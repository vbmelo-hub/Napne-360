package br.edu.ifac.napne360.admin;

import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.identity.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/api/v1") @RequiredArgsConstructor
public class ReferenceController {
    private final ReferenceEntryRepository entries;
    @GetMapping("/catalog/references")
    public List<ReferenceEntry> active(@RequestParam ReferenceEntry.Kind kind) {return entries.findByKindAndActiveTrueOrderByLabel(kind);}
    @GetMapping("/admin/references") @PreAuthorize("hasRole('ADMIN')")
    public List<ReferenceEntry> all(){return entries.findAll();}
    @PostMapping("/admin/references") @PreAuthorize("hasRole('ADMIN')")
    public ReferenceEntry create(@Valid @RequestBody EntryRequest request){
        return entries.save(ReferenceEntry.builder().kind(request.kind()).code(request.code().trim()).label(request.label().trim()).description(request.description()).build());
    }
    @PutMapping("/admin/references/{id}") @PreAuthorize("hasRole('ADMIN')") @Transactional
    public ReferenceEntry update(@PathVariable Long id,@Valid @RequestBody EntryRequest request){
        var entry=entries.findById(id).orElseThrow(()->new NotFoundException("Item não encontrado."));
        if(entry.getKind()!=request.kind())throw new IllegalArgumentException("Tipo do catálogo é imutável.");
        entry.setCode(request.code().trim());entry.setLabel(request.label().trim());entry.setDescription(request.description());
        return entries.save(entry);
    }
    @PatchMapping("/admin/references/{id}/active") @PreAuthorize("hasRole('ADMIN')") @Transactional
    public ReferenceEntry active(@PathVariable Long id,@RequestBody AdminController.ActiveRequest request){
        var entry=entries.findById(id).orElseThrow(()->new NotFoundException("Item não encontrado."));entry.setActive(request.active());return entries.save(entry);
    }
    public record EntryRequest(@NotNull ReferenceEntry.Kind kind,@NotBlank @Size(max=80) String code,@NotBlank @Size(max=180) String label,@Size(max=2000) String description){}
}
