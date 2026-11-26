package br.edu.ifac.napne360.projection;

import br.edu.ifac.napne360.audit.AuditEvent;
import br.edu.ifac.napne360.audit.AuditEventRepository;
import br.edu.ifac.napne360.casework.NapneCase;
import br.edu.ifac.napne360.casework.NapneCaseRepository;
import br.edu.ifac.napne360.document.CareRecordDocument;
import br.edu.ifac.napne360.document.CareRecordRepository;
import br.edu.ifac.napne360.document.DossierRepository;
import br.edu.ifac.napne360.identity.Campus;
import br.edu.ifac.napne360.identity.CampusRepository;
import br.edu.ifac.napne360.identity.Course;
import br.edu.ifac.napne360.identity.CourseRepository;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.identity.UserAccountRepository;
import br.edu.ifac.napne360.student.Student;
import br.edu.ifac.napne360.student.StudentRepository;
import br.edu.ifac.napne360.timeline.TimelineEventDocument;
import br.edu.ifac.napne360.timeline.TimelineRepository;
import br.edu.ifac.napne360.timeline.TimelineService;
import org.h2.api.Trigger;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.Connection;
import java.sql.SQLException;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.SoftAssertions.assertSoftly;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.doAnswer;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

@SpringBootTest(properties = {
        "spring.datasource.url=jdbc:h2:mem:napne_mutation_recovery;MODE=MySQL;DB_CLOSE_DELAY=-1",
        "napne360.pei.projection.retry-delay-ms=3600000",
        "napne360.mutation-projection.retry-delay-ms=100"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
@EnabledIfEnvironmentVariable(named = "NAPNE_TEST_MUTATION_MONGO_URI", matches = ".+")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class MutationRecoveryIntegrationTest {
    private static final String DATABASE = "napne_mutation_" + UUID.randomUUID().toString().replace("-", "");
    private static final String DOSSIER = """
            {"identification":{"demand":"Demanda fictícia"},"educationalNeeds":{},"healthAndSupport":{},
            "familyContext":{},"schoolHistory":{},"strengths":{},"difficulties":{},"initialInterventions":{}}
            """;
    private static final AtomicBoolean FAIL_AUDIT = new AtomicBoolean();
    private static final AtomicInteger FAILED_AUDITS = new AtomicInteger();
    private final AtomicBoolean failTimeline = new AtomicBoolean();
    private final AtomicInteger failedTimelines = new AtomicInteger();

    @Autowired MockMvc mvc;
    @Autowired MongoTemplate mongo;
    @Autowired JdbcTemplate sql;
    @Autowired TransactionTemplate transactions;
    @Autowired CampusRepository campuses;
    @Autowired CourseRepository courses;
    @Autowired StudentRepository students;
    @Autowired UserAccountRepository users;
    @Autowired DossierRepository dossiers;
    @Autowired CareRecordRepository records;
    @Autowired NapneCaseRepository cases;
    @Autowired AuditEventRepository audit;
    @Autowired TimelineRepository timeline;
    @MockitoSpyBean TimelineService timelineWriter;

    private Student student;
    private UserAccount actor;

    @DynamicPropertySource
    static void standaloneMongo(DynamicPropertyRegistry registry) {
        registry.add("spring.data.mongodb.uri", () -> System.getenv("NAPNE_TEST_MUTATION_MONGO_URI"));
        registry.add("spring.data.mongodb.database", () -> DATABASE);
        registry.add("spring.data.mongodb.auto-index-creation", () -> "true");
    }

    @BeforeEach void fixtures() {
        assertThat(mongo.getDb().getName()).isEqualTo(DATABASE);
        failedTimelines.set(0);
        FAILED_AUDITS.set(0);
        var unique = UUID.randomUUID().toString();
        var campus = campuses.saveAndFlush(Campus.builder().name("Campus fictício").code(unique).build());
        var course = courses.saveAndFlush(Course.builder().campus(campus).name("Curso fictício").code("CURSO").build());
        student = students.saveAndFlush(Student.builder().campus(campus).course(course).registration(unique)
                .civilName("Estudante fictício").build());
        actor = users.saveAndFlush(UserAccount.builder().campus(campus).name("Autor fictício")
                .email(unique + "@example.test").passwordHash("fictício").roles(Set.of(RoleName.NAPNE)).active(true).build());
        doAnswer(call -> {
            rejectTimelineWhenUnavailable();
            return call.callRealMethod();
        }).when(timelineWriter).append(anyLong(), anyString(), anyString(), anyString(), any(), anyMap());
        doAnswer(call -> {
            rejectTimelineWhenUnavailable();
            return call.callRealMethod();
        }).when(timelineWriter).appendOnce(anyString(), anyLong(), anyString(), anyString(), anyString(), any(), anyMap(), any());
        sql.execute("CREATE TRIGGER IF NOT EXISTS audit_unavailable BEFORE INSERT ON audit_event FOR EACH ROW CALL '"
                + UnavailableAudit.class.getName() + "'");
    }

    @AfterEach void restoreDestinations() {
        failTimeline.set(false);
        FAIL_AUDIT.set(false);
    }

    @AfterAll void dropFixtureDatabase() {
        if (DATABASE.equals(mongo.getDb().getName())) mongo.getDb().drop();
    }

    @Test void dossierIsSavedDuringTimelineOutageAndItsEventIsRecoveredOnce() throws Exception {
        failTimeline.set(true);
        var path = studentPath() + "/dossier";
        int response = perform(put(path).content(DOSSIER));
        var persisted = dossiers.findByStudentId(student.getId()).orElseThrow();
        assertThat(persisted.getIdentification()).containsEntry("demand", "Demanda fictícia");
        assertThat(events()).isEmpty();
        // Repeating a now-stale first save must not create another version or event.
        int replay = perform(put(path).content(DOSSIER));
        await().atMost(Duration.ofSeconds(5)).until(() -> failedTimelines.get() > 0);
        failTimeline.set(false);
        assertSoftly(softly -> {
            softly.assertThat(response).as("PUT da gravação já persistida").isEqualTo(200);
            softly.assertThat(replay).as("PUT repetido sem a versão atual").isEqualTo(409);
            softly.assertThatCode(() -> await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
                assertThat(events()).singleElement().satisfies(event -> {
                    assertThat(event.getEventType()).isEqualTo("DOSSIER_UPDATED");
                    assertThat(event.getData()).containsEntry("version", 0L);
                });
                assertThat(auditFor("DOSSIER", student.getId().toString())).singleElement().satisfies(event -> {
                    assertThat(event.getAction()).isEqualTo("UPDATE");
                    assertThat(event.getIpAddress()).isEqualTo("192.0.2.41");
                });
                var confirmed = dossiers.findByStudentId(student.getId()).orElseThrow();
                assertThat(confirmed.getPendingProjections()).isEmpty();
                assertThat(confirmed.getVersion()).isEqualTo(0L);
                assertThat(confirmed.getHistory()).isEmpty();
            })).as("evento e auditoria recuperados após desbloquear timeline").doesNotThrowAnyException();
        });
    }

    @Test void linkedCareRecordCanBeCreatedAndRevisedDuringAuditOutageWithoutRepeatingItsTimeline() throws Exception {
        var linked = cases.saveAndFlush(NapneCase.builder().student(student).responsible(actor).source("Legado fictício").build());
        FAIL_AUDIT.set(true);
        var path = studentPath() + "/records";
        var create = "{\"caseId\":%d,\"type\":\"CASE_STUDY\",\"title\":\"Atendimento fictício\"}".formatted(linked.getId());
        int createResponse = perform(post(path).content(create));
        CareRecordDocument original = records.findByStudentIdOrderByCreatedAtDesc(student.getId()).getFirst();
        assertThat(original.getCaseId()).isEqualTo(linked.getId());
        var update = """
                {"caseId":%d,"type":"CASE_STUDY","title":"Revisado","status":"ACTIVE","version":%d}
                """.formatted(linked.getId(), original.getVersion());
        int updateResponse = perform(put(path + "/" + original.getId()).content(update));
        int replay = perform(put(path + "/" + original.getId()).content(update));
        var persisted = records.findById(original.getId()).orElseThrow();
        assertThat(persisted.getTitle()).isEqualTo("Revisado");
        assertThat(persisted.getHistory()).singleElement().satisfies(revision ->
                assertThat(revision.title()).isEqualTo("Atendimento fictício"));
        assertThat(auditFor("CARE_RECORD", original.getId())).isEmpty();
        await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> assertThat(events())
                .extracting(TimelineEventDocument::getEventType)
                .containsExactlyInAnyOrder("CARE_RECORD_CREATED", "CARE_RECORD_UPDATED"));
        await().atMost(Duration.ofSeconds(5)).until(() -> FAILED_AUDITS.get() >= 2);
        FAIL_AUDIT.set(false);
        assertSoftly(softly -> {
            softly.assertThat(createResponse).as("POST com Mongo já persistido").isEqualTo(200);
            softly.assertThat(updateResponse).as("PUT com nova revisão já persistida").isEqualTo(200);
            softly.assertThat(replay).as("PUT repetido com versão antiga").isEqualTo(409);
            softly.assertThatCode(() -> await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
                assertThat(auditFor("CARE_RECORD", original.getId())).extracting(AuditEvent::getAction)
                        .containsExactlyInAnyOrder("CREATE", "UPDATE");
                var confirmed = records.findById(original.getId()).orElseThrow();
                assertThat(confirmed.getPendingProjections()).isEmpty();
                assertThat(confirmed.getVersion()).isEqualTo(1L);
            }))
                    .as("auditoria recuperada após desbloquear destino").doesNotThrowAnyException();
        });
        assertThat(events()).hasSize(2).allSatisfy(event -> {
            assertThat(event.getData()).containsEntry("recordId", original.getId()).doesNotContainKey("caseId");
        });
    }

    @Test void caseAndHistoryCommitDuringTimelineOutageAndTheEventIsRecoveredOnce() throws Exception {
        failTimeline.set(true);
        int response = perform(post(studentPath() + "/cases").content("{\"source\":\"Abertura fictícia\"}"));
        assertThat(events()).isEmpty();
        var persisted = cases.findByStudentIdOrderByOpenedAtDesc(student.getId());
        int historyRows = sql.queryForObject("""
                SELECT COUNT(*) FROM case_history h JOIN napne_case c ON c.id = h.case_id WHERE c.student_id = ?
                """, Integer.class, student.getId());
        await().atMost(Duration.ofSeconds(5)).until(() -> failedTimelines.get() > 0);
        failTimeline.set(false);
        assertSoftly(softly -> {
            softly.assertThat(response).as("POST com timeline indisponível").isEqualTo(200);
            softly.assertThat(persisted).as("caso confirmado no SQL").hasSize(1);
            softly.assertThat(historyRows).as("histórico confirmado no SQL").isEqualTo(1);
        });
        var caseId = persisted.getFirst().getId();
        await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> {
            assertThat(events()).singleElement().satisfies(event -> {
                assertThat(event.getEventType()).isEqualTo("CASE_OPENED");
                assertThat(((Number) event.getData().get("caseId")).longValue()).isEqualTo(caseId);
            });
            assertThat(auditFor("NAPNE_CASE", caseId.toString())).extracting(AuditEvent::getAction).containsExactly("CREATE");
            assertThat(pendingCaseProjections(caseId.toString())).isZero();
        });
    }

    @Test void rollingBackCaseAndHistoryAfterFlushLeavesNoSuccessfulEvents() {
        String caseId = transactions.execute(transaction -> {
            try {
                int response = perform(post(studentPath() + "/cases").content("{\"source\":\"Rollback fictício\"}"));
                assertThat(response).isEqualTo(200);
                var saved = cases.findByStudentIdOrderByOpenedAtDesc(student.getId()).getFirst();
                transaction.setRollbackOnly();
                return saved.getId().toString();
            } catch (Exception e) {
                throw new AssertionError(e);
            }
        });
        assertThat(cases.findByStudentIdOrderByOpenedAtDesc(student.getId())).isEmpty();
        assertThat(pendingCaseProjections(caseId)).isZero();
        await().pollDelay(Duration.ZERO).during(Duration.ofMillis(350)).atMost(Duration.ofSeconds(2))
                .untilAsserted(() -> assertSoftly(softly -> {
                    softly.assertThat(events()).as("timeline do caso revertido").isEmpty();
                    softly.assertThat(auditFor("NAPNE_CASE", caseId)).as("auditoria do caso revertido").isEmpty();
                }));
    }

    private int perform(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request.with(user(actor.getEmail()).roles("NAPNE")).with(value -> {
            value.setRemoteAddr("192.0.2.41");
            return value;
        }).contentType(MediaType.APPLICATION_JSON)).andReturn().getResponse().getStatus();
    }

    private String studentPath() {
        return "/api/v1/students/" + student.getId();
    }

    private List<TimelineEventDocument> events() {
        return timeline.findByStudentIdOrderByCreatedAtDesc(student.getId());
    }

    private List<AuditEvent> auditFor(String resource, String id) {
        return audit.findByResourceTypeAndResourceIdAndActorCampusIdOrderByOccurredAtDesc(resource, id,
                student.getCampus().getId(), org.springframework.data.domain.Pageable.unpaged()).getContent();
    }

    private long pendingCaseProjections(String caseId) {
        return sql.queryForObject("SELECT COUNT(*) FROM case_projection_outbox WHERE projection_key LIKE ?",
                Long.class, "case:" + caseId + ":%");
    }

    private void rejectTimelineWhenUnavailable() {
        if (failTimeline.get()) {
            failedTimelines.incrementAndGet();
            throw new DataAccessResourceFailureException("Timeline indisponível no ensaio");
        }
    }

    public static class UnavailableAudit implements Trigger {
        @Override public void fire(Connection connection, Object[] previous, Object[] next) throws SQLException {
            if (FAIL_AUDIT.get()) {
                FAILED_AUDITS.incrementAndGet();
                throw new SQLException("Auditoria indisponível no ensaio", "57014");
            }
        }
    }
}
