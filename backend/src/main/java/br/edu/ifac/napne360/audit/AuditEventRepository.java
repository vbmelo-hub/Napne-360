package br.edu.ifac.napne360.audit;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;

public interface AuditEventRepository extends JpaRepository<AuditEvent, Long> {
    Page<AuditEvent> findByResourceTypeAndResourceIdAndActorCampusIdOrderByOccurredAtDesc(String resourceType, String resourceId, Long campusId, Pageable pageable);

    @Modifying
    @Query(value = """
            INSERT INTO audit_event
                (projection_key, actor_user_id, action, resource_type, resource_id, outcome, ip_address, occurred_at, details)
            VALUES (:key, :actorId, :action, 'PEI', :revisionId, 'SUCCESS', :ipAddress, :occurredAt, :details)
            ON DUPLICATE KEY UPDATE projection_key = audit_event.projection_key
            """, nativeQuery = true)
    void insertPeiMutationIfAbsent(@Param("key") String key, @Param("actorId") Long actorId,
                                  @Param("action") String action, @Param("revisionId") String revisionId,
                                  @Param("ipAddress") String ipAddress, @Param("occurredAt") Instant occurredAt,
                                  @Param("details") String details);
}
