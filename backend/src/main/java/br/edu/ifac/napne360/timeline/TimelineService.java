package br.edu.ifac.napne360.timeline;

import lombok.RequiredArgsConstructor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class TimelineService {
    private final TimelineRepository repository;

    public void append(Long studentId, String eventType, String title, String actor,
                       TimelineVisibility visibility, Map<String, Object> data) {
        repository.save(TimelineEventDocument.builder().studentId(studentId).eventType(eventType)
                .title(title).actor(actor).visibility(visibility).data(data == null ? Map.of() : data).build());
    }

    public void appendOnce(String key, Long studentId, String eventType, String title, String actor, Long actorId,
                           TimelineVisibility visibility, Map<String, Object> data, Instant occurredAt) {
        try {
            repository.insert(TimelineEventDocument.builder().id(key).studentId(studentId).eventType(eventType)
                    .title(title).actor(actor).actorId(actorId).visibility(visibility).data(data).createdAt(occurredAt).build());
        } catch (DuplicateKeyException alreadyPublished) {
            // The deterministic _id identifies the same operation on every retry.
        }
    }
}
