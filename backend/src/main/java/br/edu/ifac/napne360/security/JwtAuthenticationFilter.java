package br.edu.ifac.napne360.security;

import br.edu.ifac.napne360.identity.UserAccountRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

@Component
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    public static final String SESSION_ATTRIBUTE = "napne360.authenticatedSession";

    private final JwtService jwtService;
    private final UserAccountRepository users;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String authorization = request.getHeader("Authorization");
        if (authorization != null && authorization.startsWith("Bearer ")
                && SecurityContextHolder.getContext().getAuthentication() == null) {
            try {
                var session = jwtService.parse(authorization.substring(7));
                var user = users.findByEmailIgnoreCase(session.email()).orElse(null);
                session.requireAccount(user);
                var details = NapneUserDetailsService.detailsFor(user);
                var authentication = new UsernamePasswordAuthenticationToken(details, null, details.getAuthorities());
                SecurityContextHolder.getContext().setAuthentication(authentication);
                request.setAttribute(SESSION_ATTRIBUTE, session);
            } catch (JwtService.SessionRejected rejected) {
                response.setHeader(JwtService.STATUS_HEADER, rejected.reason().name());
            }
        }
        chain.doFilter(request, response);
    }
}
