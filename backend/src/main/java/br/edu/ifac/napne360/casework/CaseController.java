package br.edu.ifac.napne360.casework;

import br.edu.ifac.napne360.security.AccessGuard;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class CaseController {
    private final CaseService service;
    private final AccessGuard access;

    @GetMapping("/students/{studentId}/cases")
    public List<CaseService.CaseView> list(@PathVariable Long studentId) { return service.list(access.requireView(studentId)); }

    @PostMapping("/students/{studentId}/cases")
    @PreAuthorize("@accessGuard.canEditDossier(#studentId)")
    public CaseService.CaseView create(@PathVariable Long studentId, @Valid @RequestBody CaseService.CaseRequest request,
                                       Authentication auth, HttpServletRequest http) {
        return service.create(access.requireView(studentId), request, auth, http);
    }

    @PatchMapping("/cases/{caseId}/stage")
    @PreAuthorize("hasRole('NAPNE')")
    public CaseService.CaseView changeStage(@PathVariable Long caseId, @Valid @RequestBody CaseService.CaseStageRequest request,
                                            Authentication auth, HttpServletRequest http) {
        Long studentId = service.studentId(caseId);
        if (!access.canEditDossier(studentId)) throw new org.springframework.security.access.AccessDeniedException("Access denied");
        return service.changeStage(caseId, request, auth, http);
    }
}
