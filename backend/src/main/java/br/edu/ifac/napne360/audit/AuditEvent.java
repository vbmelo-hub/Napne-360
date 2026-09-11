package br.edu.ifac.napne360.audit;

import br.edu.ifac.napne360.identity.UserAccount;
import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;

@Entity
@Table(name = "audit_event")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AuditEvent {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "actor_user_id")
    private UserAccount actor;
    @Column(nullable = false, length = 80)
    private String action;
    @Column(nullable = false, length = 80)
    private String resourceType;
    @Column(length = 100)
    private String resourceId;
    @Column(nullable = false, length = 20)
    private String outcome;
    @Column(length = 64)
    private String ipAddress;
    @Column(nullable = false)
    @Builder.Default
    private Instant occurredAt = Instant.now();
    @Column(length = 500)
    private String details;
}
