package br.edu.ifac.napne360.identity;

import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

import java.util.Optional;
import java.util.Set;

public interface UserEmailHistoryRepository extends Repository<UserEmailHistory, String> {
    @Query("select h.user.id from UserEmailHistory h where h.email = :email")
    Optional<Long> ownerId(String email);

    @Query("select h.user from UserEmailHistory h where lower(h.email) = lower(:email)")
    Optional<UserAccount> owner(String email);

    @Query("select h.email from UserEmailHistory h where h.user.id = :userId")
    Set<String> addresses(Long userId);
}
