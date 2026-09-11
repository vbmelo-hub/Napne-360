package br.edu.ifac.napne360.security;

import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.identity.UserAccountRepository;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.User;
import java.util.Optional;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class JwtAuthenticationFilterTest {
    @Test void disabledAccountCannotUseExistingJwt() throws Exception {
        var jwt = mock(JwtService.class);
        var details = mock(NapneUserDetailsService.class);
        var users = mock(UserAccountRepository.class);
        when(jwt.subject("old-token")).thenReturn("user@test.local");
        when(details.loadUserByUsername("user@test.local")).thenReturn(User.withUsername("user@test.local")
                .password("ignored").roles("TEACHER").disabled(true).build());
        when(users.findByEmailIgnoreCase("user@test.local")).thenReturn(Optional.of(UserAccount.builder().active(false).build()));
        var request = new MockHttpServletRequest();
        request.addHeader("Authorization","Bearer old-token");
        SecurityContextHolder.clearContext();
        new JwtAuthenticationFilter(jwt,details,users).doFilter(request,new MockHttpServletResponse(),(req,res)->
                assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull());
        SecurityContextHolder.clearContext();
    }
}
