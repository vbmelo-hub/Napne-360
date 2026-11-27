package br.edu.ifac.napne360.auth;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.identity.UserAccountRepository;
import br.edu.ifac.napne360.security.JwtService;
import br.edu.ifac.napne360.security.NapneUserDetailsService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.Set;
import java.util.stream.Collectors;

import static br.edu.ifac.napne360.security.JwtAuthenticationFilter.SESSION_ATTRIBUTE;

@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {
    private final AuthenticationManager authenticationManager;
    private final JwtService jwtService;
    private final UserAccountRepository users;
    private final AuditService audit;
    private final org.springframework.security.crypto.password.PasswordEncoder passwords;
    private final LoginRateLimiter rateLimiter;

    @PostMapping("/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest request, HttpServletRequest http) {
        rateLimiter.acquire(request.email(),http.getRemoteAddr());
        Authentication authentication;
        UserAccount user;
        try {
            authentication = authenticationManager.authenticate(new UsernamePasswordAuthenticationToken(request.email(), request.password()));
            user = users.findByEmailIgnoreCase(authentication.getName()).orElseThrow(
                    () -> new BadCredentialsException("Invalid credentials"));
            if (!(authentication.getPrincipal() instanceof NapneUserDetailsService.AccountDetails details)
                    || !details.matches(user)) {
                throw new BadCredentialsException("Invalid credentials");
            }
        } catch (org.springframework.security.core.AuthenticationException exception) {
            audit.record(null, http, "AUTH_LOGIN", "USER", null, "DENIED", "Credenciais inválidas");
            throw exception;
        }
        rateLimiter.success(request.email(),http.getRemoteAddr());
        audit.record(authentication, http, "AUTH_LOGIN", "USER", user.getId(), "SUCCESS", null);
        JwtService.IssuedToken issued = jwtService.create(user);
        return response(user, issued.token(), issued.timing());
    }

    @GetMapping("/me")
    public AuthResponse me(@RequestAttribute(SESSION_ATTRIBUTE) JwtService.Session session) {
        UserAccount user = users.findByEmailIgnoreCase(session.email()).orElse(null);
        session.requireAccount(user);
        return response(user, null, jwtService.timing(session));
    }

    @PostMapping("/refresh")
    public AuthResponse refresh(@RequestAttribute(SESSION_ATTRIBUTE) JwtService.Session session,
                                Authentication authentication, HttpServletRequest http) {
        UserAccount user = users.findByEmailIgnoreCase(session.email()).orElse(null);
        JwtService.IssuedToken issued = jwtService.refresh(user, session);
        audit.record(authentication, http, "AUTH_REFRESH", "USER", user.getId(), "SUCCESS", null);
        return response(user, issued.token(), issued.timing());
    }

    @PostMapping("/logout")
    @org.springframework.transaction.annotation.Transactional
    public void logout(@RequestAttribute(SESSION_ATTRIBUTE) JwtService.Session session, HttpServletRequest http) {
        UserAccount user = requireAccountForUpdate(session);
        user.setSessionVersion(user.getSessionVersion() + 1);
        audit.recordWithAccountLock(user, http, "AUTH_LOGOUT", "Sessões anteriores revogadas");
    }

    @PostMapping("/password")
    @org.springframework.transaction.annotation.Transactional
    public void changePassword(@Valid @RequestBody PasswordRequest request,
                               @RequestAttribute(SESSION_ATTRIBUTE) JwtService.Session session, HttpServletRequest http) {
        UserAccount user = requireAccountForUpdate(session);
        if (!passwords.matches(request.currentPassword(), user.getPasswordHash()))
            throw new org.springframework.security.authentication.BadCredentialsException("Invalid credentials");
        user.setPasswordHash(passwords.encode(request.newPassword()));
        user.setSessionVersion(user.getSessionVersion() + 1);
        audit.recordWithAccountLock(user, http, "PASSWORD_CHANGE", null);
    }

    private UserAccount requireAccountForUpdate(JwtService.Session session) {
        UserAccount user = users.findByIdForUpdate(session.userId()).orElse(null);
        jwtService.requireCurrentSession(user, session);
        return user;
    }

    private AuthResponse response(UserAccount user, String token, JwtService.SessionTiming session) {
        return new AuthResponse(token, user.getId(), user.getName(), user.getEmail(),
                user.getCampus() == null ? null : user.getCampus().getId(),
                user.getRoles().stream().map(Enum::name).collect(Collectors.toSet()), session);
    }

    public record LoginRequest(@Email @NotBlank String email, @NotBlank String password) {}
    public record PasswordRequest(@NotBlank String currentPassword,
                                  @NotBlank @jakarta.validation.constraints.Size(min = 12, max = 72) String newPassword) {}
    public record AuthResponse(String token, Long id, String name, String email, Long campusId, Set<String> roles,
                               JwtService.SessionTiming session) {}
}
