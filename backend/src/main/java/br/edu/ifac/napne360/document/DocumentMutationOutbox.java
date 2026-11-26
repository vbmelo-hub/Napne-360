package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.common.ConflictException;
import br.edu.ifac.napne360.timeline.MutationProjection;
import br.edu.ifac.napne360.timeline.MutationProjectionPublisher;
import lombok.extern.slf4j.Slf4j;
import org.bson.Document;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.Function;

@Service
@Slf4j
class DocumentMutationOutbox {
    private static final String DELAY = "${napne360.mutation-projection.retry-delay-ms}";
    private final MongoOperations mongo;
    private final MutationProjectionPublisher publisher;
    private final Executor executor;

    DocumentMutationOutbox(MongoOperations mongo, MutationProjectionPublisher publisher,
                           @Qualifier("mutationProjectionExecutor") Executor executor) {
        this.mongo = mongo;
        this.publisher = publisher;
        this.executor = executor;
    }

    void update(String id, long version, Update changes, MutationProjection event, Class<?> type) {
        var filter = Query.query(Criteria.where("id").is(id).and("version").is(version));
        changes.inc("version", 1L).push("pendingProjections", event);
        if (mongo.updateFirst(filter, changes, type).getMatchedCount() != 1) {
            throw new ConflictException("O documento foi alterado. Recarregue antes de salvar.");
        }
    }

    void enqueue(String id, Class<?> type, MutationProjection event) {
        try {
            executor.execute(() -> publish(id, type, event));
        } catch (RejectedExecutionException ignored) {
            log.debug("A projeção {} será retomada na próxima varredura", event.key());
        }
    }

    @Scheduled(initialDelayString = DELAY, fixedDelayString = DELAY)
    void retryPending() {
        retryPending(DossierDocument.class, DossierDocument::getId, DossierDocument::getPendingProjections);
        retryPending(CareRecordDocument.class, CareRecordDocument::getId, CareRecordDocument::getPendingProjections);
    }

    private <T> void retryPending(Class<T> type, Function<T, String> id, Function<T, List<MutationProjection>> pending) {
        var query = Query.query(Criteria.where("pendingProjections.key").exists(true)).cursorBatchSize(50);
        query.fields().include("pendingProjections");
        try (var documents = mongo.stream(query, type)) {
            documents.forEach(document -> pending.apply(document).forEach(event -> publish(id.apply(document), type, event)));
        } catch (RuntimeException e) {
            log.warn("Falha ao consultar projeções pendentes em {}", type.getSimpleName(), e);
        }
    }

    private void publish(String id, Class<?> type, MutationProjection event) {
        try {
            publisher.publish(event);
            // A delayed acknowledgement only removes its own event and does not change the document version.
            mongo.updateFirst(Query.query(Criteria.where("id").is(id)),
                    new Update().pull("pendingProjections", new Document("key", event.key())).inc("version", 0L), type);
        } catch (RuntimeException e) {
            log.warn("Falha ao concluir projeção {}", event.key(), e);
        }
    }
}
