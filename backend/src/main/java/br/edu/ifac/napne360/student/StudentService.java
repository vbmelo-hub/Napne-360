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
import br.edu.ifac.napne360.identity.ReferenceIdDeserializer;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.security.CurrentUserService;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class StudentService {
    private static final Set<RoleName> CAMPUS_WIDE = Set.of(RoleName.NAPNE);
    private static final ZoneId CAMPUS_TIME = ZoneId.of("America/Rio_Branco");
    private static final List<CaseStage> TERMINAL_CASE_STAGES = List.of(CaseStage.CLOSED, CaseStage.ARCHIVED);
    private final StudentRepository students;
    private final CourseRepository courses;
    private final CurrentUserService currentUser;
    private final AuditService audit;
    private final AcademicRepository academic;
    private final NapneCaseRepository cases;
    private final PeiSeriesStore peis;
    private final StudentAssignmentRepository assignments;
    private final StudentStatusHistoryRepository statusHistory;

    @Transactional(readOnly = true)
    public Page<StudentSummary> list(String query, String academicQuery, boolean archived, Long courseId,
                                    StudentStatus status, StudentStatusReason reason, Pageable pageable) {
        UserAccount user = currentUser.require();
        if (user.getRoles().stream().anyMatch(CAMPUS_WIDE::contains)) {
            Long campusId = user.getCampus().getId();
            var rows = archived || status == StudentStatus.ARCHIVED
                    ? students.searchArchivedCampus(campusId, clean(query), courseId,
                            status == StudentStatus.ARCHIVED ? null : status, reason, pageable)
                    : students.searchCampus(campusId, clean(query), courseId, status, reason, pageable);
            return rows.map(student -> summary(student, true));
        }
        if (archived || status == StudentStatus.ARCHIVED) return Page.empty(pageable);
        if (reason != null) throw new AccessDeniedException("Motivo da situação disponível somente ao NAPNE.");
        var rows = user.getRoles().contains(RoleName.TEACHER) && !clean(academicQuery).isEmpty()
                ? students.searchTeachingScope(user.getId(), clean(query), clean(academicQuery), courseId, status, pageable)
                : students.searchAssigned(user.getId(), clean(query), courseId, status, pageable);
        return rows.map(student -> summary(student, false));
    }

    @Transactional(readOnly = true)
    public List<FilterCourse> filterCourses() {
        var user = currentUser.require();
        var allowed = user.getRoles().stream().anyMatch(CAMPUS_WIDE::contains)
                ? students.campusFilterCourses(user.getCampus().getId()) : students.assignedFilterCourses(user.getId());
        return allowed.stream().map(course -> new FilterCourse(course.getId(), course.getName(), course.getCode()))
                .sorted(java.util.Comparator.comparing(FilterCourse::name).thenComparing(FilterCourse::code)).toList();
    }

    public record FilterCourse(Long id, String name, String code) {}

    @Transactional(readOnly = true)
    public StudentDetails get(Student student) {
        StudentDetails full = details(student);
        if (currentUser.require().getRoles().contains(RoleName.NAPNE)) return full;
        return new StudentDetails(full.id(), full.registration(), null, full.socialName(), full.displayName(),
                null, null, null, full.status(), full.campusId(), full.campus(), full.courseId(), full.course(),
                full.version(), full.academicStatus(), full.archived(), null);
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
        return details(students.saveAndFlush(student));
    }

    @Transactional(readOnly = true)
    public List<StatusRestriction> statusRestrictions(Long studentId) {
        Student student = students.findById(studentId).orElseThrow(() -> new NotFoundException("Estudante não encontrado."));
        requireNapne(student);
        return restrictions(studentId);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public StudentDetails changeStatus(Long studentId, StatusRequest request, HttpServletRequest http) {
        Student student = lockStudent(studentId);
        UserAccount actor = requireNapne(student);
        requireVersion(student, request.version());
        if (student.isAdministrativelyArchived())
            throw statusConflict("STUDENT_STATUS_ARCHIVED", "Desarquive o cadastro antes de alterar a situação acadêmica.");
        var previous = student.getAcademicStatus();
        var next = request.status();
        var reason = request.reason();
        String observations = blankToNull(request.observations());
        if (!allowsTransition(previous, next, reason))
            throw statusInput("STUDENT_STATUS_TRANSITION_INVALID", "Escolha um motivo e uma situação resultante compatíveis.");
        if ((reason == StudentStatusReason.OTHER || reason == StudentStatusReason.ADMINISTRATIVE_CORRECTION)
                && observations == null)
            throw statusInput("STUDENT_STATUS_OBSERVATIONS_REQUIRED", "Informe observações para este motivo.");
        var date = request.effectiveDate();
        if (date.isAfter(today()))
            throw statusInput("STUDENT_STATUS_DATE_INVALID", "A data da ocorrência deve ser igual ou anterior a hoje.");
        if (reason != StudentStatusReason.ADMINISTRATIVE_CORRECTION
                && statusHistory.findFirstByStudentIdAndReasonIsNotNullOrderByIdDesc(studentId)
                        .filter(entry -> date.isBefore(entry.getEffectiveDate())).isPresent())
            throw statusInput("STUDENT_STATUS_DATE_INVALID", "A data da ocorrência é anterior à última alteração. Use Correção cadastral para corrigir o registro.");

        if (previous != next) {
            if (next == StudentStatus.ACTIVE) requireActiveCourse(student);
            else requireNoRestrictions(student);
            student.setStatus(next);
            student.setStatusReason(reason);
        }
        saveStatusEvent(student, actor, StudentStatusHistory.Action.STATUS_CHANGED, previous, next, reason,
                date, observations, http);
        return details(student);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void archive(Student snapshot, HttpServletRequest http) {
        Student student = lockStudent(snapshot.getId());
        UserAccount actor = requireNapne(student);
        if (student.isAdministrativelyArchived()) return;
        requireVersion(student, snapshot.getVersion());
        requireNoRestrictions(student);
        var academicStatus = student.getAcademicStatus();
        student.setArchivedAcademicStatus(academicStatus);
        student.setStatus(StudentStatus.ARCHIVED);
        student.setArchivedAt(Instant.now());
        saveStatusEvent(student, actor, StudentStatusHistory.Action.ARCHIVED, academicStatus, academicStatus,
                null, today(), null, http);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public StudentDetails reactivate(Student snapshot, RestoreRequest request, HttpServletRequest http) {
        Student student = lockStudent(snapshot.getId());
        UserAccount actor = requireNapne(student);
        if (!student.isAdministrativelyArchived()) return details(student);
        requireVersion(student, request != null && request.version() != null ? request.version() : snapshot.getVersion());
        var previous = student.getAcademicStatus();
        var restored = previous;
        StudentStatusReason reason = null;
        String observations = null;
        if (previous == null) {
            if (request == null || request.academicStatus() == null || request.academicStatus() == StudentStatus.ARCHIVED
                    || blankToNull(request.observations()) == null)
                throw statusConflict("STUDENT_ARCHIVE_STATUS_REQUIRED",
                        "O arquivamento antigo não informa a situação acadêmica. Confira a situação atual e informe uma justificativa para desarquivar.");
            restored = request.academicStatus();
            reason = StudentStatusReason.ADMINISTRATIVE_CORRECTION;
            observations = blankToNull(request.observations());
            if (restored != StudentStatus.ACTIVE) requireNoRestrictions(student);
            student.setStatusReason(reason);
        } else if (request != null && request.academicStatus() != null && request.academicStatus() != previous) {
            throw statusInput("STUDENT_ARCHIVE_STATUS_IMMUTABLE",
                    "O desarquivamento mantém a situação acadêmica anterior. Para alterá-la, use Alterar situação.");
        }

        requireActiveCourse(student);
        student.setStatus(restored);
        student.setArchivedAcademicStatus(null);
        student.setArchivedAt(null);
        saveStatusEvent(student, actor, StudentStatusHistory.Action.UNARCHIVED, previous, restored, reason,
                today(), observations, http);
        return details(student);
    }

    private Student lockStudent(Long studentId) {
        return students.findByIdForUpdate(studentId).orElseThrow(() -> new NotFoundException("Estudante não encontrado."));
    }

    private UserAccount requireNapne(Student student) {
        var actor = currentUser.require();
        if (!actor.getRoles().contains(RoleName.NAPNE) || actor.getCampus() == null
                || !actor.getCampus().getId().equals(student.getCampus().getId()))
            throw new AccessDeniedException("Acesso negado.");
        return actor;
    }

    private void requireVersion(Student student, Long version) {
        if (version == null || version != student.getVersion())
            throw statusConflict("STUDENT_STATUS_STALE", "O cadastro foi alterado. Reabra o formulário para consultar a situação atual.");
    }

    private void requireActiveCourse(Student student) {
        Course course = courses.findByIdForUpdate(student.getCourse().getId()).orElseThrow(() -> new NotFoundException("Curso não encontrado."));
        if (!course.isActive() || !course.getCampus().isActive())
            throw statusConflict("STUDENT_COURSE_INACTIVE", "O curso e o campus devem estar ativos para esta operação.");
    }

    private List<StatusRestriction> restrictions(Long studentId) {
        var existing = new ArrayList<StatusRestriction>();
        if (academic.hasActiveStudentEnrollments(studentId))
            existing.add(new StatusRestriction("STUDENT_HAS_ENROLLMENTS", "Encerre as matrículas ativas na aba Matrículas."));
        if (assignments.existsEffectiveForStudent(studentId))
            existing.add(new StatusRestriction("STUDENT_HAS_ASSIGNMENTS", "Solicite à Administração o encerramento dos vínculos profissionais ativos."));
        if (cases.findFirstByStudentIdAndStageNotInOrderByOpenedAtDesc(studentId, TERMINAL_CASE_STAGES).isPresent())
            existing.add(new StatusRestriction("STUDENT_HAS_CASES", "Encerre os casos ativos na aba Estudo de caso."));
        if (peis.hasOpenWorkForStudent(studentId))
            existing.add(new StatusRestriction("STUDENT_HAS_PEIS", "Resolva os PEIs em andamento na aba PEI."));
        return existing;
    }

    private void requireNoRestrictions(Student student) {
        var blocking = restrictions(student.getId());
        if (!blocking.isEmpty()) throw statusConflict(blocking.getFirst().code(), blocking.getFirst().message());
    }

    private void saveStatusEvent(Student student, UserAccount actor, StudentStatusHistory.Action action,
                                 StudentStatus previous, StudentStatus next, StudentStatusReason reason,
                                 LocalDate effectiveDate, String observations, HttpServletRequest http) {
        Instant recordedAt = Instant.now();
        student.setUpdatedAt(recordedAt);
        statusHistory.save(StudentStatusHistory.builder().studentId(student.getId()).action(action)
                .previousStatus(previous).newStatus(next).reason(reason).effectiveDate(effectiveDate)
                .recordedAt(recordedAt).observations(observations).authorId(actor.getId()).authorName(actor.getName()).build());
        students.flush();
        var auditAction = switch (action) {
            case STATUS_CHANGED -> "STATUS_CHANGED";
            case ARCHIVED -> "ARCHIVE";
            case UNARCHIVED -> "REACTIVATE";
        };
        audit.recordStudentStatus(actor, http, student.getId(), auditAction, recordedAt);
    }

    private static boolean allowsTransition(StudentStatus previous, StudentStatus next, StudentStatusReason reason) {
        if (next == null || next == StudentStatus.ARCHIVED || reason == null) return false;
        if (reason == StudentStatusReason.ADMINISTRATIVE_CORRECTION) return true;
        if (previous == next) return false;
        if (next == StudentStatus.ACTIVE) return reason == StudentStatusReason.ACADEMIC_RESUMPTION;
        if (previous != StudentStatus.ACTIVE) return false;
        return switch (reason) {
            case DROPOUT, LEAVE_OF_ABSENCE, DISMISSAL -> next == StudentStatus.INACTIVE;
            case COURSE_COMPLETION -> next == StudentStatus.COMPLETED;
            case TRANSFER -> next == StudentStatus.TRANSFERRED;
            case OTHER -> true;
            default -> false;
        };
    }

    private static LocalDate today() { return LocalDate.now(CAMPUS_TIME); }

    private static ApiOperationException statusConflict(String code, String detail) {
        return new ApiOperationException(HttpStatus.CONFLICT, code, detail);
    }

    private static ApiOperationException statusInput(String code, String detail) {
        return new ApiOperationException(HttpStatus.BAD_REQUEST, code, detail);
    }

    private static StudentSummary summary(Student student, boolean includeReason) {
        return new StudentSummary(student.getId(), student.getRegistration(), student.getDisplayName(),
                student.getCourse().getName(), student.getCampus().getName(), student.getStatus().name(),
                student.isAdministrativelyArchived() ? student.getAcademicStatus() : null,
                student.isAdministrativelyArchived() ? true : null, includeReason ? student.getStatusReason() : null);
    }
    private static StudentDetails details(Student student) {
        return new StudentDetails(student.getId(), student.getRegistration(), student.getCivilName(), student.getSocialName(),
                student.getDisplayName(), student.getBirthDate(), student.getInstitutionalEmail(), student.getPhone(),
                student.getStatus().name(), student.getCampus().getId(), student.getCampus().getName(),
                student.getCourse().getId(), student.getCourse().getName(), student.getVersion(),
                student.getAcademicStatus(), student.isAdministrativelyArchived(), student.getStatusReason());
    }
    private String clean(String value) { return value == null ? "" : value.trim(); }
    private String blankToNull(String value) { return value == null || value.isBlank() ? null : value.trim(); }

    public record StudentRequest(@NotNull Long courseId, @NotBlank String registration, @NotBlank String civilName,
                                 String socialName, LocalDate birthDate, @Email String institutionalEmail, String phone) {}
    public record StatusRequest(@NotNull StudentStatus status, @NotNull StudentStatusReason reason,
                                @NotNull LocalDate effectiveDate, @Size(max = 1000) String observations,
                                @NotNull @PositiveOrZero @JsonDeserialize(using = ReferenceIdDeserializer.class) Long version) {}
    public record RestoreRequest(StudentStatus academicStatus, @Size(max = 1000) String observations,
                                 @PositiveOrZero @JsonDeserialize(using = ReferenceIdDeserializer.class) Long version) {}
    public record StatusRestriction(String code, String message) {}
    public record StudentSummary(Long id, String registration, String displayName, String course, String campus, String status,
                                 @JsonInclude(JsonInclude.Include.NON_NULL) StudentStatus academicStatus,
                                 @JsonInclude(JsonInclude.Include.NON_NULL) Boolean archived,
                                 @JsonInclude(JsonInclude.Include.NON_NULL) StudentStatusReason statusReason) {}
    public record StudentDetails(Long id, String registration, String civilName, String socialName, String displayName,
                                 LocalDate birthDate, String institutionalEmail, String phone, String status,
                                 Long campusId, String campus, Long courseId, String course, long version,
                                 StudentStatus academicStatus, boolean archived, StudentStatusReason statusReason) {}
}
