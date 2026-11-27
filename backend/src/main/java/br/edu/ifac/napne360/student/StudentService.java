package br.edu.ifac.napne360.student;

import br.edu.ifac.napne360.academic.AcademicRepository;
import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.casework.CaseStage;
import br.edu.ifac.napne360.casework.NapneCaseRepository;
import br.edu.ifac.napne360.pei.PeiSeriesStore;
import br.edu.ifac.napne360.common.ConflictException;
import br.edu.ifac.napne360.common.ApiOperationException;
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
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class StudentService {
    private static final Set<RoleName> CAMPUS_WIDE = Set.of(RoleName.NAPNE);
    private final StudentRepository students;
    private final CourseRepository courses;
    private final CurrentUserService currentUser;
    private final AuditService audit;
    private final AcademicRepository academic;
    private final NapneCaseRepository cases;
    private final PeiSeriesStore peis;

    @Transactional(readOnly = true)
    public Page<StudentSummary> list(String query, String academicQuery, boolean archived, Pageable pageable) {
        UserAccount user = currentUser.require();
        if (user.getRoles().stream().anyMatch(CAMPUS_WIDE::contains)) {
            var campusId = user.getCampus().getId();
            var rows = archived ? students.searchArchivedCampus(campusId, clean(query), pageable)
                    : students.searchCampus(campusId, clean(query), pageable);
            return rows.map(StudentService::summary);
        }
        if (archived) return Page.empty(pageable);
        if (user.getRoles().contains(RoleName.TEACHER) && !clean(academicQuery).isEmpty())
            return students.searchTeachingScope(user.getId(), clean(query), clean(academicQuery), pageable).map(StudentService::summary);
        return students.searchAssigned(user.getId(), clean(query), pageable).map(StudentService::summary);
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
        Course course = courses.findByIdForUpdate(request.courseId()).orElseThrow(() -> new NotFoundException("Curso não encontrado."));
        if (user.getCampus() == null || !user.getCampus().getId().equals(course.getCampus().getId())) {
            throw new IllegalArgumentException("O curso deve pertencer ao campus do usuário.");
        }
        if (!course.isActive()) throw new ConflictException("O curso está arquivado.");
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
    public StudentDetails update(Student snapshot, StudentRequest request, Authentication auth, HttpServletRequest http) {
        Student student = students.findByIdForUpdate(snapshot.getId())
                .orElseThrow(() -> new NotFoundException("Estudante não encontrado."));
        if (student.getVersion() != snapshot.getVersion()) throw new ConflictException("O cadastro foi alterado.");
        Course course = courses.findByIdForUpdate(request.courseId()).orElseThrow(() -> new NotFoundException("Curso não encontrado."));
        if (!student.getCampus().getId().equals(course.getCampus().getId())) throw new IllegalArgumentException("Curso inválido para o campus.");
        if (!course.isActive() && !course.getId().equals(student.getCourse().getId())) {
            throw new ConflictException("O curso está arquivado.");
        }
        if (!course.getId().equals(student.getCourse().getId()) && academic.hasActiveStudentEnrollments(student.getId()))
            throw new ApiOperationException(HttpStatus.CONFLICT, "STUDENT_COURSE_HAS_ENROLLMENTS", "Encerre as matrículas em componentes antes de trocar o curso do estudante.");
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
    public void archive(Student snapshot, Authentication auth, HttpServletRequest http) {
        Student student = students.findByIdForUpdate(snapshot.getId()).orElseThrow(() -> new NotFoundException("Estudante não encontrado."));
        if (student.getStatus() == StudentStatus.ARCHIVED) return;
        if (academic.hasActiveStudentEnrollments(student.getId()))
            throw new ApiOperationException(HttpStatus.CONFLICT, "STUDENT_HAS_ENROLLMENTS", "Encerre primeiro as matrículas ativas em componentes.");
        if (cases.findFirstByStudentIdAndStageNotInOrderByOpenedAtDesc(student.getId(), List.of(CaseStage.CLOSED, CaseStage.ARCHIVED)).isPresent())
            throw new ApiOperationException(HttpStatus.CONFLICT, "STUDENT_HAS_CASES", "Encerre primeiro os casos de acompanhamento ativos.");
        if (peis.hasOpenWorkForStudent(student.getId()))
            throw new ApiOperationException(HttpStatus.CONFLICT, "STUDENT_HAS_PEIS", "Resolva primeiro os PEIs em andamento.");
        student.setStatus(StudentStatus.ARCHIVED);
        student.setArchivedAt(Instant.now());
        audit.record(auth, http, "ARCHIVE", "STUDENT", student.getId(), "SUCCESS", "Cadastro arquivado");
    }

    @Transactional
    public StudentDetails reactivate(Student snapshot, Authentication auth, HttpServletRequest http) {
        Student student = students.findByIdForUpdate(snapshot.getId()).orElseThrow(() -> new NotFoundException("Estudante não encontrado."));
        if (student.getStatus() != StudentStatus.ARCHIVED) return details(student);
        Course course = courses.findByIdForUpdate(student.getCourse().getId()).orElseThrow(() -> new NotFoundException("Curso não encontrado."));
        if (!course.isActive() || !course.getCampus().isActive())
            throw new ApiOperationException(HttpStatus.CONFLICT, "STUDENT_COURSE_INACTIVE", "O curso e o campus devem estar ativos para reativar o estudante.");
        student.setStatus(StudentStatus.ACTIVE);
        student.setArchivedAt(null);
        students.flush();
        audit.record(auth, http, "REACTIVATE", "STUDENT", student.getId(), "SUCCESS", "Cadastro reativado");
        return details(student);
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
