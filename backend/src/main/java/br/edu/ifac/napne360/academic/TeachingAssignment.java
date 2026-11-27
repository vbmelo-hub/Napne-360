package br.edu.ifac.napne360.academic;

import br.edu.ifac.napne360.identity.UserAccount;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "teaching_assignment", uniqueConstraints = @UniqueConstraint(columnNames = {"teacher_id", "offering_id"}))
@Getter @Setter @NoArgsConstructor
public class TeachingAssignment {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "teacher_id", nullable = false)
    private UserAccount teacher;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "offering_id", nullable = false)
    private AcademicOffering offering;

    @Column(nullable = false)
    private boolean active = true;

    @Version
    private long version;

    public TeachingAssignment(UserAccount teacher, AcademicOffering offering) {
        this.teacher = teacher;
        this.offering = offering;
    }
}
