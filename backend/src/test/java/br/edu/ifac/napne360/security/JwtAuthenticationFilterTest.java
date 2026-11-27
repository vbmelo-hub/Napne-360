package br.edu.ifac.napne360.security;

import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.identity.UserAccountRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;

import java.time.Clock;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class JwtAuthenticationFilterTest {
    private final JwtService jwt = new JwtService(JwtServiceTest.TEST_SECRET, 60, 30, 5, 480, Clock.systemUTC());
    private final UserAccountRepository users = mock(UserAccountRepository.class);
    private final UserAccount account = UserAccount.builder().id(1L).email("user@test.local").passwordHash("ignored").build();

    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void disabledAccountCannotUseExistingJwt() throws Exception {
        var request = authenticatedRequest();
        account.setActive(false);
        account.setSessionVersion(1L);
        var response = new MockHttpServletResponse();

        new JwtAuthenticationFilter(jwt, users).doFilter(request, response, (req, res) ->
                assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull());
        assertThat(response.getHeader(JwtService.STATUS_HEADER)).isEqualTo("ACCOUNT_INACTIVE");
    }

    @Test
    void revokedAccountVersionRejectsExistingJwt() throws Exception {
        var request = authenticatedRequest();
        account.setSessionVersion(1L);
        var response = new MockHttpServletResponse();

        new JwtAuthenticationFilter(jwt, users).doFilter(request, response, (req, res) ->
                assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull());
        assertThat(response.getHeader(JwtService.STATUS_HEADER)).isEqualTo("REVOKED");
    }

    private MockHttpServletRequest authenticatedRequest() {
        var request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer " + jwt.create(account).token());
        when(users.findByEmailIgnoreCase(account.getEmail())).thenReturn(Optional.of(account));
        return request;
    }
}
