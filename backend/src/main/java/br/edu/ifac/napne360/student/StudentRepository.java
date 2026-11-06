package br.edu.ifac.napne360.student;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

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
            and (:query = '' or lower(s.civilName) like lower(concat('%', :query, '%'))
                 or lower(coalesce(s.socialName, '')) like lower(concat('%', :query, '%'))
                 or lower(s.registration) like lower(concat('%', :query, '%')))
            """)
    Page<Student> searchCampus(@Param("campusId") Long campusId, @Param("query") String query, Pageable pageable);

    @org.springframework.data.jpa.repository.EntityGraph(attributePaths = {"campus", "course"})
    @Query("""
            select distinct s from Student s join StudentAssignment a on a.student.id = s.id
            where a.user.id = :userId and a.active = true
              and a.user.campus.id = s.campus.id
              and s.status <> br.edu.ifac.napne360.student.StudentStatus.ARCHIVED
              and (:query = '' or lower(s.civilName) like lower(concat('%', :query, '%'))
                   or lower(coalesce(s.socialName, '')) like lower(concat('%', :query, '%'))
                   or lower(s.registration) like lower(concat('%', :query, '%')))
            """)
    Page<Student> searchAssigned(@Param("userId") Long userId, @Param("query") String query, Pageable pageable);
    boolean existsByRegistration(String registration);
}
