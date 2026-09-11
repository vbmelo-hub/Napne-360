package br.edu.ifac.napne360.pei;

import lombok.*;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.Version;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@Document("pei_documents")
@CompoundIndex(name = "student_subject_term_unique", def = "{'studentId': 1, 'subjectId': 1, 'academicTerm': 1, 'revision': -1}", unique = true)
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class PeiDocument {
    @Id
    private String id;
    private Long studentId;
    private Long subjectId;
    private Long teacherId;
    private String academicTerm;
    @Builder.Default
    private int revision = 1;
    @Builder.Default
    private PeiStatus status = PeiStatus.DRAFT;
    @Builder.Default
    private Map<String, Object> content = new LinkedHashMap<>();
    private String createdBy;
    private String updatedBy;
    private String reviewedBy;
    private Instant reviewedAt;
    @Builder.Default
    private Instant createdAt = Instant.now();
    @Builder.Default
    private Instant updatedAt = Instant.now();
    @Version
    private Long storageVersion;
}
