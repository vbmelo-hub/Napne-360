package br.edu.ifac.napne360.academic;

import br.edu.ifac.napne360.identity.*;
import br.edu.ifac.napne360.pei.PeiSeriesStore;
import br.edu.ifac.napne360.student.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Year;
import java.time.ZoneId;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class AcademicStructureIntegrationTest {
    private static final String ADMIN_URL = "/api/v1/admin/academic";
    private static final String CURRENT_YEAR = Year.now(ZoneId.of("America/Rio_Branco")).toString();

    @Autowired MockMvc mvc;
    @Autowired AcademicPeriods periodGenerator;
    @Autowired ReferenceEntryRepository periods;
    @Autowired CampusRepository campuses;
    @Autowired CourseRepository courses;
    @Autowired SubjectRepository subjects;
    @Autowired StudentRepository students;
    @Autowired UserAccountRepository users;
    @Autowired StudentAssignmentRepository links;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean PeiSeriesStore peis;

    private Campus campus;
    private Course course;
    private Subject subject;
    private Student student;
    private UserAccount teacher;
    private UserAccount napne;
    private UserAccount admin;
    private ReferenceEntry period;

    @BeforeEach
    void setUp() {
        campus = campus();
        course = courses.saveAndFlush(Course.builder().name("Curso acadêmico").code("ACA").campus(campus).build());
        subject = subjects.saveAndFlush(Subject.builder().name("Componente de teste").code("CMP")
                .workloadHours(60).course(course).build());
        student = students.saveAndFlush(Student.builder().registration(UUID.randomUUID().toString())
                .civilName("Nome civil").socialName("Nome social").course(course).campus(campus).build());
        teacher = account(campus, RoleName.TEACHER);
        napne = account(campus, RoleName.NAPNE);
        admin = account(null, RoleName.ADMIN);
        period = periods.findByKindAndCode(ReferenceEntry.Kind.ACADEMIC_TERM, CURRENT_YEAR + ".1").orElseThrow();
    }

    @Test
    void generatesTheTwoAcademicPeriodsAtStartupAndDoesNotDuplicateThem() {
        periodGenerator.ensureCurrentYear();
        periodGenerator.ensureCurrentYear();

        assertThat(periods.findByKindAndActiveTrueOrderByLabel(ReferenceEntry.Kind.ACADEMIC_TERM))
                .extracting(ReferenceEntry::getCode)
                .filteredOn(code -> code.startsWith(CURRENT_YEAR + "."))
                .containsExactly(CURRENT_YEAR + ".1", CURRENT_YEAR + ".2");
    }

    @Test
    void peiOffersExcludeOccupiedSubjectAndPeriodOnly() throws Exception {
        long occupied = offering("TURMA-OCUPADA");
        var nextPeriod = periods.findByKindAndCode(ReferenceEntry.Kind.ACADEMIC_TERM, CURRENT_YEAR + ".2")
                .orElseThrow();
        long available = offering("TURMA-DISPONÍVEL", nextPeriod);
        for (long offer : new long[]{occupied, available}) {
            teaching(offer, teacher);
            enrollment(offer);
        }
        when(peis.occupiedDraftScopes(student.getId()))
                .thenReturn(Set.of(new PeiSeriesStore.DraftScope(subject.getId(), period.getCode())));

        mvc.perform(get(studentPath() + "/academic/pei-offers").with(user(teacher.getEmail()).roles("TEACHER")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(available));
        verify(peis).occupiedDraftScopes(student.getId());
    }

    @Test
    void compatibleOffersGenerateOneLinkAndEndingOneOfferDoesNotRevokeTheOther() throws Exception {
        long first = offering("TURMA-A");
        long second = offering("TURMA-B");
        teaching(first, teacher);
        long secondTeaching = teaching(second, teacher);
        assertThat(links.canTeachOffering(student.getId(), teacher.getId(), first)).isFalse();

        long firstEnrollment = enrollment(first);
        enrollment(second);

        mvc.perform(get(studentPath() + "/academic/pei-offers").with(user(teacher.getEmail()).roles("TEACHER")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(2));
        mvc.perform(get("/api/v1/students").param("academicQuery", "TURMA-B")
                        .with(user(teacher.getEmail()).roles("TEACHER")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.content[0].displayName").value("Nome social"));
        assertThat(links.existsEffectiveTeaching(student.getId(), teacher.getId(), subject.getId(), period.getCode(), false)).isTrue();
        assertThat(jdbc.queryForObject("select count(*) from student_assignment where student_id=? and origin='AUTOMATIC'",
                Long.class, student.getId())).isEqualTo(1L);

        mvc.perform(patch(studentPath() + "/academic/enrollments/{id}/active", firstEnrollment).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"active\":false}").with(user(napne.getEmail()).roles("NAPNE"))).andExpect(status().isOk());
        assertThat(links.canTeachOffering(student.getId(), teacher.getId(), first)).isFalse();
        assertThat(links.canTeachOffering(student.getId(), teacher.getId(), second)).isTrue();

        mvc.perform(patch(ADMIN_URL + "/teaching/{id}/active", secondTeaching).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"active\":false}").with(user(admin.getEmail()).roles("ADMIN"))).andExpect(status().isOk());
        assertThat(links.existsEffectiveTeaching(student.getId(), teacher.getId(), subject.getId(), period.getCode(), false)).isFalse();
        assertThat(jdbc.queryForObject("select active from student_assignment where student_id=? and origin='AUTOMATIC'",
                Boolean.class, student.getId())).isFalse();
        assertThat(jdbc.queryForObject("""
                select count(*) from audit_event where resource_type='STUDENT_ASSIGNMENT'
                and resource_id in (select cast(id as char) from student_assignment where student_id=?)
                """, Long.class, student.getId())).isGreaterThanOrEqualTo(2L);
    }

    @Test
    void wrongCampusAndOtherGroupCannotGrantStudentAccess() throws Exception {
        long assigned = offering("TURMA-ATRIBUÍDA");
        long other = offering("TURMA-DIFERENTE");
        teaching(assigned, teacher);
        enrollment(other);
        UserAccount outside = account(campus(), RoleName.NAPNE);

        assertThat(links.canTeachOffering(student.getId(), teacher.getId(), assigned)).isFalse();
        assertThat(links.existsByStudentIdAndUserIdAndActiveTrue(student.getId(), teacher.getId())).isFalse();
        mvc.perform(get(studentPath()).with(user(teacher.getEmail()).roles("TEACHER"))).andExpect(status().isForbidden());
        mvc.perform(post(studentPath() + "/academic/enrollments").contentType(MediaType.APPLICATION_JSON)
                .content("{\"offeringId\":" + assigned + "}").with(user(outside.getEmail()).roles("NAPNE")))
                .andExpect(status().isForbidden());

        mvc.perform(patch(ADMIN_URL + "/offerings/{id}/active", other).contentType(MediaType.APPLICATION_JSON)
                .content("{\"active\":false}").with(user(admin.getEmail()).roles("ADMIN"))).andExpect(status().isConflict());
        mvc.perform(patch(ADMIN_URL + "/periods/{id}/active", period.getId()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"active\":false}").with(user(admin.getEmail()).roles("ADMIN"))).andExpect(status().isConflict());
    }

    @Test
    void preservesLegacyAccessAndHonorsAnExplicitManualRevocation() throws Exception {
        var legacy = links.saveAndFlush(StudentAssignment.builder().student(student).user(teacher)
                .subject(subject).assignmentType(AssignmentType.TEACHER).build());
        assertThat(links.existsEffectiveTeaching(student.getId(), teacher.getId(), subject.getId(), "Histórico", true)).isTrue();
        assertThat(links.existsEffectiveTeaching(student.getId(), teacher.getId(), subject.getId(), "Histórico", false)).isFalse();

        mvc.perform(patch("/api/v1/admin/assignments/{id}/active", legacy.getId()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"active\":false}").with(user(admin.getEmail()).roles("ADMIN")))
                .andExpect(status().isOk());

        long offering = offering("TURMA-SEGURANÇA");
        teaching(offering, teacher);
        enrollment(offering);

        assertThat(links.canTeachOffering(student.getId(), teacher.getId(), offering)).isFalse();
        assertThat(links.existsByStudentIdAndUserIdAndActiveTrue(student.getId(), teacher.getId())).isFalse();
    }

    @Test
    void regularizationKeepsTheAutomaticLinkAndHistoricalManualRecord() throws Exception {
        var legacy = links.saveAndFlush(StudentAssignment.builder().student(student).user(teacher)
                .subject(subject).assignmentType(AssignmentType.TEACHER).build());
        mvc.perform(patch("/api/v1/admin/assignments/{id}/regularize", legacy.getId())
                        .with(user(admin.getEmail()).roles("ADMIN")))
                .andExpect(status().isConflict());

        long offering = offering("TURMA-REGULAR");
        teaching(offering, teacher);
        enrollment(offering);
        var automatic = links.findByStudentIdAndActiveTrue(student.getId()).stream()
                .filter(link -> link.getOrigin() == AssignmentOrigin.AUTOMATIC).findFirst().orElseThrow();
        mvc.perform(patch("/api/v1/admin/assignments/{id}/active", automatic.getId()).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"active\":false}").with(user(admin.getEmail()).roles("ADMIN")))
                .andExpect(status().isConflict());
        mvc.perform(patch("/api/v1/admin/assignments/{id}/regularize", legacy.getId())
                        .with(user(admin.getEmail()).roles("ADMIN")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.active").value(false));

        assertThat(links.canTeachOffering(student.getId(), teacher.getId(), offering)).isTrue();
        assertThat(links.findById(legacy.getId()).orElseThrow().isSecurityBlock()).isFalse();
    }

    @Test
    void replacingTeacherRevokesTheOriginalAndKeepsBothTeachingRecords() throws Exception {
        long offering = offering("TURMA-SUBSTITUIÇÃO");
        long first = teaching(offering, teacher);
        enrollment(offering);
        UserAccount successor = account(campus, RoleName.TEACHER);

        mvc.perform(put(ADMIN_URL + "/teaching/{id}", first).contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"teacherId":%d,"version":0}
                                """.formatted(successor.getId()))
                        .with(user(admin.getEmail()).roles("ADMIN")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.teacherId").value(successor.getId()));

        assertThat(links.canTeachOffering(student.getId(), teacher.getId(), offering)).isFalse();
        assertThat(links.canTeachOffering(student.getId(), successor.getId(), offering)).isTrue();
        assertThat(jdbc.queryForObject("select active from teaching_assignment where id=?", Boolean.class, first)).isFalse();
        assertThat(jdbc.queryForObject("select count(*) from teaching_assignment where offering_id=?", Long.class, offering)).isEqualTo(2L);
    }

    @Test
    void blocksEndingAnEnrollmentWhileItsPeiIsUnfinished() throws Exception {
        long offer = offering("TURMA-PEI");
        long enrollment = enrollment(offer);
        when(peis.hasOpenWorkForEnrollment(student.getId(), offer)).thenReturn(true);

        mvc.perform(patch(studentPath() + "/academic/enrollments/{id}/active", enrollment).contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"active":false}
                                """).with(user(napne.getEmail()).roles("NAPNE")))
                .andExpect(status().isConflict());

        assertThat(jdbc.queryForObject("select active from academic_enrollment where id=?", Boolean.class, enrollment)).isTrue();
    }

    @Test
    void paginatesAcademicRecordsAfterFilteringAndLimitsEnrollmentOptionsToCampusCourse() throws Exception {
        long offer = offering("TURMA-BUSCA");
        long teaching = teaching(offer, teacher);
        var adminActor = user(admin.getEmail()).roles("ADMIN");
        var napneActor = user(napne.getEmail()).roles("NAPNE");

        mvc.perform(get(ADMIN_URL + "/periods").param("query", CURRENT_YEAR + ".1").with(adminActor))
                .andExpect(status().isOk()).andExpect(jsonPath("$.content[0].id").value(period.getId()));
        mvc.perform(get(ADMIN_URL + "/offerings").param("query", "TURMA-BUSCA").with(adminActor))
                .andExpect(status().isOk()).andExpect(jsonPath("$.content[0].id").value(offer))
                .andExpect(jsonPath("$.totalElements").value(1));
        mvc.perform(get(ADMIN_URL + "/teaching").param("query", "TURMA-BUSCA").with(adminActor))
                .andExpect(status().isOk()).andExpect(jsonPath("$.content[0].id").value(teaching));
        var otherCourse = courses.saveAndFlush(Course.builder().name("Outro curso").code("OUTRO").campus(campus()).build());
        var otherSubject = subjects.saveAndFlush(Subject.builder().name("Componente externo").code("EXT")
                .workloadHours(60).course(otherCourse).build());
        mvc.perform(post(ADMIN_URL + "/offerings").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"subjectId":%d,"periodId":%d,"groupCode":"TURMA-BUSCA"}
                                """.formatted(otherSubject.getId(), period.getId())).with(adminActor))
                .andExpect(status().isOk());
        mvc.perform(get(studentPath() + "/academic/enrollment-options").param("query", "TURMA-BUSCA").with(napneActor))
                .andExpect(status().isOk()).andExpect(jsonPath("$.content[0].id").value(offer))
                .andExpect(jsonPath("$.totalElements").value(1));
        long enrollment = enrollment(offer);
        mvc.perform(get(studentPath() + "/academic/enrollments").param("query", "TURMA-BUSCA").with(napneActor))
                .andExpect(status().isOk()).andExpect(jsonPath("$.content[0].id").value(enrollment));
    }

    @Test
    void historicalFilterOptionsAreScopedToTheListingAndKeepArchivedRecords() throws Exception {
        long historicalOffer = offering("TURMA-HISTORICA");
        long historicalEnrollment = enrollment(historicalOffer);
        long historicalTeaching = teaching(historicalOffer, teacher);
        var nextPeriod = periods.findByKindAndCode(ReferenceEntry.Kind.ACADEMIC_TERM, CURRENT_YEAR + ".2").orElseThrow();
        offering("TURMA-SO-OFERTA", nextPeriod);
        jdbc.update("update academic_enrollment set active = false where id = ?", historicalEnrollment);
        jdbc.update("update teaching_assignment set active = false where id = ?", historicalTeaching);
        jdbc.update("update academic_offering set active = false where id = ?", historicalOffer);
        jdbc.update("update reference_entry set active = false where id = ?", period.getId());
        try {
            var adminActor = user(admin.getEmail()).roles("ADMIN");
            var napneActor = user(napne.getEmail()).roles("NAPNE");
            var enrollmentFilters = studentPath() + "/academic/enrollments/filter-options";
            String courseId = course.getId().toString();

            mvc.perform(get(ADMIN_URL + "/offerings/filter-options").param("courseId", courseId)
                            .param("periodCode", period.getCode()).with(adminActor))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.periodCodes[1]").value(period.getCode()))
                    .andExpect(jsonPath("$.groupCodes.length()").value(1))
                    .andExpect(jsonPath("$.groupCodes[0]").value("TURMA-HISTORICA"));
            mvc.perform(get(ADMIN_URL + "/teaching/filter-options").param("courseId", courseId).with(adminActor))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.groupCodes.length()").value(1))
                    .andExpect(jsonPath("$.groupCodes[0]").value("TURMA-HISTORICA"));
            mvc.perform(get("/api/v1/admin/assignments/periods").with(adminActor))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$[?(@ == '" + period.getCode() + "')]").isNotEmpty());
            mvc.perform(get(enrollmentFilters).with(napneActor))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.subjects[0].id").value(subject.getId()))
                    .andExpect(jsonPath("$.periodCodes.length()").value(1))
                    .andExpect(jsonPath("$.groupCodes.length()").value(1))
                    .andExpect(jsonPath("$.groupCodes[0]").value("TURMA-HISTORICA"));
            mvc.perform(get(enrollmentFilters).with(user(account(campus(), RoleName.NAPNE).getEmail()).roles("NAPNE")))
                    .andExpect(status().isForbidden());
            mvc.perform(get(studentPath() + "/academic/enrollments")
                            .param("subjectId", subject.getId().toString()).param("periodCode", period.getCode())
                            .param("groupCode", "TURMA-HISTORICA").param("active", "false").with(napneActor))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.totalElements").value(1))
                    .andExpect(jsonPath("$.content[0].id").value(historicalEnrollment));
        } finally {
            jdbc.update("update reference_entry set active = true where id = ?", period.getId());
        }
    }

    private Campus campus() {
        return campuses.saveAndFlush(Campus.builder().name("Campus acadêmico").code(UUID.randomUUID().toString()).build());
    }

    private UserAccount account(Campus campus, RoleName role) {
        return users.saveAndFlush(UserAccount.builder().name(role.name()).campus(campus).roles(Set.of(role))
                .email(UUID.randomUUID() + "@example.test").passwordHash("hash-fictício").build());
    }

    private long offering(String groupCode) throws Exception {
        return offering(groupCode, period);
    }

    private long offering(String groupCode, ReferenceEntry offeringPeriod) throws Exception {
        mvc.perform(post(ADMIN_URL + "/offerings").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"subjectId":%d,"periodId":%d,"groupCode":"%s"}
                                """.formatted(subject.getId(), offeringPeriod.getId(), groupCode))
                        .with(user(admin.getEmail()).roles("ADMIN"))).andExpect(status().isOk());
        return jdbc.queryForObject("select id from academic_offering where subject_id=? and group_code=?", Long.class, subject.getId(), groupCode);
    }

    private long teaching(long offer, UserAccount actor) throws Exception {
        mvc.perform(post(ADMIN_URL + "/teaching").contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"offeringId":%d,"teacherId":%d}
                                """.formatted(offer, actor.getId()))
                        .with(user(admin.getEmail()).roles("ADMIN"))).andExpect(status().isOk());
        return jdbc.queryForObject("select id from teaching_assignment where offering_id=? and teacher_id=?", Long.class, offer, actor.getId());
    }

    private long enrollment(long offer) throws Exception {
        mvc.perform(post(studentPath() + "/academic/enrollments").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"offeringId\":" + offer + "}").with(user(napne.getEmail()).roles("NAPNE")))
                .andExpect(status().isOk());
        return jdbc.queryForObject("select id from academic_enrollment where offering_id=? and student_id=?", Long.class, offer, student.getId());
    }

    private String studentPath() {
        return "/api/v1/students/" + student.getId();
    }
}
