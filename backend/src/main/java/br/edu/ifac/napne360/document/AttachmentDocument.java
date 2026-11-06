package br.edu.ifac.napne360.document;

import lombok.*;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;

@Document("attachments")
@CompoundIndex(name = "student_uploaded", def = "{'studentId': 1, 'uploadedAt': -1}")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AttachmentDocument {
    @Id
    private String id;
    private Long studentId;
    private String category;
    private String previousVersionId;
    @Builder.Default
    private int revision = 1;
    private String originalName;
    @com.fasterxml.jackson.annotation.JsonIgnore
    private String storedName;
    private String contentType;
    private long size;
    private String sha256;
    private String uploadedBy;
    @Builder.Default
    private Instant uploadedAt = Instant.now();
    @Builder.Default
    private boolean archived = false;
}
