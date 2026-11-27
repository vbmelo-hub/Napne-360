package br.edu.ifac.napne360.admin;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AdminIdentityMigrationTest {
    @Test
    void preservesLegacyAccountsAndReservesPreviousEmailForTheirExistingIds() {
        var database = new DriverManagerDataSource("jdbc:h2:mem:identity_" + UUID.randomUUID()
                + ";MODE=MySQL;DB_CLOSE_DELAY=-1", "sa", "");
        var sql = new JdbcTemplate(database);
        sql.execute("create table app_user (id bigint primary key, email varchar(190) not null)");
        sql.update("insert into app_user(id, email) values (7, 'Legado@example.test'), (8, 'Pessoa@example.test')");

        new ResourceDatabasePopulator(new ClassPathResource("db/migration/V100__administrative_identity.sql")).execute(database);

        assertThat(sql.queryForObject("select email from app_user where id = 7", String.class)).isEqualTo("Legado@example.test");
        assertThat(sql.queryForObject("select count(*) from app_user where cpf is null and institutional_registration is null",
                Integer.class)).isEqualTo(2);
        assertThat(sql.queryForObject("select user_id from user_email_history where email = 'legado@example.test'",
                Long.class)).isEqualTo(7);
        assertThatThrownBy(() -> sql.update("insert into user_email_history(email, user_id) values ('legado@example.test', 8)"))
                .isInstanceOf(DataIntegrityViolationException.class);
        sql.update("update app_user set cpf = '52998224725' where id = 7");
        assertThatThrownBy(() -> sql.update("update app_user set cpf = '52998224725' where id = 8"))
                .isInstanceOf(DataIntegrityViolationException.class);
    }
}
