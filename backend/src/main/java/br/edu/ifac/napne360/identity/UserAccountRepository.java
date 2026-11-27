package br.edu.ifac.napne360.identity;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface UserAccountRepository extends JpaRepository<UserAccount, Long>, JpaSpecificationExecutor<UserAccount> {
    @org.springframework.data.jpa.repository.EntityGraph(attributePaths = {"campus", "roles"})
    Optional<UserAccount> findByEmailIgnoreCase(String email);
    boolean existsByEmailIgnoreCase(String email);
    boolean existsByCampusIdAndActiveTrue(Long campusId);
    Optional<UserAccount> findByCpf(String cpf);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from UserAccount u where u.id = :id")
    Optional<UserAccount> findByIdForUpdate(Long id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from UserAccount u where lower(u.email) = lower(:email)")
    Optional<UserAccount> findByCurrentEmailForUpdate(String email);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from UserAccount u where u.active = true and :role member of u.roles order by u.id")
    List<UserAccount> lockActiveAccountsWithRole(RoleName role);

    @Query("select u.campus.id from UserAccount u where u.id = :id")
    Optional<Long> findCampusId(Long id);

    @org.springframework.data.jpa.repository.Query("select u from UserAccount u where u.active = true and u.campus.id = :campusId "
            + "and :role member of u.roles order by u.name, u.id")
    java.util.List<UserAccount> findResponsibleCandidates(Long campusId, RoleName role);
}
