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
    public Page<StudentService.StudentSummary> list(@RequestParam(defaultValue = "") String query,
                                                    @RequestParam(defaultValue = "") String academicQuery,
                                                    @RequestParam(defaultValue = "false") boolean archived,
                                                    @RequestParam(required = false) Long courseId,
                                                    @RequestParam(required = false) StudentStatus status,
                                                    @RequestParam(required = false) StudentStatusReason reason, Pageable pageable) {
        return service.list(query, academicQuery, archived, courseId, status, reason, pageable);
    }

    @GetMapping("/filter-courses")
    @PreAuthorize("hasAnyRole('NAPNE','COTEP','COURSE_COORDINATOR','MANAGEMENT','TEACHER','TUTOR')")
    public java.util.List<StudentService.FilterCourse> filterCourses() {
        return service.filterCourses();
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

    @GetMapping("/{id}/status/restrictions")
    @PreAuthorize("@accessGuard.canEditDossier(#id)")
    public java.util.List<StudentService.StatusRestriction> statusRestrictions(@PathVariable Long id) {
        return service.statusRestrictions(id);
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize("@accessGuard.canEditDossier(#id)")
    public StudentService.StudentDetails changeStatus(@PathVariable Long id,
                                                      @Valid @RequestBody StudentService.StatusRequest request,
                                                      HttpServletRequest http) {
        return service.changeStatus(id, request, http);
    }

    @PatchMapping("/{id}/reactivate")
    @PreAuthorize("@accessGuard.canEditDossier(#id)")
    public StudentService.StudentDetails reactivate(@PathVariable Long id,
                                                    @Valid @RequestBody(required = false) StudentService.RestoreRequest request,
                                                    HttpServletRequest http) {
        return service.reactivate(access.requireView(id), request, http);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("@accessGuard.canEditDossier(#id)")
    public void archive(@PathVariable Long id, HttpServletRequest http) {
        service.archive(access.requireView(id), http);
    }
}
