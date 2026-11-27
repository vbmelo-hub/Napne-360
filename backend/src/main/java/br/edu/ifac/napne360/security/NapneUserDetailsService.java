package br.edu.ifac.napne360.security;

import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.identity.UserAccountRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class NapneUserDetailsService implements UserDetailsService {
    private final UserAccountRepository users;

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        UserAccount account = users.findByEmailIgnoreCase(username)
                .orElseThrow(() -> new UsernameNotFoundException("Invalid credentials"));
        return detailsFor(account);
    }

    static AccountDetails detailsFor(UserAccount account) {
        return new AccountDetails(account);
    }

    public static final class AccountDetails extends User {
        private final long accountId;
        private final long sessionVersion;

        private AccountDetails(UserAccount account) {
            super(account.getEmail(), account.getPasswordHash(), account.isActive(), true, true, true,
                    account.getRoles().stream().map(role -> new SimpleGrantedAuthority("ROLE_" + role.name())).toList());
            this.accountId = account.getId();
            this.sessionVersion = account.getSessionVersion();
        }

        public boolean matches(UserAccount account) {
            return account.getId() == accountId && account.getSessionVersion() == sessionVersion && account.isActive();
        }
    }
}
