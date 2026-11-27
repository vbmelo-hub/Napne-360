package br.edu.ifac.napne360.academic;

import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class AcademicController {
    private final AcademicService academic;

    @GetMapping("/admin/academic/periods") @PreAuthorize("hasRole('ADMIN')")
    public Page<AcademicService.PeriodView> periods(@RequestParam(defaultValue = "") String query, Pageable page) {
        return academic.periods(query, page);
    }

    @PatchMapping("/admin/academic/periods/{id}/active") @PreAuthorize("hasRole('ADMIN')")
    public AcademicService.PeriodView periodActive(@PathVariable Long id, @Valid @RequestBody StatusRequest request) {
        return academic.setPeriodActive(id, request.active());
    }

    @GetMapping("/admin/academic/offerings") @PreAuthorize("hasRole('ADMIN')")
    public Page<AcademicService.OfferingView> offerings(@RequestParam(defaultValue = "") String query,
                            @RequestParam(defaultValue = "false") boolean onlyActive, AcademicListFilters filters, Pageable page) {
        return academic.offerings(query, onlyActive, filters, page);
    }

    @PostMapping("/admin/academic/offerings") @PreAuthorize("hasRole('ADMIN')")
    public AcademicService.OfferingView createOffering(@Valid @RequestBody OfferingRequest request) {
        return academic.createOffering(request.subjectId(), request.periodId(), request.groupCode());
    }

    @PatchMapping("/admin/academic/offerings/{id}/active") @PreAuthorize("hasRole('ADMIN')")
    public AcademicService.OfferingView offeringActive(@PathVariable Long id, @Valid @RequestBody StatusRequest request) {
        return academic.setOfferingActive(id, request.active());
    }

    @GetMapping("/admin/academic/teaching") @PreAuthorize("hasRole('ADMIN')")
    public Page<AcademicService.TeachingView> teaching(@RequestParam(defaultValue = "") String query, AcademicListFilters filters, Pageable page) {
        return academic.teaching(query, filters, page);
    }

    @PostMapping("/admin/academic/teaching") @PreAuthorize("hasRole('ADMIN')")
    public AcademicService.TeachingView createTeaching(@Valid @RequestBody TeachingRequest request) {
        return academic.createTeaching(request.offeringId(), request.teacherId());
    }

    @PutMapping("/admin/academic/teaching/{id}") @PreAuthorize("hasRole('ADMIN')")
    public AcademicService.TeachingView replaceTeacher(@PathVariable Long id, @Valid @RequestBody ReplacementRequest request) {
        return academic.replaceTeacher(id, request.teacherId(), request.version());
    }

    @PatchMapping("/admin/academic/teaching/{id}/active") @PreAuthorize("hasRole('ADMIN')")
    public AcademicService.TeachingView teachingActive(@PathVariable Long id, @Valid @RequestBody StatusRequest request) {
        return academic.setTeachingActive(id, request.active());
    }

    @GetMapping("/students/{studentId}/academic/enrollment-options") @PreAuthorize("hasRole('NAPNE')")
    public Page<AcademicService.OfferingView> enrollmentOptions(@PathVariable Long studentId, @RequestParam(defaultValue = "") String query, Pageable page) {
        return academic.enrollmentOptions(studentId, query, page);
    }

    @GetMapping("/students/{studentId}/academic/enrollments") @PreAuthorize("hasRole('NAPNE')")
    public Page<AcademicService.EnrollmentView> enrollments(@PathVariable Long studentId, @RequestParam(defaultValue = "") String query, AcademicListFilters filters, Pageable page) {
        return academic.enrollments(studentId, query, filters, page);
    }

    @PostMapping("/students/{studentId}/academic/enrollments") @PreAuthorize("hasRole('NAPNE')")
    public AcademicService.EnrollmentView enroll(@PathVariable Long studentId, @Valid @RequestBody EnrollmentRequest request) {
        return academic.enroll(studentId, request.offeringId());
    }

    @PatchMapping("/students/{studentId}/academic/enrollments/{id}/active") @PreAuthorize("hasRole('NAPNE')")
    public AcademicService.EnrollmentView enrollmentActive(@PathVariable Long studentId, @PathVariable Long id,
                                                             @Valid @RequestBody StatusRequest request) {
        return academic.setEnrollmentActive(studentId, id, request.active());
    }

    @GetMapping("/students/{studentId}/academic/pei-offers")
    @PreAuthorize("hasRole('TEACHER') && @accessGuard.canViewStudent(#studentId)")
    public List<AcademicService.OfferingView> peiOffers(@PathVariable Long studentId) {
        return academic.peiOffers(studentId);
    }

    public record StatusRequest(@NotNull Boolean active) {}
    public record OfferingRequest(@NotNull @Positive Long subjectId, @NotNull @Positive Long periodId,
                                  @NotBlank @Size(max = 60) String groupCode) {}
    public record TeachingRequest(@NotNull @Positive Long offeringId, @NotNull @Positive Long teacherId) {}
    public record ReplacementRequest(@NotNull @Positive Long teacherId, @NotNull @PositiveOrZero Long version) {}
    public record EnrollmentRequest(@NotNull @Positive Long offeringId) {}
}
