package br.edu.ifac.napne360.student;

import br.edu.ifac.napne360.academic.AcademicRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Lock;
import jakarta.persistence.LockModeType;

import java.util.Optional;
import java.util.List;
import java.util.Set;

public interface StudentAssignmentRepository extends JpaRepository<StudentAssignment, Long> {
    String EFFECTIVE = AcademicRepository.EFFECTIVE;
    String EXISTING = "select case when count(a) > 0 then true else false end from StudentAssignment a ";

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from StudentAssignment a where a.id = :id")
    Optional<StudentAssignment> findByIdForUpdate(Long id);

    @Query(EXISTING + """
            where a.student.id = :studentId and a.user.id = :userId and a.subject.id = :subjectId
              and a.origin = br.edu.ifac.napne360.student.AssignmentOrigin.AUTOMATIC and
            """ + EFFECTIVE)
    boolean existsEquivalentAutomatic(Long studentId, Long userId, Long subjectId);

    @EntityGraph(attributePaths = {"user", "user.campus", "user.roles", "subject", "period"})
    @Query("select a from StudentAssignment a where a.student.id = :studentId and " + EFFECTIVE)
    java.util.List<StudentAssignment> findByStudentIdAndActiveTrue(Long studentId);

    @EntityGraph(attributePaths = {"user", "student", "subject", "period"})
    java.util.List<StudentAssignment> findAllByOrderByIdDesc();
    @Query("select a.id from StudentAssignment a where " + EFFECTIVE)
    java.util.Set<Long> effectiveAssignmentIds();

    String ADMIN_FILTERS = """
            from StudentAssignment a join a.student student join a.user professional
            left join a.period period left join a.subject subject
            where (:campus is null or student.campus.id = :campus)
              and (:course is null or student.course.id = :course)
              and (:subjectId is null or subject.id = :subjectId)
              and (:general = false or subject.id is null)
              and (:type is null or a.assignmentType = :type)
              and (:origin is null or a.origin = :origin)
              and (:periodCode is null or lower(period.code) = :periodCode)
              and (:actor is null or lower(professional.name) like :actor escape '!')
              and (:registration is null or lower(student.registration) like :registration escape '!')
              and (:query is null
                   or lower(student.registration) like :query escape '!'
                   or lower(professional.name) like :query escape '!'
                   or lower(subject.name) like :query escape '!'
                   or lower(period.code) like :query escape '!')
              and (:active is null or :active = case when (
            """ + EFFECTIVE + ") then true else false end)";

    @EntityGraph(attributePaths = {"user", "student", "subject", "period"})
    @Query(value = "select a " + ADMIN_FILTERS + " order by a.id desc", countQuery = "select count(a) " + ADMIN_FILTERS)
    Page<StudentAssignment> adminPage(String query, String registration, String actor, Long campus,
                                     Long course, Long subjectId, boolean general, AssignmentType type,
                                     AssignmentOrigin origin, String periodCode, Boolean active, Pageable pageable);

    @Query("""
            select distinct period.code from StudentAssignment a join a.period period
            where (:campus is null or a.student.campus.id = :campus) and (:course is null or a.student.course.id = :course)
            order by period.code desc
            """)
    java.util.List<String> administrativePeriodCodes(Long campus, Long course);

    @Query("select a.id from StudentAssignment a where a.id in :ids and " + EFFECTIVE)
    Set<Long> effectiveAssignmentIdsFor(List<Long> ids);

    @Query(EXISTING + """
            where a.active = true and a.student.id = :student and a.user.id = :user and a.assignmentType = :type
              and ((:subject is null and a.subject is null) or a.subject.id = :subject)
            """)
    boolean existsManualAssignment(Long student, Long user, Long subject, AssignmentType type);

    boolean existsBySubjectCourseId(Long courseId);
    boolean existsBySubjectId(Long subjectId);
    boolean existsBySubjectIdAndActiveTrue(Long subjectId);
    boolean existsByStudentCampusIdAndActiveTrue(Long campusId);

    @Query(EXISTING + "where a.student.id = :studentId and " + EFFECTIVE)
    boolean existsEffectiveForStudent(Long studentId);

    @org.springframework.data.jpa.repository.Query(
            "select distinct a.assignmentType from StudentAssignment a where a.user.id = :userId and a.active = true")
    java.util.Set<AssignmentType> findActiveTypesForUser(Long userId);
    boolean existsByStudentCourseIdAndActiveTrue(Long courseId);
    boolean existsBySubjectCourseIdAndActiveTrue(Long courseId);
    @Query(EXISTING + "where a.student.id = :studentId and a.user.id = :userId and " + EFFECTIVE)
    boolean existsByStudentIdAndUserIdAndActiveTrue(Long studentId, Long userId);
    @Query(EXISTING + "where a.student.id = :studentId and a.user.id = :userId and a.subject.id = :subjectId and " + EFFECTIVE)
    boolean existsByStudentIdAndUserIdAndSubjectIdAndActiveTrue(Long studentId, Long userId, Long subjectId);
    @Query(EXISTING + """
            where a.student.id = :studentId and a.user.id = :userId and a.subject.id = :subjectId
              and a.assignmentType = :assignmentType and
            """ + EFFECTIVE)
    boolean existsByStudentIdAndUserIdAndSubjectIdAndAssignmentTypeAndActiveTrue(
            Long studentId, Long userId, Long subjectId, AssignmentType assignmentType);
    @Query(EXISTING + """
            where a.student.id = :studentId and a.user.id = :userId and a.assignmentType = :assignmentType and
            """ + EFFECTIVE)
    boolean existsByStudentIdAndUserIdAndAssignmentTypeAndActiveTrue(Long studentId, Long userId, AssignmentType assignmentType);
    @Query(EXISTING + """
            left join a.period period
            where a.student.id = :studentId and a.user.id = :userId and a.subject.id = :subjectId
              and a.assignmentType = br.edu.ifac.napne360.student.AssignmentType.TEACHER
              and a.user.active = true and a.user.campus.id = a.student.campus.id
              and br.edu.ifac.napne360.identity.RoleName.TEACHER member of a.user.roles
              and (period.code = :periodCode or (:allowLegacy = true and period.id is null)) and
            """ + EFFECTIVE)
    boolean existsEffectiveTeaching(Long studentId, Long userId, Long subjectId, String periodCode, boolean allowLegacy);

    @Query("select case when count(e) > 0 then true else false end " + AcademicRepository.MATCH_JOIN
            + AcademicRepository.NOT_BLOCKED + " and e.student.id = :studentId and t.teacher.id = :userId and o.id = :offeringId")
    boolean canTeachOffering(Long studentId, Long userId, Long offeringId);
}
