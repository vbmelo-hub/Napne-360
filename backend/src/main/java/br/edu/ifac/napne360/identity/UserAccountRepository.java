package br.edu.ifac.napne360.identity;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface UserAccountRepository extends JpaRepository<UserAccount, Long> {
    @org.springframework.data.jpa.repository.EntityGraph(attributePaths = {"campus", "roles"})
    Optional<UserAccount> findByEmailIgnoreCase(String email);
    boolean existsByEmailIgnoreCase(String email);

    @org.springframework.data.jpa.repository.Query("select u from UserAccount u where u.active = true and u.campus.id = :campusId "
            + "and :role member of u.roles order by u.name, u.id")
    java.util.List<UserAccount> findResponsibleCandidates(Long campusId, RoleName role);
}
