package br.edu.ifac.napne360.casework;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import java.util.UUID;

import static org.assertj.core.api.Assertions.*;

class CaseHistoryMigrationTest {
    @Test void v4AppliesWithoutBackfillAndEnforcesCaseAndVersionIntegrity() {
        var source = new DriverManagerDataSource("jdbc:h2:mem:migration_" + UUID.randomUUID() + ";MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
        var sql = new JdbcTemplate(source);
        sql.execute("create table napne_case (id bigint primary key)");
        sql.update("insert into napne_case(id) values (1)");
        new ResourceDatabasePopulator(new ClassPathResource("db/migration/V4__case_history.sql")).execute(source);
        assertThat(sql.queryForObject("select count(*) from case_history", Long.class)).isZero();
        String insert = "insert into case_history(case_id,version,type,to_stage,to_responsible_id,to_responsible,actor_id,actor,occurred_at) "
                + "values (?,0,'OPENED','RECEIVED',2,'Nome da época',2,'Ator da época',current_timestamp)";
        sql.update(insert, 1L);
        assertThatThrownBy(() -> sql.update(insert, 1L)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> sql.update(insert, 99L)).isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> sql.update("delete from napne_case where id=1")).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(sql.queryForObject("select count(*) from case_history", Long.class)).isEqualTo(1);
    }
}
