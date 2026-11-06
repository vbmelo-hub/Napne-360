package br.edu.ifac.napne360.document;

import lombok.*;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.Version;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@Document("care_records")
@CompoundIndex(name = "student_type_created", def = "{'studentId': 1, 'type': 1, 'createdAt': -1}")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class CareRecordDocument {
    @Id
    private String id;
    @Indexed
    private Long studentId;
    private Long caseId;
    private Long subjectId;
    private CareRecordType type;
    @Builder.Default
    private RecordStatus status = RecordStatus.DRAFT;
    private String title;
    @Builder.Default
    private Map<String, Object> content = new LinkedHashMap<>();
    private String createdBy;
    private String updatedBy;
    @Builder.Default
    private Instant createdAt = Instant.now();
    @Builder.Default
    private Instant updatedAt = Instant.now();
    @Version
    private Long version;
    @Builder.Default
    private java.util.List<Revision> history = new java.util.ArrayList<>();

    public record Revision(Long version, String title, RecordStatus status, Map<String, Object> content,
                           String author, Instant occurredAt) {}
}
