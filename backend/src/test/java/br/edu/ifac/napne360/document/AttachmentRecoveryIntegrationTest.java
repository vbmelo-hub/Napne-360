package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.audit.AuditEventRepository;
import br.edu.ifac.napne360.common.ConflictException;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.timeline.MutationProjectionPublisher;
import br.edu.ifac.napne360.timeline.TimelineRepository;
import br.edu.ifac.napne360.timeline.TimelineVisibility;
import org.bson.Document;
import org.bson.types.ObjectId;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Arrays;
import java.util.Date;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.spy;

@SpringBootTest(properties = {
        "napne360.attachments.recovery.delay-ms=3600000",
        "napne360.pei.projection.retry-delay-ms=3600000",
        "spring.datasource.url=jdbc:h2:mem:napne_attachment_recovery;MODE=MySQL;DB_CLOSE_DELAY=-1"
})
@ActiveProfiles("test")
@EnabledIfEnvironmentVariable(named = "NAPNE_TEST_ATTACHMENT_MONGO_URI", matches = ".+")
class AttachmentRecoveryIntegrationTest {
    private static final String DATABASE = "napne_attachment_test_" + UUID.randomUUID().toString().replace("-", "");
    private static final String MONGO_URI = System.getenv("NAPNE_TEST_ATTACHMENT_MONGO_URI");
    // Null id represents the fixture's absent SQL account while preserving audit projections and metadata authorship.
    private static final UserAccount ACTOR = UserAccount.builder().email("equipe@example.test").name("Equipe fictícia").build();

    @TempDir Path directory;
    @Autowired MongoTemplate mongo;
    @Autowired AttachmentRepository attachments;
    @Autowired AttachmentStateStore state;
    @Autowired MutationProjectionPublisher publisher;
    @Autowired TimelineRepository timeline;
    @Autowired AuditEventRepository audit;

    @DynamicPropertySource
    static void standaloneMongo(DynamicPropertyRegistry registry) {
        registry.add("spring.data.mongodb.uri", () -> MONGO_URI);
        registry.add("spring.data.mongodb.database", () -> DATABASE);
        registry.add("spring.data.mongodb.auto-index-creation", () -> "true");
    }

    @AfterAll
    static void removeFictitiousDatabase(@Autowired MongoTemplate mongo) {
        assertThat(mongo.getDb().getName()).isEqualTo(DATABASE);
        mongo.getDb().drop();
    }

    @Test
    void workerRecoversCompleteBinaryAndReplaysPublishedHistoryWithoutDuplicating() throws Exception {
        Long studentId = 421L;
        var storage = new LocalStorageService(directory.toString());
        var previousFile = pdf("anterior.pdf", "Anterior");
        var legacy = legacyAttachment(studentId, storage.store(studentId, previousFile));
        var unavailable = spy(new AttachmentStateStore(mongo));
        doThrow(new DataAccessResourceFailureException("Mongo indisponível ao confirmar o binário"))
                .when(unavailable).confirmUpload(anyString());
        var service = service(unavailable, storage);
        var file = pdf("atual.pdf", "Atualização");
        assertThatThrownBy(() -> service.upload(studentId, "Fictício", legacy, "recuperar", file, ACTOR, "192.0.2.42"))
                .isInstanceOf(AttachmentService.UnavailableException.class);

        var pending = attachments.findAll().stream().filter(a -> studentId.equals(a.getStudentId()) && a.isUploadPending())
                .findFirst().orElseThrow();
        assertThat(storage.load(pending.getStoredName()).getContentAsByteArray()).isEqualTo(file.getBytes());
        assertThat(attachments.findActiveByStudentId(studentId)).extracting(AttachmentDocument::getId).containsExactly(legacy);
        assertThatThrownBy(() -> service.findConfirmed(studentId, pending.getId())).isInstanceOf(NotFoundException.class);
        assertThatThrownBy(() -> service.archive(studentId, pending.getId(), ACTOR, null)).isInstanceOf(NotFoundException.class);
        assertThat(timeline.findByStudentIdOrderByCreatedAtDesc(studentId)).isEmpty();

        var lostHistoryAcknowledgement = spy(new AttachmentStateStore(mongo));
        doThrow(new DataAccessResourceFailureException("Falha de confirmação após publicar"))
                .when(lostHistoryAcknowledgement).acknowledgeProjection(anyString(), anyString());
        new AttachmentRecoveryService(lostHistoryAcknowledgement, storage, publisher, Runnable::run).recover();
        var healthy = service(state, storage);
        healthy.archive(studentId, pending.getId(), ACTOR, null);
        healthy.archive(studentId, pending.getId(), ACTOR, null);
        var replay = healthy.upload(studentId, "Fictício", legacy, "recuperar", file, ACTOR, "192.0.2.42");
        assertThat(replay.getId()).isEqualTo(pending.getId());
        assertThat(replay.isArchived()).isTrue();
        assertThat(replay.getRevision()).isEqualTo(4);
        assertThat(replay.getPreviousVersionId()).isEqualTo(legacy);
        assertThat(attachments.findActiveByStudentId(studentId)).extracting(AttachmentDocument::getId).containsExactly(legacy);
        assertThat(storage.load(replay.getStoredName()).getContentAsByteArray()).isEqualTo(file.getBytes());
        assertThat(storage.load(attachments.findById(legacy).orElseThrow().getStoredName()).getContentAsByteArray())
                .isEqualTo(previousFile.getBytes());
        assertThat(directory).isDirectoryContaining(path -> path.endsWith(replay.getStoredName()));
        try (var files = Files.list(directory)) {
            assertThat(files.toList()).hasSize(2);
        }

        assertThat(timeline.findByStudentIdOrderByCreatedAtDesc(studentId)).hasSize(2)
                .allSatisfy(event -> assertThat(event.getVisibility()).isEqualTo(TimelineVisibility.RESTRICTED))
                .extracting(e -> e.getEventType()).containsExactly("ATTACHMENT_ARCHIVED", "ATTACHMENT_UPLOADED");
        assertThat(audit.findAll()).filteredOn(a -> replay.getId().equals(a.getResourceId()))
                .extracting(a -> a.getAction()).containsExactlyInAnyOrder("UPLOAD", "ARCHIVE");
        assertThat(attachments.findById(replay.getId()).orElseThrow().getPendingProjections()).isEmpty();
    }

    @Test
    void lostMongoReplyAndConcurrentRetriesKeepOneVersionAndRejectDifferentContent() throws Exception {
        var studentId = 422L;
        var storage = new LocalStorageService(directory.toString());
        var commitWithoutReply = spy(new AttachmentStateStore(mongo));
        doAnswer(invocation -> {
            invocation.callRealMethod();
            throw new DataAccessResourceFailureException("Resposta perdida após confirmar os metadados");
        }).when(commitWithoutReply).confirmUpload(anyString());
        var lostReply = service(commitWithoutReply, storage);
        var file = pdf("ficticio.pdf", "Mesmo arquivo");
        var confirmed = lostReply.upload(studentId, "Fictício", null, "mesmo-envio", file, ACTOR, null);
        var healthy = service(state, storage);
        assertThat(healthy.upload(studentId, "Fictício", null, "mesmo-envio", file, ACTOR, null).getId())
                .isEqualTo(confirmed.getId());

        var revision = pdf("ficticio-v2.pdf", "Revisão simultânea");
        var barrier = new CyclicBarrier(2);
        try (var requests = Executors.newFixedThreadPool(2)) {
            var first = requests.submit(() -> {
                barrier.await(5, TimeUnit.SECONDS);
                return healthy.upload(studentId, "Fictício", confirmed.getId(), "revisar", revision, ACTOR, null);
            });
            var second = requests.submit(() -> {
                barrier.await(5, TimeUnit.SECONDS);
                return healthy.upload(studentId, "Fictício", confirmed.getId(), "revisar", revision, ACTOR, null);
            });
            var newer = first.get(10, TimeUnit.SECONDS);
            assertThat(second.get(10, TimeUnit.SECONDS).getId()).isEqualTo(newer.getId());
            assertThat(newer.getRevision()).isEqualTo(2);
            assertThat(newer.getPreviousVersionId()).isEqualTo(confirmed.getId());
        }
        assertThatThrownBy(() -> healthy.upload(studentId, "Fictício", confirmed.getId(), "revisar",
                pdf("ficticio-v2.pdf", "Conteúdo diferente"), ACTOR, null)).isInstanceOf(ConflictException.class);
        assertThat(attachments.findActiveByStudentId(studentId)).hasSize(2);
        assertThat(timeline.findByStudentIdOrderByCreatedAtDesc(studentId)).hasSize(2);
        try (var files = Files.list(directory)) {
            assertThat(files.toList()).hasSize(2);
        }
    }

    @Test
    void workerLeavesTruncatedOrCorruptBytesHiddenUntilSameUploadIsRetried() throws Exception {
        Long studentId = 423L;
        var storage = new LocalStorageService(directory.toString());
        var interruptedStorage = spy(storage);
        doAnswer(invocation -> {
            var file = invocation.<DocumentStorage.PreparedFile>getArgument(0);
            Files.write(directory.resolve(file.storedName()), Arrays.copyOf(file.bytes(), 5));
            throw new IOException("Gravação interrompida");
        }).when(interruptedStorage).write(any());
        var file = pdf("ficticio.pdf", "Arquivo interrompido");
        assertThatThrownBy(() -> service(state, interruptedStorage).upload(studentId, "Fictício", null, "interrompido", file, ACTOR, null))
                .isInstanceOf(AttachmentService.UnavailableException.class);
        var pending = attachments.findAll().stream().filter(a -> studentId.equals(a.getStudentId())).findFirst().orElseThrow();

        var worker = new AttachmentRecoveryService(state, storage, publisher, Runnable::run);
        worker.recover();
        assertThat(attachments.findActiveByStudentId(studentId)).isEmpty();

        Files.write(directory.resolve(pending.getStoredName()), new byte[file.getBytes().length]);
        worker.recover();
        assertThat(attachments.findActiveByStudentId(studentId)).isEmpty();
        assertThat(timeline.findByStudentIdOrderByCreatedAtDesc(studentId)).isEmpty();

        var retried = service(state, storage).upload(studentId, "Fictício", null, "interrompido", file, ACTOR, null);
        assertThat(retried.getId()).isEqualTo(pending.getId());
        assertThat(storage.load(retried.getStoredName()).getContentAsByteArray()).isEqualTo(file.getBytes());
        assertThat(attachments.findActiveByStudentId(studentId)).hasSize(1);
        assertThat(timeline.findByStudentIdOrderByCreatedAtDesc(studentId)).hasSize(1);
    }

    private String legacyAttachment(long studentId, DocumentStorage.StoredFile file) {
        var id = new ObjectId();
        mongo.getCollection("attachments").insertOne(new Document("_id", id).append("studentId", studentId)
                .append("revision", 3).append("storedName", file.storedName()).append("sha256", file.sha256())
                .append("category", "Fictício").append("uploadedAt", Date.from(Instant.parse("2026-11-24T10:00:00Z"))));
        return id.toHexString();
    }

    private AttachmentService service(AttachmentStateStore store, LocalStorageService storage) {
        return new AttachmentService(attachments, store, storage,
                new AttachmentRecoveryService(store, storage, publisher, Runnable::run));
    }

    private MockMultipartFile pdf(String name, String content) {
        return new MockMultipartFile("file", name, "application/pdf", ("%PDF-1.7\n" + content).getBytes(StandardCharsets.UTF_8));
    }
}
