package br.edu.ifac.napne360.admin;

import br.edu.ifac.napne360.common.ConflictException;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.identity.*;
import br.edu.ifac.napne360.student.*;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.List;
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
    private final PasswordEncoder passwordEncoder;
    private final br.edu.ifac.napne360.security.CurrentUserService currentUser;

    @GetMapping("/courses")
    @Transactional(readOnly = true)
    public List<CourseView> allCourses() {
        return courses.findAll().stream().map(c -> new CourseView(c.getId(),c.getName(),c.getCode(),c.getCampus().getId(),c.getCampus().getName())).toList();
    }

    @GetMapping("/subjects")
    @Transactional(readOnly = true)
    public List<SubjectView> allSubjects() {
        return subjects.findAll().stream().map(s -> new SubjectView(s.getId(),s.getName(),s.getCode(),s.getWorkloadHours(),s.getCourse().getId())).toList();
    }

    @GetMapping("/student-registrations")
    @Transactional(readOnly = true)
    public List<RegistrationView> registrations() {
        return students.findAll().stream().map(s -> new RegistrationView(s.getId(),s.getRegistration(),s.getCampus().getId(),s.getCourse().getId())).toList();
    }

    @GetMapping("/assignments")
    @Transactional(readOnly = true)
    public List<AssignmentView> allAssignments() {
        return assignments.findAll().stream().map(a -> new AssignmentView(a.getId(),a.getStudent().getId(),a.getUser().getId(),
                a.getSubject()==null?null:a.getSubject().getId(),a.getAssignmentType(),a.isActive())).toList();
    }

    @PatchMapping("/assignments/{id}/active")
    @Transactional
    public AssignmentView assignmentActive(@PathVariable Long id, @RequestBody ActiveRequest request) {
        var assignment = assignments.findById(id).orElseThrow(() -> new NotFoundException("Vínculo não encontrado."));
        if (request.active()) throw new IllegalArgumentException("Para renovar um vínculo, registre uma nova atribuição validada.");
        assignment.setActive(false);
        assignments.save(assignment);
        return new AssignmentView(assignment.getId(),assignment.getStudent().getId(),assignment.getUser().getId(),
                assignment.getSubject()==null?null:assignment.getSubject().getId(),assignment.getAssignmentType(),false);
    }

    @PutMapping("/users/{id}/roles")
    @Transactional
    public UserView updateRoles(@PathVariable Long id, @Valid @RequestBody RolesRequest request) {
        var user=users.findById(id).orElseThrow(() -> new NotFoundException("Usuário não encontrado."));
        if (user.getId().equals(currentUser.require().getId()) && !request.roles().contains(RoleName.ADMIN))
            throw new IllegalArgumentException("Não remova seu próprio perfil de administrador.");
        if (user.getCampus()==null && request.roles().stream().anyMatch(r -> r != RoleName.ADMIN))
            throw new IllegalArgumentException("O perfil exige campus.");
        user.setRoles(new java.util.HashSet<>(request.roles()));
        user.setSessionVersion(user.getSessionVersion()+1);
        return view(users.save(user));
    }

    @PostMapping("/users/{id}/password")
    @Transactional
    public void resetPassword(@PathVariable Long id, @Valid @RequestBody ResetPasswordRequest request) {
        var user=users.findById(id).orElseThrow(() -> new NotFoundException("Usuário não encontrado."));
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        user.setSessionVersion(user.getSessionVersion()+1);
        users.save(user);
    }

    @GetMapping("/users")
    @Transactional(readOnly = true)
    public List<UserView> users() { return users.findAll().stream().map(this::view).toList(); }

    @PostMapping("/users")
    @Transactional
    public UserView createUser(@Valid @RequestBody UserRequest request) {
        if (users.existsByEmailIgnoreCase(request.email())) throw new ConflictException("E-mail já cadastrado.");
        Campus campus = request.campusId() == null ? null : campuses.findById(request.campusId())
                .orElseThrow(() -> new NotFoundException("Campus não encontrado."));
        if (campus == null && request.roles().stream().anyMatch(r -> r != RoleName.ADMIN))
            throw new IllegalArgumentException("Perfis institucionais exigem campus.");
        UserAccount user = UserAccount.builder().name(request.name().trim()).email(request.email().trim().toLowerCase())
                .passwordHash(passwordEncoder.encode(request.password())).campus(campus).roles(request.roles()).build();
        return view(users.save(user));
    }

    @PatchMapping("/users/{id}/active")
    @Transactional
    public UserView setActive(@PathVariable Long id, @RequestBody ActiveRequest request) {
        if (!request.active() && id.equals(currentUser.require().getId()))
            throw new IllegalArgumentException("Não inative sua própria conta de administrador.");
        UserAccount user = users.findById(id).orElseThrow(() -> new NotFoundException("Usuário não encontrado."));
        user.setActive(request.active());
        user.setSessionVersion(user.getSessionVersion() + 1);
        return view(users.save(user));
    }

    @PostMapping("/campuses")
    public CampusView createCampus(@Valid @RequestBody CampusRequest request) {
        Campus campus = campuses.save(Campus.builder().name(request.name().trim()).code(request.code().trim().toUpperCase()).build());
        return new CampusView(campus.getId(), campus.getName(), campus.getCode(), campus.isActive());
    }

    @PostMapping("/courses")
    public CourseView createCourse(@Valid @RequestBody CourseRequest request) {
        Campus campus = campuses.findById(request.campusId()).orElseThrow(() -> new NotFoundException("Campus não encontrado."));
        Course course = courses.save(Course.builder().campus(campus).name(request.name().trim()).code(request.code().trim().toUpperCase()).build());
        return new CourseView(course.getId(), course.getName(), course.getCode(), campus.getId(), campus.getName());
    }

    @PostMapping("/subjects")
    public SubjectView createSubject(@Valid @RequestBody SubjectRequest request) {
        Course course = courses.findById(request.courseId()).orElseThrow(() -> new NotFoundException("Curso não encontrado."));
        Subject subject = subjects.save(Subject.builder().course(course).name(request.name().trim())
                .code(request.code().trim().toUpperCase()).workloadHours(request.workloadHours()).syllabus(request.syllabus()).build());
        return new SubjectView(subject.getId(), subject.getName(), subject.getCode(), subject.getWorkloadHours(), course.getId());
    }

    @PostMapping("/assignments")
    public AssignmentView createAssignment(@Valid @RequestBody AssignmentRequest request) {
        Student student = students.findById(request.studentId()).orElseThrow(() -> new NotFoundException("Estudante não encontrado."));
        UserAccount user = users.findById(request.userId()).orElseThrow(() -> new NotFoundException("Usuário não encontrado."));
        Subject subject = request.subjectId() == null ? null : subjects.findById(request.subjectId())
                .orElseThrow(() -> new NotFoundException("Componente não encontrado."));
        if (user.getCampus() == null || !user.getCampus().getId().equals(student.getCampus().getId())) {
            throw new IllegalArgumentException("Usuário e estudante devem pertencer ao mesmo campus.");
        }
        if (!user.isActive() || subject != null && !subject.getCourse().getId().equals(student.getCourse().getId()))
            throw new IllegalArgumentException("Vínculo acadêmico inválido.");
        boolean roleMatches = switch (request.assignmentType()) {
            case TEACHER -> subject != null && user.getRoles().contains(RoleName.TEACHER);
            case TUTOR -> user.getRoles().contains(RoleName.TUTOR);
            case COORDINATOR -> user.getRoles().stream().anyMatch(Set.of(RoleName.COTEP, RoleName.COURSE_COORDINATOR, RoleName.MANAGEMENT)::contains);
            case NAPNE -> user.getRoles().contains(RoleName.NAPNE);
        };
        if (!roleMatches) throw new IllegalArgumentException("O tipo de vínculo deve corresponder ao perfil do usuário.");
        StudentAssignment assignment = assignments.save(StudentAssignment.builder().student(student).user(user)
                .subject(subject).assignmentType(request.assignmentType()).build());
        return new AssignmentView(assignment.getId(), student.getId(), user.getId(),
                subject == null ? null : subject.getId(), assignment.getAssignmentType(), assignment.isActive());
    }

    private UserView view(UserAccount user) {
        return new UserView(user.getId(), user.getName(), user.getEmail(), user.isActive(),
                user.getCampus() == null ? null : user.getCampus().getId(), user.getRoles());
    }

    public record UserRequest(@NotBlank String name, @Email @NotBlank String email,
                              @NotBlank @jakarta.validation.constraints.Size(min = 12, max = 72) String password,
                              Long campusId, @NotEmpty Set<RoleName> roles) {}
    public record ActiveRequest(boolean active) {}
    public record RolesRequest(@NotEmpty Set<RoleName> roles) {}
    public record ResetPasswordRequest(@NotBlank @jakarta.validation.constraints.Size(min=12,max=72) String password) {}
    public record RegistrationView(Long id, String registration, Long campusId, Long courseId) {}
    public record CampusRequest(@NotBlank String name, @NotBlank String code) {}
    public record CourseRequest(@NotNull Long campusId, @NotBlank String name, @NotBlank String code) {}
    public record SubjectRequest(@NotNull Long courseId, @NotBlank String name, @NotBlank String code,
                                 @Min(1) int workloadHours, String syllabus) {}
    public record UserView(Long id, String name, String email, boolean active, Long campusId, Set<RoleName> roles) {}
    public record CampusView(Long id, String name, String code, boolean active) {}
    public record CourseView(Long id, String name, String code, Long campusId, String campus) {}
    public record SubjectView(Long id, String name, String code, int workloadHours, Long courseId) {}
    public record AssignmentRequest(@NotNull Long studentId, @NotNull Long userId, Long subjectId,
                                    @NotNull AssignmentType assignmentType) {}
    public record AssignmentView(Long id, Long studentId, Long userId, Long subjectId,
                                 AssignmentType assignmentType, boolean active) {}
}
