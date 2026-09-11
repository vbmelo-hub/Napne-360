package br.edu.ifac.napne360.document;

import lombok.*;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.Version;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@Document("student_dossiers")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class DossierDocument {
    @Id
    private String id;
    @Indexed(unique = true)
    private Long studentId;
    @Builder.Default
    private Map<String, Object> identification = new LinkedHashMap<>();
    @Builder.Default
    private Map<String, Object> educationalNeeds = new LinkedHashMap<>();
    @Builder.Default
    private Map<String, Object> healthAndSupport = new LinkedHashMap<>();
    @Builder.Default
    private Map<String, Object> familyContext = new LinkedHashMap<>();
    @Builder.Default
    private Map<String, Object> schoolHistory = new LinkedHashMap<>();
    @Builder.Default
    private Map<String, Object> strengths = new LinkedHashMap<>();
    @Builder.Default
    private Map<String, Object> difficulties = new LinkedHashMap<>();
    @Builder.Default
    private Map<String, Object> initialInterventions = new LinkedHashMap<>();
    private String updatedBy;
    @Builder.Default
    private Instant createdAt = Instant.now();
    @Builder.Default
    private Instant updatedAt = Instant.now();
    @Version
    private Long version;
    @Builder.Default
    private java.util.List<Revision> history = new java.util.ArrayList<>();

    public record Revision(Long version, Map<String, Object> fields, String author, Instant occurredAt) {}
}
