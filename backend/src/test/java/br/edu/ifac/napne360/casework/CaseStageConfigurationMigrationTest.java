package br.edu.ifac.napne360.casework;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import java.util.ArrayList;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CaseStageConfigurationMigrationTest {
    @Test void v5SeedsTheOrderedCatalogueAndPreservesExistingHistory() throws Exception {
        var source = new DriverManagerDataSource("jdbc:h2:mem:migration_" + UUID.randomUUID()
                + ";MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
        var sql = new JdbcTemplate(source);
        sql.execute("create table napne_case (id bigint primary key, stage varchar(40) not null)");
        sql.update("insert into napne_case (id, stage) values (1, 'WELCOMING')");
        new ResourceDatabasePopulator(new ClassPathResource("db/migration/V4__case_history.sql")).execute(source);
        sql.update("insert into case_history(case_id,version,type,from_stage,to_stage,to_responsible_id,to_responsible,actor_id,actor,occurred_at)"
                + " values (1,0,'STAGE_CHANGED','SCREENING','WELCOMING',2,'Responsável',2,'Ator',current_timestamp)");

        new ResourceDatabasePopulator(new ClassPathResource("db/migration/V5__case_stage_configuration.sql")).execute(source);

        assertThat(sql.queryForObject("select stage from napne_case where id=1", String.class)).isEqualTo("WELCOMING");
        assertThat(sql.queryForMap("select from_stage, to_stage, from_stage_label, to_stage_label from case_history where case_id=1"))
                .containsEntry("FROM_STAGE", "SCREENING").containsEntry("TO_STAGE", "WELCOMING")
                .containsEntry("FROM_STAGE_LABEL", null).containsEntry("TO_STAGE_LABEL", null);

        String catalogue = sql.queryForObject("select stages_json from case_stage_configuration where id=1 and version=0", String.class);
        var stages = new ObjectMapper().readTree(catalogue);
        var entries = new ArrayList<String>();
        stages.forEach(stage -> entries.add(stage.get("code").asText() + "/" + stage.get("label").asText()));
        assertThat(entries).containsExactly("RECEIVED/Recebido", "SCREENING/Triagem", "WELCOMING/Acolhimento",
                "CASE_STUDY/Estudo de caso", "GUIDANCE_ISSUED/Orientações emitidas", "ACTION_PLAN/Plano de ação",
                "PEI/PEI", "FOLLOW_UP/Acompanhamento", "CLOSED/Encerrado", "ARCHIVED/Arquivado");
        assertThatThrownBy(() -> sql.update("insert into case_stage_configuration (id, version, stages_json) values (2, 0, ?)", catalogue))
                .isInstanceOf(DataIntegrityViolationException.class);
    }
}
