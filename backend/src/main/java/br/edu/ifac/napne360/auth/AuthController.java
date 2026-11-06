package br.edu.ifac.napne360.auth;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.identity.UserAccountRepository;
import br.edu.ifac.napne360.security.CurrentUserService;
import br.edu.ifac.napne360.security.JwtService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.Set;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
public class AuthController {
    private final AuthenticationManager authenticationManager;
    private final JwtService jwtService;
    private final UserAccountRepository users;
    private final CurrentUserService currentUser;
    private final AuditService audit;
    private final org.springframework.security.crypto.password.PasswordEncoder passwords;
    private final LoginRateLimiter rateLimiter;

    @PostMapping("/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest request, HttpServletRequest http) {
        rateLimiter.acquire(request.email(),http.getRemoteAddr());
        Authentication authentication;
        try {
            authentication = authenticationManager.authenticate(new UsernamePasswordAuthenticationToken(request.email(), request.password()));
        } catch (org.springframework.security.core.AuthenticationException exception) {
            audit.record(null, http, "AUTH_LOGIN", "USER", null, "DENIED", "Credenciais inválidas");
            throw exception;
        }
        UserAccount user = users.findByEmailIgnoreCase(authentication.getName()).orElseThrow();
        rateLimiter.success(request.email(),http.getRemoteAddr());
        audit.record(authentication, http, "AUTH_LOGIN", "USER", user.getId(), "SUCCESS", null);
        return response(user, jwtService.create(user));
    }

    @GetMapping("/me")
    public AuthResponse me() { return response(currentUser.require(), null); }

    @PostMapping("/refresh")
    public AuthResponse refresh(Authentication authentication, HttpServletRequest http) {
        UserAccount user = currentUser.require();
        audit.record(authentication, http, "AUTH_REFRESH", "USER", user.getId(), "SUCCESS", null);
        return response(user, jwtService.create(user));
    }

    @PostMapping("/logout")
    @org.springframework.transaction.annotation.Transactional
    public void logout(Authentication authentication, HttpServletRequest http) {
        UserAccount user = currentUser.require();
        user.setSessionVersion(user.getSessionVersion() + 1);
        users.save(user);
        audit.record(authentication, http, "AUTH_LOGOUT", "USER", user.getId(), "SUCCESS", "Sessões anteriores revogadas");
    }

    @PostMapping("/password")
    @org.springframework.transaction.annotation.Transactional
    public void changePassword(@Valid @RequestBody PasswordRequest request, Authentication authentication, HttpServletRequest http) {
        UserAccount user = currentUser.require();
        if (!passwords.matches(request.currentPassword(), user.getPasswordHash()))
            throw new org.springframework.security.authentication.BadCredentialsException("Invalid credentials");
        user.setPasswordHash(passwords.encode(request.newPassword()));
        user.setSessionVersion(user.getSessionVersion() + 1);
        users.save(user);
        audit.record(authentication, http, "PASSWORD_CHANGE", "USER", user.getId(), "SUCCESS", null);
    }

    private AuthResponse response(UserAccount user, String token) {
        return new AuthResponse(token, user.getId(), user.getName(), user.getEmail(),
                user.getCampus() == null ? null : user.getCampus().getId(),
                user.getRoles().stream().map(Enum::name).collect(Collectors.toSet()));
    }

    public record LoginRequest(@Email @NotBlank String email, @NotBlank String password) {}
    public record PasswordRequest(@NotBlank String currentPassword,
                                  @jakarta.validation.constraints.Size(min = 12, max = 72) String newPassword) {}
    public record AuthResponse(String token, Long id, String name, String email, Long campusId, Set<String> roles) {}
}
