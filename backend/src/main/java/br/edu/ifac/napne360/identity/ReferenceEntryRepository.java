package br.edu.ifac.napne360.identity;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface ReferenceEntryRepository extends JpaRepository<ReferenceEntry,Long> {
    Optional<ReferenceEntry> findByKindAndCode(ReferenceEntry.Kind kind, String code);
    List<ReferenceEntry> findByKindAndActiveTrueOrderByLabel(ReferenceEntry.Kind kind);
}
