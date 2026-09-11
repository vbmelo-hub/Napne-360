package br.edu.ifac.napne360.casework;

import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.student.Student;
import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;

@Entity
@Table(name = "napne_case")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class NapneCase {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", nullable = false)
    private Student student;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 40)
    @Builder.Default
    private CaseStage stage = CaseStage.RECEIVED;
    @Column(nullable = false, length = 80)
    private String source;
    @Column(nullable = false)
    @Builder.Default
    private Instant openedAt = Instant.now();
    private Instant closedAt;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "responsible_user_id", nullable = false)
    private UserAccount responsible;
    @Column(length = 500)
    private String summary;
    @Version
    private long version;
}
