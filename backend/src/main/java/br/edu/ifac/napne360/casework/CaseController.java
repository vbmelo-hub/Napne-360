package br.edu.ifac.napne360.casework;

import br.edu.ifac.napne360.security.AccessGuard;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.time.Instant;

@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class CaseController {
    private final CaseService service;
    private final AccessGuard access;

    @GetMapping("/students/{studentId}/cases")
    public List<CaseService.CaseView> list(@PathVariable Long studentId) { return service.list(access.requireView(studentId)); }

    @GetMapping("/students/{studentId}/cases/stages")
    @PreAuthorize("hasRole('NAPNE')")
    public List<CaseStageCatalogue.Option> stages(@PathVariable Long studentId) {
        access.requireView(studentId);
        return service.stages();
    }

    @PostMapping("/students/{studentId}/cases")
    @PreAuthorize("@accessGuard.canEditDossier(#studentId)")
    public CaseService.CaseView create(@PathVariable Long studentId, @Valid @RequestBody CaseService.CaseRequest request,
                                       Authentication auth, HttpServletRequest http) {
        return service.create(access.requireView(studentId), request, auth, http);
    }

    @PatchMapping("/cases/{caseId}")
    @PreAuthorize("hasRole('NAPNE')")
    public CaseService.CaseView update(@PathVariable String caseId, @Valid @RequestBody CaseService.CaseDetailsRequest request,
                                       Authentication auth, HttpServletRequest http) {
        return service.updateDetails(caseId(caseId), request, auth, http);
    }

    @PatchMapping("/cases/{caseId}/stage")
    @PreAuthorize("hasRole('NAPNE')")
    public CaseService.CaseView changeStage(@PathVariable String caseId, @Valid @RequestBody CaseService.CaseStageRequest request,
                                            Authentication auth, HttpServletRequest http) {
        return service.changeStage(caseId(caseId), request, auth, http);
    }

    @GetMapping("/cases/{caseId}")
    @PreAuthorize("hasRole('NAPNE')")
    public CaseService.CaseView get(@PathVariable String caseId) { return service.get(caseId(caseId)); }

    @GetMapping("/cases/{caseId}/responsible-candidates")
    @PreAuthorize("hasRole('NAPNE')")
    public List<CaseService.ResponsibleCandidate> candidates(@PathVariable String caseId) { return service.candidates(caseId(caseId)); }

    @PatchMapping("/cases/{caseId}/responsible")
    @PreAuthorize("hasRole('NAPNE')")
    public CaseService.CaseView transfer(@PathVariable String caseId, @Valid @RequestBody CaseService.ResponsibleRequest request,
                                         Authentication auth, HttpServletRequest http) {
        return service.transfer(caseId(caseId), request, auth, http);
    }

    @GetMapping("/cases/{caseId}/history")
    @PreAuthorize("hasRole('NAPNE')")
    public CaseService.HistoryPage history(@PathVariable String caseId, @RequestParam(required = false) String page,
                                           @RequestParam(required = false) String size,
                                           @RequestParam(required = false) CaseHistory.Type type,
                                           @RequestParam(required = false) String actor,
                                           @RequestParam(required = false) @Positive Long actorId,
                                           @RequestParam(required = false) Long version,
                                           @RequestParam(required = false) Instant from,
                                           @RequestParam(required = false) Instant to) {
        return service.history(caseId(caseId), page == null ? 0 : pageNumber(page), size == null ? 20 : pageNumber(size),
                type, actor, actorId, version, from, to);
    }

    @GetMapping("/cases/{caseId}/history/actors")
    @PreAuthorize("hasRole('NAPNE')")
    public List<CaseService.HistoryAuthor> historyActors(@PathVariable String caseId) {
        return service.historyAuthors(caseId(caseId));
    }

    private long caseId(String value) {
        if (!value.matches("[1-9][0-9]*")) throw new IllegalArgumentException("Identificador inválido.");
        return Long.parseLong(value);
    }

    private int pageNumber(String value) {
        if (!value.matches("[0-9]+")) throw new IllegalArgumentException("Paginação inválida.");
        return Integer.parseInt(value);
    }
}
