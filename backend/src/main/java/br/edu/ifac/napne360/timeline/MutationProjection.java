package br.edu.ifac.napne360.timeline;

import java.time.Instant;
import java.util.Map;

public record MutationProjection(String key, Long studentId, String eventType, String title, String actorName,
                                 TimelineVisibility visibility, Map<String, Object> data,
                                 Long actorId, String ipAddress, String action, String resourceType,
                                 String resourceId, String details, Instant occurredAt) {
}
