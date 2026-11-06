package br.edu.ifac.napne360.student;

import org.springframework.data.jpa.repository.JpaRepository;

public interface StudentAssignmentRepository extends JpaRepository<StudentAssignment, Long> {
    @org.springframework.data.jpa.repository.EntityGraph(attributePaths = {"user", "user.roles", "subject"})
    java.util.List<StudentAssignment> findByStudentIdAndActiveTrue(Long studentId);
    boolean existsByStudentIdAndUserIdAndActiveTrue(Long studentId, Long userId);
    boolean existsByStudentIdAndUserIdAndSubjectIdAndActiveTrue(Long studentId, Long userId, Long subjectId);
}
