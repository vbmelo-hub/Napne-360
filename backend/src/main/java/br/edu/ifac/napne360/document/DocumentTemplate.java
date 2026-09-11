package br.edu.ifac.napne360.document;

import lombok.*;
import org.springframework.data.annotation.Id;
import org.springframework.data.annotation.Version;
import org.springframework.data.mongodb.core.mapping.Document;
import java.time.Instant;
import java.util.*;

@Document("document_templates") @Getter @Setter @Builder @NoArgsConstructor @AllArgsConstructor
public class DocumentTemplate {
    @Id private String id;
    private String name;
    private String documentType;
    @Builder.Default private Map<String,Object> defaults=new LinkedHashMap<>();
    @Builder.Default private boolean active=true;
    private String updatedBy;
    @Builder.Default private Instant updatedAt=Instant.now();
    @Version private Long version;
    @Builder.Default private List<Revision> history=new ArrayList<>();
    public record Revision(Map<String,Object> defaults,String author,Instant date){}
}
