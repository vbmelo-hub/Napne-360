package br.edu.ifac.napne360.casework;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.Instant;

public interface CaseHistoryRepository extends JpaRepository<CaseHistory, Long> {
    @Query("""
            select h from CaseHistory h where h.napneCase.id = :caseId
                and (:type is null or h.type = :type)
                and (:actor is null or lower(h.actor) = lower(:actor))
                and (:version is null or h.version = :version)
                and (:from is null or h.occurredAt >= :from)
                and (:to is null or h.occurredAt <= :to)
            """)
    Page<CaseHistory> filter(Long caseId, CaseHistory.Type type, String actor, Long version,
                             Instant from, Instant to, Pageable pageable);
}
