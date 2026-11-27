package br.edu.ifac.napne360.academic;

import br.edu.ifac.napne360.common.ApiOperationException;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.identity.*;
import br.edu.ifac.napne360.pei.PeiSeriesStore;
import br.edu.ifac.napne360.security.CurrentUserService;
import br.edu.ifac.napne360.student.*;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class AcademicService {
    private final AcademicRepository academic;
    private final CurrentUserService currentUser;
    private final CampusRepository campuses;
    private final CourseRepository courses;
    private final SubjectRepository subjects;
    private final UserAccountRepository users;
    private final StudentRepository students;
    private final StudentAssignmentRepository assignments;
    private final PeiSeriesStore peis;

    Page<PeriodView> periods(String query, Pageable page) {
        return academic.periods(query, page).map(PeriodView::of);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public PeriodView setPeriodActive(Long id, boolean active) {
        var period = academic.lockPeriod(id);
        if (period.isActive() == active) return PeriodView.of(period);
        if (!active && academic.hasActiveOfferings(id))
            throw conflict("PERIOD_HAS_OFFERINGS", "Arquive primeiro as ofertas curriculares ativas deste período.");
        period.setActive(active);
        academic.audit(currentUser.require(), active ? "REACTIVATE" : "ARCHIVE", "ACADEMIC_PERIOD", id, null);
        return PeriodView.of(period);
    }

    Page<OfferingView> offerings(String query, boolean onlyActive, AcademicListFilters filters, Pageable page) {
        return academic.offerings(query, onlyActive, null, filters, page).map(OfferingView::of);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public OfferingView createOffering(Long subjectId, Long periodId, String groupCode) {
        var period = academic.lockPeriod(periodId);
        var subject = lockSubjectHierarchy(subjectId);
        requireActive(subject, period);
        String code = groupCode.strip().toUpperCase(Locale.ROOT);
        if (code.isBlank() || code.length() > 60)
            throw new ApiOperationException(HttpStatus.BAD_REQUEST, "ACADEMIC_GROUP_INVALID", "Informe um código de turma com até 60 caracteres.");
        if (academic.findOffering(subjectId, periodId, code) != null)
            throw conflict("OFFER_DUPLICATE", "Já existe uma oferta para este componente, turma e período.");
        var offering = new AcademicOffering(subject, period, code);
        academic.add(offering);
        academic.audit(currentUser.require(), "CREATE", "ACADEMIC_OFFERING", offering.getId(), null);
        return OfferingView.of(offering);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public OfferingView setOfferingActive(Long id, boolean active) {
        var offering = lockOffering(id);
        if (offering.isActive() == active) return OfferingView.of(offering);
        if (active) {
            requireActive(offering.getSubject(), offering.getPeriod());
        } else {
            if (academic.hasActiveOfferingDependencies(id))
                throw conflict("OFFER_HAS_RELATIONS", "Encerre primeiro as matrículas e atribuições docentes ativas desta oferta.");
            if (peis.hasOpenWorkForOffering(id))
                throw conflict("OFFER_HAS_PEIS", "Resolva primeiro os PEIs em andamento desta oferta.");
        }
        offering.setActive(active);
        academic.audit(currentUser.require(), active ? "REACTIVATE" : "ARCHIVE", "ACADEMIC_OFFERING", id, null);
        return OfferingView.of(offering);
    }

    Page<TeachingView> teaching(String query, AcademicListFilters filters, Pageable page) {
        return academic.teaching(query, filters, page).map(TeachingView::of);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public TeachingView createTeaching(Long offeringId, Long teacherId) {
        var offering = lockOffering(offeringId);
        var teacher = teachingCandidate(offering, teacherId);
        if (academic.existsTeaching(teacherId, offeringId))
            throw conflict("TEACHING_DUPLICATE", "Já existe uma atribuição para este professor e oferta. Consulte seu histórico para reativá-la.");
        var teaching = new TeachingAssignment(teacher, offering);
        academic.add(teaching);
        teachingChanged("CREATE", teaching);
        return TeachingView.of(teaching);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public TeachingView replaceTeacher(Long id, Long teacherId, long version) {
        var previous = lockTeaching(id);
        if (!previous.isActive() || previous.getVersion() != version)
            throw conflict("TEACHING_STALE", "A atribuição docente foi alterada. Atualize a página antes de substituir o professor.");
        if (previous.getTeacher().getId().equals(teacherId)) return TeachingView.of(previous);
        var teacher = teachingCandidate(previous.getOffering(), teacherId);
        var successor = academic.previousTeaching(teacherId, previous.getOffering().getId());
        if (successor != null && successor.isActive())
            throw conflict("TEACHING_DUPLICATE", "Este professor já possui uma atribuição ativa nesta oferta.");
        previous.setActive(false);
        if (successor == null) {
            successor = new TeachingAssignment(teacher, previous.getOffering());
            academic.add(successor);
        } else {
            successor.setActive(true);
        }
        var actor = currentUser.require();
        academic.audit(actor, "REPLACE", "TEACHING_ASSIGNMENT", previous.getId(), "Atribuição sucessora " + successor.getId());
        teachingChanged("ASSUME", successor);
        return TeachingView.of(successor);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public TeachingView setTeachingActive(Long id, boolean active) {
        var teaching = lockTeaching(id);
        if (teaching.isActive() == active) return TeachingView.of(teaching);
        if (active) teachingCandidate(teaching.getOffering(), teaching.getTeacher().getId());
        teaching.setActive(active);
        teachingChanged(active ? "REACTIVATE" : "END", teaching);
        return TeachingView.of(teaching);
    }

    Page<OfferingView> enrollmentOptions(Long studentId, String query, Pageable page) {
        var student = napneStudent(studentId, false);
        if (student.getStatus() != StudentStatus.ACTIVE) return Page.empty(page);
        return academic.offerings(query, true, student.getCourse().getId(), AcademicListFilters.NONE, page).map(OfferingView::of);
    }

    Page<EnrollmentView> enrollments(Long studentId, String query, AcademicListFilters filters, Pageable page) {
        napneStudent(studentId, false);
        return academic.enrollments(studentId, query, filters, page).map(EnrollmentView::of);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public EnrollmentView enroll(Long studentId, Long offeringId) {
        var student = napneStudent(studentId, true);
        var offering = lockOffering(offeringId);
        requireEligible(student, offering);
        if (academic.existsEnrollment(studentId, offeringId))
            throw conflict("ENROLLMENT_DUPLICATE", "O estudante já possui registro nesta oferta. Consulte o histórico para reativar a matrícula.");
        var enrollment = new AcademicEnrollment(student, offering);
        academic.add(enrollment);
        enrollmentChanged("CREATE", enrollment);
        return EnrollmentView.of(enrollment);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public EnrollmentView setEnrollmentActive(Long studentId, Long id, boolean active) {
        var student = napneStudent(studentId, true);
        var enrollment = academic.read(AcademicEnrollment.class, id, "Matrícula não encontrada.");
        if (!enrollment.getStudent().getId().equals(studentId))
            throw new NotFoundException("Matrícula não encontrada para este estudante.");
        var offering = lockOffering(enrollment.getOffering().getId());
        enrollment = academic.lock(AcademicEnrollment.class, id, "Matrícula não encontrada.");
        if (enrollment.isActive() == active) return EnrollmentView.of(enrollment);
        if (active) {
            requireEligible(student, offering);
        } else if (peis.hasOpenWorkForEnrollment(studentId, offering.getId())) {
            throw conflict("ENROLLMENT_HAS_PEIS", "Conclua primeiro os PEIs em andamento do estudante nesta oferta.");
        }
        enrollment.setActive(active);
        enrollmentChanged(active ? "REACTIVATE" : "END", enrollment);
        return EnrollmentView.of(enrollment);
    }

    public List<OfferingView> peiOffers(Long studentId) {
        var actor = currentUser.require();
        var offers = academic.peiOffers(studentId, actor.getId());
        if (offers.isEmpty()) return List.of();
        var occupied = peis.occupiedDraftScopes(studentId);
        return offers.stream()
                .filter(offer -> !occupied.contains(new PeiSeriesStore.DraftScope(
                        offer.getSubject().getId(), offer.getPeriod().getCode())))
                .map(OfferingView::of)
                .toList();
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public OfferingView requirePeiOffering(Long studentId, Long offerId, Long subjectId, Long termId, String termCode) {
        var actor = currentUser.require();
        var student = students.findByIdForUpdate(studentId).orElseThrow(() -> new NotFoundException("Estudante não encontrado."));
        if (actor.getCampus() == null || !actor.getCampus().getId().equals(student.getCampus().getId()))
            throw new AccessDeniedException("Acesso negado.");
        var initial = academic.peiOffers(studentId, actor.getId()).stream().filter(o -> {
            if (offerId != null) return offerId.equals(o.getId());
            return Objects.equals(subjectId, o.getSubject().getId())
                    && (termId != null ? termId.equals(o.getPeriod().getId()) : Objects.equals(termCode, o.getPeriod().getCode()));
        }).toList();
        if (initial.isEmpty())
            throw new AccessDeniedException("A oferta deve ter matrícula e atribuição docente ativas.");
        if (initial.size() > 1)
            throw new ApiOperationException(HttpStatus.BAD_REQUEST, "ACADEMIC_PEI_OFFER_REQUIRED", "Selecione a turma ou oferta específica para criar este PEI.");
        var offering = lockOffering(initial.getFirst().getId());
        teachingCandidate(offering, actor.getId());
        if (academic.peiOffers(studentId, actor.getId()).stream().noneMatch(o -> o.getId().equals(offering.getId())))
            throw new AccessDeniedException("A oferta deve ter matrícula e atribuição docente ativas.");
        return OfferingView.of(offering);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void seedDemo(Long subjectId, Long periodId, Long studentId, Long teacherId, UserAccount actor) {
        var student = students.findByIdForUpdate(studentId).orElseThrow();
        var period = academic.lockPeriod(periodId);
        var subject = lockSubjectHierarchy(subjectId);
        if (!period.isActive() || !subject.isActive() || !subject.getCourse().isActive()
                || !subject.getCourse().getCampus().isActive() || student.getStatus() != StudentStatus.ACTIVE
                || !student.getCourse().getId().equals(subject.getCourse().getId())) return;
        var demoTeacher = users.findByIdForUpdate(teacherId).orElseThrow();
        if (!demoTeacher.isActive() || !demoTeacher.getRoles().contains(RoleName.TEACHER) || demoTeacher.getCampus() == null
                || !demoTeacher.getCampus().getId().equals(subject.getCourse().getCampus().getId())) return;
        var groupCode = "DEMONSTRAÇÃO";
        var offering = academic.findOffering(subjectId, periodId, groupCode);
        if (offering == null) {
            offering = new AcademicOffering(subject, period, groupCode);
            academic.add(offering);
            academic.audit(actor, "CREATE", "ACADEMIC_OFFERING", offering.getId(), "Demonstração");
        }
        if (!offering.isActive()) return;
        if (!academic.existsTeaching(teacherId, offering.getId())) {
            var teaching = new TeachingAssignment(demoTeacher, offering);
            academic.add(teaching);
            academic.audit(actor, "CREATE", "TEACHING_ASSIGNMENT", teaching.getId(), "Demonstração");
        }
        if (!academic.existsEnrollment(studentId, offering.getId())) {
            var enrollment = new AcademicEnrollment(student, offering);
            academic.add(enrollment);
            academic.audit(actor, "CREATE", "ACADEMIC_ENROLLMENT", enrollment.getId(), "Demonstração");
        }
        syncAssignments(offering, actor);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public void lockPeiTransferCandidate(Long studentId, Long offeringId, Long teacherId) {
        var student = napneStudent(studentId, true);
        var offering = lockOffering(offeringId);
        teachingCandidate(offering, teacherId);
        if (!assignments.canTeachOffering(student.getId(), teacherId, offeringId))
            throw conflict("PEI_TEACHING_TRANSFER_INVALID", "O docente selecionado precisa ter uma atribuição ativa nesta oferta.");
    }

    private void teachingChanged(String action, TeachingAssignment teaching) {
        var actor = currentUser.require();
        academic.audit(actor, action, "TEACHING_ASSIGNMENT", teaching.getId(), null);
        syncAssignments(teaching.getOffering(), actor);
    }

    private void enrollmentChanged(String action, AcademicEnrollment enrollment) {
        var actor = currentUser.require();
        academic.audit(actor, action, "ACADEMIC_ENROLLMENT", enrollment.getId(), null);
        syncAssignments(enrollment.getOffering(), actor);
    }

    private void syncAssignments(AcademicOffering offering, UserAccount actor) {
        Long subjectId = offering.getSubject().getId();
        Long periodId = offering.getPeriod().getId();
        academic.flush();
        var projected = new HashMap<PairId, StudentAssignment>();
        for (var assignment : academic.projected(subjectId, periodId)) {
            projected.put(new PairId(assignment.getStudent().getId(), assignment.getUser().getId()), assignment);
        }
        for (var pair : academic.pairs(subjectId, periodId)) {
            var key = new PairId(pair.student().getId(), pair.teacher().getId());
            var assignment = projected.remove(key);
            if (assignment == null) {
                assignment = assignments.save(StudentAssignment.builder().student(pair.student()).user(pair.teacher())
                        .subject(offering.getSubject()).period(offering.getPeriod()).origin(AssignmentOrigin.AUTOMATIC)
                        .assignmentType(AssignmentType.TEACHER).build());
                academic.audit(actor, "CREATE", "STUDENT_ASSIGNMENT", assignment.getId(), "Relação acadêmica");
            } else if (!assignment.isActive()) {
                assignment.setActive(true);
                academic.audit(actor, "REACTIVATE", "STUDENT_ASSIGNMENT", assignment.getId(), "Relação acadêmica");
            }
        }
        for (var assignment : projected.values()) {
            if (assignment.isActive()) {
                assignment.setActive(false);
                academic.audit(actor, "REVOKE", "STUDENT_ASSIGNMENT", assignment.getId(), "Relação acadêmica encerrada");
            }
        }
    }

    private AcademicOffering lockOffering(Long id) {
        var snapshot = academic.read(AcademicOffering.class, id, "Oferta não encontrada.");
        academic.lockPeriod(snapshot.getPeriod().getId());
        lockSubjectHierarchy(snapshot.getSubject().getId());
        return academic.lockOffering(id);
    }

    private TeachingAssignment lockTeaching(Long id) {
        var snapshot = academic.read(TeachingAssignment.class, id, "Atribuição não encontrada.");
        lockOffering(snapshot.getOffering().getId());
        return academic.lock(TeachingAssignment.class, id, "Atribuição não encontrada.");
    }

    private Subject lockSubjectHierarchy(Long subjectId) {
        var scope = academic.subjectScope(subjectId);
        Long campusId = scope.campusId();
        campuses.findByIdForUpdate(campusId).orElseThrow(() -> new NotFoundException("Campus não encontrado."));
        if (!courses.findByIdForUpdate(scope.courseId()).orElseThrow().getCampus().getId().equals(campusId))
            throw conflict("COURSE_CAMPUS_CHANGED", "O campus do curso foi alterado. Atualize a página antes de continuar.");
        return subjects.findByIdForUpdate(subjectId).orElseThrow();
    }

    private UserAccount teachingCandidate(AcademicOffering offering, Long teacherId) {
        requireActive(offering);
        var teacher = users.findByIdForUpdate(teacherId).orElseThrow(() -> new NotFoundException("Professor não encontrado."));
        if (!teacher.isActive() || !teacher.getRoles().contains(RoleName.TEACHER) || teacher.getCampus() == null
                || !teacher.getCampus().getId().equals(offering.getSubject().getCourse().getCampus().getId()))
            throw new ApiOperationException(HttpStatus.BAD_REQUEST, "ACADEMIC_TEACHER_INELIGIBLE", "O professor deve estar ativo e pertencer ao campus da oferta.");
        return teacher;
    }

    private Student napneStudent(Long id, boolean lock) {
        var actor = currentUser.require();
        var student = (lock ? students.findByIdForUpdate(id) : students.findById(id))
                .orElseThrow(() -> new NotFoundException("Estudante não encontrado."));
        if (!actor.getRoles().contains(RoleName.NAPNE) || actor.getCampus() == null
                || !student.getCampus().getId().equals(actor.getCampus().getId()))
            throw new AccessDeniedException("Acesso negado.");
        return student;
    }

    private void requireEligible(Student student, AcademicOffering offering) {
        var course = offering.getSubject().getCourse();
        if (!student.getCourse().getId().equals(course.getId()) || !student.getCampus().getId().equals(course.getCampus().getId()))
            throw new ApiOperationException(HttpStatus.BAD_REQUEST, "ACADEMIC_OFFER_NOT_IN_STUDENT_COURSE", "A oferta deve pertencer ao curso e ao campus do estudante.");
        if (student.getStatus() != StudentStatus.ACTIVE)
            throw conflict("STUDENT_INACTIVE", "Somente estudantes ativos podem receber matrículas.");
        requireActive(offering);
    }

    private void requireActive(AcademicOffering offering) {
        if (!offering.isActive()) throw conflict("OFFER_ARCHIVED", "A oferta curricular está arquivada.");
        requireActive(offering.getSubject(), offering.getPeriod());
    }

    private void requireActive(Subject subject, ReferenceEntry period) {
        if (!subject.isActive() || !subject.getCourse().isActive() || !subject.getCourse().getCampus().isActive())
            throw conflict("OFFER_HIERARCHY_ARCHIVED", "Selecione um componente, curso e campus ativos.");
        if (!period.isActive()) throw conflict("PERIOD_ARCHIVED", "O período letivo está arquivado.");
    }

    private static ApiOperationException conflict(String code, String detail) {
        return new ApiOperationException(HttpStatus.CONFLICT, "ACADEMIC_" + code, detail);
    }

    private record PairId(Long student, Long teacher) {}

    public record PeriodView(Long id, String code, String label, boolean active) {
        static PeriodView of(ReferenceEntry entry) {
            return new PeriodView(entry.getId(), entry.getCode(), entry.getLabel(), entry.isActive());
        }
    }

    public record OfferingView(Long id, Long subjectId, String subjectName, String groupCode, Long courseId,
                               String courseName, Long campusId, String campusName, Long periodId, String periodCode,
                               String periodLabel, boolean active) {
        static OfferingView of(AcademicOffering offer) {
            var subject = offer.getSubject();
            var course = subject.getCourse();
            var campus = course.getCampus();
            var period = offer.getPeriod();
            return new OfferingView(offer.getId(), subject.getId(), subject.getName(), offer.getGroupCode(),
                    course.getId(), course.getName(), campus.getId(), campus.getName(),
                    period.getId(), period.getCode(), period.getLabel(), offer.isActive());
        }
    }

    public record TeachingView(Long id, Long teacherId, String teacherName, OfferingView offering, boolean active, long version) {
        static TeachingView of(TeachingAssignment teaching) {
            return new TeachingView(teaching.getId(), teaching.getTeacher().getId(), teaching.getTeacher().getName(),
                    OfferingView.of(teaching.getOffering()), teaching.isActive(), teaching.getVersion());
        }
    }

    public record EnrollmentView(Long id, OfferingView offering, boolean active) {
        static EnrollmentView of(AcademicEnrollment enrollment) {
            return new EnrollmentView(enrollment.getId(), OfferingView.of(enrollment.getOffering()), enrollment.isActive());
        }
    }

}
