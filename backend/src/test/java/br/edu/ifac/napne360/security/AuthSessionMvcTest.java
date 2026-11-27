package br.edu.ifac.napne360.security;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.auth.AuthController;
import br.edu.ifac.napne360.auth.LoginRateLimiter;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.identity.UserAccountRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(controllers = AuthController.class, properties = "napne360.security.jwt-secret=" + JwtServiceTest.TEST_SECRET)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, JwtService.class, NapneUserDetailsService.class,
        CurrentUserService.class, LoginRateLimiter.class})
class AuthSessionMvcTest {
    private static final String AUTH = "/api/v1/auth";
    private static final String EMAIL = "usuario@example.test";
    private static final String PASSWORD = "initial-secret-123";

    @Autowired private MockMvc mvc;
    @Autowired private ObjectMapper json;
    @Autowired private PasswordEncoder passwords;
    @MockitoBean private AuditService audit;
    @MockitoBean private UserAccountRepository users;
    private UserAccount account;

    @BeforeEach
    void setUp() {
        account = UserAccount.builder().id(12L).email(EMAIL).name("Docente")
                .passwordHash(passwords.encode(PASSWORD)).roles(Set.of(RoleName.TEACHER)).build();
        when(users.findByEmailIgnoreCase(EMAIL)).thenReturn(Optional.of(account));
    }

    @Test
    void ordinaryRequestsReportTheSameDeadlineAndPasswordChangeRevokesIssuedTokens() throws Exception {
        var login = json.readTree(mvc.perform(post(AUTH + "/login").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"usuario@example.test","password":"initial-secret-123"}
                                """))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        String originalToken = login.get("token").asText();
        long originalDeadline = login.at("/session/expiresAt").asLong();
        assertThat(originalDeadline).isPositive();

        mvc.perform(get(AUTH + "/me").header("Authorization", "Bearer " + originalToken))
                .andExpect(status().isOk()).andExpect(jsonPath("$.session.expiresAt").value(originalDeadline));

        var refreshed = json.readTree(mvc.perform(post(AUTH + "/refresh").header("Authorization", "Bearer " + originalToken))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        String renewedToken = refreshed.get("token").asText();
        assertThat(renewedToken).isNotBlank();

        when(users.findByIdForUpdate(account.getId())).thenReturn(Optional.of(account));

        mvc.perform(post(AUTH + "/password").header("Authorization", "Bearer " + renewedToken)
                        .contentType(MediaType.APPLICATION_JSON).content("""
                                {"currentPassword":"initial-secret-123","newPassword":"replacement-secret-123"}
                                """))
                .andExpect(status().isOk());

        mvc.perform(post(AUTH + "/refresh").header("Authorization", "Bearer " + renewedToken))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string(JwtService.STATUS_HEADER, "REVOKED"));
    }
    @Test
    void sessionMutationRevalidatesTheLockedAccountVersion() throws Exception {
        var login = json.readTree(mvc.perform(post(AUTH + "/login").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"usuario@example.test","password":"initial-secret-123"}
                                """))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        var locked = UserAccount.builder().id(account.getId()).email(EMAIL).name("Docente")
                .passwordHash(account.getPasswordHash()).roles(Set.of(RoleName.TEACHER)).sessionVersion(2).build();
        when(users.findByIdForUpdate(account.getId())).thenReturn(Optional.of(locked));

        mvc.perform(post(AUTH + "/logout").header("Authorization", "Bearer " + login.get("token").asText()))
                .andExpect(status().isUnauthorized())
                .andExpect(header().string(JwtService.STATUS_HEADER, "REVOKED"));
        assertThat(locked.getSessionVersion()).isEqualTo(2);
    }

}
