package br.edu.ifac.napne360.casework;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface NapneCaseRepository extends JpaRepository<NapneCase, Long> {
    List<NapneCase> findByStudentIdOrderByOpenedAtDesc(Long studentId);
    Optional<NapneCase> findFirstByStudentIdAndStageNotInOrderByOpenedAtDesc(Long studentId, List<CaseStage> stages);
}
