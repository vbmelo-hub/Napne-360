package br.edu.ifac.napne360.student;

import br.edu.ifac.napne360.academic.AcademicRepository;
import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.casework.CaseStage;
import br.edu.ifac.napne360.casework.NapneCase;
import br.edu.ifac.napne360.casework.NapneCaseRepository;
import br.edu.ifac.napne360.common.ApiOperationException;
import br.edu.ifac.napne360.identity.Campus;
import br.edu.ifac.napne360.identity.Course;
import br.edu.ifac.napne360.identity.CourseRepository;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.pei.PeiSeriesStore;
import br.edu.ifac.napne360.security.CurrentUserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.security.access.AccessDeniedException;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class StudentStatusServiceTest {
    private final StudentRepository students = mock(StudentRepository.class);
    private final CourseRepository courses = mock(CourseRepository.class);
    private final CurrentUserService currentUser = mock(CurrentUserService.class);
    private final AuditService audit = mock(AuditService.class);
    private final AcademicRepository academic = mock(AcademicRepository.class);
    private final NapneCaseRepository cases = mock(NapneCaseRepository.class);
    private final PeiSeriesStore peis = mock(PeiSeriesStore.class);
    private final StudentAssignmentRepository assignments = mock(StudentAssignmentRepository.class);
    private final StudentStatusHistoryRepository history = mock(StudentStatusHistoryRepository.class);
    private final Campus campus = Campus.builder().id(1L).build();
    private final Course course = Course.builder().id(2L).campus(campus).build();
    private final Student student = Student.builder().id(3L).campus(campus).course(course).version(4L).build();
    private final LocalDate effectiveDate = LocalDate.of(2026, 1, 2);
    private final StudentService service = new StudentService(students, courses, currentUser, audit,
            academic, cases, peis, assignments, history);

    @BeforeEach
    void setUp() {
        when(students.findByIdForUpdate(3L)).thenReturn(Optional.of(student));
        when(courses.findByIdForUpdate(2L)).thenReturn(Optional.of(course));
        when(currentUser.require()).thenReturn(UserAccount.builder().id(8L).name("Autora NAPNE")
                .roles(Set.of(RoleName.NAPNE)).campus(campus).build());
    }

    @Test
    void recordsAnAttributedAcademicChangeAndKeepsItThroughArchiving() {
        var changed = service.changeStatus(3L,
                request(StudentStatus.COMPLETED, StudentStatusReason.COURSE_COMPLETION, effectiveDate, "  Certificado recebido.  "), null);
        assertThat(changed.academicStatus()).isEqualTo(StudentStatus.COMPLETED);
        assertThat(changed.statusReason()).isEqualTo(StudentStatusReason.COURSE_COMPLETION);
        assertThat(changed.archived()).isFalse();
        var auditEntry = org.mockito.ArgumentCaptor.forClass(StudentStatusHistory.class);
        verify(history).save(auditEntry.capture());
        assertThat(auditEntry.getValue()).satisfies(entry -> {
            assertThat(entry.getPreviousStatus()).isEqualTo(StudentStatus.ACTIVE);
            assertThat(entry.getNewStatus()).isEqualTo(StudentStatus.COMPLETED);
            assertThat(entry.getEffectiveDate()).isEqualTo(effectiveDate);
            assertThat(entry.getRecordedAt()).isNotNull();
            assertThat(entry.getAuthorId()).isEqualTo(8L);
            assertThat(entry.getAuthorName()).isEqualTo("Autora NAPNE");
            assertThat(entry.getObservations()).isEqualTo("Certificado recebido.");
        });

        service.archive(student, null);
        assertThat(student.isAdministrativelyArchived()).isTrue();
        assertThat(student.getAcademicStatus()).isEqualTo(StudentStatus.COMPLETED);
        var restored = service.reactivate(student, null, null);
        assertThat(restored.academicStatus()).isEqualTo(StudentStatus.COMPLETED);
        assertThat(restored.statusReason()).isEqualTo(StudentStatusReason.COURSE_COMPLETION);
        assertThat(restored.archived()).isFalse();
        assertThat(student.acceptsNewOperations()).isFalse();
        verify(history, times(3)).save(any());
    }

    @Test
    void requiresAnExplicitAcademicReactivationAndAnExplanationForOther() {
        assertProblem("STUDENT_STATUS_OBSERVATIONS_REQUIRED", () -> service.changeStatus(3L,
                request(StudentStatus.INACTIVE, StudentStatusReason.OTHER, effectiveDate, " "), null));
        assertProblem("STUDENT_STATUS_TRANSITION_INVALID", () -> service.changeStatus(3L,
                request(StudentStatus.TRANSFERRED, StudentStatusReason.DROPOUT, effectiveDate, null), null));
        assertProblem("STUDENT_STATUS_DATE_INVALID", () -> service.changeStatus(3L,
                request(StudentStatus.INACTIVE, StudentStatusReason.DROPOUT, LocalDate.now().plusDays(3), null), null));
        verify(history, never()).save(any());

        student.setStatus(StudentStatus.INACTIVE);
        assertProblem("STUDENT_STATUS_TRANSITION_INVALID", () -> service.changeStatus(3L,
                request(StudentStatus.ACTIVE, StudentStatusReason.OTHER, effectiveDate, "Retorno"), null));
        assertThat(service.changeStatus(3L,
                request(StudentStatus.ACTIVE, StudentStatusReason.ACADEMIC_RESUMPTION, effectiveDate, null), null)
                .academicStatus()).isEqualTo(StudentStatus.ACTIVE);
    }

    @Test
    void keepsTheAcademicSituationUnknownForARecordArchivedBeforeTheNewFlow() {
        student.setStatus(StudentStatus.ARCHIVED);
        assertThat(student.getAcademicStatus()).isNull();
        assertProblem("STUDENT_ARCHIVE_STATUS_REQUIRED", () -> service.reactivate(student, null, null));
        assertProblem("STUDENT_STATUS_ARCHIVED", () -> service.changeStatus(3L,
                request(StudentStatus.COMPLETED, StudentStatusReason.COURSE_COMPLETION, effectiveDate, null), null));
        var restored = service.reactivate(student,
                new StudentService.RestoreRequest(StudentStatus.COMPLETED, "Conclusão conferida no registro acadêmico.", 4L), null);
        assertThat(restored.academicStatus()).isEqualTo(StudentStatus.COMPLETED);
        assertThat(restored.archived()).isFalse();
    }

    @Test
    void addsAnAdministrativeCorrectionWithoutRestartingTheStudent() {
        student.setStatus(StudentStatus.INACTIVE);
        student.setStatusReason(StudentStatusReason.LEAVE_OF_ABSENCE);
        var changed = service.changeStatus(3L, request(StudentStatus.INACTIVE,
                StudentStatusReason.ADMINISTRATIVE_CORRECTION, effectiveDate, "Data corrigida."), null);
        assertThat(changed.academicStatus()).isEqualTo(StudentStatus.INACTIVE);
        assertThat(changed.statusReason()).isEqualTo(StudentStatusReason.LEAVE_OF_ABSENCE);
        verify(history).save(argThat(entry -> entry.getReason() == StudentStatusReason.ADMINISTRATIVE_CORRECTION));
        verifyNoInteractions(assignments, academic, cases, peis);
    }

    @ParameterizedTest
    @ValueSource(strings = {"STUDENT_HAS_ENROLLMENTS", "STUDENT_HAS_ASSIGNMENTS", "STUDENT_HAS_CASES", "STUDENT_HAS_PEIS"})
    void dependenciesBlockEndOfOperationsAndArchivingWithoutMutation(String problem) {
        switch (problem) {
            case "STUDENT_HAS_ENROLLMENTS" -> when(academic.hasActiveStudentEnrollments(3L)).thenReturn(true);
            case "STUDENT_HAS_ASSIGNMENTS" -> when(assignments.existsEffectiveForStudent(3L)).thenReturn(true);
            case "STUDENT_HAS_CASES" -> when(cases.findFirstByStudentIdAndStageNotInOrderByOpenedAtDesc(
                    3L, List.of(CaseStage.CLOSED, CaseStage.ARCHIVED))).thenReturn(Optional.of(new NapneCase()));
            case "STUDENT_HAS_PEIS" -> when(peis.hasOpenWorkForStudent(3L)).thenReturn(true);
        }
        assertProblem(problem, () -> service.changeStatus(3L,
                request(StudentStatus.INACTIVE, StudentStatusReason.DROPOUT, effectiveDate, null), null));
        assertProblem(problem, () -> service.archive(student, null));
        assertThat(student.getStatus()).isEqualTo(StudentStatus.ACTIVE);
        verify(history, never()).save(any());
    }

    @Test
    void rejectsOutOfCampusAndStaleRequests() {
        assertProblem("STUDENT_STATUS_STALE", () -> service.changeStatus(3L, new StudentService.StatusRequest(
                StudentStatus.INACTIVE, StudentStatusReason.DROPOUT, effectiveDate, null, 2L), null));
        when(currentUser.require()).thenReturn(UserAccount.builder().roles(Set.of(RoleName.NAPNE))
                .campus(Campus.builder().id(9L).build()).build());
        assertThatThrownBy(() -> service.changeStatus(3L,
                request(StudentStatus.INACTIVE, StudentStatusReason.DROPOUT, effectiveDate, null), null))
                .isInstanceOf(AccessDeniedException.class);
        verify(history, never()).save(any());
    }

    private StudentService.StatusRequest request(StudentStatus status, StudentStatusReason reason, LocalDate date,
                                                 String observations) {
        return new StudentService.StatusRequest(status, reason, date, observations, 4L);
    }

    private static void assertProblem(String code, Runnable action) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(ApiOperationException.class,
                problem -> assertThat(problem.code()).isEqualTo(code));
    }
}
