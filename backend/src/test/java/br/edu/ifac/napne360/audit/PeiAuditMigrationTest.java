package br.edu.ifac.napne360.audit;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PeiAuditMigrationTest {
    @Test void migrationPreservesExistingAuditsAndAppliesUniquenessOnlyToKeyedEvents() {
        var dataSource = new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID()
                + ";MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
        var sql = new JdbcTemplate(dataSource);
        sql.execute("CREATE TABLE audit_event (id BIGINT PRIMARY KEY AUTO_INCREMENT, action VARCHAR(80) NOT NULL)");
        sql.update("INSERT INTO audit_event (action) VALUES ('DOWNLOAD')");

        new ResourceDatabasePopulator(new ClassPathResource("db/migration/V6__pei_audit_projection_key.sql"))
                .execute(dataSource);

        sql.update("INSERT INTO audit_event (action) VALUES ('VIEW')");
        sql.update("INSERT INTO audit_event (action, projection_key) VALUES ('SUBMIT', 'pei:rev1:1')");
        assertThatThrownBy(() ->
                sql.update("INSERT INTO audit_event (action, projection_key) VALUES ('SUBMIT', 'pei:rev1:1')"))
                .isInstanceOf(DuplicateKeyException.class);
        assertThat(sql.queryForList("SELECT action FROM audit_event WHERE projection_key IS NULL ORDER BY id", String.class))
                .containsExactly("DOWNLOAD", "VIEW");
    }
}
