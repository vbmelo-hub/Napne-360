package br.edu.ifac.napne360.student;

import br.edu.ifac.napne360.identity.ReferenceEntry;
import br.edu.ifac.napne360.identity.Subject;
import br.edu.ifac.napne360.identity.UserAccount;
import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;

@Entity
@Table(name = "student_assignment", uniqueConstraints = @UniqueConstraint(columnNames = {
        "student_id", "user_id", "subject_id", "period_id"}))
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class StudentAssignment {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", nullable = false)
    private Student student;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private UserAccount user;
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "subject_id")
    private Subject subject;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private AssignmentType assignmentType;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    @Builder.Default
    private AssignmentOrigin origin = AssignmentOrigin.MANUAL;
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "period_id")
    private ReferenceEntry period;
    @Column(nullable = false)
    private boolean securityBlock;
    @Column(nullable = false)
    @Builder.Default
    private boolean active = true;
    @Column(nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();
}
