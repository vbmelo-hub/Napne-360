package br.edu.ifac.napne360.timeline;

import br.edu.ifac.napne360.audit.AuditService;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;

import java.time.Instant;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class MutationProjectionPublisherTest {
    private final TimelineService timeline = mock(TimelineService.class);
    private final AuditService audit = mock(AuditService.class);
    private final MutationProjectionPublisher publisher = new MutationProjectionPublisher(timeline, audit);
    private final MutationProjection event = new MutationProjection("dossier:42:3", 42L, "DOSSIER_UPDATED",
            "Dossiê atualizado", "Pessoa fictícia", TimelineVisibility.RESTRICTED, Map.of("version", 3L),
            7L, "192.0.2.1", "UPDATE", "DOSSIER", "42", "Versão atualizada", Instant.parse("2026-11-25T21:25:04Z"));

    @Test void writesBothRecordsWithTheSameOperationKeyAndTimestamp() {
        publisher.publish(event);

        verify(timeline).appendOnce(event.key(), event.studentId(), event.eventType(), event.title(),
                event.actorName(), event.actorId(), event.visibility(), event.data(), event.occurredAt());
        verify(audit).recordProjection(event.key(), event.actorId(), event.ipAddress(), event.action(),
                event.resourceType(), event.resourceId(), event.details(), event.occurredAt());
    }

    @Test void reportsFailureForCallerToLeaveTheProjectionPending() {
        doThrow(new DataAccessResourceFailureException("indisponível")).when(audit)
                .recordProjection(event.key(), event.actorId(), event.ipAddress(), event.action(),
                        event.resourceType(), event.resourceId(), event.details(), event.occurredAt());

        assertThatThrownBy(() -> publisher.publish(event)).isInstanceOf(DataAccessResourceFailureException.class);
        verify(timeline).appendOnce(event.key(), event.studentId(), event.eventType(), event.title(),
                event.actorName(), event.actorId(), event.visibility(), event.data(), event.occurredAt());
    }
}
