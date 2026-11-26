package br.edu.ifac.napne360.timeline;

import br.edu.ifac.napne360.audit.AuditService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class MutationProjectionPublisher {
    private final TimelineService timeline;
    private final AuditService audit;

    public void publish(MutationProjection event) {
        timeline.appendOnce(event.key(), event.studentId(), event.eventType(), event.title(), event.actorName(),
                event.visibility(), event.data(), event.occurredAt());
        audit.recordProjection(event.key(), event.actorId(), event.ipAddress(), event.action(), event.resourceType(),
                event.resourceId(), event.details(), event.occurredAt());
    }
}
