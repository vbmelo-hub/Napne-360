package br.edu.ifac.napne360.timeline;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.*;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@Document("timeline_events")
@CompoundIndex(name = "student_created", def = "{'studentId': 1, 'createdAt': -1}")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class TimelineEventDocument {
    @Id
    private String id;
    private Long studentId;
    private String eventType;
    private String title;
    private String actor;
    @JsonIgnore
    private Long actorId;
    @Builder.Default
    private TimelineVisibility visibility = TimelineVisibility.RESTRICTED;
    @Builder.Default
    private Map<String, Object> data = new LinkedHashMap<>();
    @Builder.Default
    private Instant createdAt = Instant.now();
}
