package br.edu.ifac.napne360.identity;

import br.edu.ifac.napne360.common.ApiOperationException;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.Locale;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class UserEmailHistoryService {
    private final UserEmailHistoryRepository history;
    private final JdbcTemplate jdbc;

    public void ensureAvailable(String email, Long accountId) {
        if (history.ownerId(email).filter(id -> !id.equals(accountId)).isPresent()) {
            throw duplicateEmail();
        }
    }

    public void reserve(String email, Long accountId) {
        String address = normalize(email);
        var owner = history.ownerId(address);
        if (owner.isPresent()) {
            if (!owner.get().equals(accountId)) throw duplicateEmail();
            return;
        }
        try {
            jdbc.update("insert into user_email_history(email, user_id) values (?, ?)", address, accountId);
        } catch (DataIntegrityViolationException exception) {
            throw duplicateEmail();
        }
    }

    public Set<String> previouslyOwnedAddresses(UserAccount user) {
        if (user.getId() == null) return Set.of(normalize(user.getEmail()));
        var addresses = new java.util.HashSet<>(history.addresses(user.getId()));
        addresses.add(normalize(user.getEmail()));
        return Set.copyOf(addresses);
    }

    public static String normalize(String email) {
        return email.strip().toLowerCase(Locale.ROOT);
    }

    public static ApiOperationException duplicateEmail() {
        return new ApiOperationException(HttpStatus.CONFLICT, "USER_EMAIL_DUPLICATE",
                "Este e-mail já está vinculado a outra conta.");
    }
}
