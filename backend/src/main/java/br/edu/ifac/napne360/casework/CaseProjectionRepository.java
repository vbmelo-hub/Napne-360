package br.edu.ifac.napne360.casework;

import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

interface CaseProjectionRepository extends JpaRepository<CaseProjectionEntry, String> {
    List<CaseProjectionEntry> findByProjectionKeyGreaterThanOrderByProjectionKey(String key, Pageable pageable);

    @Transactional
    @Modifying
    @Query("delete from CaseProjectionEntry entry where entry.projectionKey = :key")
    void acknowledge(@Param("key") String key);
}
