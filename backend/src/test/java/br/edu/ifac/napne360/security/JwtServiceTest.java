package br.edu.ifac.napne360.security;

import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

class JwtServiceTest {
    @Test
    void createsAndValidatesTokenForUser() {
        JwtService service = new JwtService("test-secret-that-is-long-enough-for-hmac-signing-key", 10);
        UserAccount user = UserAccount.builder().id(42L).name("Equipe").email("napne@example.test")
                .passwordHash("ignored").roles(Set.of(RoleName.NAPNE)).build();

        String token = service.create(user);

        assertThat(service.subject(token)).isEqualTo("napne@example.test");
        assertThat(service.isValid(token, "napne@example.test")).isTrue();
        assertThat(service.isValid(token, "other@example.test")).isFalse();
    }
}
