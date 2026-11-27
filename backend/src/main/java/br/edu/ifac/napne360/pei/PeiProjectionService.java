package br.edu.ifac.napne360.pei;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.timeline.TimelineService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;

@Service
@Slf4j
class PeiProjectionService {
    private static final String RETRY_DELAY = "${napne360.pei.projection.retry-delay-ms}";
    private final PeiSeriesStore store;
    private final TimelineService timeline;
    private final AuditService audit;
    private final Executor executor;

    PeiProjectionService(PeiSeriesStore store, TimelineService timeline, AuditService audit,
                         @Qualifier("peiProjectionExecutor") Executor executor) {
        this.store = store;
        this.timeline = timeline;
        this.audit = audit;
        this.executor = executor;
    }

    void enqueue(String seriesId, PeiProjection event) {
        try {
            executor.execute(() -> publish(seriesId, event));
        } catch (RejectedExecutionException e) {
            log.debug("A operação de PEI {} será retomada na próxima varredura", event.key());
        }
    }

    @Scheduled(initialDelayString = RETRY_DELAY, fixedDelayString = RETRY_DELAY)
    void retryPending() {
        try (var series = store.pendingProjections()) {
            series.forEach(s -> s.pendingProjections().forEach(event -> publish(s.id(), event)));
        } catch (RuntimeException e) {
            log.warn("Falha ao consultar projeções pendentes de PEI", e);
        }
    }

    private void publish(String seriesId, PeiProjection event) {
        boolean timelineWritten = attempt(event.key(), "timeline", () -> {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("peiId", event.revisionId());
            data.put("revision", event.revision());
            if (event.subjectId() != null) data.put("subjectId", event.subjectId());
            if (event.academicTerm() != null) data.put("academicTerm", event.academicTerm());
            if (event.offeringId() != null) data.put("offeringId", event.offeringId());
            timeline.appendOnce(event.key(), event.studentId(), event.eventType(), event.title(), event.actorName(),
                    event.visibility(), data, event.occurredAt());
        });
        boolean auditWritten = attempt(event.key(), "auditoria", () ->
                audit.recordPeiMutation(event.key(), event.actorId(), event.ipAddress(), event.action(),
                        event.revisionId(), event.revision(), event.occurredAt()));
        if (timelineWritten && auditWritten) {
            attempt(event.key(), "confirmação", () -> store.acknowledgeProjection(seriesId, event.key()));
        }
    }

    private boolean attempt(String key, String projection, Runnable write) {
        try {
            write.run();
            return true;
        } catch (RuntimeException e) {
            log.warn("Falha na {} da operação de PEI {}", projection, key, e);
            return false;
        }
    }
}
