package br.edu.ifac.napne360.identity;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SubjectRepository extends JpaRepository<Subject, Long> {
    @Override
    @org.springframework.data.jpa.repository.EntityGraph(attributePaths = {"course", "course.campus"})
    java.util.Optional<Subject> findById(Long id);
    List<Subject> findByCourseIdAndActiveTrueOrderByName(Long courseId);
}
