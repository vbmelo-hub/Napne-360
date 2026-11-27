package br.edu.ifac.napne360.admin;

import br.edu.ifac.napne360.document.CareRecordDocument;
import br.edu.ifac.napne360.document.CareRecordRepository;
import br.edu.ifac.napne360.document.DocumentTemplateRepository;
import br.edu.ifac.napne360.document.RecordStatus;
import br.edu.ifac.napne360.pei.PeiDocument;
import br.edu.ifac.napne360.pei.PeiStatus;
import br.edu.ifac.napne360.identity.Campus;
import br.edu.ifac.napne360.identity.CampusRepository;
import br.edu.ifac.napne360.identity.Course;
import br.edu.ifac.napne360.identity.CourseRepository;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.Subject;
import br.edu.ifac.napne360.identity.SubjectRepository;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.identity.UserAccountRepository;
import br.edu.ifac.napne360.student.AssignmentType;
import br.edu.ifac.napne360.student.Student;
import br.edu.ifac.napne360.student.StudentAssignment;
import br.edu.ifac.napne360.student.StudentAssignmentRepository;
import br.edu.ifac.napne360.student.StudentRepository;
import br.edu.ifac.napne360.student.StudentStatus;
import org.bson.Document;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AdminCourseIntegrationTest {
    private static final String COURSE = "/api/v1/admin/courses/{id}";
    private static final String ARCHIVE = COURSE + "/archive";
    private static final String ADMIN_EMAIL = "admin@example.test";

    @Autowired MockMvc mvc;
    @Autowired CampusRepository campuses;
    @Autowired CourseRepository courses;
    @Autowired SubjectRepository subjects;
    @Autowired StudentRepository students;
    @Autowired StudentAssignmentRepository assignments;
    @Autowired UserAccountRepository users;
    @Autowired JdbcTemplate sql;
    @Autowired PlatformTransactionManager transactionManager;
    @MockitoSpyBean MongoTemplate mongo;
    @MockitoBean CareRecordRepository careRecords;
    @MockitoBean DocumentTemplateRepository templates;
    @MockitoBean(name = "mutationProjectionExecutor") ThreadPoolTaskExecutor projectionExecutor;

    private Campus original;
    private Campus destination;
    private Course course;

    @BeforeEach
    void setUp() {
        original = campus("Campus de origem");
        destination = campus("Campus de destino");
        course = courses.saveAndFlush(Course.builder().campus(original).name("Curso original").code("CURSO").build());
        doReturn(false).when(mongo).exists(any(Query.class), any(Class.class));
        doAnswer(ignored -> Stream.empty()).when(mongo).stream(any(Query.class), eq(PeiDocument.class));
    }

    @Test
    void editsNormalizedFieldsAndKeepsSubjectsAttached() throws Exception {
        var subject = subject(course, "ALVO", true);

        mvc.perform(edit(course.getId(), destination.getId(), "  Nome revisado  ", "  novo-cod  ")
                .with(user(ADMIN_EMAIL).roles("ADMIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(course.getId()))
                .andExpect(jsonPath("$.name").value("Nome revisado"))
                .andExpect(jsonPath("$.code").value("NOVO-COD"))
                .andExpect(jsonPath("$.campusId").value(destination.getId()))
                .andExpect(jsonPath("$.campus").value("Campus de destino"));

        assertThat(subjects.findById(subject.getId()).orElseThrow().getCourse().getId()).isEqualTo(course.getId());
        assertThat(sql.queryForObject("select campus_id from course where id = ?", Long.class, course.getId()))
                .isEqualTo(destination.getId());
        assertAudited("PUT", "SUCCESS");
    }

    @Test
    void rejectsDuplicateCodeInDestinationWithoutChangingOriginalCourse() throws Exception {
        courses.saveAndFlush(Course.builder().campus(destination).name("Outro curso").code("DUPLICADO").build());

        mvc.perform(edit(course.getId(), destination.getId(), "Nome revisado", " duplicado ")
                .with(user(ADMIN_EMAIL).roles("ADMIN")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.detail", containsString("código")));

        assertThat(courses.findById(course.getId()).orElseThrow().getName()).isEqualTo("Curso original");
        assertThat(sql.queryForObject("select campus_id from course where id = ?", Long.class, course.getId()))
                .isEqualTo(original.getId());
    }

    @Test
    void courseWithArchivedStudentKeepsCampusAndAllowsNameAndCodeEdits() throws Exception {
        var student = student(course, StudentStatus.ARCHIVED);

        mvc.perform(edit(course.getId(), destination.getId(), "Nome revisado", "CURSO")
                .with(user(ADMIN_EMAIL).roles("ADMIN")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.detail", containsString("campus")));
        mvc.perform(edit(course.getId(), original.getId(), "Nome revisado", "REVISAO")
                .with(user(ADMIN_EMAIL).roles("ADMIN")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.code").value("REVISAO"));

        assertThat(students.findById(student.getId()).orElseThrow().getCampus().getId()).isEqualTo(original.getId());
        assertThat(sql.queryForObject("select campus_id from course where id = ?", Long.class, course.getId()))
                .isEqualTo(original.getId());
    }

    @Test
    void archivesOnlyTheTargetCourseAndItsComponents() throws Exception {
        var first = subject(course, "ALVO", true);
        var second = subject(course, "INATIVO", false);
        var untouchedCourse = courses.saveAndFlush(Course.builder().campus(destination).name("Outro curso").code("CURSO").build());
        var untouchedSubject = subject(untouchedCourse, "ALVO", true);

        mvc.perform(patch(ARCHIVE, course.getId()).with(user(ADMIN_EMAIL).roles("ADMIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value(false));

        assertThat(courses.findById(course.getId()).orElseThrow().isActive()).isFalse();
        assertThat(subjects.findAllById(List.of(first.getId(), second.getId())))
                .hasSize(2).noneMatch(Subject::isActive);
        assertThat(courses.findById(untouchedCourse.getId()).orElseThrow().isActive()).isTrue();
        assertThat(subjects.findById(untouchedSubject.getId()).orElseThrow().isActive()).isTrue();
        assertAudited("PATCH", "SUCCESS");
    }

    @Test
    void refusesArchiveWithActiveStudentAndKeepsEveryComponent() throws Exception {
        student(course, StudentStatus.ACTIVE);
        var subject = subject(course, "ALVO", true);

        mvc.perform(patch(ARCHIVE, course.getId()).with(user(ADMIN_EMAIL).roles("ADMIN")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.detail", containsString("estudantes ativos")));

        assertThat(courses.findById(course.getId()).orElseThrow().isActive()).isTrue();
        assertThat(subjects.findById(subject.getId()).orElseThrow().isActive()).isTrue();
        assertAudited("PATCH", "DENIED");
    }

    @Test
    void activeAssignmentStillBlocksAfterStudentHasMovedToAnotherCourse() throws Exception {
        var currentCourse = courses.saveAndFlush(Course.builder().campus(original).name("Curso atual").code("ATUAL").build());
        var student = student(currentCourse, StudentStatus.ACTIVE);
        var subject = subject(course, "ALVO", true);
        var otherSubject = subject(course, "LIVRE", true);
        assignment(student, subject, true);

        mvc.perform(patch(ARCHIVE, course.getId()).with(user(ADMIN_EMAIL).roles("ADMIN")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.detail", containsString("vínculos ativos")));

        assertThat(courses.findById(course.getId()).orElseThrow().isActive()).isTrue();
        assertThat(subjects.findAllById(List.of(subject.getId(), otherSubject.getId())))
                .hasSize(2).allMatch(Subject::isActive);
    }

    @Test
    void activeAssignmentWithoutSubjectBlocksArchive() throws Exception {
        assignment(student(course, StudentStatus.ARCHIVED), null, true);

        mvc.perform(patch(ARCHIVE, course.getId()).with(user(ADMIN_EMAIL).roles("ADMIN")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.detail", containsString("vínculos ativos")));
    }

    @Test
    void archivedStudentRevokedAssignmentAndFinalizedRecordsRemainLinkedAfterArchive() throws Exception {
        var subject = subject(course, "ALVO", true);
        var student = student(course, StudentStatus.ARCHIVED);
        var assignment = assignment(student, subject, false);
        doAnswer(call -> matchesSubjectAndStatus(call.getArgument(0), subject.getId(), "status", RecordStatus.ACTIVE))
                .when(mongo).exists(any(Query.class), eq(CareRecordDocument.class));

        mvc.perform(patch(ARCHIVE, course.getId()).with(user(ADMIN_EMAIL).roles("ADMIN")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.active").value(false));

        assertThat(students.findById(student.getId()).orElseThrow().getCourse().getId()).isEqualTo(course.getId());
        assertThat(assignments.existsById(assignment.getId())).isTrue();
        assertThat(subjects.findById(subject.getId()).orElseThrow().isActive()).isFalse();
    }

    @ParameterizedTest
    @CsvSource({"CareRecordDocument,status,DRAFT", "PeiSeries,revisions.status,DRAFT",
            "PeiSeries,revisions.status,IN_REVIEW", "PeiSeries,revisions.status,APPROVED"})
    void refusesArchiveWithPendingRecordOrOpenOrCurrentPei(String type, String field, String state) throws Exception {
        var subject = subject(course, "ALVO", true);
        doAnswer(call -> matchesSubjectAndStatus(call.getArgument(0), subject.getId(), field, state))
                .when(mongo).exists(any(Query.class), argThat((Class<?> entity) -> entity.getSimpleName().equals(type)));

        mvc.perform(patch(ARCHIVE, course.getId()).with(user(ADMIN_EMAIL).roles("ADMIN")))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.detail", containsString("acompanhamentos")));

        assertThat(courses.findById(course.getId()).orElseThrow().isActive()).isTrue();
        assertThat(subjects.findById(subject.getId()).orElseThrow().isActive()).isTrue();
    }

    @ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void legacyPeiBlocksOnlyWhenNotReplacedByAuthoritativeSeries(boolean migrated) throws Exception {
        var subject = subject(course, "ALVO", true);
        doAnswer(ignored -> Stream.of(PeiDocument.builder()
                .studentId(92L).subjectId(subject.getId()).academicTerm("2026-1").status(PeiStatus.APPROVED).build()))
                .when(mongo).stream(any(Query.class), eq(PeiDocument.class));
        doAnswer(call -> migrated && ("92:" + subject.getId() + ":+2026-1").equals(
                call.<Query>getArgument(0).getQueryObject().get("_id")))
                .when(mongo).exists(any(Query.class), argThat((Class<?> entity) -> entity.getSimpleName().equals("PeiSeries")));

        mvc.perform(patch(ARCHIVE, course.getId()).with(user(ADMIN_EMAIL).roles("ADMIN")))
                .andExpect(status().is(migrated ? 200 : 409));
    }

    @Test
    void seriesMaterializedDuringLegacyProbeStillBlocksArchive() throws Exception {
        var subject = subject(course, "ALVO", true);
        var migrated = new AtomicBoolean();
        doAnswer(ignored -> {
            migrated.set(true);
            return Stream.of(PeiDocument.builder().studentId(92L).subjectId(subject.getId())
                    .academicTerm("2026-1").status(PeiStatus.DRAFT).build());
        }).when(mongo).stream(any(Query.class), eq(PeiDocument.class));
        doAnswer(call -> {
            Query query = call.getArgument(0);
            return migrated.get() && (query.getQueryObject().containsKey("_id")
                    || matchesSubjectAndStatus(query, subject.getId(), "revisions.status", PeiStatus.IN_REVIEW));
        }).when(mongo).exists(any(Query.class), argThat((Class<?> entity) -> entity.getSimpleName().equals("PeiSeries")));

        mvc.perform(patch(ARCHIVE, course.getId()).with(user(ADMIN_EMAIL).roles("ADMIN")))
                .andExpect(status().isConflict());
    }

    private static boolean matchesSubjectAndStatus(Query query, Long subjectId, String field, Object state) {
        var candidate = query.getQueryObject().get("subjectId", Document.class);
        if (candidate == null || !candidate.getList("$in", Long.class).contains(subjectId)) return false;
        Object status = query.getQueryObject().get(field);
        if (status instanceof Document conditions) {
            return conditions.getList("$in", Object.class).stream().anyMatch(it -> state.toString().equals(it.toString()));
        }
        return status != null && status.toString().equals(state.toString());
    }

    @Test
    void requiresAdminRoleForBothMutations() throws Exception {
        mvc.perform(edit(course.getId(), original.getId(), "Nome revisado", "CURSO")
                .with(user("napne@example.test").roles("NAPNE"))).andExpect(status().isForbidden());
        mvc.perform(patch(ARCHIVE, course.getId())
                .with(user("napne@example.test").roles("NAPNE"))).andExpect(status().isForbidden());
        assertThat(courses.findById(course.getId()).orElseThrow().getName()).isEqualTo("Curso original");
    }

    @Test
    void returnsNotFoundForAnUnknownCourseOrCampus() throws Exception {
        var admin = user(ADMIN_EMAIL).roles("ADMIN");
        mvc.perform(edit(-1L, original.getId(), "Nome revisado", "CURSO").with(admin))
                .andExpect(status().isNotFound());
        mvc.perform(edit(course.getId(), -1L, "Nome revisado", "CURSO").with(admin))
                .andExpect(status().isNotFound());
        mvc.perform(patch(ARCHIVE, -1L).with(admin)).andExpect(status().isNotFound());
    }

    @Test
    void concurrentStudentRegistrationChecksCampusAgainAfterCourseMoves() throws Exception {
        var actor = napneAccount();
        String registration = UUID.randomUUID().toString();
        var transaction = new TransactionTemplate(transactionManager);

        try (var executor = Executors.newSingleThreadExecutor()) {
            var result = transaction.execute(ignored -> {
                sql.update("update course set campus_id = ? where id = ?", destination.getId(), course.getId());
                var request = executor.submit(() -> mvc.perform(post("/api/v1/students")
                        .with(user(actor.getEmail()).roles("NAPNE"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"courseId":%d,"registration":"%s","civilName":"Estudante fictício"}
                                """.formatted(course.getId(), registration))).andReturn().getResponse().getStatus());
                awaitRowLock();
                return request;
            });

            assertThat(result.get(10, TimeUnit.SECONDS)).isEqualTo(400);
            assertThat(students.existsByRegistration(registration)).isFalse();
        }
    }

    @Test
    void assignmentChecksTheStudentCourseAfterAConcurrentTransfer() throws Exception {
        var student = student(course, StudentStatus.ARCHIVED);
        var target = courses.saveAndFlush(Course.builder().campus(original).name("Curso de destino").code("DESTINO").build());
        var actor = napneAccount();
        var transaction = new TransactionTemplate(transactionManager);

        try (var executor = Executors.newSingleThreadExecutor()) {
            var result = transaction.execute(ignored -> {
                sql.update("update student set course_id = ? where id = ?", target.getId(), student.getId());
                sql.update("update course set active = false where id = ?", target.getId());
                var request = executor.submit(() -> mvc.perform(post("/api/v1/admin/assignments")
                        .with(user(ADMIN_EMAIL).roles("ADMIN"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"studentId":%d,"userId":%d,"assignmentType":"NAPNE"}
                                """.formatted(student.getId(), actor.getId()))).andReturn().getResponse().getStatus());
                await().pollInSameThread().pollInterval(Duration.ofMillis(20)).atMost(Duration.ofSeconds(5)).until(() ->
                        request.isDone() || sql.queryForObject("""
                                select count(*) from information_schema.sessions where blocker_id = session_id()
                                """, Integer.class) == 1);
                return request;
            });

            assertThat(result.get(10, TimeUnit.SECONDS)).isEqualTo(409);
            assertThat(assignments.existsByStudentIdAndUserIdAndActiveTrue(student.getId(), actor.getId())).isFalse();
        }
    }

    @Test
    void concurrentCareRecordCannotStartOnSubjectArchivedByCourse() throws Exception {
        var currentCourse = courses.saveAndFlush(Course.builder().campus(original).name("Curso atual").code("ATUAL").build());
        var student = student(currentCourse, StudentStatus.ACTIVE);
        var subject = subject(course, "ALVO", true);
        var actor = napneAccount();
        var transaction = new TransactionTemplate(transactionManager);
        lenient().when(careRecords.save(any(CareRecordDocument.class))).thenAnswer(call -> call.getArgument(0));
        when(templates.findByDocumentTypeAndActiveTrueOrderByUpdatedAtDesc("PEDAGOGICAL_GUIDANCE")).thenReturn(List.of());

        try (var executor = Executors.newSingleThreadExecutor()) {
            var result = transaction.execute(ignored -> {
                sql.update("update subject set active = false where id = ?", subject.getId());
                sql.update("update course set active = false where id = ?", course.getId());
                var request = executor.submit(() -> mvc.perform(post("/api/v1/students/{id}/records", student.getId())
                        .with(user(actor.getEmail()).roles("NAPNE"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"subjectId":%d,"type":"PEDAGOGICAL_GUIDANCE","title":"Acompanhamento"}
                                """.formatted(subject.getId()))).andReturn().getResponse().getStatus());
                awaitRowLock();
                return request;
            });

            assertThat(result.get(10, TimeUnit.SECONDS)).isEqualTo(409);
        }
    }

    private void awaitRowLock() {
        await().pollInSameThread().pollInterval(Duration.ofMillis(20)).atMost(Duration.ofSeconds(5)).untilAsserted(() ->
                assertThat(sql.queryForObject("""
                        select count(*) from information_schema.sessions where blocker_id = session_id()
                        """, Integer.class)).isEqualTo(1));
    }

    @Test
    void rejectsNewEnrollmentsSubjectsAndAssignmentsOnArchivedCourse() throws Exception {
        var student = student(course, StudentStatus.ARCHIVED);
        var actor = napneAccount();
        var admin = user(ADMIN_EMAIL).roles("ADMIN");
        sql.update("update course set active = false where id = ?", course.getId());

        mvc.perform(post("/api/v1/students").with(user(actor.getEmail()).roles("NAPNE"))
                .contentType(MediaType.APPLICATION_JSON).content("""
                        {"courseId":%d,"registration":"NOVA","civilName":"Estudante fictício"}
                        """.formatted(course.getId()))).andExpect(status().isConflict());
        mvc.perform(post("/api/v1/admin/subjects").with(admin).contentType(MediaType.APPLICATION_JSON).content("""
                {"courseId":%d,"name":"Novo componente","code":"NOVO","workloadHours":40}
                """.formatted(course.getId()))).andExpect(status().isConflict());
        mvc.perform(post("/api/v1/admin/assignments").with(admin).contentType(MediaType.APPLICATION_JSON).content("""
                {"studentId":%d,"userId":%d,"assignmentType":"NAPNE"}
                """.formatted(student.getId(), actor.getId()))).andExpect(status().isConflict());
        mvc.perform(put("/api/v1/students/{id}", student.getId()).with(user(actor.getEmail()).roles("NAPNE"))
                .contentType(MediaType.APPLICATION_JSON).content("""
                        {"courseId":%d,"registration":"%s","civilName":"Nome atualizado"}
                        """.formatted(course.getId(), student.getRegistration()))).andExpect(status().isOk());
    }

    private StudentAssignment assignment(Student student, Subject subject, boolean active) {
        var teacher = users.saveAndFlush(UserAccount.builder().campus(original).name("Docente")
                .email(UUID.randomUUID() + "@example.test").passwordHash("unused").build());
        return assignments.saveAndFlush(StudentAssignment.builder().student(student).subject(subject).user(teacher)
                .assignmentType(subject == null ? AssignmentType.TUTOR : AssignmentType.TEACHER).active(active).build());
    }

    private UserAccount napneAccount() {
        return users.saveAndFlush(UserAccount.builder().campus(original).name("NAPNE")
                .email(UUID.randomUUID() + "@example.test").passwordHash("unused").roles(Set.of(RoleName.NAPNE)).build());
    }

    private Campus campus(String name) {
        return campuses.saveAndFlush(Campus.builder().name(name).code(UUID.randomUUID().toString()).build());
    }

    private Subject subject(Course course, String code, boolean active) {
        return subjects.saveAndFlush(Subject.builder().course(course).name(code).code(code)
                .workloadHours(40).active(active).build());
    }

    private Student student(Course course, StudentStatus status) {
        return students.saveAndFlush(Student.builder().campus(original).course(course).registration(UUID.randomUUID().toString())
                .civilName("Estudante fictício").status(status).build());
    }

    private MockHttpServletRequestBuilder edit(Long id, Long campusId, String name, String code) {
        return put(COURSE, id).contentType(MediaType.APPLICATION_JSON).content("""
                {"campusId":%d,"name":"%s","code":"%s"}
                """.formatted(campusId, name, code));
    }

    private void assertAudited(String method, String outcome) {
        assertThat(sql.queryForObject("""
                select count(*) from audit_event where resource_type = 'CONFIGURATION' and resource_id = ?
                    and action = 'ADMIN_CHANGE' and outcome = ? and details = ?
                """, Integer.class, course.getId().toString(), outcome, method + " " + (method.equals("PATCH") ? ARCHIVE : COURSE))).isEqualTo(1);
    }
}
