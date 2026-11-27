package br.edu.ifac.napne360.academic;

import br.edu.ifac.napne360.identity.ReferenceEntry;
import br.edu.ifac.napne360.identity.Subject;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "academic_offering", uniqueConstraints = @UniqueConstraint(columnNames = {"subject_id", "period_id", "group_code"}))
@Getter @Setter @NoArgsConstructor
public class AcademicOffering {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "subject_id", nullable = false)
    private Subject subject;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "period_id", nullable = false)
    private ReferenceEntry period;

    @Column(nullable = false, length = 60)
    private String groupCode;

    @Column(nullable = false)
    private boolean active = true;

    public AcademicOffering(Subject subject, ReferenceEntry period, String groupCode) {
        this.subject = subject;
        this.period = period;
        this.groupCode = groupCode;
    }
}
