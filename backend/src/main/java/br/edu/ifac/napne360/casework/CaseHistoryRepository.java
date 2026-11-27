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
                and (:actorId is null or h.actorId = :actorId)
                and (:version is null or h.version = :version)
                and (:from is null or h.occurredAt >= :from)
                and (:to is null or h.occurredAt <= :to)
            """)
    Page<CaseHistory> filter(Long caseId, CaseHistory.Type type, String actor, Long actorId, Long version,
                             Instant from, Instant to, Pageable pageable);

    @Query("""
            select h.actorId as id, h.actor as name from CaseHistory h
            where h.napneCase.id = :caseId and h.version = (
                select max(entry.version) from CaseHistory entry
                where entry.napneCase.id = :caseId and entry.actorId = h.actorId
            )
            order by h.actor, h.actorId
            """)
    java.util.List<Author> authors(Long caseId);

    interface Author {
        Long getId();
        String getName();
    }
}
