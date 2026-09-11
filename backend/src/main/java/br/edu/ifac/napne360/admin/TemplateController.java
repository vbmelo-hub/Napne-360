package br.edu.ifac.napne360.admin;

import br.edu.ifac.napne360.document.*;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.security.CurrentUserService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import java.time.Instant;
import java.util.*;

@RestController @RequestMapping("/api/v1/admin/templates") @PreAuthorize("hasRole('ADMIN')") @RequiredArgsConstructor
public class TemplateController {
    private final DocumentTemplateRepository templates;
    private final CurrentUserService currentUser;
    @GetMapping public List<DocumentTemplate> list(){return templates.findAll();}
    @PostMapping public DocumentTemplate create(@Valid @RequestBody TemplateRequest request){
        return save(DocumentTemplate.builder().build(),request);
    }
    @PutMapping("/{id}") public DocumentTemplate update(@PathVariable String id,@Valid @RequestBody TemplateRequest request){
        var value=templates.findById(id).orElseThrow(()->new NotFoundException("Modelo não encontrado."));
        if(!Objects.equals(request.version(),value.getVersion()))throw new br.edu.ifac.napne360.common.ConflictException("Modelo alterado. Recarregue.");
        value.getHistory().add(new DocumentTemplate.Revision(new LinkedHashMap<>(value.getDefaults()),value.getUpdatedBy(),value.getUpdatedAt()));
        return save(value,request);
    }
    private DocumentTemplate save(DocumentTemplate value,TemplateRequest request){
        if(!request.documentType().equals("PEI")) CareRecordType.valueOf(request.documentType());
        value.setName(request.name());value.setDocumentType(request.documentType());value.setDefaults(new LinkedHashMap<>(request.defaults()));
        value.setActive(request.active());value.setUpdatedBy(currentUser.require().getEmail());value.setUpdatedAt(Instant.now());
        return templates.save(value);
    }
    public record TemplateRequest(@NotBlank @Size(max=180) String name,@NotBlank String documentType,@NotNull Map<String,Object> defaults,boolean active,Long version){}
}
