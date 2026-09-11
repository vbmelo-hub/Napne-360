package br.edu.ifac.napne360.identity;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "subject", uniqueConstraints = @UniqueConstraint(columnNames = {"course_id", "code"}))
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Subject {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "course_id", nullable = false)
    private Course course;
    @Column(nullable = false, length = 180)
    private String name;
    @Column(nullable = false, length = 60)
    private String code;
    @Column(nullable = false)
    private int workloadHours;
    @Column(columnDefinition = "TEXT")
    private String syllabus;
    @Column(nullable = false)
    @Builder.Default
    private boolean active = true;
}
