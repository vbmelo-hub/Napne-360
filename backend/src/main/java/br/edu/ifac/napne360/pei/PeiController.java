package br.edu.ifac.napne360.pei;

import br.edu.ifac.napne360.security.AccessGuard;
import br.edu.ifac.napne360.student.Student;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/students/{studentId}/peis")
@RequiredArgsConstructor
public class PeiController {
    private final PeiService service;
    private final AccessGuard access;

    @GetMapping
    public List<PeiDocument> list(@PathVariable Long studentId) {
        access.requireView(studentId);
        return service.list(studentId);
    }

    @GetMapping("/{id}")
    public PeiDocument get(@PathVariable Long studentId, @PathVariable String id) {
        access.requireView(studentId);
        return service.get(studentId, id);
    }

    @PostMapping
    public PeiDocument create(@PathVariable Long studentId, @Valid @RequestBody PeiService.PeiCreateRequest request,
                              Authentication auth, HttpServletRequest http) {
        Student student = access.requireView(studentId);
        return service.createDraft(student, request, auth, http);
    }

    @PutMapping("/{id}")
    public PeiDocument update(@PathVariable Long studentId, @PathVariable String id,
                              @Valid @RequestBody PeiService.PeiUpdateRequest request,
                              Authentication auth, HttpServletRequest http) {
        return service.createVersion(studentId, id, request, auth, http);
    }

    @GetMapping("/{id}/transfer-candidates")
    public List<PeiService.TransferCandidate> transferCandidates(@PathVariable Long studentId, @PathVariable String id) {
        return service.transferCandidates(studentId, id);
    }

    @PostMapping("/{id}/transfer")
    public PeiDocument transfer(@PathVariable Long studentId, @PathVariable String id,
                                @Valid @RequestBody PeiService.PeiTransferRequest request,
                                Authentication auth, HttpServletRequest http) {
        return service.transfer(studentId, id, request, auth, http);
    }

    @PostMapping("/{id}/{operation:submit|return|approve|archive|revisions}")
    public PeiDocument transition(@PathVariable Long studentId, @PathVariable String id, @PathVariable String operation,
                                  @Valid @RequestBody PeiService.PeiActionRequest request,
                                  Authentication auth, HttpServletRequest http) {
        var action = switch (operation) {
            case "submit" -> PeiService.Action.SUBMIT;
            case "return" -> PeiService.Action.RETURN;
            case "approve" -> PeiService.Action.APPROVE;
            case "archive" -> PeiService.Action.ARCHIVE;
            case "revisions" -> PeiService.Action.START_REVISION;
            default -> throw new IllegalArgumentException("Operação de PEI inválida.");
        };
        return service.transition(studentId, id, action, request.version(), auth, http);
    }
}
