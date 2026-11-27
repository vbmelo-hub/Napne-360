package br.edu.ifac.napne360.pei;

import br.edu.ifac.napne360.audit.AuditEventRepository;
import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.common.ConflictException;
import br.edu.ifac.napne360.timeline.TimelineRepository;
import br.edu.ifac.napne360.timeline.TimelineService;
import br.edu.ifac.napne360.timeline.TimelineVisibility;
import org.bson.Document;
import org.bson.types.ObjectId;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.spy;

@SpringBootTest(properties = {
        "napne360.pei.projection.retry-delay-ms=3600000",
        "spring.datasource.url=jdbc:h2:mem:napne_pei_projection;MODE=MySQL;DB_CLOSE_DELAY=-1"
})
@ActiveProfiles("test")
@EnabledIfEnvironmentVariable(named = "NAPNE_TEST_PEI_MONGO_URI", matches = ".+")
class PeiProjectionIntegrationTest {
    private static final String DATABASE = "napne_pei_projection_" + UUID.randomUUID().toString().replace("-", "");
    private static final String MONGO_URI = System.getenv("NAPNE_TEST_PEI_MONGO_URI");

    @Autowired MongoTemplate mongo;
    @Autowired PeiRepository legacy;
    @Autowired TimelineService timeline;
    @Autowired TimelineRepository timelineEvents;
    @Autowired AuditService audit;
    @Autowired AuditEventRepository auditEvents;

    @DynamicPropertySource
    static void standaloneMongo(DynamicPropertyRegistry registry) {
        registry.add("spring.data.mongodb.uri", () -> MONGO_URI);
        registry.add("spring.data.mongodb.database", () -> DATABASE);
        registry.add("spring.data.mongodb.auto-index-creation", () -> "true");
    }

    @Test void restartedWorkerReplaysAfterLostConfirmationAndPreservesNewerProjectionAndLegacyIds() {
        assertThat(mongo.getDb().getName()).isEqualTo(DATABASE);
        try {
            exerciseRecovery();
        } finally {
            mongo.getDb().drop();
        }
    }

    private void exerciseRecovery() {
        var legacyId = new ObjectId();
        var key = PeiSeries.key(101L, null, null);
        var occurredAt = Instant.parse("2026-11-25T21:25:04.923Z");
        mongo.getCollection("pei_series").insertOne(new Document("_id", key).append("version", 0L)
                .append("studentId", 101L).append("revisions", List.of(
                        new Document("_id", legacyId).append("studentId", 101L).append("revision", 7)
                                .append("storageVersion", 0L).append("status", "IN_REVIEW"))));
        var store = new PeiSeriesStore(mongo, legacy);
        var older = store.find(101L, legacyId.toHexString()).orElseThrow();
        assertThat(older.pendingProjections()).isEmpty();
        var draft = older.revisions().getFirst().toBuilder().status(PeiStatus.DRAFT).storageVersion(1L).build();
        var returned = new PeiProjection("pei:" + legacyId.toHexString() + ":1", 101L, null, legacyId.toHexString(), 7,
                occurredAt, null, "Pessoa fictícia", "192.0.2.53", "RETURN", "PEI_RETURNED",
                "PEI devolvido para ajustes", TimelineVisibility.PEDAGOGICAL, null, null);
        store.save(older, older.next(List.of(draft), returned), returned);

        var beforeLostAck = spy(store);
        doThrow(new DataAccessResourceFailureException("confirmação indisponível"))
                .when(beforeLostAck).acknowledgeProjection(key, returned.key());
        new PeiProjectionService(beforeLostAck, timeline, audit, Runnable::run).enqueue(key, returned);
        var awaitingConfirmation = store.load(101L, null, null);
        assertThat(awaitingConfirmation.pendingProjections()).containsExactly(returned);
        assertThat(timelineEvents.findByStudentIdOrderByCreatedAtDesc(101L)).hasSize(1);
        assertThat(auditEvents.findAll()).filteredOn(event -> returned.key().equals(event.getProjectionKey())).hasSize(1);

        store.acknowledgeProjection(key, returned.key());
        var submitted = new PeiProjection("pei:" + legacyId.toHexString() + ":2", 101L, null, legacyId.toHexString(), 7,
                occurredAt.plusSeconds(1), null, "Docente fictício", "192.0.2.54", "SUBMIT", "PEI_SUBMITTED",
                "PEI enviado para revisão", TimelineVisibility.PEDAGOGICAL, null, null);
        var inReview = draft.toBuilder().status(PeiStatus.IN_REVIEW).storageVersion(2L).build();
        store.save(awaitingConfirmation, awaitingConfirmation.next(List.of(inReview), submitted), submitted);
        assertThatThrownBy(() -> store.save(older, older.next(List.of(draft), returned), returned))
                .isInstanceOf(ConflictException.class);
        assertThat(store.load(101L, null, null).pendingProjections()).containsExactly(submitted);

        var pending = store.load(101L, null, null);
        var publisher = new PeiProjectionService(new PeiSeriesStore(mongo, legacy), timeline, audit, Runnable::run);
        publisher.enqueue(key, returned);
        assertThat(store.load(101L, null, null).pendingProjections()).containsExactly(submitted);
        publisher.retryPending();
        publisher.retryPending();

        var saved = store.find(101L, legacyId.toHexString()).orElseThrow();
        assertThat(saved.pendingProjections()).isEmpty();
        assertThat(saved.version()).isEqualTo(pending.version());
        assertThat(saved.revisions()).singleElement().satisfies(revision -> {
            assertThat(revision.getStatus()).isEqualTo(PeiStatus.IN_REVIEW);
            assertThat(revision.getStorageVersion()).isEqualTo(2L);
        });
        assertThat(timelineEvents.findByStudentIdOrderByCreatedAtDesc(101L)).hasSize(2).element(1).satisfies(event -> {
            assertThat(event.getId()).isEqualTo(returned.key());
            assertThat(event.getData()).isEqualTo(Map.of("peiId", legacyId.toHexString(), "revision", 7));
            assertThat(event.getCreatedAt()).isEqualTo(occurredAt);
        });
        assertThat(auditEvents.findAll()).filteredOn(event -> returned.key().equals(event.getProjectionKey()))
                .singleElement().satisfies(event -> {
                    assertThat(event.getAction()).isEqualTo("RETURN");
                    assertThat(event.getResourceType()).isEqualTo("PEI");
                    assertThat(event.getResourceId()).isEqualTo(legacyId.toHexString());
                    assertThat(event.getDetails()).isEqualTo("Revisão 7");
                    assertThat(event.getOutcome()).isEqualTo("SUCCESS");
                    assertThat(event.getOccurredAt()).isEqualTo(occurredAt);
                    assertThat(event.getIpAddress()).isEqualTo("192.0.2.53");
                });
        assertThat(auditEvents.findAll()).filteredOn(event -> submitted.key().equals(event.getProjectionKey())).hasSize(1);
    }
}
