package br.edu.ifac.napne360.pei;

import br.edu.ifac.napne360.timeline.TimelineVisibility;

import java.time.Instant;

record PeiProjection(String key, Long studentId, Long subjectId, String revisionId, int revision,
                     Instant occurredAt, Long actorId, String actorName, String ipAddress, String action,
                     String eventType, String title, TimelineVisibility visibility, String academicTerm, Long offeringId) {
}
