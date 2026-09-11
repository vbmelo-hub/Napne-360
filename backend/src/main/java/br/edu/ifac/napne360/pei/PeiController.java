package br.edu.ifac.napne360.pei;

import br.edu.ifac.napne360.security.AccessGuard;
import br.edu.ifac.napne360.student.Student;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
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
        if (!access.canManagePei(studentId, request.subjectId())) throw new AccessDeniedException("Access denied");
        return service.createDraft(student, request, auth, http);
    }

    @PutMapping("/{id}")
    public PeiDocument update(@PathVariable Long studentId, @PathVariable String id,
                              @RequestBody PeiService.PeiUpdateRequest request,
                              Authentication auth, HttpServletRequest http) {
        PeiDocument current = service.get(studentId, id);
        if (!access.canManagePei(studentId, current.getSubjectId())) throw new AccessDeniedException("Access denied");
        return service.createVersion(studentId, id, request, auth, http);
    }

    @PostMapping("/{id}/approve")
    public PeiDocument approve(@PathVariable Long studentId, @PathVariable String id,
                               Authentication auth, HttpServletRequest http) {
        PeiDocument current = service.get(studentId, id);
        if (!access.canManagePei(studentId, current.getSubjectId())) throw new AccessDeniedException("Access denied");
        return service.approve(studentId, id, auth, http);
    }
}
