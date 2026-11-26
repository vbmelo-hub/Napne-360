package br.edu.ifac.napne360.casework;

import br.edu.ifac.napne360.timeline.MutationProjection;
import br.edu.ifac.napne360.timeline.MutationProjectionPublisher;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.PageRequest;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;

@Service
@Slf4j
class CaseMutationOutbox {
    private static final String DELAY = "${napne360.mutation-projection.retry-delay-ms}";
    private static final PageRequest BATCH = PageRequest.of(0, 50);
    private final CaseProjectionRepository pending;
    private final MutationProjectionPublisher publisher;
    private final ApplicationEventPublisher events;
    private final ObjectMapper json;
    private final Executor executor;

    CaseMutationOutbox(CaseProjectionRepository pending, MutationProjectionPublisher publisher,
                       ApplicationEventPublisher events, ObjectMapper json,
                       @Qualifier("mutationProjectionExecutor") Executor executor) {
        this.pending = pending;
        this.publisher = publisher;
        this.events = events;
        this.json = json;
        this.executor = executor;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    void stage(MutationProjection event) {
        try {
            pending.save(new CaseProjectionEntry(event.key(), json.writeValueAsString(event)));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Falha ao preparar projeção do caso", e);
        }
        events.publishEvent(new CaseProjectionReady(event));
    }

    @TransactionalEventListener
    void enqueue(CaseProjectionReady ready) {
        var event = ready.event();
        try {
            executor.execute(() -> publish(event));
        } catch (RejectedExecutionException ignored) {
            log.debug("A projeção {} será retomada na próxima varredura", event.key());
        }
    }

    @Scheduled(initialDelayString = DELAY, fixedDelayString = DELAY)
    void retryPending() {
        try {
            String after = "";
            List<CaseProjectionEntry> batch;
            do {
                batch = pending.findByProjectionKeyGreaterThanOrderByProjectionKey(after, BATCH);
                for (var row : batch) {
                    try {
                        publish(json.readValue(row.getPayload(), MutationProjection.class));
                    } catch (JsonProcessingException e) {
                        log.warn("Projeção de caso {} ilegível", row.getProjectionKey(), e);
                    }
                }
                if (!batch.isEmpty()) after = batch.getLast().getProjectionKey();
            } while (batch.size() == BATCH.getPageSize());
        } catch (RuntimeException e) {
            log.warn("Falha ao consultar projeções pendentes de casos", e);
        }
    }

    private void publish(MutationProjection event) {
        try {
            publisher.publish(event);
            pending.acknowledge(event.key());
        } catch (RuntimeException e) {
            log.warn("Falha ao concluir projeção {}", event.key(), e);
        }
    }

    record CaseProjectionReady(MutationProjection event) {}
}
