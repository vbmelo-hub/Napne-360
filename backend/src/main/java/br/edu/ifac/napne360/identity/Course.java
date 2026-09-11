package br.edu.ifac.napne360.identity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "course", uniqueConstraints = @UniqueConstraint(columnNames = {"campus_id", "code"}))
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Course {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "campus_id", nullable = false)
    private Campus campus;
    @Column(nullable = false, length = 180)
    private String name;
    @Column(nullable = false, length = 60)
    private String code;
    @Column(nullable = false)
    @Builder.Default
    private boolean active = true;
}
