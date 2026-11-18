package br.edu.ifac.napne360.casework;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.identity.*;
import br.edu.ifac.napne360.student.Student;
import br.edu.ifac.napne360.student.StudentRepository;
import br.edu.ifac.napne360.timeline.TimelineService;
import br.edu.ifac.napne360.timeline.TimelineVisibility;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.is;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Real MVC, method security and H2 transactions; only cross-store effects are mocked. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class CaseControllerIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired CampusRepository campuses;
    @Autowired CourseRepository courses;
    @Autowired UserAccountRepository users;
    @Autowired StudentRepository students;
    @Autowired NapneCaseRepository cases;
    @Autowired JdbcTemplate sql;
    @MockitoBean TimelineService timeline;
    @MockitoBean AuditService audit;
    Campus campus;
    UserAccount actor;
    UserAccount candidate;
    Student student;
    NapneCase legacy;
    String token;

    @BeforeEach void fixtures() {
        token = UUID.randomUUID().toString();
        campus = campuses.saveAndFlush(Campus.builder().name("Campus fictício").code(token).build());
        var course = courses.saveAndFlush(Course.builder().campus(campus).name("Curso fictício").code("CURSO").build());
        actor = account("Autor da abertura", campus, true, Set.of(RoleName.NAPNE));
        candidate = account("Outro NAPNE", campus, true, Set.of(RoleName.NAPNE));
        student = students.saveAndFlush(Student.builder().campus(campus).course(course).registration(token).civilName("Pessoa fictícia").build());
        legacy = cases.saveAndFlush(NapneCase.builder().student(student).responsible(actor).source("Legado")
                .summary("Resumo reservado").openedAt(Instant.parse("2026-01-01T10:00:00Z")).build());
    }

    @ParameterizedTest @ValueSource(strings = {"{}", "{\"version\":null}", "{\"version\":1}", "{\"version\":-1}"})
    void stageRejectsMissingOrStaleVersionBeforeEffects(String version) throws Exception {
        var before = snapshot();
        var body = (com.fasterxml.jackson.databind.node.ObjectNode) json.readTree(version);
        body.put("stage", "SCREENING").put("summary", "Não persistir");
        perform(patch(stagePath()).content(body.toString()), actor).andExpect(status().isConflict());
        assertThat(snapshot()).isEqualTo(before);
        assertThat(historyCount()).isZero(); verifyNoInteractions(timeline, audit);
    }

    @ParameterizedTest @ValueSource(strings = {"1.5", "\"0\"", "true", "[]", "{}", "9223372036854775808"})
    void versionIsNeverCoercedFromNonIntegerJson(String version) throws Exception {
        perform(patch(stagePath()).content("{\"stage\":\"SCREENING\",\"version\":" + version + "}"), actor).andExpect(status().isBadRequest());
        perform(patch(responsiblePath()).content(transferBody(candidate.getId(), version, null)), actor).andExpect(status().isBadRequest());
        assertThat(snapshot().get("VERSION")).isEqualTo(0L); verifyNoInteractions(timeline, audit);
    }

    @Test void zeroVersionReturnsFlushedVersionAndSecondClientConflicts() throws Exception {
        perform(patch(stagePath()).content(stageBody("SCREENING", "Resumo", 0)), actor).andExpect(status().isOk()).andExpect(jsonPath("$.version").value(1));
        assertThat(snapshot().get("VERSION")).isEqualTo(1L);
        clearInvocations(timeline, audit);
        perform(patch(stagePath()).content(stageBody("WELCOMING", "Não persistir", 0)), actor).andExpect(status().isConflict());
        assertThat(historyCount()).isEqualTo(1); verifyNoInteractions(timeline, audit);
        perform(patch(stagePath()).content(stageBody("WELCOMING", "Resumo", 1)), actor).andExpect(status().isOk()).andExpect(jsonPath("$.version").value(2));
        verify(timeline).append(eq(student.getId()), eq("CASE_STAGE_CHANGED"), anyString(), eq(actor.getName()), eq(TimelineVisibility.RESTRICTED),
                eq(Map.of("caseId", legacy.getId(), "from", "SCREENING", "to", "WELCOMING")));
    }

    @Test void transferPreservesFieldsAndWritesSnapshotsWithoutLeakingReason() throws Exception {
        var before = snapshot();
        String secret = "Motivo restrito fictício";
        perform(patch(responsiblePath()).content(transferBody(candidate.getId(), "0", secret)), actor)
                .andExpect(status().isOk()).andExpect(jsonPath("$.responsibleId").value(candidate.getId()))
                .andExpect(jsonPath("$.version").value(1)).andExpect(jsonPath("$.summary").value("Resumo reservado"));
        var after = snapshot();
        for (String field : List.of("STAGE", "SUMMARY", "OPENED_AT", "CLOSED_AT")) assertThat(after.get(field)).isEqualTo(before.get(field));
        JsonNode entry = history(legacy.getId(), 0, 20).get("content").get(0);
        assertThat(entry.get("type").asText()).isEqualTo("RESPONSIBLE_CHANGED");
        assertThat(entry.get("version").asLong()).isEqualTo(1);
        assertThat(entry.get("caseId").asLong()).isEqualTo(legacy.getId());
        assertThat(entry.get("fromResponsibleId").asLong()).isEqualTo(actor.getId());
        assertThat(entry.get("toResponsibleId").asLong()).isEqualTo(candidate.getId());
        assertThat(entry.get("actorId").asLong()).isEqualTo(actor.getId());
        assertThat(entry.get("reason").asText()).isEqualTo(secret);
        assertThat(entry.get("occurredAt").isNull()).isFalse();
        candidate.setName("Nome alterado depois"); users.saveAndFlush(candidate);
        actor.setName("Ator alterado depois"); users.saveAndFlush(actor);
        JsonNode frozen = history(legacy.getId(), 0, 20).get("content").get(0);
        assertThat(frozen.get("fromResponsible").asText()).isEqualTo("Autor da abertura");
        assertThat(frozen.get("toResponsible").asText()).isEqualTo("Outro NAPNE");
        assertThat(frozen.get("actor").asText()).isEqualTo("Autor da abertura");
        verify(timeline).append(eq(student.getId()), eq("CASE_RESPONSIBLE_CHANGED"), anyString(), eq("Autor da abertura"), eq(TimelineVisibility.RESTRICTED),
                eq(Map.of("caseId", legacy.getId(), "fromResponsibleId", actor.getId(), "toResponsibleId", candidate.getId())));
        verify(audit).record(any(), any(), eq("UPDATE_RESPONSIBLE"), eq("NAPNE_CASE"), eq(legacy.getId()), eq("SUCCESS"), isNull());
    }

    @ParameterizedTest @ValueSource(strings = {"missing", "null", "old"})
    void transferRejectsMissingOrStaleVersionWithoutEffects(String input) throws Exception {
        String body = "{\"responsibleId\":" + candidate.getId() + (input.equals("missing") ? "" : ",\"version\":" + (input.equals("null") ? "null" : "1")) + "}";
        var before = snapshot();
        perform(patch(responsiblePath()).content(body), actor).andExpect(status().isConflict());
        assertThat(snapshot()).isEqualTo(before); assertThat(historyCount()).isZero(); verifyNoInteractions(timeline, audit);
    }

    @ParameterizedTest @ValueSource(strings = {"null", "0", "-1", "1.9", "\"1\"", "true", "[]", "{}", "9223372036854775808"})
    void invalidResponsibleIdsAre400NotCoerced(String id) throws Exception {
        perform(patch(responsiblePath()).content("{\"version\":0,\"responsibleId\":" + id + "}"), actor).andExpect(status().isBadRequest());
        assertThat(historyCount()).isZero(); verifyNoInteractions(timeline, audit);
    }

    @ParameterizedTest @ValueSource(strings = {"inactive", "otherCampus", "teacher", "noCampus", "missing"})
    void ineligibleCandidateIs400BeforeMutation(String kind) throws Exception {
        if (kind.equals("inactive")) candidate.setActive(false);
        if (kind.equals("otherCampus")) candidate.setCampus(campuses.saveAndFlush(Campus.builder().code("B-" + token).name("Outro campus").build()));
        if (kind.equals("teacher")) candidate.setRoles(Set.of(RoleName.TEACHER));
        if (kind.equals("noCampus")) candidate.setCampus(null);
        users.saveAndFlush(candidate);
        var before = snapshot();
        perform(patch(responsiblePath()).content(transferBody(kind.equals("missing") ? Long.MAX_VALUE : candidate.getId(), "0", null)), actor).andExpect(status().isBadRequest());
        assertThat(snapshot()).isEqualTo(before); assertThat(historyCount()).isZero(); verifyNoInteractions(timeline, audit);
    }

    @ParameterizedTest @EnumSource(value = CaseStage.class, names = {"CLOSED", "ARCHIVED"})
    void terminalCasesRefuseTransferButAllowHistory(CaseStage state) throws Exception {
        legacy.setStage(state); legacy.setClosedAt(Instant.parse("2026-02-01T10:00:00Z")); cases.saveAndFlush(legacy);
        var before = snapshot();
        perform(patch(responsiblePath()).content(transferBody(candidate.getId(), before.get("VERSION").toString(), null)), actor).andExpect(status().isConflict());
        assertThat(snapshot()).isEqualTo(before); history(legacy.getId(), 0, 20); verifyNoInteractions(timeline, audit);
    }

    @Test void sameResponsibleAndIdenticalStageAreNoOpsIncludingClosureDate() throws Exception {
        perform(patch(responsiblePath()).content(transferBody(actor.getId(), "0", "Não cria revisão")), actor).andExpect(status().isOk()).andExpect(jsonPath("$.version").value(0));
        perform(patch(stagePath()).content(stageBody("CLOSED", "Resumo", 0)), actor).andExpect(status().isOk());
        var closed = snapshot(); clearInvocations(timeline, audit);
        perform(patch(stagePath()).content(stageBody("CLOSED", "Resumo", 1)), actor).andExpect(status().isOk()).andExpect(jsonPath("$.version").value(1));
        assertThat(snapshot()).isEqualTo(closed); assertThat(historyCount()).isEqualTo(1); verifyNoInteractions(timeline, audit);
    }

    @ParameterizedTest @EnumSource(CaseStage.class)
    void exposesOnlyAllowedDestinationsForEveryStage(CaseStage stage) throws Exception {
        legacy.setStage(stage);
        cases.saveAndFlush(legacy);
        var active = List.of("RECEIVED", "SCREENING", "WELCOMING", "CASE_STUDY", "GUIDANCE_ISSUED",
                "ACTION_PLAN", "PEI", "FOLLOW_UP", "CLOSED");
        List<String> expected = switch (stage) {
            case CLOSED -> List.of("SCREENING", "ARCHIVED");
            case ARCHIVED -> List.of();
            default -> active.stream().filter(next -> !stage.name().equals(next)).toList();
        };
        perform(get("/api/v1/cases/" + legacy.getId()), actor).andExpect(status().isOk())
                .andExpect(jsonPath("$.allowedNextStages").value(is(expected)));
        perform(get("/api/v1/students/" + student.getId() + "/cases"), actor).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].allowedNextStages").value(is(expected)));
    }

    @Test void activeStagesCanAdvanceAndReturnButCannotArchiveDirectly() throws Exception {
        var before = snapshot();
        perform(patch(stagePath()).content(stageBody("ARCHIVED", "Resumo reservado", 0)), actor)
                .andExpect(status().isBadRequest());
        assertThat(snapshot()).isEqualTo(before);
        assertThat(historyCount()).isZero();
        verifyNoInteractions(timeline, audit);
        perform(patch(stagePath()).content(stageBody("FOLLOW_UP", "Resumo reservado", 0)), actor)
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(1));
        perform(patch(stagePath()).content(stageBody("RECEIVED", "Resumo reservado", 1)), actor)
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(2));
        assertThat(snapshot().get("STAGE")).isEqualTo("RECEIVED");
        assertThat(historyCount()).isEqualTo(2);
    }

    @Test void closesReopensAndArchivesWithClosureDateAndRestrictedHistory() throws Exception {
        closeCase();
        clearInvocations(timeline, audit);
        String reason = "R".repeat(500);
        perform(patch(stagePath()).content(stageBody("SCREENING", "Resumo reservado", 1, "  \u00A0" + reason + "\uFEFF  ")), candidate)
                .andExpect(status().isOk()).andExpect(jsonPath("$.stage").value("SCREENING"))
                .andExpect(jsonPath("$.closedAt").isEmpty()).andExpect(jsonPath("$.version").value(2))
                .andExpect(jsonPath("$.summary").value("Resumo reservado"))
                .andExpect(jsonPath("$.responsibleId").value(actor.getId()))
                .andExpect(jsonPath("$.reason").doesNotHaveJsonPath());
        assertThat(snapshot().get("CLOSED_AT")).isNull();
        JsonNode reopened = history(legacy.getId(), 0, 20).get("content").get(0);
        assertThat(reopened.get("type").asText()).isEqualTo("STAGE_CHANGED");
        assertThat(reopened.get("version").asInt()).isEqualTo(2);
        assertThat(reopened.get("fromStage").asText()).isEqualTo("CLOSED");
        assertThat(reopened.get("toStage").asText()).isEqualTo("SCREENING");
        assertThat(reopened.get("actorId").asLong()).isEqualTo(candidate.getId());
        assertThat(reopened.get("fromResponsibleId").asLong()).isEqualTo(actor.getId());
        assertThat(reopened.get("toResponsibleId").asLong()).isEqualTo(actor.getId());
        assertThat(reopened.get("reason").asText()).isEqualTo(reason);
        verify(timeline).append(eq(student.getId()), eq("CASE_STAGE_CHANGED"), anyString(), eq(candidate.getName()),
                eq(TimelineVisibility.RESTRICTED), eq(Map.of("caseId", legacy.getId(), "from", "CLOSED", "to", "SCREENING")));
        verify(audit).record(any(), any(), eq("UPDATE_STAGE"), eq("NAPNE_CASE"), eq(legacy.getId()), eq("SUCCESS"), eq("CLOSED -> SCREENING"));

        perform(patch(stagePath()).content(stageBody("CLOSED", "Resumo reservado", 2)), actor).andExpect(status().isOk());
        var closed = snapshot();
        perform(patch(stagePath()).content(stageBody("ARCHIVED", "Resumo reservado", 3, "Motivo fora da reabertura")), actor)
                .andExpect(status().isOk()).andExpect(jsonPath("$.stage").value("ARCHIVED"))
                .andExpect(jsonPath("$.version").value(4)).andExpect(jsonPath("$.allowedNextStages").isEmpty());
        var archived = snapshot();
        assertThat(archived.get("CLOSED_AT")).isNotNull().isEqualTo(closed.get("CLOSED_AT"));
        assertThat(archived.get("RESPONSIBLE_USER_ID")).isEqualTo(closed.get("RESPONSIBLE_USER_ID"));
        JsonNode archive = history(legacy.getId(), 0, 20).get("content").get(0);
        assertThat(archive.get("toStage").asText()).isEqualTo("ARCHIVED");
        assertThat(archive.get("reason").isNull()).isTrue();
        assertThat(archive.get("occurredAt").asText()).isNotBlank();
        assertThat(historyCount()).isEqualTo(4);
    }

    @ParameterizedTest @NullSource @ValueSource(strings = {"", "  \t\n", "\u00A0", "TOO_LONG"})
    void reopeningRejectsInvalidReasonsWithoutEffects(String reason) throws Exception {
        closeCase();
        var before = snapshot();
        perform(patch(stagePath()).content(stageBody("SCREENING", "Resumo reservado", 1,
                "TOO_LONG".equals(reason) ? "R".repeat(501) : reason)), actor).andExpect(status().isBadRequest());
        assertThat(snapshot()).isEqualTo(before);
        assertThat(historyCount()).isEqualTo(1);
        verifyNoInteractions(timeline, audit);
    }

    @Test void closedRejectsOtherActiveDestinationsSummaryOnlyAndUnauthorizedReopening() throws Exception {
        closeCase();
        var before = snapshot();
        var otherCampus = campuses.saveAndFlush(Campus.builder().name("Outro campus").code(token + "-2").build());
        var otherNapne = account("NAPNE de outro campus", otherCampus, true, Set.of(RoleName.NAPNE));
        for (CaseStage target : CaseStage.values()) {
            if (target == CaseStage.SCREENING || target == CaseStage.ARCHIVED) continue;
            perform(patch(stagePath()).content(stageBody(target.name(), "Resumo alterado", 1, "Motivo fictício")), actor)
                    .andExpect(status().isBadRequest());
        }
        perform(patch(stagePath()).content(stageBody("SCREENING", "Resumo reservado", 1, "Motivo fictício")), otherNapne)
                .andExpect(status().isForbidden());
        perform(patch(stagePath()).content(stageBody("SCREENING", "Resumo reservado", 0, "Motivo fictício")), actor)
                .andExpect(status().isConflict());
        assertThat(snapshot()).isEqualTo(before);
        assertThat(historyCount()).isEqualTo(1);
        verifyNoInteractions(timeline, audit);
    }

    @Test void archivedAllowsConsultationAndExactNoOpButRejectsMutations() throws Exception {
        closeCase();
        perform(patch(stagePath()).content(stageBody("ARCHIVED", "Resumo reservado", 1)), actor).andExpect(status().isOk());
        var before = snapshot();
        clearInvocations(timeline, audit);
        for (CaseStage target : CaseStage.values()) {
            perform(patch(stagePath()).content(stageBody(target.name(), "Resumo alterado", 2, "Motivo fictício")), actor)
                    .andExpect(status().isBadRequest());
        }
        perform(patch(stagePath()).content(stageBody("ARCHIVED", "Resumo reservado", 2)), actor)
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(2));
        perform(get("/api/v1/cases/" + legacy.getId()), actor).andExpect(status().isOk())
                .andExpect(jsonPath("$.stage").value("ARCHIVED"));
        assertThat(history(legacy.getId(), 0, 20).get("totalElements").asInt()).isEqualTo(2);
        assertThat(snapshot()).isEqualTo(before);
        verifyNoInteractions(timeline, audit);
    }

    private void closeCase() throws Exception {
        perform(patch(stagePath()).content(stageBody("CLOSED", "Resumo reservado", 0)), actor)
                .andExpect(status().isOk()).andExpect(jsonPath("$.closedAt").isNotEmpty());
        clearInvocations(timeline, audit);
    }

    @Test void changingOnlySummaryCreatesRevisionWithOnlyMetadataInGeneralEvent() throws Exception {
        perform(patch(stagePath()).content(stageBody("RECEIVED", "Novo resumo reservado", 0)), actor).andExpect(status().isOk()).andExpect(jsonPath("$.version").value(1));
        assertThat(history(legacy.getId(), 0, 20).get("content").get(0).get("type").asText()).isEqualTo("STAGE_CHANGED");
        verify(timeline).append(eq(student.getId()), eq("CASE_STAGE_CHANGED"), anyString(), eq(actor.getName()), eq(TimelineVisibility.RESTRICTED),
                eq(Map.of("caseId", legacy.getId(), "from", "RECEIVED", "to", "RECEIVED")));
    }

    @Test void openingKeepsCreatorAndInitialVersionWithoutBackfillingLegacy() throws Exception {
        perform(get("/api/v1/cases/" + legacy.getId()), actor).andExpect(status().isOk()).andExpect(jsonPath("$.version").value(0));
        assertThat(history(legacy.getId(), 0, 20).get("content").size()).isZero();
        JsonNode created = result(perform(post("/api/v1/students/" + student.getId() + "/cases").content("{\"source\":\"  Encaminhamento  \"}"), actor)
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(0)).andExpect(jsonPath("$.responsibleId").value(actor.getId()))
                .andReturn().getResponse().getContentAsString());
        JsonNode opened = history(created.get("id").asLong(), 0, 20).get("content").get(0);
        assertThat(opened.get("type").asText()).isEqualTo("OPENED");
        assertThat(opened.get("version").asLong()).isZero();
        assertThat(opened.get("fromStage").isNull()).isTrue();
        assertThat(opened.get("fromResponsibleId").isNull()).isTrue();
        assertThat(opened.get("toStage").asText()).isEqualTo("RECEIVED"); assertThat(historyCount()).isZero();
    }

    @Test void historyIsPaginatedDeterministicAndIsolatedBetweenCasesOfSameStudent() throws Exception {
        for (int i = 0; i < 5; i++) perform(patch(stagePath()).content(stageBody("SCREENING", "Resumo " + i, i)), actor).andExpect(status().isOk());
        JsonNode first = history(legacy.getId(), 0, 2), second = history(legacy.getId(), 1, 2), third = history(legacy.getId(), 2, 2);
        assertThat(first.get("totalElements").asInt()).isEqualTo(5); assertThat(first.get("totalPages").asInt()).isEqualTo(3);
        assertThat(first.get("number").asInt()).isZero(); assertThat(first.get("size").asInt()).isEqualTo(2);
        assertThat(first.get("content").get(0).get("version").asInt()).isEqualTo(5);
        assertThat(second.get("content").get(0).get("version").asInt()).isEqualTo(3);
        assertThat(third.get("content").get(0).get("version").asInt()).isEqualTo(1);
        var other = cases.saveAndFlush(NapneCase.builder().student(student).source("Outro caso").responsible(actor).build());
        assertThat(history(other.getId(), 0, 20).get("totalElements").asInt()).isZero();
    }

    @ParameterizedTest @ValueSource(strings = {"page=-1", "page=1.1", "page=texto", "page=2147483648", "page=2147483647&size=100", "size=0", "size=-1", "size=101", "size=1.5", "size=texto", "size="})
    void invalidPaginationIs400(String query) throws Exception {
        perform(get("/api/v1/cases/" + legacy.getId() + "/history?" + query), actor).andExpect(status().isBadRequest());
    }

    @Test void candidatesContainOnlyActiveNapneFromCasesCampusOrderedByName() throws Exception {
        account("Sem papel", campus, true, Set.of(RoleName.TEACHER)); account("Inativo", campus, false, Set.of(RoleName.NAPNE));
        account("Sem campus", null, true, Set.of(RoleName.NAPNE));
        account("Outro campus", campuses.saveAndFlush(Campus.builder().name("Outro").code("B-" + token).build()), true, Set.of(RoleName.NAPNE));
        JsonNode values = result(perform(get("/api/v1/cases/" + legacy.getId() + "/responsible-candidates"), actor).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(values.size()).isEqualTo(2); assertThat(values.get(0).get("id").asLong()).isEqualTo(actor.getId());
        assertThat(values.get(1).get("id").asLong()).isEqualTo(candidate.getId()); assertThat(values.get(0).size()).isEqualTo(2);
    }

    @ParameterizedTest @CsvSource({"ADMIN,false", "TEACHER,false", "TUTOR,false", "MANAGEMENT,false", "COTEP,false", "COURSE_COORDINATOR,false", "NAPNE,true"})
    void otherRolesAndCampusCannotReadOrMutateCases(String role, boolean otherCampus) throws Exception {
        Campus where = otherCampus ? campuses.saveAndFlush(Campus.builder().name("Outro").code("B-" + token).build()) : campus;
        var forbidden = account("Sem acesso", where, true, Set.of(RoleName.valueOf(role)));
        for (String suffix : List.of("", "/history", "/responsible-candidates"))
            perform(get("/api/v1/cases/" + legacy.getId() + suffix), forbidden).andExpect(status().isForbidden());
        perform(patch(responsiblePath()).content(transferBody(candidate.getId(), "0", null)), forbidden).andExpect(status().isForbidden());
        perform(patch(stagePath()).content(stageBody("SCREENING", null, 0)), forbidden).andExpect(status().isForbidden());
        assertThat(historyCount()).isZero(); verifyNoInteractions(timeline, audit);
    }

    @Test void reasonIsOptionalAndLimitedTo500Characters() throws Exception {
        perform(patch(responsiblePath()).content(transferBody(candidate.getId(), "0", "x".repeat(501))), actor).andExpect(status().isBadRequest());
        assertThat(historyCount()).isZero(); verifyNoInteractions(timeline, audit);
        perform(patch(responsiblePath()).content(transferBody(candidate.getId(), "0", "x".repeat(500))), actor).andExpect(status().isOk());
        perform(patch(responsiblePath()).content(transferBody(actor.getId(), "1", null)), actor).andExpect(status().isOk());
        assertThat(history(legacy.getId(), 0, 20).get("content").get(0).get("reason").isNull()).isTrue();
    }

    @Test void sqlHistoryFailureRollsBackFlushedCaseAndEmitsNoCrossStoreEffect() throws Exception {
        // Fail a real SQL history INSERT after the case UPDATE has already been flushed.
        String constraint = "test_reject_history_" + legacy.getId();
        sql.execute("alter table case_history add constraint " + constraint + " check (case_id <> " + legacy.getId() + ")");
        var before = snapshot();
        try {
            perform(patch(responsiblePath()).content(transferBody(candidate.getId(), "0", null)), actor).andExpect(status().isConflict());
            assertThat(snapshot()).isEqualTo(before);
            assertThat(historyCount()).isZero();
            verifyNoInteractions(timeline, audit);
        } finally {
            sql.execute("alter table case_history drop constraint " + constraint);
        }
    }

    @ParameterizedTest @ValueSource(strings = {"0", "-1", "1.5", "texto", "9223372036854775808"})
    void invalidCasePathIdsAre400(String id) throws Exception {
        perform(get("/api/v1/cases/" + id), actor).andExpect(status().isBadRequest());
    }

    @Test void missingCaseIs404AndAnonymousCannotUseTheNewEndpoints() throws Exception {
        perform(get("/api/v1/cases/" + Long.MAX_VALUE), actor).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/cases/" + legacy.getId())).andExpect(status().isUnauthorized());
    }

    private UserAccount account(String name, Campus where, boolean active, Set<RoleName> roles) {
        return users.saveAndFlush(UserAccount.builder().name(name).campus(where).email(UUID.randomUUID() + "@example.test")
                .passwordHash("not-used-by-test-security-context").roles(roles).active(active).build());
    }
    private ResultActions perform(MockHttpServletRequestBuilder request, UserAccount account) throws Exception {
        return mvc.perform(request.contentType(MediaType.APPLICATION_JSON).with(user(account.getEmail()).roles(account.getRoles().stream().map(Enum::name).toArray(String[]::new))));
    }
    private String stagePath() { return "/api/v1/cases/" + legacy.getId() + "/stage"; }
    private String responsiblePath() { return "/api/v1/cases/" + legacy.getId() + "/responsible"; }
    private String stageBody(String stage, String summary, long version) {
        return stageBody(stage, summary, version, null);
    }
    private String stageBody(String stage, String summary, long version, String reason) {
        var body = json.createObjectNode().put("stage", stage).put("version", version);
        if (reason != null) body.put("reason", reason);
        if (summary == null) body.putNull("summary"); else body.put("summary", summary);
        return body.toString();
    }
    private String transferBody(long id, String version, String reason) throws Exception {
        var body = json.createObjectNode().put("responsibleId", id); body.set("version", json.readTree(version));
        if (reason != null) body.put("reason", reason); return body.toString();
    }
    private JsonNode history(long id, int page, int size) throws Exception {
        return result(perform(get("/api/v1/cases/" + id + "/history?page=" + page + "&size=" + size), actor).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }
    private JsonNode result(String body) throws Exception { return json.readTree(body); }
    private Map<String, Object> snapshot() { return sql.queryForMap("select stage, summary, opened_at, closed_at, responsible_user_id, version from napne_case where id=?", legacy.getId()); }
    private long historyCount() { return sql.queryForObject("select count(*) from case_history where case_id=?", Long.class, legacy.getId()); }
}
