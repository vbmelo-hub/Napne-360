package br.edu.ifac.napne360.casework;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.identity.*;
import br.edu.ifac.napne360.student.Student;
import br.edu.ifac.napne360.student.StudentRepository;
import br.edu.ifac.napne360.timeline.TimelineService;
import br.edu.ifac.napne360.timeline.TimelineVisibility;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

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
    private static final String STAGES = "/api/v1/admin/case-stages";
    private boolean seededStageConfiguration;
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

    @ParameterizedTest @ValueSource(strings = {"CLOSED", "ARCHIVED"})
    void terminalCasesRefuseTransferButAllowHistory(String state) throws Exception {
        legacy.setStage(new CaseStage(state)); legacy.setClosedAt(Instant.parse("2026-02-01T10:00:00Z")); cases.saveAndFlush(legacy);
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

    @ParameterizedTest @ValueSource(strings = {"RECEIVED", "SCREENING", "WELCOMING", "CASE_STUDY", "GUIDANCE_ISSUED",
            "ACTION_PLAN", "PEI", "FOLLOW_UP", "CLOSED", "ARCHIVED"})
    void exposesOnlyAllowedDestinationsForEveryStage(String stage) throws Exception {
        legacy.setStage(new CaseStage(stage));
        cases.saveAndFlush(legacy);
        var active = List.of("RECEIVED", "SCREENING", "WELCOMING", "CASE_STUDY", "GUIDANCE_ISSUED",
                "ACTION_PLAN", "PEI", "FOLLOW_UP", "CLOSED");
        List<String> expected = switch (stage) {
            case "CLOSED" -> List.of("SCREENING", "ARCHIVED");
            case "ARCHIVED" -> List.of();
            default -> active.stream().filter(next -> !stage.equals(next)).toList();
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
        for (var option : CaseStageCatalogue.DEFAULTS.stages()) {
            var target = option.code();
            if (target.equals(CaseStage.SCREENING) || target.equals(CaseStage.ARCHIVED)) continue;
            perform(patch(stagePath()).content(stageBody(target.code(), "Resumo alterado", 1, "Motivo fictício")), actor)
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
        for (var option : CaseStageCatalogue.DEFAULTS.stages()) {
            perform(patch(stagePath()).content(stageBody(option.code().code(), "Resumo alterado", 2, "Motivo fictício")), actor)
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

    @AfterEach void removeStageConfigurationFixture() {
        if (seededStageConfiguration) sql.update("delete from case_stage_configuration where id=1");
    }

    @Test void stageCatalogueDefaultsAreAvailableWithoutFlyway() throws Exception {
        var defaults = stageCatalogue(admin());
        assertThat(defaults.get("version").asLong()).isZero();
        assertThat(textFields(defaults.get("stages"), "code")).containsExactly("RECEIVED", "SCREENING", "WELCOMING",
                "CASE_STUDY", "GUIDANCE_ISSUED", "ACTION_PLAN", "PEI", "FOLLOW_UP", "CLOSED", "ARCHIVED");
        assertThat(textFields(defaults.get("stages"), "label")).containsExactly("Recebido", "Triagem", "Acolhimento",
                "Estudo de caso", "Orientações emitidas", "Plano de ação", "PEI", "Acompanhamento", "Encerrado", "Arquivado");
    }

    @Test void stageCatalogueIsRestrictedToAdmin() throws Exception {
        var owner = admin();
        var defaults = stageCatalogue(owner);
        perform(get(STAGES), actor).andExpect(status().isForbidden());
        perform(put(STAGES).content(defaults.toString()), actor).andExpect(status().isForbidden());
        mvc.perform(get(STAGES)).andExpect(status().isUnauthorized());
        mvc.perform(put(STAGES).contentType(MediaType.APPLICATION_JSON).content(defaults.toString()))
                .andExpect(status().isUnauthorized());
    }

    @ParameterizedTest @ValueSource(strings = {"blank", "null-label", "duplicate-label", "duplicate-code",
            "unknown-code", "missing-code", "terminal-order", "active-after-terminal", "null-entry", "null-version",
            "fractional-version", "string-version", "missing-create-code", "non-text-label"})
    void invalidStageConfigurationLeavesCatalogueUnchanged(String invalid) throws Exception {
        var owner = admin();
        var before = seedStageCatalogue(owner);
        ObjectNode request = before.deepCopy();
        var stages = (com.fasterxml.jackson.databind.node.ArrayNode) request.get("stages");
        var first = (ObjectNode) stages.get(0);
        switch (invalid) {
            case "blank" -> first.put("label", "\u00A0 \t");
            case "null-label" -> first.putNull("label");
            case "duplicate-label" -> first.put("label", "  tRIAGEM ");
            case "duplicate-code" -> stages.insert(0, first.deepCopy());
            case "unknown-code" -> first.put("code", "CUSTOM_" + "a".repeat(32));
            case "missing-code" -> stages.remove(0);
            case "terminal-order" -> stages.add(stages.remove(stages.size() - 2));
            case "active-after-terminal" -> stages.add(stages.remove(0));
            case "null-entry" -> stages.insertNull(0);
            case "null-version" -> request.putNull("version");
            case "fractional-version" -> request.put("version", 0.5);
            case "string-version" -> request.put("version", "0");
            case "missing-create-code" -> stages.insert(0, json.createObjectNode().put("label", "Visita técnica"));
            case "non-text-label" -> first.put("label", 7);
            default -> throw new AssertionError(invalid);
        }
        perform(put(STAGES).content(request.toString()), owner).andExpect(status().isBadRequest());
        assertThat(stageCatalogue(owner)).isEqualTo(before);
    }

    @Test void evenAnUnchangedSaveAdvancesTheCatalogueVersion() throws Exception {
        var owner = admin();
        var initial = seedStageCatalogue(owner);
        perform(put(STAGES).content(initial.toString()), owner).andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1));
        perform(put(STAGES).content(initial.toString()), owner).andExpect(status().isConflict());
        assertThat(stageCatalogue(owner).get("stages")).isEqualTo(initial.get("stages"));
    }

    @Test void concurrentStageConfigurationWritesRejectOneStaleVersion() throws Exception {
        var owner = admin();
        var first = seedStageCatalogue(owner);
        var second = first.deepCopy();
        stage(first, "WELCOMING").put("label", "Primeiro acolhimento");
        stage(second, "WELCOMING").put("label", "Segundo acolhimento");
        var start = new CountDownLatch(1);
        var ready = new CountDownLatch(2);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var firstResult = executor.submit(() -> sendConcurrentStageConfiguration(first, owner, ready, start));
            var secondResult = executor.submit(() -> sendConcurrentStageConfiguration(second, owner, ready, start));
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            int firstStatus = firstResult.get(15, TimeUnit.SECONDS);
            int secondStatus = secondResult.get(15, TimeUnit.SECONDS);
            assertThat(List.of(firstStatus, secondStatus)).containsExactlyInAnyOrder(200, 409);
            var saved = stageCatalogue(owner);
            assertThat(saved.get("version").asLong()).isEqualTo(1);
            assertThat(stage(saved, "WELCOMING").get("label"))
                    .isEqualTo(stage(firstStatus == 200 ? first : second, "WELCOMING").get("label"));
        }
    }

    @Test void configuredStageOrderReachesCaseDetailAndStudentCases() throws Exception {
        var owner = admin();
        var config = seedStageCatalogue(owner);
        var stages = (com.fasterxml.jackson.databind.node.ArrayNode) config.get("stages");
        stage(config, "WELCOMING").put("label", "  Acolhimento inicial  ");
        stages.insert(0, stages.remove(2));
        stages.insert(1, json.createObjectNode().putNull("code").put("label", "Visita técnica"));
        stages.insert(2, json.createObjectNode().putNull("code").put("label", "Reunião pedagógica"));
        JsonNode saved = result(perform(put(STAGES).content(config.toString()), owner)
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(saved.get("version").asLong()).isEqualTo(1);
        String visit = saved.get("stages").get(1).get("code").asText();
        String meeting = saved.get("stages").get(2).get("code").asText();
        assertThat(visit).matches("CUSTOM_[0-9a-f]{32}").isNotEqualTo(meeting);
        assertThat(meeting).matches("CUSTOM_[0-9a-f]{32}");
        assertThat(stageCatalogue(owner)).isEqualTo(saved);

        JsonNode detail = caseDetail();
        var expectedCodes = List.of("WELCOMING", visit, meeting, "SCREENING", "CASE_STUDY",
                "GUIDANCE_ISSUED", "ACTION_PLAN", "PEI", "FOLLOW_UP", "CLOSED");
        assertThat(textValues(detail.get("allowedNextStages"))).containsExactlyElementsOf(expectedCodes);
        assertThat(textFields(detail.get("stageOptions"), "code")).containsExactlyElementsOf(expectedCodes);
        assertThat(textFields(detail.get("stageOptions"), "label")).containsExactly("Acolhimento inicial", "Visita técnica",
                "Reunião pedagógica", "Triagem", "Estudo de caso", "Orientações emitidas", "Plano de ação", "PEI", "Acompanhamento", "Encerrado");

        var listed = result(perform(get("/api/v1/students/" + student.getId() + "/cases"), actor)
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).get(0);
        assertThat(listed.get("stage").asText()).isEqualTo("RECEIVED");
        assertThat(listed.get("stageLabel").asText()).isEqualTo("Recebido");
        assertThat(listed.get("stageOptions")).isEqualTo(detail.get("stageOptions"));
    }

    @Test void customStagesPersistAndHistoryRetainsTheLabelsAtEachMutation() throws Exception {
        var owner = admin();
        var config = seedStageCatalogue(owner);
        var stages = (com.fasterxml.jackson.databind.node.ArrayNode) config.get("stages");
        stage(config, "RECEIVED").put("label", "Recepção");
        stage(config, "WELCOMING").put("label", "Acolhimento inicial");
        stages.insert(2, json.createObjectNode().putNull("code").put("label", "Visita técnica"));
        var updated = result(perform(put(STAGES).content(config.toString()), owner)
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        String custom = updated.get("stages").get(2).get("code").asText();

        String createPath = "/api/v1/students/" + student.getId() + "/cases";
        var opened = result(perform(post(createPath).content("{\"source\":\"Encaminhamento\"}"), actor)
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
        assertThat(opened.get("stageLabel").asText()).isEqualTo("Recepção");
        var opening = history(opened.get("id").asLong(), 0, 20).get("content").get(0);
        assertThat(opening.get("fromStageLabel").isNull()).isTrue();
        assertThat(opening.get("toStageLabel").asText()).isEqualTo("Recepção");

        perform(patch(stagePath()).content(stageBody("WELCOMING", "Resumo reservado", 0)), actor)
                .andExpect(status().isOk()).andExpect(jsonPath("$.stageLabel").value("Acolhimento inicial"));
        perform(patch(stagePath()).content(stageBody(custom, "Resumo reservado", 1)), actor)
                .andExpect(status().isOk()).andExpect(jsonPath("$.stage").value(custom))
                .andExpect(jsonPath("$.stageLabel").value("Visita técnica"));
        assertThat(snapshot().get("STAGE")).isEqualTo(custom);

        ObjectNode rename = (ObjectNode) updated.deepCopy();
        stage(rename, custom).put("label", "Visita de acompanhamento");
        perform(put(STAGES).content(rename.toString()), owner).andExpect(status().isOk());
        assertThat(caseDetail().get("stageLabel").asText()).isEqualTo("Visita de acompanhamento");
        perform(patch(responsiblePath()).content(transferBody(candidate.getId(), "2", null)), actor)
                .andExpect(status().isOk()).andExpect(jsonPath("$.stageLabel").value("Visita de acompanhamento"));

        var entries = history(legacy.getId(), 0, 20).get("content");
        assertThat(entries.get(0).get("fromStageLabel").asText()).isEqualTo("Visita de acompanhamento");
        assertThat(entries.get(0).get("toStageLabel").asText()).isEqualTo("Visita de acompanhamento");
        assertThat(entries.get(1).get("fromStageLabel").asText()).isEqualTo("Acolhimento inicial");
        assertThat(entries.get(1).get("toStage").asText()).isEqualTo(custom);
        assertThat(entries.get(1).get("toStageLabel").asText()).isEqualTo("Visita técnica");
        assertThat(entries.get(2).get("fromStageLabel").asText()).isEqualTo("Recepção");

        perform(patch(stagePath()).content(stageBody(custom, "Resumo atualizado", 3)), actor)
                .andExpect(status().isOk()).andExpect(jsonPath("$.version").value(4));
        perform(patch(stagePath()).content(stageBody("CLOSED", "Resumo atualizado", 4)), actor)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.allowedNextStages").value(is(List.of("SCREENING", "ARCHIVED"))));
        perform(patch(stagePath()).content(stageBody(custom, "Resumo atualizado", 5, "Motivo fictício")), actor)
                .andExpect(status().isBadRequest());
        perform(patch(stagePath()).content(stageBody("SCREENING", "Resumo atualizado", 5, "Motivo fictício")), actor)
                .andExpect(status().isOk());
    }

    @Test void unknownCustomStageCannotEnterCase() throws Exception {
        var custom = "CUSTOM_" + "a".repeat(32);
        perform(patch(stagePath()).content(stageBody(custom, "Resumo reservado", 0)), actor)
                .andExpect(status().isBadRequest());
        assertThat(snapshot().get("STAGE")).isEqualTo("RECEIVED");
        assertThat(historyCount()).isZero();
    }

    @Test void legacyHistoryLabelsUseOriginalDefaultsAfterConfigurationChanges() throws Exception {
        var owner = admin();
        var config = seedStageCatalogue(owner);
        sql.update("insert into case_history(case_id,version,type,from_stage,to_stage,to_responsible_id,to_responsible,actor_id,actor,occurred_at)"
                        + " values (?,0,'STAGE_CHANGED','RECEIVED','WELCOMING',?,?,?,?,current_timestamp)",
                legacy.getId(), actor.getId(), actor.getName(), actor.getId(), actor.getName());
        stage(config, "RECEIVED").put("label", "Recepção");
        stage(config, "WELCOMING").put("label", "Acolhimento inicial");
        perform(put(STAGES).content(config.toString()), owner).andExpect(status().isOk());
        assertThat(caseDetail().get("stageLabel").asText()).isEqualTo("Recepção");
        var entry = history(legacy.getId(), 0, 20).get("content").get(0);
        assertThat(entry.get("fromStageLabel").asText()).isEqualTo("Recebido");
        assertThat(entry.get("toStageLabel").asText()).isEqualTo("Acolhimento");
    }

    private UserAccount admin() { return account("Administrador fictício", null, true, Set.of(RoleName.ADMIN)); }

    private ObjectNode stageCatalogue(UserAccount owner) throws Exception {
        return (ObjectNode) result(perform(get(STAGES), owner).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString());
    }

    private ObjectNode seedStageCatalogue(UserAccount owner) throws Exception {
        var defaults = stageCatalogue(owner);
        sql.update("insert into case_stage_configuration (id, version, stages_json) values (1, 0, ?)",
                defaults.get("stages").toString());
        seededStageConfiguration = true;
        return defaults;
    }

    private int sendConcurrentStageConfiguration(ObjectNode config, UserAccount owner,
                                                  CountDownLatch ready, CountDownLatch start) throws Exception {
        ready.countDown();
        if (!start.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("PUT concorrente não iniciado");
        return perform(put(STAGES).content(config.toString()), owner).andReturn().getResponse().getStatus();
    }

    private JsonNode caseDetail() throws Exception {
        return result(perform(get("/api/v1/cases/" + legacy.getId()), actor)
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    private static ObjectNode stage(JsonNode catalogue, String code) {
        for (var choice : catalogue.get("stages")) {
            if (choice.get("code").asText().equals(code)) return (ObjectNode) choice;
        }
        throw new AssertionError("Etapa ausente: " + code);
    }

    private static List<String> textFields(JsonNode array, String field) {
        var values = new ArrayList<String>();
        array.forEach(node -> values.add(node.get(field).asText()));
        return values;
    }

    private static List<String> textValues(JsonNode array) {
        var values = new ArrayList<String>();
        array.forEach(node -> values.add(node.asText()));
        return values;
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
