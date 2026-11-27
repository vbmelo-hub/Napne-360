package br.edu.ifac.napne360.security;

import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class JwtServiceTest {
    static final String TEST_SECRET = "test-secret-that-is-long-enough-for-hmac-signing-key";
    private static final Instant START = Instant.parse("2026-10-01T12:00:00Z");
    private final Clock clock = mock(Clock.class);
    private final JwtService service = new JwtService(TEST_SECRET, 60, 30, 5, 480, clock);
    private final UserAccount account = UserAccount.builder().id(42L).name("Equipe").email("napne@example.test")
            .passwordHash("ignored").roles(Set.of(RoleName.NAPNE)).build();

    @BeforeEach
    void setUp() {
        advanceTo(Duration.ZERO);
    }

    @Test
    void capsNewTokenAtThirtyMinutesOfInactivityEvenWithLongerJwtConfiguration() {
        var issued = service.create(account);

        var parsed = service.parse(issued.token());
        assertThat(parsed.email()).isEqualTo("napne@example.test");
        assertThat(parsed.expiresAt()).isEqualTo(START.plus(Duration.ofMinutes(30)));
        assertThat(issued.timing().warningAt()).isEqualTo(START.plus(Duration.ofMinutes(25)).toEpochMilli());
        advanceTo(Duration.ofMinutes(30));
        assertThatThrownBy(() -> service.parse(issued.token())).isInstanceOfSatisfying(
                JwtService.SessionRejected.class, rejected -> assertThat(rejected.reason()).isEqualTo(JwtService.EndReason.IDLE_TIMEOUT));
    }

    @Test
    void renewsFromCurrentActivityButStillExpiresEightHoursAfterLogin() {
        var issued = service.create(account);
        for (int minute = 20; minute < 480; minute += 20) {
            advanceTo(Duration.ofMinutes(minute));
            issued = service.refresh(account, service.parse(issued.token()));
        }

        assertThat(issued.timing().reason()).isEqualTo(JwtService.EndReason.MAX_DURATION);
        assertThat(issued.timing().expiresAt()).isEqualTo(START.plus(Duration.ofHours(8)).toEpochMilli());
        assertThat(issued.timing().warningAt()).isEqualTo(START.plus(Duration.ofMinutes(475)).toEpochMilli());

        var originalSession = service.parse(issued.token());
        advanceTo(Duration.ofHours(8));
        assertThatThrownBy(() -> service.refresh(account, originalSession)).isInstanceOfSatisfying(
                JwtService.SessionRejected.class, rejected -> assertThat(rejected.reason()).isEqualTo(JwtService.EndReason.MAX_DURATION));
    }

    @Test
    void cannotRenewASessionRevokedAfterTheRequestWasAuthenticated() {
        var originalSession = service.parse(service.create(account).token());
        account.setSessionVersion(1L);

        assertThatThrownBy(() -> service.refresh(account, originalSession)).isInstanceOfSatisfying(
                JwtService.SessionRejected.class, rejected -> assertThat(rejected.reason()).isEqualTo(JwtService.EndReason.REVOKED));
    }

    private void advanceTo(Duration elapsed) {
        when(clock.instant()).thenReturn(START.plus(elapsed));
    }
}
