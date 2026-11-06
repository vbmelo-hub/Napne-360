package br.edu.ifac.napne360.student;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.common.ConflictException;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.identity.Course;
import br.edu.ifac.napne360.identity.CourseRepository;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.security.CurrentUserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class StudentService {
    private static final Set<RoleName> CAMPUS_WIDE = Set.of(RoleName.NAPNE);
    private final StudentRepository students;
    private final CourseRepository courses;
    private final CurrentUserService currentUser;
    private final AuditService audit;

    @Transactional(readOnly = true)
    public Page<StudentSummary> list(String query, Pageable pageable) {
        UserAccount user = currentUser.require();
        Page<Student> page = user.getRoles().stream().anyMatch(CAMPUS_WIDE::contains)
                ? students.searchCampus(user.getCampus().getId(), clean(query), pageable)
                : students.searchAssigned(user.getId(), clean(query), pageable);
        return page.map(StudentService::summary);
    }

    @Transactional(readOnly = true)
    public StudentDetails get(Student student) {
        StudentDetails full = details(student);
        if (currentUser.require().getRoles().contains(RoleName.NAPNE)) return full;
        return new StudentDetails(full.id(), full.registration(), null, full.socialName(), full.displayName(),
                null, null, null, full.status(), full.campusId(), full.campus(), full.courseId(), full.course(), full.version());
    }

    @Transactional
    public StudentDetails create(StudentRequest request, Authentication auth, HttpServletRequest http) {
        UserAccount user = currentUser.require();
        Course course = courses.findById(request.courseId()).orElseThrow(() -> new NotFoundException("Curso não encontrado."));
        if (user.getCampus() == null || !user.getCampus().getId().equals(course.getCampus().getId())) {
            throw new IllegalArgumentException("O curso deve pertencer ao campus do usuário.");
        }
        if (students.existsByRegistration(request.registration())) throw new ConflictException("Matrícula já cadastrada.");
        Student student = Student.builder()
                .campus(user.getCampus()).course(course).registration(request.registration().trim())
                .civilName(request.civilName().trim()).socialName(blankToNull(request.socialName()))
                .birthDate(request.birthDate()).institutionalEmail(blankToNull(request.institutionalEmail()))
                .phone(blankToNull(request.phone())).status(StudentStatus.ACTIVE).build();
        student = students.save(student);
        audit.record(auth, http, "CREATE", "STUDENT", student.getId(), "SUCCESS", "Cadastro criado");
        return details(student);
    }

    @Transactional
    public StudentDetails update(Student student, StudentRequest request, Authentication auth, HttpServletRequest http) {
        Course course = courses.findById(request.courseId()).orElseThrow(() -> new NotFoundException("Curso não encontrado."));
        if (!student.getCampus().getId().equals(course.getCampus().getId())) throw new IllegalArgumentException("Curso inválido para o campus.");
        student.setCourse(course);
        student.setCivilName(request.civilName().trim());
        student.setSocialName(blankToNull(request.socialName()));
        student.setBirthDate(request.birthDate());
        student.setInstitutionalEmail(blankToNull(request.institutionalEmail()));
        student.setPhone(blankToNull(request.phone()));
        audit.record(auth, http, "UPDATE", "STUDENT", student.getId(), "SUCCESS", "Cadastro atualizado");
        return details(students.save(student));
    }

    @Transactional
    public void archive(Student student, Authentication auth, HttpServletRequest http) {
        student.setStatus(StudentStatus.ARCHIVED);
        student.setArchivedAt(Instant.now());
        students.save(student);
        audit.record(auth, http, "ARCHIVE", "STUDENT", student.getId(), "SUCCESS", "Cadastro arquivado");
    }

    private static StudentSummary summary(Student student) {
        return new StudentSummary(student.getId(), student.getRegistration(), student.getDisplayName(),
                student.getCourse().getName(), student.getCampus().getName(), student.getStatus().name());
    }
    private static StudentDetails details(Student student) {
        return new StudentDetails(student.getId(), student.getRegistration(), student.getCivilName(), student.getSocialName(),
                student.getDisplayName(), student.getBirthDate(), student.getInstitutionalEmail(), student.getPhone(),
                student.getStatus().name(), student.getCampus().getId(), student.getCampus().getName(),
                student.getCourse().getId(), student.getCourse().getName(), student.getVersion());
    }
    private String clean(String value) { return value == null ? "" : value.trim(); }
    private String blankToNull(String value) { return value == null || value.isBlank() ? null : value.trim(); }

    public record StudentRequest(@NotNull Long courseId, @NotBlank String registration, @NotBlank String civilName,
                                 String socialName, LocalDate birthDate, @Email String institutionalEmail, String phone) {}
    public record StudentSummary(Long id, String registration, String displayName, String course, String campus, String status) {}
    public record StudentDetails(Long id, String registration, String civilName, String socialName, String displayName,
                                 LocalDate birthDate, String institutionalEmail, String phone, String status,
                                 Long campusId, String campus, Long courseId, String course, long version) {}
}
