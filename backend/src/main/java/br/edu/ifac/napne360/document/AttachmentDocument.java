package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.timeline.MutationProjection;
import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.*;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.CompoundIndex;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.Instant;
import java.util.List;

@Document("attachments")
@CompoundIndex(name = "student_uploaded", def = "{'studentId': 1, 'uploadedAt': -1}")
@CompoundIndex(name = "attachment_pending_upload", def = "{'uploadPending': 1}", partialFilter = "{'uploadPending': true}")
@CompoundIndex(name = "attachment_pending_projection", def = "{'pendingProjections.key': 1}", sparse = true)
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
    @JsonIgnore
    private String storedName;
    private String contentType;
    private long size;
    private String sha256;
    private String uploadedBy;
    @Builder.Default
    private Instant uploadedAt = Instant.now();
    @Builder.Default
    private boolean archived = false;
    @JsonIgnore
    private boolean uploadPending;
    @JsonIgnore
    private List<MutationProjection> pendingProjections;
}
