package br.edu.ifac.napne360.identity;

import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface SubjectRepository extends JpaRepository<Subject, Long> {
    @Override
    @org.springframework.data.jpa.repository.EntityGraph(attributePaths = {"course", "course.campus"})
    Optional<Subject> findById(Long id);
    List<Subject> findByCourseIdAndActiveTrueOrderByName(Long courseId);

    @Query("select s.course.id from Subject s where s.id = :id")
    Optional<Long> courseIdOf(Long id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Subject s where s.id = :id")
    Optional<Subject> findByIdForUpdate(Long id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Subject s where s.course.id = :courseId order by s.id")
    List<Subject> findByCourseIdForUpdate(Long courseId);
}
