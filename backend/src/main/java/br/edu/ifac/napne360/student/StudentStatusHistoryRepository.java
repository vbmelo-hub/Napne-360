package br.edu.ifac.napne360.student;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface StudentStatusHistoryRepository extends JpaRepository<StudentStatusHistory, Long> {
    List<StudentStatusHistory> findByStudentIdOrderByRecordedAtDescIdDesc(Long studentId);

    Optional<StudentStatusHistory> findFirstByStudentIdAndReasonIsNotNullOrderByIdDesc(Long studentId);
}
