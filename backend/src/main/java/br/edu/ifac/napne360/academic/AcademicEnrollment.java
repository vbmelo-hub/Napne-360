package br.edu.ifac.napne360.academic;

import br.edu.ifac.napne360.student.Student;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "academic_enrollment", uniqueConstraints = @UniqueConstraint(columnNames = {"student_id", "offering_id"}))
@Getter @Setter @NoArgsConstructor
public class AcademicEnrollment {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "student_id", nullable = false)
    private Student student;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "offering_id", nullable = false)
    private AcademicOffering offering;

    @Column(nullable = false)
    private boolean active = true;

    public AcademicEnrollment(Student student, AcademicOffering offering) {
        this.student = student;
        this.offering = offering;
    }
}
