package br.edu.ifac.napne360.student;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.Instant;
import java.time.LocalDate;

@Entity
@Table(name = "student_status_history")
@Getter
@Builder
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class StudentStatusHistory {
    public enum Action {
        STATUS_CHANGED, ARCHIVED, UNARCHIVED
    }

    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(nullable = false, updatable = false)
    private Long studentId;
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, updatable = false, length = 30)
    private Action action;
    @Enumerated(EnumType.STRING)
    @Column(updatable = false, length = 30)
    private StudentStatus previousStatus;
    @Enumerated(EnumType.STRING)
    @Column(updatable = false, length = 30)
    private StudentStatus newStatus;
    @Enumerated(EnumType.STRING)
    @Column(updatable = false, length = 40)
    private StudentStatusReason reason;
    @Column(nullable = false, updatable = false)
    private LocalDate effectiveDate;
    @Column(nullable = false, updatable = false)
    private Instant recordedAt;
    @Column(updatable = false, length = 1000)
    private String observations;
    @Column(nullable = false, updatable = false)
    private Long authorId;
    @Column(nullable = false, updatable = false, length = 180)
    private String authorName;
}
