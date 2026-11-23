package br.edu.ifac.napne360.casework;

import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

interface CaseStageConfigurationRepository extends Repository<CaseStageConfiguration, Integer> {
    Optional<CaseStageConfiguration> findById(Integer id);

    @Modifying
    @Query("""
            update CaseStageConfiguration configuration
            set configuration.stagesJson = :stagesJson, configuration.version = configuration.version + 1
            where configuration.id = :id and configuration.version = :version
            """)
    int updateIfCurrent(@Param("id") int id, @Param("version") long version, @Param("stagesJson") String stagesJson);
}
