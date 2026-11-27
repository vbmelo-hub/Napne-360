package br.edu.ifac.napne360.academic;

import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.identity.ReferenceEntry;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.student.StudentAssignment;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.persistence.TypedQuery;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.HashMap;

@Repository
@RequiredArgsConstructor
public class AcademicRepository {
    public static final String ACTIVE_OFFER = """
             o.active = true and o.subject.active = true and o.subject.course.active = true
             and o.subject.course.campus.active = true and o.period.active = true
            """;
    private static final String ACADEMIC_MATCH = """
            from AcademicEnrollment e
            join e.offering o
            join TeachingAssignment t on t.offering.id = o.id
            where e.active = true and t.active = true
              and e.student.status = br.edu.ifac.napne360.student.StudentStatus.ACTIVE
              and e.student.course.id = o.subject.course.id
              and e.student.campus.id = o.subject.course.campus.id
              and
            """ + ACTIVE_OFFER;
    public static final String MATCH_JOIN = ACADEMIC_MATCH + """
             and t.teacher.active = true and t.teacher.campus.id = e.student.campus.id
             and br.edu.ifac.napne360.identity.RoleName.TEACHER member of t.teacher.roles
            """;
    public static final String NOT_BLOCKED = """
             and not exists (
                 select 1 from StudentAssignment blocked
                 where blocked.student.id = e.student.id and blocked.user.id = t.teacher.id
                   and blocked.subject.id = o.subject.id
                   and blocked.assignmentType = br.edu.ifac.napne360.student.AssignmentType.TEACHER
                   and blocked.origin = br.edu.ifac.napne360.student.AssignmentOrigin.MANUAL
                   and blocked.securityBlock = true
                   and not exists (select 1 from StudentAssignment later
                       where later.student.id = blocked.student.id and later.user.id = blocked.user.id
                         and later.subject.id = blocked.subject.id
                         and later.assignmentType = blocked.assignmentType and later.origin = blocked.origin
                         and later.id > blocked.id)
             )
            """;
    public static final String EFFECTIVE = """
             a.active = true and (a.origin = br.edu.ifac.napne360.student.AssignmentOrigin.MANUAL
                 or exists (select 1
            """ + MATCH_JOIN + NOT_BLOCKED + """
                  and e.student.id = a.student.id and t.teacher.id = a.user.id
                  and o.subject.id = a.subject.id and o.period.id = a.period.id))
            """;
    private static final String OFFER_SEARCH = """
             lower(concat(o.subject.name, ' ', o.subject.code, ' ', o.groupCode, ' ', o.period.code, ' ',
               o.period.label, ' ', o.subject.course.name, ' ', o.subject.course.campus.name))
            """;

    private final EntityManager db;
    private final JdbcTemplate jdbc;

    Page<ReferenceEntry> periods(String query, Pageable page) {
        return page(ReferenceEntry.class, "r", """
                from ReferenceEntry r
                where r.kind = br.edu.ifac.napne360.identity.ReferenceEntry.Kind.ACADEMIC_TERM
                """, "lower(concat(r.code, ' ', r.label))", query, "r.code desc, r.id", Map.of(), page);
    }

    Page<AcademicOffering> offerings(String query, boolean activeOnly, Long courseId, AcademicListFilters filters,
                                    Pageable page) {
        String from = "from AcademicOffering o where " + (activeOnly ? ACTIVE_OFFER : "1 = 1 ");
        Map<String, Object> params = new HashMap<>();
        if (courseId != null) {
            from += " and o.subject.course.id = :course ";
            params.put("course", courseId);
        }
        from += offeringCriteria(filters, "o.active", params);
        if (filters.teacherId() != null) {
            from += """
                    and exists (select 1 from TeachingAssignment teacherLink where teacherLink.offering.id = o.id
                        and teacherLink.teacher.id = :teacherId)
                    """;
            params.put("teacherId", filters.teacherId());
        }
        return page(AcademicOffering.class, "o", from, OFFER_SEARCH, query,
                "o.period.code desc, o.subject.name, o.groupCode, o.id", params, page);
    }

    Page<TeachingAssignment> teaching(String query, AcademicListFilters filters, Pageable page) {
        Map<String, Object> params = new HashMap<>();
        String from = "from TeachingAssignment t join t.offering o where 1 = 1 "
                + offeringCriteria(filters, "t.active", params);
        if (filters.teacherId() != null) {
            from += " and t.teacher.id = :teacherId ";
            params.put("teacherId", filters.teacherId());
        }
        return page(TeachingAssignment.class, "t", from, "concat(lower(t.teacher.name), ' ', " + OFFER_SEARCH + ")",
                query, "o.period.code desc, o.subject.name, o.groupCode, t.teacher.name, t.id", params, page);
    }

    Page<AcademicEnrollment> enrollments(Long studentId, String query, AcademicListFilters filters, Pageable page) {
        Map<String, Object> params = new HashMap<>();
        params.put("student", studentId);
        String from = "from AcademicEnrollment e join e.offering o where e.student.id = :student "
                + offeringCriteria(filters, "e.active", params);
        return page(AcademicEnrollment.class, "e", from, OFFER_SEARCH, query,
                "o.period.code desc, o.subject.name, o.groupCode, e.id", params, page);
    }

    private String offeringCriteria(AcademicListFilters filters, String activeField, Map<String, Object> params) {
        var criteria = new StringBuilder();
        filter(criteria, params, "courseId", filters.courseId(), "o.subject.course.id = :courseId");
        filter(criteria, params, "subjectId", filters.subjectId(), "o.subject.id = :subjectId");
        filter(criteria, params, "subject", normalized(filters.subject()), "(lower(o.subject.name) = :subject or lower(o.subject.code) = :subject)");
        filter(criteria, params, "groupCode", normalized(filters.groupCode()), "lower(o.groupCode) = :groupCode");
        filter(criteria, params, "periodCode", normalized(filters.periodCode()), "lower(o.period.code) = :periodCode");
        filter(criteria, params, "active", filters.active(), activeField + " = :active");
        return criteria.toString();
    }

    private static void filter(StringBuilder criteria, Map<String, Object> params, String key, Object value, String clause) {
        if (value == null) return;
        criteria.append(" and ").append(clause).append(' ');
        params.put(key, value);
    }

    private static String normalized(String value) {
        return value == null || value.isBlank() ? null : value.strip().toLowerCase(Locale.ROOT);
    }

    List<AcademicOffering> peiOffers(Long studentId, Long teacherId) {
        return db.createQuery("select distinct o " + MATCH_JOIN + NOT_BLOCKED
                        + " and e.student.id = :student and t.teacher.id = :teacher order by o.id",
                AcademicOffering.class).setParameter("student", studentId).setParameter("teacher", teacherId).getResultList();
    }

    List<TeachingPair> pairs(Long subjectId, Long periodId) {
        return db.createQuery("select distinct e.student, t.teacher " + ACADEMIC_MATCH + NOT_BLOCKED
                        + " and o.subject.id = :subject and o.period.id = :period", Object[].class)
                .setParameter("subject", subjectId).setParameter("period", periodId).getResultList().stream()
                .map(row -> new TeachingPair((br.edu.ifac.napne360.student.Student) row[0], (UserAccount) row[1])).toList();
    }

    List<StudentAssignment> projected(Long subjectId, Long periodId) {
        return db.createQuery("""
                select a from StudentAssignment a where a.subject.id = :subject and a.period.id = :period
                and a.origin = br.edu.ifac.napne360.student.AssignmentOrigin.AUTOMATIC
                """, StudentAssignment.class).setParameter("subject", subjectId).setParameter("period", periodId).getResultList();
    }

    SubjectScope subjectScope(Long subjectId) {
        return db.createQuery("""
                select s.course.id, s.course.campus.id from Subject s where s.id = :subject
                """, Object[].class).setParameter("subject", subjectId).getResultList().stream()
                .map(row -> new SubjectScope((Long) row[0], (Long) row[1])).findFirst()
                .orElseThrow(() -> new NotFoundException("Componente não encontrado."));
    }

    AcademicOffering lockOffering(Long id) {
        return lock(AcademicOffering.class, id, "Oferta não encontrada.");
    }

    ReferenceEntry lockPeriod(Long id) {
        var period = lock(ReferenceEntry.class, id, "Período letivo não encontrado.");
        if (period.getKind() != ReferenceEntry.Kind.ACADEMIC_TERM)
            throw new NotFoundException("Período letivo não encontrado.");
        return period;
    }

    <T> T lock(Class<T> type, Long id, String message) {
        T row = read(type, id, message);
        db.refresh(row, LockModeType.PESSIMISTIC_WRITE);
        return row;
    }

    <T> T read(Class<T> type, Long id, String message) {
        T row = db.find(type, id);
        if (row == null) throw new NotFoundException(message);
        return row;
    }

    <T> void add(T row) {
        db.persist(row);
    }

    void flush() {
        db.flush();
    }

    boolean hasActiveOfferings(Long periodId) {
        return exists("select count(*) from academic_offering where period_id = ? and active = true", periodId);
    }

    boolean hasActiveOfferingDependencies(Long offeringId) {
        return exists("select count(*) from academic_enrollment where offering_id = ? and active = true", offeringId)
                || exists("select count(*) from teaching_assignment where offering_id = ? and active = true", offeringId);
    }

    public boolean hasActiveTeaching(Long userId) {
        return exists("select count(*) from teaching_assignment where teacher_id = ? and active = true", userId);
    }

    public boolean hasActiveCampusDependencies(Long campusId) {
        return exists("""
                select count(*) from academic_offering o join subject s on s.id = o.subject_id
                join course c on c.id = s.course_id where c.campus_id = ? and o.active = true
                """, campusId);
    }

    public boolean hasActiveStudentEnrollments(Long studentId) {
        return exists("select count(*) from academic_enrollment where student_id = ? and active = true", studentId);
    }

    public boolean hasCourseOfferings(Long courseId, boolean activeOnly) {
        return exists("""
                select count(*) from academic_offering o join subject s on s.id = o.subject_id
                where s.course_id = ? and (? = false or o.active = true)
                """, courseId, activeOnly);
    }

    public boolean hasSubjectOfferings(Long subjectId) {
        return exists("select count(*) from academic_offering where subject_id = ?", subjectId);
    }

    public boolean hasActiveSubjectDependencies(Long subjectId) {
        return exists("""
                select count(*) from academic_offering o where o.subject_id = ? and (
                    o.active = true
                    or exists (select 1 from academic_enrollment e where e.offering_id = o.id and e.active = true)
                    or exists (select 1 from teaching_assignment t where t.offering_id = o.id and t.active = true))
                """, subjectId);
    }

    AcademicOffering findOffering(Long subjectId, Long periodId, String groupCode) {
        return db.createQuery("""
                select o from AcademicOffering o where o.subject.id = :subject and o.period.id = :period and o.groupCode = :groupCode
                """, AcademicOffering.class).setParameter("subject", subjectId).setParameter("period", periodId)
                .setParameter("groupCode", groupCode).getResultList().stream().findFirst().orElse(null);
    }

    boolean existsTeaching(Long teacherId, Long offeringId) {
        return exists("select count(*) from teaching_assignment where teacher_id = ? and offering_id = ?", teacherId, offeringId);
    }

    TeachingAssignment previousTeaching(Long teacherId, Long offeringId) {
        return db.createQuery("""
                select t from TeachingAssignment t where t.teacher.id = :teacher and t.offering.id = :offering
                """, TeachingAssignment.class).setParameter("teacher", teacherId).setParameter("offering", offeringId)
                .getResultList().stream().findFirst().orElse(null);
    }

    boolean existsEnrollment(Long studentId, Long offeringId) {
        return exists("select count(*) from academic_enrollment where student_id = ? and offering_id = ?",
                studentId, offeringId);
    }

    void audit(UserAccount actor, String action, String resource, Long id, String details) {
        jdbc.update("""
                insert into audit_event (actor_user_id, action, resource_type, resource_id, outcome, occurred_at, details)
                values (?, ?, ?, ?, 'SUCCESS', current_timestamp, ?)
                """, actor.getId(), action, resource, id.toString(), details);
    }

    private boolean exists(String query, Object... arguments) {
        return jdbc.queryForObject(query, Long.class, arguments) > 0;
    }

    private <T> Page<T> page(Class<T> type, String alias, String from, String searchField, String search,
                             String order, Map<String, ?> parameters, Pageable page) {
        String escaped = search.strip().toLowerCase(Locale.ROOT).replace("!", "!!").replace("%", "!%").replace("_", "!_");
        String clause = from + " and " + searchField + " like :search escape '!' ";
        TypedQuery<T> rows = db.createQuery("select " + alias + " " + clause + " order by " + order, type);
        TypedQuery<Long> count = db.createQuery("select count(" + alias + ") " + clause, Long.class);
        parameters.forEach((key, value) -> {
            rows.setParameter(key, value);
            count.setParameter(key, value);
        });
        String term = "%" + escaped + "%";
        rows.setParameter("search", term).setFirstResult((int) Math.min(page.getOffset(), Integer.MAX_VALUE)).setMaxResults(page.getPageSize());
        return new PageImpl<>(rows.getResultList(), page, count.setParameter("search", term).getSingleResult());
    }

    record SubjectScope(Long courseId, Long campusId) {}
    record TeachingPair(br.edu.ifac.napne360.student.Student student, UserAccount teacher) {}
}
