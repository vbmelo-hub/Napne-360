package br.edu.ifac.napne360.timeline;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

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
}
