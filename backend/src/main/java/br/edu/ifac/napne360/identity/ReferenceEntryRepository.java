package br.edu.ifac.napne360.identity;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ReferenceEntryRepository extends JpaRepository<ReferenceEntry,Long> {
    List<ReferenceEntry> findByKindAndActiveTrueOrderByLabel(ReferenceEntry.Kind kind);
}
