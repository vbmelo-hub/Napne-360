package br.edu.ifac.napne360.identity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name="reference_entry",uniqueConstraints=@UniqueConstraint(columnNames={"kind","code"}))
@Getter @Setter @Builder @NoArgsConstructor @AllArgsConstructor
public class ReferenceEntry {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) private Long id;
    @Enumerated(EnumType.STRING) @Column(nullable=false,length=30) private Kind kind;
    @Column(nullable=false,length=80) private String code;
    @Column(nullable=false,length=180) private String label;
    @Column(length=2000) private String description;
    @Builder.Default @Column(nullable=false) private boolean active=true;
    @Version private long version;
    public enum Kind { ACADEMIC_TERM, NEED_CATEGORY }
}
