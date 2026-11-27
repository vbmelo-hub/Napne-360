package br.edu.ifac.napne360.pei;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.common.ApiExceptionHandler;
import br.edu.ifac.napne360.document.DocumentTemplateRepository;
import br.edu.ifac.napne360.document.CareRecordService;
import br.edu.ifac.napne360.identity.*;
import br.edu.ifac.napne360.security.AccessGuard;
import br.edu.ifac.napne360.security.CurrentUserService;
import br.edu.ifac.napne360.student.AssignmentType;
import br.edu.ifac.napne360.student.Student;
import br.edu.ifac.napne360.student.StudentAssignment;
import br.edu.ifac.napne360.student.StudentAssignmentRepository;
import br.edu.ifac.napne360.student.StudentRepository;
import br.edu.ifac.napne360.timeline.TimelineService;
import br.edu.ifac.napne360.timeline.TimelineVisibility;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Duration;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class PeiWorkflowTest {
    private static final String PATH = "/api/v1/students/1/peis";
    private static final String VERSION = "{\"version\":0}";
    private static final String TRANSFER = "{\"teacherId\":12,\"version\":0,\"reason\":\"  Substituição docente  \"}";
    private static final Campus CAMPUS = Campus.builder().id(4L).build();
    private static final Campus OTHER_CAMPUS = Campus.builder().id(5L).build();
    final PeiRepository legacy = mock(PeiRepository.class);
    final PeiMongoFixture mongo = new PeiMongoFixture(legacy);
    final CurrentUserService current = mock(CurrentUserService.class);
    final AccessGuard access = mock(AccessGuard.class);
    final StudentRepository students = mock(StudentRepository.class);
    final StudentAssignmentRepository assignments = mock(StudentAssignmentRepository.class);
    final ReferenceCatalogService catalog = mock(ReferenceCatalogService.class);
    final SubjectRepository subjects = mock(SubjectRepository.class);
    final TimelineService timeline = mock(TimelineService.class);
    final AuditService audit = mock(AuditService.class);
    PeiDocument approved;
    PeiDocument draft;
    MockMvc mvc;
    PeiProjectionService projections;

    @BeforeEach void setUp() {
        setUpController(access);
        approved = plan("old", 3, PeiStatus.APPROVED);
        draft = plan("draft", 7, PeiStatus.DRAFT);
        when(legacy.findById("old")).thenReturn(Optional.of(approved));
        when(legacy.findById("draft")).thenReturn(Optional.of(draft));
        when(legacy.findByStudentIdAndSubjectIdAndAcademicTermOrderByRevisionDesc(1L, 2L, "2026-2"))
                .thenReturn(List.of(draft, approved));
        when(legacy.findByStudentIdOrderByUpdatedAtDesc(1L)).thenReturn(List.of(draft, approved));
        when(access.canViewPei(1L, 2L)).thenReturn(true);
        when(access.canTeachPei(1L, 2L)).thenReturn(true);
        when(access.canEditDossier(1L)).thenReturn(true);
        actor(RoleName.TEACHER);
    }

    private void setUpController(AccessGuard guard) {
        setUpController(guard, Runnable::run);
    }

    private void setUpController(AccessGuard guard, Executor executor) {
        projections = new PeiProjectionService(mongo.store, timeline, audit, executor);
        var service = new PeiService(catalog, mongo.store, mock(CareRecordService.class),
                subjects, current, projections, guard, mock(DocumentTemplateRepository.class), assignments);
        mvc = MockMvcBuilders.standaloneSetup(new PeiController(service, guard))
                .setControllerAdvice(new ApiExceptionHandler()).build();
    }

    @Test void editingReturnsNewRevisionAndStaleRetryCannotChangeVigency() throws Exception {
        update("draft", "{\"content\":{\"notes\":\"Novo\"},\"version\":0}")
                .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(8))
                .andExpect(jsonPath("$.storageVersion").isNumber())
                .andExpect(jsonPath("$.allowedActions", containsInAnyOrder("EDIT", "SUBMIT")));
        update("draft", "{\"content\":{},\"version\":0}").andExpect(status().isConflict());
        assertThat(approved.getStatus()).isEqualTo(PeiStatus.APPROVED);
        verify(timeline, times(1)).appendOnce(any(), any(), any(), any(), any(), any(), any(), any());
        verify(audit, times(1)).recordPeiMutation(any(), any(), any(), any(), any(), anyInt(), any());
    }

    @Test void editSucceedsAndAuditIsAttemptedWhenTimelineFailsAfterTheRevisionWrite() throws Exception {
        doThrow(new DataAccessResourceFailureException("timeline indisponível")).doNothing()
                .when(timeline).appendOnce(any(), any(), any(), any(), any(), any(), any(), any());

        update("draft", "{\"content\":{\"notes\":\"Novo\"},\"version\":0}")
                .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(8));

        var saved = mongo.store.load(1L, 2L, "2026-2");
        assertThat(saved.find("draft").orElseThrow().getStatus()).isEqualTo(PeiStatus.SUPERSEDED);
        assertThat(saved.revisions()).extracting(PeiDocument::getRevision).containsExactly(7, 3, 8);
        assertThat(saved.pendingProjections()).singleElement()
                .satisfies(event -> assertThat(event.action()).isEqualTo("REVISE"));
        verify(audit).recordPeiMutation(any(), any(), any(), eq("REVISE"), any(), eq(8), any());

        new PeiProjectionService(mongo.store, timeline, audit, Runnable::run).retryPending();
        assertThat(mongo.store.load(1L, 2L, "2026-2").pendingProjections()).isEmpty();
    }

    @Test void submitSucceedsWhenAuditFailsAfterTheTimelineWrite() throws Exception {
        doThrow(new DataAccessResourceFailureException("auditoria indisponível"))
                .when(audit).recordPeiMutation(any(), any(), any(), any(), any(), anyInt(), any());

        action("draft", "submit", VERSION).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_REVIEW"));

        var saved = mongo.store.load(1L, 2L, "2026-2");
        assertThat(saved.find("draft").orElseThrow().getStatus()).isEqualTo(PeiStatus.IN_REVIEW);
        assertThat(saved.pendingProjections()).extracting(PeiProjection::key).containsExactly("pei:draft:1");
        verify(timeline).appendOnce(any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test void requestReturnsWhileProjectionIsBlocked() throws Exception {
        var started = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        doAnswer(call -> {
            started.countDown();
            assertThat(release.await(5, TimeUnit.SECONDS)).isTrue();
            return null;
        }).when(timeline).appendOnce(any(), any(), any(), any(), any(), any(), any(), any());
        try (var worker = Executors.newSingleThreadExecutor()) {
            setUpController(access, worker);
            try {
                assertTimeoutPreemptively(Duration.ofSeconds(3), () ->
                        action("draft", "submit", VERSION).andExpect(status().isOk())
                                .andExpect(jsonPath("$.status").value("IN_REVIEW")));
                assertThat(started.await(2, TimeUnit.SECONDS)).isTrue();
                assertThat(mongo.store.load(1L, 2L, "2026-2").pendingProjections())
                        .extracting(PeiProjection::key).containsExactly("pei:draft:1");
            } finally {
                release.countDown();
            }
        }
        assertThat(mongo.store.load(1L, 2L, "2026-2").pendingProjections()).isEmpty();
    }

    @Test void rejectedDispatchLeavesDurableWorkForTheRetry() throws Exception {
        setUpController(access, task -> { throw new RejectedExecutionException("fila cheia"); });

        action("draft", "submit", VERSION).andExpect(status().isOk());
        verifyNoInteractions(timeline, audit);
        assertThat(mongo.store.load(1L, 2L, "2026-2").pendingProjections())
                .extracting(PeiProjection::key).containsExactly("pei:draft:1");

        projections.retryPending();
        assertThat(mongo.store.load(1L, 2L, "2026-2").pendingProjections()).isEmpty();
        verify(timeline).appendOnce(eq("pei:draft:1"), any(), eq("PEI_SUBMITTED"), any(), any(), any(), any(), any());
        verify(audit).recordPeiMutation(eq("pei:draft:1"), any(), any(), eq("SUBMIT"), eq("draft"), eq(7), any());
    }

    @ParameterizedTest @ValueSource(strings = {
            "{\"content\":{},\"version\":0,\"status\":\"IN_REVIEW\"}",
            "{\"content\":{},\"version\":0,\"status\":null}",
            "{\"content\":{},\"version\":0.5}",
            "{\"content\":{}}"
    })
    void putRejectsStatusOrInvalidVersionWithoutEffects(String body) throws Exception {
        update("draft", body).andExpect(status().isBadRequest());
        verify(legacy, never()).save(any());
        verifyNoInteractions(timeline, audit);
    }

    @Test void approvalSwapsVigentAndRetryCannotEmitDuplicateEffects() throws Exception {
        draft.setStatus(PeiStatus.IN_REVIEW);
        actor(RoleName.NAPNE);
        action("draft", "approve", VERSION).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.reviewedBy").value("napne@example.test"))
                .andExpect(jsonPath("$.reviewedAt").exists());
        mvc.perform(get(PATH + "/old")).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUPERSEDED"));
        action("draft", "approve", VERSION).andExpect(status().isConflict());
        verify(timeline, times(1)).appendOnce(any(), any(), any(), any(), any(), any(), any(), any());
        verify(audit, times(1)).recordPeiMutation(any(), any(), any(), any(), any(), anyInt(), any());
    }

    @Test void approvalOfOfficialRevisionKeepsTheOfficialContentAndReplacesTheVigentPlan() throws Exception {
        draft.setFormVersion("IFAC_76_2025");
        draft.setStatus(PeiStatus.IN_REVIEW);
        draft.setContent(officialContent());
        actor(RoleName.NAPNE);

        action("draft", "approve", VERSION).andExpect(status().isOk())
                .andExpect(jsonPath("$.formVersion").value("IFAC_76_2025"))
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.content.skillsInventory.oralCommunication1").value("REALIZA_COM_AJUDA"));

        var saved = mongo.store.load(1L, 2L, "2026-2");
        assertThat(saved.current().orElseThrow().getId()).isEqualTo("draft");
        assertThat(saved.find("old").orElseThrow().getStatus()).isEqualTo(PeiStatus.SUPERSEDED);
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "specificObjectives|[\"Primeiro\"]",
            "specificObjectives|[\"Primeiro\",\"Segundo\",\"Terceiro\",\"Quarto\",\"Quinto\"]",
            "contents|[{\"description\":\"Tema\",\"workloadHours\":null,\"priority\":false}]",
            "contents|[{\"description\":\"Tema\",\"workloadHours\":0,\"priority\":false}]",
            "assessmentInstruments|[{\"description\":\"Relato oral\",\"justification\":\" \"}]",
            "skillsInventory|{\"oralCommunication\":\"NAO_OBSERVADO\"}"
    })
    void incompleteOfficialApprovalKeepsThePreviousVigentPlan(String field, String jsonValue) throws Exception {
        draft.setFormVersion("IFAC_76_2025");
        draft.setStatus(PeiStatus.IN_REVIEW);
        var content = officialContent();
        content.put(field, new ObjectMapper().readValue(jsonValue, Object.class));
        draft.setContent(content);
        actor(RoleName.NAPNE);

        action("draft", "approve", VERSION).andExpect(status().isBadRequest());

        var untouched = mongo.store.load(1L, 2L, "2026-2");
        assertThat(untouched.version()).isNull();
        assertThat(untouched.current().orElseThrow().getId()).isEqualTo("old");
        verifyNoInteractions(timeline, audit);
    }

    @Test void officialTransferUpdatesOnlyTheNewTeachersSnapshot() throws Exception {
        transferFixture();
        draft.setFormVersion("IFAC_76_2025");
        draft.setContent(officialContent());

        transfer(TRANSFER).andExpect(status().isOk())
                .andExpect(jsonPath("$.formVersion").value("IFAC_76_2025"))
                .andExpect(jsonPath("$.teacherId").value(12))
                .andExpect(jsonPath("$.content.teacherName").value("Docente 12"))
                .andExpect(jsonPath("$.content.skillsInventory.oralCommunication1").value("REALIZA_COM_AJUDA"));

        var saved = mongo.store.load(1L, 2L, "2026-2");
        assertThat(saved.find("draft").orElseThrow().getContent().get("teacherName")).isEqualTo("Docente original");
        assertThat(saved.current().orElseThrow().getId()).isEqualTo("old");
    }

    @Test void replacementOfOfficialRevisionUsesTheResponsibleTeachersSnapshot() throws Exception {
        approved.setFormVersion("IFAC_76_2025");
        approved.setContent(officialContent());
        draft.setStatus(PeiStatus.ARCHIVED);
        actor(RoleName.TEACHER, 12L, CAMPUS);

        action("old", "revisions", VERSION).andExpect(status().isOk())
                .andExpect(jsonPath("$.formVersion").value("IFAC_76_2025"))
                .andExpect(jsonPath("$.teacherId").value(12))
                .andExpect(jsonPath("$.content.teacherName").value("Pessoa fictícia"))
                .andExpect(jsonPath("$.content.generalObjectives").value("Objetivos"));

        mvc.perform(get(PATH + "/old")).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"))
                .andExpect(jsonPath("$.content.teacherName").value("Docente original"));
    }

    private Map<String, Object> officialContent() {
        var result = new LinkedHashMap<>(draft.getContent());
        result.put("teacherName", "Docente original");
        result.put("specificObjectives", List.of("Primeiro", "Segundo"));
        result.put("contents", List.of(Map.of("description", "Tema", "workloadHours", 2, "priority", false)));
        result.put("assessmentInstruments", List.of(Map.of("description", "Relato oral", "justification", "Permite explicar as etapas")));
        var indicators = new LinkedHashMap<String, String>();
        for (String group : List.of("oralCommunication", "readingAndWriting", "logicalMathematicalReasoning",
                "socioemotionalSkills", "functionalAutonomy", "digitalTechnologies")) {
            int count = group.equals("oralCommunication") || group.equals("digitalTechnologies") ? 4 : 5;
            for (int number = 1; number <= count; number++) {
                indicators.put(group + number, "NAO_OBSERVADO");
            }
        }
        indicators.put("oralCommunication1", "REALIZA_COM_AJUDA");
        result.put("skillsInventory", indicators);
        return result;
    }

    @Test void linkedTeacherCannotApproveAndReviewerCannotSubmit() throws Exception {
        draft.setStatus(PeiStatus.IN_REVIEW);
        action("draft", "approve", VERSION).andExpect(status().isForbidden());
        draft.setStatus(PeiStatus.DRAFT);
        actor(RoleName.NAPNE);
        action("draft", "submit", VERSION).andExpect(status().isForbidden());
        verifyNoInteractions(timeline, audit);
    }

    @ParameterizedTest @ValueSource(strings = {"COTEP", "COURSE_COORDINATOR"})
    void linkedPedagogicalProfilesReadButCannotEdit(String role) throws Exception {
        actor(RoleName.valueOf(role));
        mvc.perform(get(PATH + "/draft")).andExpect(status().isOk())
                .andExpect(jsonPath("$.allowedActions").isEmpty());
        update("draft", "{\"content\":{},\"version\":0}").andExpect(status().isForbidden());
        verifyNoInteractions(timeline, audit);
    }

    @Test void teacherLinkedToSubjectButNotResponsibleCannotChangeSomeoneElsesDraft() throws Exception {
        draft.setTeacherId(99L);
        update("draft", "{\"content\":{},\"version\":0}").andExpect(status().isForbidden());
        action("draft", "submit", VERSION).andExpect(status().isForbidden());
        verifyNoInteractions(timeline, audit);
    }

    @Test void transferKeepsAuthoredContentAndVigencyAndRetainsTheReasonOnlyInItsRevision() throws Exception {
        transferFixture();
        var moved = transfer(TRANSFER).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.revision").value(8))
                .andExpect(jsonPath("$.teacherId").value(12))
                .andExpect(jsonPath("$.createdBy").value("teacher@example.test"))
                .andExpect(jsonPath("$.updatedBy").value("napne@example.test"))
                .andExpect(jsonPath("$.transfer.fromTeacherId").value(9))
                .andExpect(jsonPath("$.transfer.toTeacherId").value(12))
                .andExpect(jsonPath("$.transfer.transferredBy").value("napne@example.test"))
                .andExpect(jsonPath("$.transfer.transferredAt").exists())
                .andExpect(jsonPath("$.transfer.reason").value("Substituição docente"))
                .andExpect(jsonPath("$.allowedActions").isEmpty())
                .andReturn();
        var id = new ObjectMapper().readTree(moved.getResponse().getContentAsString()).get("id").asText();

        var saved = mongo.store.load(1L, 2L, "2026-2");
        assertThat(saved.revisions()).hasSize(3);
        assertThat(saved.current().orElseThrow()).usingRecursiveComparison().isEqualTo(approved);
        var previous = saved.find("draft").orElseThrow();
        assertThat(previous.getStatus()).isEqualTo(PeiStatus.SUPERSEDED);
        assertThat(previous.getTeacherId()).isEqualTo(9L);
        assertThat(previous.getContent()).isEqualTo(draft.getContent());
        assertThat(saved.find(id).orElseThrow().getContent()).isEqualTo(draft.getContent());
        verify(timeline).appendOnce(eq("pei:" + id + ":0"), eq(1L), eq("PEI_TRANSFERRED"), anyString(), anyString(),
                eq(TimelineVisibility.RESTRICTED), eq(Map.of("peiId", id, "subjectId", 2L, "revision", 8)), any());
        verify(audit).recordPeiMutation(eq("pei:" + id + ":0"), any(), any(), eq("TRANSFER"), eq(id), eq(8), any());

        transfer(TRANSFER).andExpect(status().isConflict());
        actor(RoleName.TEACHER, 12L, CAMPUS);
        mvc.perform(get(PATH + "/" + id)).andExpect(status().isOk())
                .andExpect(jsonPath("$.transfer").doesNotHaveJsonPath())
                .andExpect(jsonPath("$.allowedActions", containsInAnyOrder("EDIT", "SUBMIT")));
        mvc.perform(get(PATH)).andExpect(status().isOk())
                .andExpect(jsonPath("$[*].transfer").isEmpty());
        var edited = update(id, "{\"version\":0,\"content\":{\"generalObjectives\":\"Revisado\"}}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.createdBy").value("teacher@example.test")).andReturn();
        var newId = new ObjectMapper().readTree(edited.getResponse().getContentAsString()).get("id").asText();
        action(newId, "submit", VERSION).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("IN_REVIEW"));
        actor(RoleName.NAPNE, 10L, CAMPUS);
        mvc.perform(get(PATH + "/" + id)).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUPERSEDED"))
                .andExpect(jsonPath("$.transfer.reason").value("Substituição docente"));
        mvc.perform(get(PATH + "/" + newId)).andExpect(status().isOk())
                .andExpect(jsonPath("$.transfer").doesNotHaveJsonPath());
        mvc.perform(get(PATH)).andExpect(status().isOk())
                .andExpect(jsonPath("$[*].transfer.reason", org.hamcrest.Matchers.contains("Substituição docente")));
    }

    @Test void candidatesExcludeOtherAssignmentTypesSubjectsCampusesRolesAndInactiveAccounts() throws Exception {
        var eligible = transferFixture();
        var previousWithTutorLink = transferTeacher(9L, CAMPUS, true, RoleName.TEACHER, RoleName.TUTOR);
        var nonTeacher = transferTeacher(13L, CAMPUS, true, RoleName.TUTOR);
        var inactive = transferTeacher(14L, CAMPUS, false, RoleName.TEACHER);
        var otherCampus = transferTeacher(15L, OTHER_CAMPUS, true, RoleName.TEACHER);
        var wrongType = transferTeacher(16L, CAMPUS, true, RoleName.TEACHER, RoleName.TUTOR);
        var otherSubject = transferTeacher(17L, CAMPUS, true, RoleName.TEACHER);
        var absentCampus = transferTeacher(18L, null, true, RoleName.TEACHER);
        when(assignments.findByStudentIdAndActiveTrue(1L)).thenReturn(List.of(
                link(eligible, 2L, AssignmentType.TEACHER), link(eligible, 2L, AssignmentType.TEACHER),
                link(previousWithTutorLink, 2L, AssignmentType.TUTOR), link(nonTeacher, 2L, AssignmentType.TEACHER),
                link(inactive, 2L, AssignmentType.TEACHER), link(otherCampus, 2L, AssignmentType.TEACHER),
                link(wrongType, 2L, AssignmentType.TUTOR), link(otherSubject, 3L, AssignmentType.TEACHER),
                link(absentCampus, 2L, AssignmentType.TEACHER)));

        mvc.perform(get(PATH + "/draft")).andExpect(status().isOk())
                .andExpect(jsonPath("$.allowedActions", org.hamcrest.Matchers.contains("TRANSFER")));
        candidates().andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].id").value(12))
                .andExpect(jsonPath("$[0].name").value("Docente 12"))
                .andExpect(jsonPath("$[0].email").doesNotHaveJsonPath());
        for (long id : List.of(9L, 13L, 14L, 15L, 16L, 17L, 18L)) {
            transfer(TRANSFER.replace("\"teacherId\":12", "\"teacherId\":" + id)).andExpect(status().isBadRequest());
        }
        verifyNoInteractions(timeline, audit);
    }

    @Test void candidateRemovedAfterListingCannotReceiveDraft() throws Exception {
        transferFixture();
        candidates().andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(1));
        when(assignments.findByStudentIdAndActiveTrue(1L)).thenReturn(List.of());

        transfer(TRANSFER).andExpect(status().isBadRequest());
        assertThat(mongo.store.load(1L, 2L, "2026-2").version()).isNull();
        verifyNoInteractions(timeline, audit);
    }

    @Test void activePriorTeachingAssignmentWithdrawsTransfer() throws Exception {
        transferFixture();
        candidates().andExpect(status().isOk());
        when(assignments.existsByStudentIdAndUserIdAndSubjectIdAndAssignmentTypeAndActiveTrue(
                1L, 9L, 2L, AssignmentType.TEACHER)).thenReturn(true);

        mvc.perform(get(PATH + "/draft")).andExpect(status().isOk()).andExpect(jsonPath("$.allowedActions").isEmpty());
        candidates().andExpect(status().isConflict());
        transfer(TRANSFER).andExpect(status().isConflict());
        verifyNoInteractions(timeline, audit);
    }

    @ParameterizedTest
    @EnumSource(value = RoleName.class, names = {"TEACHER", "COTEP", "COURSE_COORDINATOR", "NAPNE"})
    void onlyNapneOnTheStudentCampusCanListCandidatesOrTransfer(RoleName role) throws Exception {
        transferFixture();
        actor(role, 10L, role == RoleName.NAPNE ? OTHER_CAMPUS : CAMPUS);

        candidates().andExpect(status().isForbidden());
        transfer(TRANSFER).andExpect(status().isForbidden());
        verifyNoInteractions(timeline, audit);
    }

    @Test void onlyAssignedDraftsCanBeTransferredAndReturnedDraftsUseTheNewVersion() throws Exception {
        transferFixture();
        draft.setTeacherId(null);
        candidates().andExpect(status().isConflict());
        transfer(TRANSFER).andExpect(status().isConflict());
        draft.setTeacherId(9L);
        draft.setStatus(PeiStatus.IN_REVIEW);
        candidates().andExpect(status().isConflict());
        transfer(TRANSFER).andExpect(status().isConflict());

        action("draft", "return", VERSION).andExpect(status().isOk());
        transfer(TRANSFER).andExpect(status().isConflict());
        transfer(TRANSFER.replace("\"version\":0", "\"version\":1")).andExpect(status().isOk());
    }

    @Test void transferReasonMustContainAtMostFiveHundredCharactersAfterTrimming() throws Exception {
        transferFixture();
        var mapper = new ObjectMapper();
        transfer("{\"teacherId\":12,\"version\":0}").andExpect(status().isBadRequest());
        transfer("{\"teacherId\":12,\"version\":0,\"reason\":123}").andExpect(status().isBadRequest());
        for (var invalid : List.of(" \t ", "x".repeat(501))) {
            transfer(mapper.writeValueAsString(Map.of("teacherId", 12, "version", 0, "reason", invalid)))
                    .andExpect(status().isBadRequest());
        }
        verifyNoInteractions(timeline, audit);
        var limit = "x".repeat(500);
        transfer(mapper.writeValueAsString(Map.of("teacherId", 12, "version", 0, "reason", "  " + limit + "  ")))
                .andExpect(status().isOk()).andExpect(jsonPath("$.transfer.reason").value(limit));
    }

    @ParameterizedTest
    @ValueSource(strings = {"\u00A0", "\u202F", "\u2007", "\uFEFF", " \t\u00A0\u202F\u2007\uFEFF\n"})
    void transferRejectsReasonContainingOnlyUnicodeSpaces(String reason) throws Exception {
        transferFixture();
        var body = new ObjectMapper().writeValueAsString(Map.of("teacherId", 12, "version", 0, "reason", reason));

        transfer(body).andExpect(status().isBadRequest());

        assertThat(mongo.store.load(1L, 2L, "2026-2").version()).isNull();
        verifyNoInteractions(timeline, audit);
    }

    @Test void transferTrimsUnicodeSpacesAtTheEdgesAndPreservesThemInTheText() throws Exception {
        transferFixture();
        var text = "Troca\u00A0de\u202Fdocente\u2007por escala.";
        var reason = text + "x".repeat(500 - text.length());
        var padded = "\u00A0\u202F\u2007\uFEFF" + reason + "\uFEFF\u2007\u202F\u00A0";
        var body = new ObjectMapper().writeValueAsString(Map.of("teacherId", 12, "version", 0, "reason", padded));

        transfer(body).andExpect(status().isOk())
                .andExpect(jsonPath("$.transfer.reason").value(reason));
    }

    @Test void simultaneousTransfersCreateOneDraftAndOneSuccessEvent() throws Exception {
        transferFixture();
        var imported = mongo.store.load(1L, 2L, "2026-2");
        mongo.seed(imported);

        race(() -> transfer(TRANSFER).andReturn().getResponse().getStatus());

        var saved = mongo.store.load(1L, 2L, "2026-2");
        assertThat(saved.revisions()).hasSize(3);
        assertThat(saved.revisions().stream().filter(plan -> plan.getStatus() == PeiStatus.DRAFT))
                .singleElement().extracting(PeiDocument::getTeacherId).isEqualTo(12L);
        assertThat(saved.current().orElseThrow().getId()).isEqualTo("old");
        verify(timeline, times(1)).appendOnce(any(), any(), any(), any(), any(), any(), any(), any());
        verify(audit, times(1)).recordPeiMutation(any(), any(), any(), any(), any(), anyInt(), any());
    }

    @Test void replacementCopiesContentAndKeepsVigentUntilApproval() throws Exception {
        draft.setStatus(PeiStatus.ARCHIVED);
        action("old", "revisions", VERSION).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.revision").value(8))
                .andExpect(jsonPath("$.content.generalObjectives").value("Objetivos"));
        mvc.perform(get(PATH + "/old")).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("APPROVED"));
        action("old", "revisions", VERSION).andExpect(status().isConflict());
    }

    @Test void returnedWorkCanBeSentAgainAndArchivingVigentRetainsHistory() throws Exception {
        var submitted = action("draft", "submit", VERSION).andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_REVIEW")).andReturn();
        actor(RoleName.NAPNE);
        var version = new ObjectMapper().readTree(submitted.getResponse().getContentAsString())
                .get("storageVersion").asLong();
        action("draft", "return", "{\"version\":" + version + "}").andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"));
        action("old", "archive", VERSION).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ARCHIVED"));
        mvc.perform(get(PATH + "/old")).andExpect(status().isOk()).andExpect(jsonPath("$.status").value("ARCHIVED"));
    }

    @ParameterizedTest
    @EnumSource(value = PeiStatus.class, names = {"DRAFT", "IN_REVIEW"})
    void archiveRejectsWorkThatIsNotVigent(PeiStatus status) throws Exception {
        draft.setStatus(status);
        actor(RoleName.NAPNE);
        mvc.perform(get(PATH + "/draft")).andExpect(status().isOk())
                .andExpect(jsonPath("$.allowedActions", org.hamcrest.Matchers.not(org.hamcrest.Matchers.hasItem("ARCHIVE"))));
        action("draft", "archive", VERSION).andExpect(status().isConflict());
        assertThat(mongo.store.load(1L, 2L, "2026-2").version()).isNull();
        verifyNoInteractions(timeline, audit);
    }

    @Test void linkedTeacherCanClaimUnassignedLegacyDraftByEditingButCannotSubmitItBeforeClaiming() throws Exception {
        draft.setTeacherId(null);
        mvc.perform(get(PATH + "/draft")).andExpect(status().isOk())
                .andExpect(jsonPath("$.allowedActions", org.hamcrest.Matchers.contains("EDIT")));
        action("draft", "submit", VERSION).andExpect(status().isConflict());
        verifyNoInteractions(timeline, audit);

        var edited = update("draft", "{\"version\":0,\"content\":{}}").andExpect(status().isOk())
                .andExpect(jsonPath("$.teacherId").value(9)).andReturn();
        var revision = new ObjectMapper().readTree(edited.getResponse().getContentAsString());
        action(revision.get("id").asText(), "submit", "{\"version\":" + revision.get("storageVersion").asLong() + "}")
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("IN_REVIEW"));
        assertThat(draft.getTeacherId()).isNull();
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "generalObjectives|{}",
            "generalObjectives|1",
            "generalObjectives|[\"Objetivo\"]",
            "generalObjectives|\"  \"",
            "specificObjectives|{}",
            "specificObjectives|[]",
            "contents|1",
            "teachingStrategies|[\"  \"]",
            "assessmentCriteria|[\"Critério\",3]",
            "assessmentInstruments|\"Instrumento\""
    })
    void invalidRequiredApprovalContentIsRejectedWithoutEffects(String field, String jsonValue) throws Exception {
        draft.setStatus(PeiStatus.IN_REVIEW);
        var content = new LinkedHashMap<>(draft.getContent());
        content.put(field, new ObjectMapper().readValue(jsonValue, Object.class));
        draft.setContent(content);
        actor(RoleName.NAPNE);

        action("draft", "approve", VERSION).andExpect(status().isBadRequest());

        var untouched = mongo.store.load(1L, 2L, "2026-2");
        assertThat(untouched.version()).isNull();
        assertThat(untouched.current().orElseThrow().getId()).isEqualTo("old");
        assertThat(untouched.find("draft").orElseThrow().getStatus()).isEqualTo(PeiStatus.IN_REVIEW);
        verifyNoInteractions(timeline, audit);
    }

    @Test void approvedLegacyStrategyMapIsRemovedFromReadsAndReplacementWithoutMutatingRawLegacy() throws Exception {
        draft.setStatus(PeiStatus.ARCHIVED);
        var raw = Map.of("methodological", "  Rotina visual\n\n Dividir em etapas ", "notes", "RESTRITO",
                "referrals", "ENCAMINHAMENTO-RESTRITO");
        var content = new LinkedHashMap<>(approved.getContent());
        content.put("teachingStrategies", raw);
        approved.setContent(content);
        var authored = new LinkedHashMap<>(draft.getContent());
        authored.put("teachingStrategies", List.of("  Primeiro texto autorado  ", "Segundo texto"));
        draft.setContent(authored);

        mvc.perform(get(PATH + "/old")).andExpect(status().isOk())
                .andExpect(jsonPath("$.content.teachingStrategies").doesNotExist());
        mvc.perform(get(PATH + "/draft")).andExpect(status().isOk())
                .andExpect(jsonPath("$.content.teachingStrategies", org.hamcrest.Matchers.contains("  Primeiro texto autorado  ", "Segundo texto")));
        action("old", "revisions", VERSION).andExpect(status().isOk())
                .andExpect(jsonPath("$.content.teachingStrategies").doesNotExist());

        assertThat(approved.getContent().get("teachingStrategies")).isEqualTo(raw);
        verify(legacy, never()).save(any());
    }

    @Test void twoFirstDraftsRaceForOneSeriesAndOnlyWinnerEmitsEffects() throws Exception {
        var course = Course.builder().id(4L).name("Curso fictício").build();
        when(access.requireView(1L)).thenReturn(Student.builder().id(1L).course(course).civilName("Pessoa fictícia").build());
        when(subjects.findByIdForUpdate(2L)).thenReturn(Optional.of(Subject.builder().id(2L).course(course).build()));
        when(catalog.academicTerm(5L, null)).thenReturn(ReferenceEntry.builder().id(5L).code("2026-1").label("Primeiro").build());

        race(() -> mvc.perform(post(PATH).contentType(MediaType.APPLICATION_JSON)
                .content("{\"subjectId\":2,\"academicTermId\":5}")).andReturn().getResponse().getStatus());

        var saved = mongo.store.load(1L, 2L, "2026-1");
        assertThat(saved.revisions()).singleElement().satisfies(plan -> {
            assertThat(plan.getStatus()).isEqualTo(PeiStatus.DRAFT);
            assertThat(plan.getRevision()).isEqualTo(1);
        });
        verify(timeline, times(1)).appendOnce(any(), any(), any(), any(), any(), any(), any(), any());
        verify(audit, times(1)).recordPeiMutation(any(), any(), any(), any(), any(), anyInt(), any());
    }

    @Test void concurrentApprovalsKeepOneVigentAndOneSuccessEvent() throws Exception {
        draft.setStatus(PeiStatus.IN_REVIEW);
        var imported = mongo.store.load(1L, 2L, "2026-2");
        mongo.seed(imported);
        actor(RoleName.NAPNE);

        race(() -> action("draft", "approve", VERSION).andReturn().getResponse().getStatus());

        var saved = mongo.store.load(1L, 2L, "2026-2");
        assertThat(saved.revisions()).hasSize(2);
        assertThat(saved.find("old").orElseThrow().getStatus()).isEqualTo(PeiStatus.SUPERSEDED);
        assertThat(saved.current().orElseThrow().getId()).isEqualTo("draft");
        verify(timeline, times(1)).appendOnce(any(), any(), any(), any(), any(), any(), any(), any());
        verify(audit, times(1)).recordPeiMutation(any(), any(), any(), any(), any(), anyInt(), any());
    }

    @Test void failedApprovalWriteDoesNotChangeCurrentPlanOrEmitEffects() throws Exception {
        draft.setStatus(PeiStatus.IN_REVIEW);
        var imported = mongo.store.load(1L, 2L, "2026-2");
        mongo.seed(imported);
        actor(RoleName.NAPNE);
        mongo.beforeWrite = () -> { throw new org.springframework.dao.DataAccessResourceFailureException("Falha simulada"); };

        action("draft", "approve", VERSION).andExpect(status().isInternalServerError());

        var saved = mongo.store.load(1L, 2L, "2026-2");
        assertThat(saved.current().orElseThrow().getId()).isEqualTo("old");
        assertThat(saved.find("draft").orElseThrow().getStatus()).isEqualTo(PeiStatus.IN_REVIEW);
        verifyNoInteractions(timeline, audit);
    }

    @Test void legacyCollisionsPreserveIdsAndUseHighestRevisionThenHighestIdInEachSlot() throws Exception {
        var otherVigent = plan("a", 3, PeiStatus.APPROVED);
        var otherWork = plan("earlier", 6, PeiStatus.IN_REVIEW);
        var records = List.of(otherVigent, otherWork, approved, draft);
        when(legacy.findByStudentIdAndSubjectIdAndAcademicTermOrderByRevisionDesc(1L, 2L, "2026-2")).thenReturn(records);
        when(legacy.findByStudentIdOrderByUpdatedAtDesc(1L)).thenReturn(records);

        mvc.perform(get(PATH)).andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(4));
        action("draft", "submit", VERSION).andExpect(status().isOk());

        var saved = mongo.store.load(1L, 2L, "2026-2");
        assertThat(saved.revisions()).extracting(PeiDocument::getId).containsExactlyInAnyOrder("old", "a", "draft", "earlier");
        assertThat(saved.current().orElseThrow().getId()).isEqualTo("old");
        assertThat(saved.find("a").orElseThrow().getStatus()).isEqualTo(PeiStatus.SUPERSEDED);
        assertThat(saved.find("earlier").orElseThrow().getStatus()).isEqualTo(PeiStatus.SUPERSEDED);
        assertThat(otherVigent.getStatus()).isEqualTo(PeiStatus.APPROVED);
        assertThat(otherWork.getStatus()).isEqualTo(PeiStatus.IN_REVIEW);
        mvc.perform(get(PATH)).andExpect(status().isOk()).andExpect(jsonPath("$.length()").value(4));
        verify(legacy, never()).save(any());
    }

    private void race(Callable<Integer> call) throws Exception {
        var barrier = new CyclicBarrier(2);
        mongo.beforeWrite = () -> {
            try {
                barrier.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new AssertionError(exception);
            } catch (java.util.concurrent.BrokenBarrierException | java.util.concurrent.TimeoutException exception) {
                throw new AssertionError(exception);
            }
        };
        try (var threads = Executors.newFixedThreadPool(2)) {
            var first = threads.submit(call);
            var second = threads.submit(call);
            assertThat(List.of(first.get(8, TimeUnit.SECONDS), second.get(8, TimeUnit.SECONDS)))
                    .containsExactlyInAnyOrder(200, 409);
        }
        mongo.beforeWrite = () -> {};
    }

    private void actor(RoleName role) {
        actor(role, role == RoleName.TEACHER ? 9L : 10L, CAMPUS);
    }

    private void actor(RoleName role, Long id, Campus campus) {
        when(current.require()).thenReturn(UserAccount.builder().id(id).campus(campus)
                .email(role.name().toLowerCase(java.util.Locale.ROOT) + "@example.test")
                .name("Pessoa fictícia").roles(Set.of(role)).build());
    }

    private UserAccount transferFixture() {
        setUpController(new AccessGuard(current, students, assignments));
        when(students.findById(1L)).thenReturn(Optional.of(Student.builder().id(1L).campus(CAMPUS).build()));
        actor(RoleName.NAPNE, 10L, CAMPUS);
        var eligible = transferTeacher(12L, CAMPUS, true, RoleName.TEACHER);
        when(assignments.findByStudentIdAndActiveTrue(1L)).thenReturn(List.of(link(eligible, 2L, AssignmentType.TEACHER)));
        when(assignments.existsByStudentIdAndUserIdAndActiveTrue(1L, 12L)).thenReturn(true);
        when(assignments.existsByStudentIdAndUserIdAndSubjectIdAndAssignmentTypeAndActiveTrue(
                1L, 12L, 2L, AssignmentType.TEACHER)).thenReturn(true);
        return eligible;
    }

    private UserAccount transferTeacher(Long id, Campus campus, boolean active, RoleName... roles) {
        return UserAccount.builder().id(id).campus(campus).name("Docente " + id).active(active).roles(Set.of(roles)).build();
    }

    private StudentAssignment link(UserAccount teacher, Long subjectId, AssignmentType type) {
        return StudentAssignment.builder().student(Student.builder().id(1L).campus(CAMPUS).build())
                .subject(Subject.builder().id(subjectId).build()).assignmentType(type).user(teacher).build();
    }

    private ResultActions candidates() throws Exception {
        return mvc.perform(get(PATH + "/draft/transfer-candidates"));
    }

    private ResultActions transfer(String body) throws Exception {
        return action("draft", "transfer", body);
    }

    private ResultActions action(String id, String action, String body) throws Exception {
        return mvc.perform(post(PATH + "/" + id + "/" + action).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private ResultActions update(String id, String body) throws Exception {
        return mvc.perform(put(PATH + "/" + id).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private PeiDocument plan(String id, int number, PeiStatus status) {
        return PeiDocument.builder().id(id).studentId(1L).subjectId(2L).academicTerm("2026-2")
                .teacherId(9L).revision(number).status(status).createdBy("teacher@example.test").storageVersion(0L)
                .content(Map.of("generalObjectives", "Objetivos", "specificObjectives", List.of("Objetivo"),
                        "contents", List.of("Conteúdo"), "teachingStrategies", List.of("Estratégia"),
                        "assessmentCriteria", List.of("Critério"), "assessmentInstruments", List.of("Instrumento"),
                        "skillsInventory", Map.of("oralCommunication", "NAO_OBSERVADO", "readingAndWriting", "NAO_OBSERVADO",
                                "logicalMathematicalReasoning", "NAO_OBSERVADO", "socioemotionalSkills", "NAO_OBSERVADO",
                                "functionalAutonomy", "NAO_OBSERVADO", "digitalTechnologies", "NAO_OBSERVADO"))).build();
    }
}
