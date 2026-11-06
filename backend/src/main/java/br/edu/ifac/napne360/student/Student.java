package br.edu.ifac.napne360.student;

import br.edu.ifac.napne360.identity.Campus;
import br.edu.ifac.napne360.identity.Course;
import jakarta.persistence.*;
import lombok.*;

import java.time.Instant;
import java.time.LocalDate;

@Entity
@Table(name = "student")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Student {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "campus_id", nullable = false)
    private Campus campus;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "course_id", nullable = false)
    private Course course;
    @Column(nullable = false, unique = true, length = 60)
    private String registration;
    @Column(nullable = false, length = 180)
    private String civilName;
    @Column(length = 180)
    private String socialName;
    private LocalDate birthDate;
    @Column(length = 190)
    private String institutionalEmail;
    @Column(length = 40)
    private String phone;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    @Builder.Default
    private StudentStatus status = StudentStatus.ACTIVE;
    private Instant archivedAt;
    @Column(nullable = false, updatable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();
    @Column(nullable = false)
    @Builder.Default
    private Instant updatedAt = Instant.now();
    @Version
    private long version;

    public String getDisplayName() {
        return socialName == null || socialName.isBlank() ? civilName : socialName;
    }

    @PreUpdate
    void touch() { updatedAt = Instant.now(); }
}
