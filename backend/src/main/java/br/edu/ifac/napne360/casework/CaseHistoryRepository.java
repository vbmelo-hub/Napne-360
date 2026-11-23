package br.edu.ifac.napne360.casework;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CaseHistoryRepository extends JpaRepository<CaseHistory, Long> {
    Page<CaseHistory> findByNapneCaseId(Long caseId, Pageable pageable);
}
