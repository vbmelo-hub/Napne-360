package br.edu.ifac.napne360.admin;

import br.edu.ifac.napne360.identity.Campus;
import br.edu.ifac.napne360.identity.CampusRepository;
import br.edu.ifac.napne360.identity.Course;
import br.edu.ifac.napne360.identity.CourseRepository;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.identity.UserAccountRepository;
import br.edu.ifac.napne360.identity.UserEmailHistoryRepository;
import br.edu.ifac.napne360.security.JwtService;
import br.edu.ifac.napne360.student.AssignmentType;
import br.edu.ifac.napne360.student.Student;
import br.edu.ifac.napne360.student.StudentAssignment;
import br.edu.ifac.napne360.student.StudentAssignmentRepository;
import br.edu.ifac.napne360.student.StudentRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AdminIdentityIntegrationTest {
    private static final String USERS = "/api/v1/admin/users";
    private static final String CAMPUSES = "/api/v1/admin/campuses";
    private static final String PASSWORD = "SenhaTemporaria!94";
    @Autowired MockMvc mvc;
    @Autowired CampusRepository campuses;
    @Autowired CourseRepository courses;
    @Autowired UserAccountRepository users;
    @Autowired UserEmailHistoryRepository emails;
    @Autowired StudentRepository students;
    @Autowired StudentAssignmentRepository assignments;
    @Autowired JdbcTemplate sql;
    @Autowired JwtService jwt;

    @Test
    void capturesValidCpfForNewAccountsAndReturnsOnlyMaskedCpfInList() throws Exception {
        var email = email();
        mvc.perform(create(email, "529.982.247-25"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cpfMasked").value("***.***.***-25"))
                .andExpect(jsonPath("$.cpf").doesNotExist())
                .andExpect(jsonPath("$.institutionalRegistration").value("SIAPE-42"));
        Long id = users.findByEmailIgnoreCase(email).orElseThrow().getId();
        mvc.perform(admin(get(USERS + "/{id}", id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.cpf").value("52998224725"));
        mvc.perform(admin(post(USERS + "/cpf-search")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"cpf\":\"52998224725\"}")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(id));
        mvc.perform(create(email, "11144477735")).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("USER_EMAIL_DUPLICATE"));
        mvc.perform(create(email(), "52998224725")).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("USER_CPF_DUPLICATE"));
        mvc.perform(create(email(), "52998224726")).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("USER_CPF_INVALID"));
        mvc.perform(get(USERS + "/{id}", id).with(user("napne@example.test").roles("NAPNE")))
                .andExpect(status().isForbidden());
    }

    @Test
    void userEditKeepsIdAndRejectsReuseOfHistoricalEmail() throws Exception {
        var oldEmail = email();
        var newEmail = email();
        var account = users.save(UserAccount.builder()
                .name("Conta legada").email(oldEmail).passwordHash(PASSWORD).roles(Set.of(RoleName.ADMIN)).build());
        String authorization = "Bearer " + jwt.create(account).token();
        mvc.perform(get(USERS + "/{id}", account.getId()).header("Authorization", authorization))
                .andExpect(status().isOk());
        mvc.perform(admin(put(USERS + "/{id}", account.getId()).contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"name":" Nome atualizado ","email":"%s","institutionalRegistration":" 000123 "}
                                """.formatted(newEmail))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.id").value(account.getId()))
                .andExpect(jsonPath("$.name").value("Nome atualizado"))
                .andExpect(jsonPath("$.institutionalRegistration").value("000123"));
        assertThat(users.findByEmailIgnoreCase(oldEmail)).isEmpty();
        assertThat(emails.ownerId(oldEmail)).contains(account.getId());
        assertThat(users.findByEmailIgnoreCase(newEmail).orElseThrow().getSessionVersion()).isEqualTo(1L);
        mvc.perform(get(USERS + "/{id}", account.getId()).header("Authorization", authorization))
                .andExpect(status().isUnauthorized());
        mvc.perform(create(oldEmail, "11144477735")).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("USER_EMAIL_DUPLICATE"));
    }

    @Test
    void institutionalRoleRequiresCampusWithSpecificProblemCode() throws Exception {
        var account = users.save(UserAccount.builder().name("Admin técnico").email(email())
                .passwordHash(PASSWORD).roles(Set.of(RoleName.ADMIN)).build());
        mvc.perform(admin(put(USERS + "/{id}/roles", account.getId())
                        .contentType(MediaType.APPLICATION_JSON).content("{\"roles\":[\"ADMIN\",\"COTEP\"]}")))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("USER_CAMPUS_REQUIRED"))
                .andExpect(jsonPath("$.detail").value("Para conceder o perfil COTEP, é necessário vincular este usuário a um campus."));
    }

    @Test
    void archiveCampusRejectsActiveCourseAndPreservesCampusForLaterReactivation() throws Exception {
        var campus = campuses.save(Campus.builder().name("Campus inicial").code(UUID.randomUUID().toString()).build());
        var course = courses.save(Course.builder().campus(campus).name("Curso ativo").code("ATIVO").build());

        mvc.perform(campusStatus(campus.getId(), false)).andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CAMPUS_ACTIVE_COURSES"));
        course.setActive(false);
        courses.saveAndFlush(course);

        mvc.perform(admin(put(CAMPUSES + "/{id}", campus.getId()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\" Campus renomeado \",\"code\":\" campus-rev \"}")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value("CAMPUS-REV"));
        mvc.perform(campusStatus(campus.getId(), false)).andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false));
        mvc.perform(admin(get(CAMPUSES + "/{id}", campus.getId()))).andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Campus renomeado"));
        mvc.perform(campusStatus(campus.getId(), true)).andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(true));
        assertThat(courses.findById(course.getId()).orElseThrow().isActive()).isFalse();
    }

    @Test
    void activeAssignmentsBlockAdministrativeChangesButAllowImmediateSecurityBlock() throws Exception {
        var admin = users.save(UserAccount.builder().name("Administrador").email(email()).passwordHash(PASSWORD)
                .roles(Set.of(RoleName.ADMIN)).build());
        var origin = campus();
        var destination = campus();
        var course = courses.save(Course.builder().campus(origin).name("Curso").code("ATV").build());
        var monitor = users.save(UserAccount.builder().name("Monitor").email(email()).campus(origin).passwordHash(PASSWORD)
                .roles(Set.of(RoleName.TUTOR)).build());
        var student = students.save(Student.builder().campus(origin).course(course).civilName("Aluno")
                .registration(UUID.randomUUID().toString()).build());
        var assignment = assignments.save(StudentAssignment.builder().student(student).user(monitor)
                .assignmentType(AssignmentType.TUTOR).build());
        String path = USERS + "/" + monitor.getId();
        var actor = user(admin.getEmail()).roles("ADMIN");
        mvc.perform(put(path).with(actor).contentType(MediaType.APPLICATION_JSON).content("""
                        {"name":"Monitor","email":"%s","campusId":%d}
                        """.formatted(monitor.getEmail(), destination.getId())))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("USER_ACTIVE_ASSIGNMENTS"));
        mvc.perform(put(path + "/roles").with(actor).contentType(MediaType.APPLICATION_JSON).content("{\"roles\":[\"NAPNE\"]}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("USER_ACTIVE_ASSIGNMENTS"));
        mvc.perform(patch(path + "/active").with(actor).contentType(MediaType.APPLICATION_JSON).content("{\"active\":false}"))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("USER_ACTIVE_ASSIGNMENTS"));
        mvc.perform(post(path + "/block").with(actor))
                .andExpect(status().isOk()).andExpect(jsonPath("$.active").value(false))
                .andExpect(jsonPath("$.securityBlocked").value(true));
        assertThat(assignments.findById(assignment.getId()).orElseThrow().isActive()).isTrue();
        assertThat(users.findByEmailIgnoreCase(monitor.getEmail()).orElseThrow().getSessionVersion()).isEqualTo(1);
        mvc.perform(patch(path + "/active").with(actor).contentType(MediaType.APPLICATION_JSON).content("{\"active\":true}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.active").value(true))
                .andExpect(jsonPath("$.securityBlocked").value(false));
    }

    @Test
    void identicalEditDoesNotAddAuditHistoryOrRevokeSessions() throws Exception {
        var account = users.save(UserAccount.builder().name("Conta técnica").email(email()).passwordHash(PASSWORD)
                .roles(Set.of(RoleName.ADMIN)).build());

        mvc.perform(admin(put(USERS + "/{id}", account.getId()).contentType(MediaType.APPLICATION_JSON).content("""
                        {"name":" Conta técnica ","email":"%s"}
                        """.formatted(account.getEmail().toUpperCase(java.util.Locale.ROOT)))))
                .andExpect(status().isOk());
        assertThat(users.findById(account.getId()).orElseThrow().getSessionVersion()).isZero();
        assertThat(sql.queryForObject("select count(*) from audit_event where resource_id = ? and details = ?",
                Integer.class, account.getId().toString(), "PUT " + USERS + "/{id}")).isZero();
    }

    private Campus campus() {
        return campuses.save(Campus.builder().name("Campus fictício").code(UUID.randomUUID().toString()).build());
    }

    private MockHttpServletRequestBuilder create(String email, String cpf) {
        return admin(post(USERS).contentType(MediaType.APPLICATION_JSON).content("""
                {"name":"Conta fictícia","email":"%s","cpf":"%s","password":"%s",
                 "institutionalRegistration":" SIAPE-42 ","roles":["ADMIN"]}
                """.formatted(email, cpf, PASSWORD)));
    }

    private MockHttpServletRequestBuilder campusStatus(long id, boolean active) {
        return admin(patch(CAMPUSES + "/{id}/active", id).contentType(MediaType.APPLICATION_JSON)
                .content("{\"active\":" + active + "}"));
    }

    private MockHttpServletRequestBuilder admin(MockHttpServletRequestBuilder request) {
        return request.with(user("admin@example.test").roles("ADMIN"));
    }

    private String email() {
        return UUID.randomUUID() + "@example.test";
    }
}
