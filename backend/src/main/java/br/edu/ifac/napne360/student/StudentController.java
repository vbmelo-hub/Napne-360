package br.edu.ifac.napne360.student;

import br.edu.ifac.napne360.security.AccessGuard;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/students")
@RequiredArgsConstructor
public class StudentController {
    private final StudentService service;
    private final AccessGuard access;

    @GetMapping
    @PreAuthorize("hasAnyRole('NAPNE','COTEP','COURSE_COORDINATOR','MANAGEMENT','TEACHER','TUTOR')")
    public Page<StudentService.StudentSummary> list(@RequestParam(defaultValue = "") String query, Pageable pageable) {
        return service.list(query, pageable);
    }

    @GetMapping("/{id}")
    public StudentService.StudentDetails get(@PathVariable Long id) { return service.get(access.requireView(id)); }

    @PostMapping
    @PreAuthorize("hasRole('NAPNE')")
    public StudentService.StudentDetails create(@Valid @RequestBody StudentService.StudentRequest request,
                                                Authentication auth, HttpServletRequest http) {
        return service.create(request, auth, http);
    }

    @PutMapping("/{id}")
    @PreAuthorize("@accessGuard.canEditDossier(#id)")
    public StudentService.StudentDetails update(@PathVariable Long id, @Valid @RequestBody StudentService.StudentRequest request,
                                                Authentication auth, HttpServletRequest http) {
        return service.update(access.requireView(id), request, auth, http);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("@accessGuard.canEditDossier(#id)")
    public void archive(@PathVariable Long id, Authentication auth, HttpServletRequest http) {
        service.archive(access.requireView(id), auth, http);
    }
}
