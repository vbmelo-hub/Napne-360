package br.edu.ifac.napne360.admin;

import br.edu.ifac.napne360.academic.AcademicRepository;
import br.edu.ifac.napne360.common.ConflictException;
import br.edu.ifac.napne360.common.ApiOperationException;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.identity.*;
import br.edu.ifac.napne360.student.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Locale;
import java.util.Set;

@RestController
@RequestMapping("/api/v1/admin")
@PreAuthorize("hasRole('ADMIN')")
@RequiredArgsConstructor
public class AdminController {
    private final CampusRepository campuses;
    private final CourseRepository courses;
    private final SubjectRepository subjects;
    private final UserAccountRepository users;
    private final StudentRepository students;
    private final StudentAssignmentRepository assignments;
    private final CourseSubjectReferences subjectReferences;
    private final AcademicRepository academic;

    @GetMapping("/courses")
    @Transactional(readOnly = true)
    public List<CourseView> allCourses() {
        return courses.findAll().stream().map(CourseView::of).toList();
    }

    @GetMapping("/subjects")
    @Transactional(readOnly = true)
    public List<SubjectView> allSubjects() {
        return subjects.findAll().stream().map(SubjectView::of).toList();
    }

    @GetMapping("/student-registrations")
    @Transactional(readOnly = true)
    public List<RegistrationView> registrations() {
        return students.findAll().stream().map(s -> new RegistrationView(s.getId(),s.getRegistration(),s.getCampus().getId(),s.getCourse().getId(),s.getStatus())).toList();
    }

    @GetMapping("/assignments")
    @Transactional(readOnly = true)
    public List<AssignmentView> allAssignments() {
        var effectiveIds = assignments.effectiveAssignmentIds();
        return assignments.findAllByOrderByIdDesc().stream()
                .map(a -> AssignmentView.of(a, effectiveIds.contains(a.getId()))).toList();
    }

    @PatchMapping("/assignments/{id}/active")
    @Transactional
    public AssignmentView assignmentActive(@PathVariable Long id, @RequestBody ActiveRequest request) {
        var assignment = assignments.findByIdForUpdate(id).orElseThrow(() -> new NotFoundException("Vínculo não encontrado."));
        if (request.active()) throw new IllegalArgumentException("Para renovar um vínculo, registre uma nova atribuição validada.");
        if (assignment.getOrigin() == AssignmentOrigin.AUTOMATIC)
            throw new ApiOperationException(HttpStatus.CONFLICT, "ACADEMIC_LINK_IS_AUTOMATIC", "Encerre a atribuição docente ou matrícula que sustenta este vínculo automático.");
        if (assignment.isActive() && assignment.getAssignmentType() == AssignmentType.TEACHER)
            assignment.setSecurityBlock(true);
        assignment.setActive(false);
        return AssignmentView.of(assignment, false);
    }

    @PatchMapping("/assignments/{id}/regularize")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public AssignmentView regularizeAcademicAssignment(@PathVariable Long id) {
        var assignment = assignments.findByIdForUpdate(id).orElseThrow(() -> new NotFoundException("Vínculo não encontrado."));
        if (assignment.getOrigin() != AssignmentOrigin.MANUAL || assignment.getAssignmentType() != AssignmentType.TEACHER
                || !assignment.isActive() || assignment.getSubject() == null)
            throw new ApiOperationException(HttpStatus.CONFLICT, "ACADEMIC_LINK_NOT_LEGACY_TEACHER", "Selecione um vínculo docente manual ativo com componente.");
        if (!assignments.existsEquivalentAutomatic(assignment.getStudent().getId(), assignment.getUser().getId(), assignment.getSubject().getId()))
            throw new ApiOperationException(HttpStatus.CONFLICT, "ACADEMIC_LINK_NO_AUTOMATIC_EQUIVALENT", "Registre uma matrícula e uma atribuição docente ativas para este componente antes de regularizar o vínculo.");
        assignment.setActive(false);
        return AssignmentView.of(assignment, false);
    }

    @PostMapping("/courses")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public CourseView createCourse(@Valid @RequestBody CourseRequest request) {
        Course course = Course.builder().campus(requireActiveCampus(request.campusId()))
                .name(request.name()).code(request.code()).build();
        return saveCourse(course);
    }

    @PutMapping("/courses/{id}")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public CourseView updateCourse(@PathVariable Long id, @Valid @RequestBody CourseRequest request) {
        Campus campus = campuses.findByIdForUpdate(request.campusId())
                .orElseThrow(() -> new NotFoundException("Campus não encontrado."));
        Course course = lockCourse(id);
        if (!campus.isActive() && (course.isActive() || !course.getCampus().getId().equals(campus.getId()))) {
            throw new CourseConflictException("O campus do curso está arquivado.");
        }
        if (!course.getCampus().getId().equals(campus.getId())
                && (students.existsByCourseId(id) || assignments.existsBySubjectCourseId(id)
                || academic.hasCourseOfferings(id, false) || subjectReferences.hasHistory(subjects.findByCourseIdForUpdate(id)))) {
            throw new CourseConflictException("O campus deste curso não pode ser alterado porque há estudantes ou registros vinculados.");
        }
        course.setCampus(campus);
        course.setName(request.name());
        course.setCode(request.code());
        return saveCourse(course);
    }

    @PatchMapping("/courses/{id}/archive")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public CourseView archiveCourse(@PathVariable Long id) {
        Course course = lockCourse(id);
        if (students.existsByCourseIdAndStatus(id, StudentStatus.ACTIVE)) {
            throw new CourseConflictException("O curso possui estudantes ativos vinculados.");
        }
        if (assignments.existsByStudentCourseIdAndActiveTrue(id) || assignments.existsBySubjectCourseIdAndActiveTrue(id)) {
            throw new CourseConflictException("O curso ou seus componentes possuem vínculos ativos.");
        }
        if (academic.hasCourseOfferings(id, true))
            throw new CourseConflictException("Arquive primeiro as ofertas curriculares ativas dos componentes do curso.");
        var components = subjects.findByCourseIdForUpdate(id);
        if (subjectReferences.hasOpenWork(components)) {
            throw new CourseConflictException("Os componentes possuem acompanhamentos em andamento ou PEIs vigentes.");
        }
        components.forEach(subject -> subject.setActive(false));
        course.setActive(false);
        return CourseView.of(course);
    }

    @PostMapping("/subjects")
    @Transactional
    public SubjectView createSubject(@Valid @RequestBody SubjectRequest request) {
        Course course = lockActiveCourse(request.courseId());
        Subject subject = subjects.save(Subject.builder().course(course).name(request.name().trim())
                .code(request.code().trim().toUpperCase()).workloadHours(request.workloadHours()).syllabus(request.syllabus()).build());
        return SubjectView.of(subject);
    }

    @PostMapping("/assignments")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public AssignmentView createAssignment(@Valid @RequestBody AssignmentRequest request) {
        if (request.assignmentType() == AssignmentType.TEACHER)
            throw new ApiOperationException(HttpStatus.CONFLICT, "ACADEMIC_LINK_TEACHER_REQUIRES_OFFER", "Registre a atribuição docente e a matrícula na mesma oferta para gerar um vínculo de professor.");
        Student student = students.findByIdForUpdate(request.studentId())
                .orElseThrow(() -> new NotFoundException("Estudante não encontrado."));
        if (student.getStatus() == StudentStatus.ARCHIVED) throw new ApiOperationException(HttpStatus.CONFLICT, "ACADEMIC_LINK_STUDENT_ARCHIVED", "O estudante está arquivado.");
        Course course = lockActiveCourse(student.getCourse().getId());
        UserAccount user = users.findByIdForUpdate(request.userId()).orElseThrow(() -> new NotFoundException("Usuário não encontrado."));
        Subject subject = request.subjectId() == null ? null : subjects.findById(request.subjectId())
                .orElseThrow(() -> new NotFoundException("Componente não encontrado."));
        if (subject != null && !subject.isActive()) {
            throw new CourseConflictException("O componente está arquivado.");
        }
        if (user.getCampus() == null || !user.getCampus().getId().equals(student.getCampus().getId())) {
            throw new IllegalArgumentException("Usuário e estudante devem pertencer ao mesmo campus.");
        }
        if (!user.isActive() || subject != null && !subject.getCourse().getId().equals(course.getId()))
            throw new IllegalArgumentException("Vínculo acadêmico inválido.");
        boolean roleMatches = switch (request.assignmentType()) {
            case TEACHER -> false;
            case TUTOR -> user.getRoles().contains(RoleName.TUTOR);
            case COORDINATOR -> user.getRoles().stream().anyMatch(Set.of(RoleName.COTEP, RoleName.COURSE_COORDINATOR, RoleName.MANAGEMENT)::contains);
            case NAPNE -> user.getRoles().contains(RoleName.NAPNE);
        };
        if (!roleMatches) throw new IllegalArgumentException("O tipo de vínculo deve corresponder ao perfil do usuário.");
        if (assignments.existsManualAssignment(student.getId(), user.getId(), request.subjectId(), request.assignmentType()))
            throw new ApiOperationException(HttpStatus.CONFLICT, "ACADEMIC_LINK_DUPLICATE", "Já existe um vínculo ativo deste tipo entre o estudante e o usuário.");
        StudentAssignment assignment = assignments.save(StudentAssignment.builder().student(student).user(user)
                .subject(subject).assignmentType(request.assignmentType()).build());
        return AssignmentView.of(assignment, true);
    }

    private Campus requireActiveCampus(Long id) {
        Campus campus = campuses.findByIdForUpdate(id)
                .orElseThrow(() -> new NotFoundException("Campus não encontrado."));
        if (!campus.isActive()) throw new CourseConflictException("O campus do curso está arquivado.");
        return campus;
    }

    private Course lockCourse(Long id) {
        return courses.findByIdForUpdate(id).orElseThrow(() -> new NotFoundException("Curso não encontrado."));
    }

    private Course lockActiveCourse(Long id) {
        Course course = lockCourse(id);
        if (!course.isActive()) throw new CourseConflictException("O curso está arquivado.");
        return course;
    }

    private CourseView saveCourse(Course course) {
        try {
            return CourseView.of(courses.saveAndFlush(course));
        } catch (DataIntegrityViolationException exception) {
            throw new CourseConflictException("Já existe um curso com esse código neste campus.");
        }
    }

    @ExceptionHandler(CourseConflictException.class)
    public ProblemDetail courseConflict(CourseConflictException exception) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, exception.getMessage());
        problem.setTitle("Conflito de dados");
        return problem;
    }

    private static class CourseConflictException extends ConflictException {
        CourseConflictException(String message) { super(message); }
    }

    public record ActiveRequest(boolean active) {}
    public record RegistrationView(Long id, String registration, Long campusId, Long courseId, StudentStatus status) {}
    public record CourseRequest(@NotNull Long campusId, @NotBlank @Size(max = 180) String name,
                                @NotBlank @Size(max = 60) String code) {
        public CourseRequest {
            name = name == null ? null : name.trim();
            code = code == null ? null : code.trim().toUpperCase(Locale.ROOT);
        }
    }
    public record SubjectRequest(@NotNull Long courseId, @NotBlank String name, @NotBlank String code,
                                 @Min(1) int workloadHours, String syllabus) {}
    public record CourseView(Long id, String name, String code, Long campusId, String campus, boolean active) {
        static CourseView of(Course course) {
            return new CourseView(course.getId(), course.getName(), course.getCode(),
                    course.getCampus().getId(), course.getCampus().getName(), course.isActive());
        }
    }

    public record SubjectView(Long id, String name, String code, int workloadHours, Long courseId, boolean active) {
        static SubjectView of(Subject subject) {
            return new SubjectView(subject.getId(), subject.getName(), subject.getCode(),
                    subject.getWorkloadHours(), subject.getCourse().getId(), subject.isActive());
        }
    }
    public record AssignmentRequest(@NotNull Long studentId, @NotNull Long userId, Long subjectId,
                                    @NotNull AssignmentType assignmentType) {}
    public record AssignmentView(Long id, Long studentId, String studentName, String registration,
                                 Long userId, String userName, Long subjectId, String subjectName,
                                 AssignmentType assignmentType, AssignmentOrigin origin, String periodCode, boolean active) {
        static AssignmentView of(StudentAssignment link, boolean active) {
            return new AssignmentView(link.getId(), link.getStudent().getId(), link.getStudent().getDisplayName(),
                    link.getStudent().getRegistration(), link.getUser().getId(), link.getUser().getName(),
                    link.getSubject() == null ? null : link.getSubject().getId(),
                    link.getSubject() == null ? null : link.getSubject().getName(), link.getAssignmentType(),
                    link.getOrigin(), link.getPeriod() == null ? null : link.getPeriod().getCode(), active);
        }
    }
}
