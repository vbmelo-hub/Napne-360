package br.edu.ifac.napne360.casework;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import jakarta.persistence.LockModeType;

import java.util.List;
import java.util.Optional;

public interface NapneCaseRepository extends JpaRepository<NapneCase, Long> {
    List<NapneCase> findByStudentIdOrderByOpenedAtDesc(Long studentId);
    boolean existsByResponsibleIdAndStageNotIn(Long responsibleId, List<CaseStage> stages);
    boolean existsByStudentCampusIdAndStageNotIn(Long campusId, List<CaseStage> stages);
    Optional<NapneCase> findFirstByStudentIdAndStageNotInOrderByOpenedAtDesc(Long studentId, List<CaseStage> stages);

    @Lock(LockModeType.PESSIMISTIC_READ)
    @Query("select c from NapneCase c where c.id = :caseId and c.student.id = :studentId")
    Optional<NapneCase> findByIdAndStudentIdForLink(@Param("caseId") Long caseId, @Param("studentId") Long studentId);

}
