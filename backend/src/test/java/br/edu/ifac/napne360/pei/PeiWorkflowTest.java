package br.edu.ifac.napne360.pei;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.common.ApiExceptionHandler;
import br.edu.ifac.napne360.document.DocumentTemplateRepository;
import br.edu.ifac.napne360.document.CareRecordService;
import br.edu.ifac.napne360.identity.*;
import br.edu.ifac.napne360.security.AccessGuard;
import br.edu.ifac.napne360.security.CurrentUserService;
import br.edu.ifac.napne360.student.Student;
import br.edu.ifac.napne360.timeline.TimelineService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.Callable;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class PeiWorkflowTest {
    private static final String PATH = "/api/v1/students/1/peis";
    private static final String VERSION = "{\"version\":0}";
    final PeiRepository legacy = mock(PeiRepository.class);
    final PeiMongoFixture mongo = new PeiMongoFixture(legacy);
    final CurrentUserService current = mock(CurrentUserService.class);
    final AccessGuard access = mock(AccessGuard.class);
    final ReferenceCatalogService catalog = mock(ReferenceCatalogService.class);
    final SubjectRepository subjects = mock(SubjectRepository.class);
    final TimelineService timeline = mock(TimelineService.class);
    final AuditService audit = mock(AuditService.class);
    PeiDocument approved;
    PeiDocument draft;
    MockMvc mvc;

    @BeforeEach void setUp() {
        var service = new PeiService(catalog, mongo.store, mock(CareRecordService.class),
                subjects, current, timeline, audit, access, mock(DocumentTemplateRepository.class));
        mvc = MockMvcBuilders.standaloneSetup(new PeiController(service, access))
                .setControllerAdvice(new ApiExceptionHandler()).build();
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

    @Test void editingReturnsNewRevisionAndStaleRetryCannotChangeVigency() throws Exception {
        update("draft", "{\"content\":{\"notes\":\"Novo\"},\"version\":0}")
                .andExpect(status().isOk()).andExpect(jsonPath("$.revision").value(8))
                .andExpect(jsonPath("$.storageVersion").isNumber())
                .andExpect(jsonPath("$.allowedActions", containsInAnyOrder("EDIT", "SUBMIT")));
        update("draft", "{\"content\":{},\"version\":0}").andExpect(status().isConflict());
        assertThat(approved.getStatus()).isEqualTo(PeiStatus.APPROVED);
        verify(timeline, times(1)).append(any(), any(), any(), any(), any(), any());
        verify(audit, times(1)).record(any(), any(), any(), any(), any(), any(), any());
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
        verify(timeline, times(1)).append(any(), any(), any(), any(), any(), any());
        verify(audit, times(1)).record(any(), any(), any(), any(), any(), any(), any());
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
        when(subjects.findById(2L)).thenReturn(Optional.of(Subject.builder().id(2L).course(course).build()));
        when(catalog.academicTerm(5L, null)).thenReturn(ReferenceEntry.builder().id(5L).code("2026-1").label("Primeiro").build());

        race(() -> mvc.perform(post(PATH).contentType(MediaType.APPLICATION_JSON)
                .content("{\"subjectId\":2,\"academicTermId\":5}")).andReturn().getResponse().getStatus());

        var saved = mongo.store.load(1L, 2L, "2026-1");
        assertThat(saved.revisions()).singleElement().satisfies(plan -> {
            assertThat(plan.getStatus()).isEqualTo(PeiStatus.DRAFT);
            assertThat(plan.getRevision()).isEqualTo(1);
        });
        verify(timeline, times(1)).append(any(), any(), any(), any(), any(), any());
        verify(audit, times(1)).record(any(), any(), any(), any(), any(), any(), any());
    }

    @Test void concurrentApprovalsKeepOneVigentAndOneSuccessEvent() throws Exception {
        draft.setStatus(PeiStatus.IN_REVIEW);
        var imported = mongo.store.load(1L, 2L, "2026-2");
        mongo.store.save(imported, imported.revisions());
        actor(RoleName.NAPNE);

        race(() -> action("draft", "approve", VERSION).andReturn().getResponse().getStatus());

        var saved = mongo.store.load(1L, 2L, "2026-2");
        assertThat(saved.revisions()).hasSize(2);
        assertThat(saved.find("old").orElseThrow().getStatus()).isEqualTo(PeiStatus.SUPERSEDED);
        assertThat(saved.current().orElseThrow().getId()).isEqualTo("draft");
        verify(timeline, times(1)).append(any(), any(), any(), any(), any(), any());
        verify(audit, times(1)).record(any(), any(), any(), any(), any(), any(), any());
    }

    @Test void failedApprovalWriteDoesNotChangeCurrentPlanOrEmitEffects() throws Exception {
        draft.setStatus(PeiStatus.IN_REVIEW);
        var imported = mongo.store.load(1L, 2L, "2026-2");
        mongo.store.save(imported, imported.revisions());
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
        when(current.require()).thenReturn(UserAccount.builder().id(role == RoleName.TEACHER ? 9L : 10L)
                .email(role.name().toLowerCase(java.util.Locale.ROOT) + "@example.test")
                .name("Pessoa fictícia").roles(Set.of(role)).build());
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
