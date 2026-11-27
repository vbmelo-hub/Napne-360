package br.edu.ifac.napne360.student;

import br.edu.ifac.napne360.academic.AcademicRepository;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.List;
import br.edu.ifac.napne360.identity.Course;

public interface StudentRepository extends JpaRepository<Student, Long> {
    @Override
    @org.springframework.data.jpa.repository.EntityGraph(attributePaths = {"campus", "course"})
    java.util.Optional<Student> findById(Long id);

    @org.springframework.data.jpa.repository.EntityGraph(attributePaths = {"campus", "course"})
    java.util.Optional<Student> findByRegistration(String registration);

    @org.springframework.data.jpa.repository.EntityGraph(attributePaths = {"campus", "course"})
    @Query("""
            select s from Student s
            where s.campus.id = :campusId and s.status <> br.edu.ifac.napne360.student.StudentStatus.ARCHIVED
            and (:courseId is null or s.course.id = :courseId)
            and (:status is null or s.status = :status)
            and (:reason is null or s.statusReason = :reason)
            and (:query = '' or lower(s.civilName) like lower(concat('%', :query, '%'))
                 or lower(coalesce(s.socialName, '')) like lower(concat('%', :query, '%'))
                 or lower(s.registration) like lower(concat('%', :query, '%')))
            """)
    Page<Student> searchCampus(Long campusId, String query, Long courseId, StudentStatus status,
                              StudentStatusReason reason, Pageable pageable);

    @org.springframework.data.jpa.repository.EntityGraph(attributePaths = {"campus", "course"})
    @Query("""
            select s from Student s
            where s.campus.id = :campusId and s.status = br.edu.ifac.napne360.student.StudentStatus.ARCHIVED
            and (:courseId is null or s.course.id = :courseId)
            and (:status is null or s.archivedAcademicStatus = :status)
            and (:reason is null or s.statusReason = :reason)
            and (:query = '' or lower(s.civilName) like lower(concat('%', :query, '%'))
                 or lower(coalesce(s.socialName, '')) like lower(concat('%', :query, '%'))
                 or lower(s.registration) like lower(concat('%', :query, '%')))
            """)
    Page<Student> searchArchivedCampus(Long campusId, String query, Long courseId, StudentStatus status,
                                      StudentStatusReason reason, Pageable pageable);

    @org.springframework.data.jpa.repository.EntityGraph(attributePaths = {"campus", "course"})
    @Query("""
            select distinct s from Student s join StudentAssignment a on a.student.id = s.id
            where a.user.id = :userId and
            """ + AcademicRepository.EFFECTIVE + """
              and a.user.campus.id = s.campus.id
              and s.status <> br.edu.ifac.napne360.student.StudentStatus.ARCHIVED
              and (:courseId is null or s.course.id = :courseId)
            and (:status is null or s.status = :status)
            and (:query = '' or lower(s.civilName) like lower(concat('%', :query, '%'))
                   or lower(coalesce(s.socialName, '')) like lower(concat('%', :query, '%'))
                   or lower(s.registration) like lower(concat('%', :query, '%')))
            """)
    Page<Student> searchAssigned(@Param("userId") Long userId, @Param("query") String query, Long courseId, StudentStatus status, Pageable pageable);
    @org.springframework.data.jpa.repository.EntityGraph(attributePaths = {"campus", "course"})
    @Query("""
            select s from Student s where exists (select 1
            """ + AcademicRepository.MATCH_JOIN + AcademicRepository.NOT_BLOCKED + """
                and e.student.id = s.id and t.teacher.id = :userId
                and lower(concat(o.subject.name, ' ', o.subject.code, ' ', o.groupCode, ' ', o.period.code))
                    like lower(concat('%', :academicQuery, '%')))
            and (:courseId is null or s.course.id = :courseId)
            and (:status is null or s.status = :status)
            and (:query = '' or lower(s.civilName) like lower(concat('%', :query, '%'))
                 or lower(coalesce(s.socialName, '')) like lower(concat('%', :query, '%'))
                 or lower(s.registration) like lower(concat('%', :query, '%')))
            """)
    Page<Student> searchTeachingScope(Long userId, String query, String academicQuery, Long courseId, StudentStatus status, Pageable pageable);

    @Query("select distinct s.course from Student s where s.campus.id = :campusId")
    List<Course> campusFilterCourses(Long campusId);

    @Query("""
            select distinct s.course from Student s join StudentAssignment a on a.student.id = s.id
            where a.user.id = :userId and
            """ + AcademicRepository.EFFECTIVE + """
              and a.user.campus.id = s.campus.id
              and s.status <> br.edu.ifac.napne360.student.StudentStatus.ARCHIVED
            """)
    List<Course> assignedFilterCourses(Long userId);

    String REGISTRATION_CANDIDATE_SCOPE = """
            from Student s where s.course.active = true
              and s.status = br.edu.ifac.napne360.student.StudentStatus.ACTIVE
            """;

    @Query("select s " + REGISTRATION_CANDIDATE_SCOPE
            + "and (:pattern is null or lower(s.registration) like :pattern escape '!')")
    Page<Student> registrationCandidates(String pattern, Pageable pageable);

    @Query("select s " + REGISTRATION_CANDIDATE_SCOPE + "and s.id = :id")
    Optional<Student> registrationCandidate(Long id);

    boolean existsByRegistration(String registration);
    boolean existsByCourseId(Long courseId);
    boolean existsByCampusIdAndStatus(Long campusId, StudentStatus status);
    boolean existsByCourseIdAndStatus(Long courseId, StudentStatus status);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Student s where s.id = :id")
    Optional<Student> findByIdForUpdate(Long id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from Student s where s.id = :id and s.campus.id = :campusId")
    Optional<Student> findByIdAndCampusForUpdate(Long id, Long campusId);
}
