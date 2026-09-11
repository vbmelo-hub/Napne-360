package br.edu.ifac.napne360.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

@Component
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    private final JwtService jwtService;
    private final NapneUserDetailsService userDetailsService;
    private final br.edu.ifac.napne360.identity.UserAccountRepository users;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String authorization = request.getHeader("Authorization");
        if (authorization == null || !authorization.startsWith("Bearer ")
                || SecurityContextHolder.getContext().getAuthentication() != null) {
            chain.doFilter(request, response);
            return;
        }
        try {
            String token = authorization.substring(7);
            String username = jwtService.subject(token);
            UserDetails details = userDetailsService.loadUserByUsername(username);
            var account = users.findByEmailIgnoreCase(username).orElseThrow();
            if (details.isEnabled() && details.isAccountNonLocked() && details.isAccountNonExpired()
                    && details.isCredentialsNonExpired() && jwtService.isValid(token, details.getUsername())
                    && jwtService.sessionVersion(token) == account.getSessionVersion()) {
                var authentication = new UsernamePasswordAuthenticationToken(details, null, details.getAuthorities());
                SecurityContextHolder.getContext().setAuthentication(authentication);
            }
        } catch (RuntimeException ignored) {
            SecurityContextHolder.clearContext();
        }
        chain.doFilter(request, response);
    }
}
