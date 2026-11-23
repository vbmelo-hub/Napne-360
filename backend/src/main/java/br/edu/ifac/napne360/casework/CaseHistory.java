package br.edu.ifac.napne360.casework;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.Immutable;

import java.time.Instant;

@Entity
@Table(name = "case_history", uniqueConstraints = @UniqueConstraint(name = "uq_case_history_version", columnNames = {"case_id", "version"}),
        indexes = @Index(name = "idx_case_history_case_version", columnList = "case_id, version, id"))
@Immutable
@Getter
@Builder
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor(access = AccessLevel.PRIVATE)
public class CaseHistory {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "case_id", nullable = false, updatable = false, foreignKey = @ForeignKey(name = "fk_case_history_case"))
    private NapneCase napneCase;
    @Column(nullable = false, updatable = false)
    private long version;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 30, updatable = false)
    private Type type;
    @Enumerated(EnumType.STRING) @Column(length = 40, updatable = false)
    private CaseStage fromStage;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 40, updatable = false)
    private CaseStage toStage;
    @Column(updatable = false)
    private Long fromResponsibleId;
    @Column(length = 160, updatable = false)
    private String fromResponsible;
    @Column(nullable = false, updatable = false)
    private Long toResponsibleId;
    @Column(nullable = false, length = 160, updatable = false)
    private String toResponsible;
    @Column(nullable = false, updatable = false)
    private Long actorId;
    @Column(nullable = false, length = 160, updatable = false)
    private String actor;
    @Column(nullable = false, updatable = false)
    private Instant occurredAt;
    @Column(length = 500, updatable = false)
    private String reason;

    public enum Type { OPENED, STAGE_CHANGED, RESPONSIBLE_CHANGED }
}
