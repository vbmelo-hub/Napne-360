package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.security.AccessGuard;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/students/{studentId}/records")
@RequiredArgsConstructor
public class CareRecordController {
    private final CareRecordService service;
    private final AccessGuard access;

    @GetMapping
    public List<CareRecordDocument> list(@PathVariable Long studentId, @RequestParam(required = false) CareRecordType type) {
        access.requireView(studentId);
        return service.list(studentId, type);
    }

    @PostMapping
    @PreAuthorize("@accessGuard.canWritePedagogical(#studentId)")
    public CareRecordDocument create(@PathVariable Long studentId, @Valid @RequestBody CareRecordService.CareRecordRequest request,
                                     Authentication auth, HttpServletRequest http) {
        return service.create(studentId, request, auth, http);
    }

    @PutMapping("/{id}")
    @PreAuthorize("@accessGuard.canWritePedagogical(#studentId)")
    public CareRecordDocument update(@PathVariable Long studentId, @PathVariable String id,
                                     @Valid @RequestBody CareRecordService.CareRecordRequest request,
                                     Authentication auth, HttpServletRequest http) {
        access.requireView(studentId);
        return service.update(studentId, id, request, auth, http);
    }
}
