package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.security.AccessGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/students/{studentId}/dossier")
@RequiredArgsConstructor
public class DossierController {
    private final DossierService service;
    private final AccessGuard access;
    private final DossierRepository dossiers;

    @GetMapping("/history")
    @PreAuthorize("@accessGuard.canEditDossier(#studentId)")
    public java.util.List<DossierDocument.Revision> history(@PathVariable Long studentId) {
        return dossiers.findByStudentId(studentId).map(DossierDocument::getHistory).orElseGet(java.util.List::of);
    }

    @GetMapping
    public DossierService.DossierView get(@PathVariable Long studentId, Authentication auth, HttpServletRequest http) {
        access.requireView(studentId);
        return service.get(studentId, auth, http);
    }

    @PutMapping
    @PreAuthorize("@accessGuard.canEditDossier(#studentId)")
    public DossierService.DossierView save(@PathVariable Long studentId,
                                           @RequestBody DossierService.DossierRequest request,
                                           Authentication auth, HttpServletRequest http) {
        access.requireView(studentId);
        return service.save(studentId, request, auth, http);
    }
}
