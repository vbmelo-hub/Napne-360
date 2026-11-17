package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.casework.NapneCase;
import br.edu.ifac.napne360.casework.NapneCaseRepository;
import br.edu.ifac.napne360.common.ApiExceptionHandler;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.security.AccessGuard;
import br.edu.ifac.napne360.security.CurrentUserService;
import br.edu.ifac.napne360.student.Student;
import br.edu.ifac.napne360.timeline.TimelineEventDocument;
import br.edu.ifac.napne360.timeline.TimelineRepository;
import br.edu.ifac.napne360.timeline.TimelineService;
import br.edu.ifac.napne360.timeline.TimelineVisibility;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.*;
import static org.junit.jupiter.api.Assertions.assertAll;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@ExtendWith(MockitoExtension.class)
class CareRecordServiceTest {
    @Mock CareRecordRepository records;
    @Mock CurrentUserService currentUser;
    @Mock AuditService audit;
    @Mock AccessGuard access;
    @Mock NapneCaseRepository cases;
    @Mock DocumentTemplateRepository templates;
    @Mock TimelineRepository events;
    private final ObjectMapper json = Jackson2ObjectMapperBuilder.json().build();
    private CareRecordService service;
    private MockMvc mvc;
    private UserAccount user;
    private CareRecordDocument record;

    @BeforeEach
    void setUp() {
        service = new CareRecordService(records, currentUser, new TimelineService(events), audit, access, cases, templates);
        mvc = MockMvcBuilders.standaloneSetup(new CareRecordController(service, access))
                .setControllerAdvice(new ApiExceptionHandler())
                .setMessageConverters(new MappingJackson2HttpMessageConverter(json)).build();
        user = UserAccount.builder().name("Docente de teste").email("autor@example.test")
                .roles(Set.of(RoleName.TEACHER)).build();
        when(currentUser.require()).thenReturn(user);
        record = CareRecordDocument.builder().id("r1").studentId(1L).subjectId(2L)
                .type(CareRecordType.TEACHER_FEEDBACK).title("Rascunho anterior")
                .content(new LinkedHashMap<>(Map.of("notes", "Texto anterior", "extra", Map.of("flag", true))))
                .createdBy(user.getEmail()).updatedBy("revisor@example.test")
                .createdAt(Instant.parse("2026-11-01T10:00:00Z"))
                .updatedAt(Instant.parse("2026-11-02T11:00:00Z")).version(4L).build();
        record.getHistory().add(new CareRecordDocument.Revision(3L, "Versão mais antiga", RecordStatus.DRAFT,
                Map.of("notes", "Texto inicial"), user.getEmail(), Instant.parse("2026-11-01T10:00:00Z")));
    }

    // Omitting the client-version check would return 200 and mutate these exact snapshots.
    @ParameterizedTest
    @ValueSource(strings = {"absent", "null", "0", "3", "5"})
    void missingOrMismatchedVersionReturns409BeforeAnyMutation(String version) throws Exception {
        allowUpdate();
        // Only the unfixed implementation reaches save; preserve its normal successful response for RED.
        lenient().when(records.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        ObjectNode payload = payload();
        if (version.equals("absent")) payload.remove("version");
        else if (version.equals("null")) payload.putNull("version");
        else payload.put("version", Long.parseLong(version));
        JsonNode before = json.valueToTree(record);

        var response = mvc.perform(put("/api/v1/students/1/records/r1")
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(payload))).andReturn();

        assertAll(
                () -> assertThat(response.getResponse().getStatus()).isEqualTo(409),
                () -> assertThat(json.<JsonNode>valueToTree(record)).isEqualTo(before),
                () -> verify(records, never()).save(any()),
                () -> verifyNoInteractions(events, audit));
    }

    @Test
    void persistedRecordWithoutStoredVersionStillRejectsMissingClientVersion() throws Exception {
        allowUpdate();
        record.setVersion(null);
        lenient().when(records.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        ObjectNode payload = payload();
        payload.remove("version");
        JsonNode before = json.valueToTree(record);

        var response = mvc.perform(put("/api/v1/students/1/records/r1")
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(payload))).andReturn();

        assertAll(
                () -> assertThat(response.getResponse().getStatus()).isEqualTo(409),
                () -> assertThat(json.<JsonNode>valueToTree(record)).isEqualTo(before),
                () -> verify(records, never()).save(any()),
                () -> verifyNoInteractions(events, audit));
    }

    @ParameterizedTest
    @CsvSource({"TEACHER,TEACHER_FEEDBACK", "TUTOR,TUTOR_OBSERVATION", "NAPNE,CASE_STUDY"})
    void currentVersionPreservesPreviousRevisionAndImmutableFields(RoleName role, CareRecordType type) throws Exception {
        user.setRoles(Set.of(role));
        record.setType(type);
        record.setCaseId(7L);
        when(cases.findById(7L)).thenReturn(Optional.of(NapneCase.builder()
                .student(Student.builder().id(1L).build()).build()));
        allowUpdate();
        when(records.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        Instant beforeUpdate = Instant.now();
        ObjectNode payload = payload();
        payload.put("caseId", 7L);
        payload.put("type", type.name());

        CareRecordDocument result = service.update(1L, "r1", request(payload), null, null);

        assertThat(result.getTitle()).isEqualTo("Título revisado");
        assertThat(result.getStatus()).isEqualTo(RecordStatus.ACTIVE);
        assertThat(result.getContent()).containsExactlyInAnyOrderEntriesOf(Map.of("notes", "Texto revisado", "extra", Map.of("flag", true)));
        assertThat(result.getStudentId()).isEqualTo(1L);
        assertThat(result.getCaseId()).isEqualTo(7L);
        assertThat(result.getSubjectId()).isEqualTo(2L);
        assertThat(result.getType()).isEqualTo(type);
        assertThat(result.getCreatedBy()).isEqualTo("autor@example.test");
        assertThat(result.getCreatedAt()).isEqualTo(Instant.parse("2026-11-01T10:00:00Z"));
        assertThat(result.getUpdatedBy()).isEqualTo(user.getEmail());
        assertThat(result.getUpdatedAt()).isAfterOrEqualTo(beforeUpdate);
        assertThat(result.getVersion()).isEqualTo(4L); // Mongo, not the service, increments @Version at save.
        assertThat(result.getHistory()).containsExactly(
                new CareRecordDocument.Revision(3L, "Versão mais antiga", RecordStatus.DRAFT,
                        Map.of("notes", "Texto inicial"), "autor@example.test", Instant.parse("2026-11-01T10:00:00Z")),
                new CareRecordDocument.Revision(4L, "Rascunho anterior", RecordStatus.DRAFT,
                        Map.of("notes", "Texto anterior", "extra", Map.of("flag", true)),
                        "revisor@example.test", Instant.parse("2026-11-02T11:00:00Z")));
        verify(records).save(record);
        verify(audit).record(null, null, "UPDATE", "CARE_RECORD", "r1", "SUCCESS", type.name());
    }

    // Losing the append or widening restricted records to PEDAGOGICAL must fail this contract.
    @ParameterizedTest
    @EnumSource(CareRecordType.class)
    void successfulUpdateEmitsOnlyScopedMetadataWithCreationVisibility(CareRecordType type) throws Exception {
        user.setRoles(Set.of(RoleName.NAPNE));
        record.setType(type);
        allowUpdate();
        when(records.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        ObjectNode payload = payload();
        payload.put("type", type.name());

        service.update(1L, "r1", request(payload), null, null);

        var event = ArgumentCaptor.forClass(TimelineEventDocument.class);
        verify(events).save(event.capture());
        assertThat(event.getValue().getStudentId()).isEqualTo(1L);
        assertThat(event.getValue().getEventType()).isEqualTo("CARE_RECORD_UPDATED");
        assertThat(event.getValue().getActor()).isEqualTo("Docente de teste");
        assertThat(event.getValue().getTitle()).isEqualTo("Registro de acompanhamento atualizado");
        TimelineVisibility expected = switch (type) {
            case PEDAGOGICAL_GUIDANCE, ACTION_PLAN, TEACHER_FEEDBACK, TUTOR_OBSERVATION -> TimelineVisibility.PEDAGOGICAL;
            default -> TimelineVisibility.RESTRICTED;
        };
        assertThat(event.getValue().getVisibility()).isEqualTo(expected);
        assertThat(event.getValue().getData()).containsExactlyInAnyOrderEntriesOf(
                Map.of("recordId", "r1", "type", type.name(), "subjectId", 2L));
    }

    @Test
    void updateWithoutSubjectOmitsSubjectMetadataAndNapneCanReviewAnotherAuthor() throws Exception {
        user.setRoles(Set.of(RoleName.NAPNE));
        record.setCreatedBy("outro@example.test");
        record.setType(CareRecordType.CASE_STUDY);
        record.setSubjectId(null);
        when(records.findById("r1")).thenReturn(Optional.of(record));
        when(access.canWritePedagogical(1L)).thenReturn(true);
        when(records.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        ObjectNode payload = payload();
        payload.put("type", "CASE_STUDY");
        payload.putNull("subjectId");

        service.update(1L, "r1", request(payload), null, null);

        var event = ArgumentCaptor.forClass(TimelineEventDocument.class);
        verify(events).save(event.capture());
        assertThat(event.getValue().getData()).containsExactlyInAnyOrderEntriesOf(Map.of("recordId", "r1", "type", "CASE_STUDY"));
        assertThat(event.getValue().getVisibility()).isEqualTo(TimelineVisibility.RESTRICTED);
        assertThat(record.getCreatedBy()).isEqualTo("outro@example.test");
    }

    @Test
    void anotherAuthorCannotReviseBeforeMutation() throws Exception {
        allowUpdate();
        record.setCreatedBy("outro@example.test");
        assertRejectedUnchanged(AccessDeniedException.class, 1L, payload());
    }

    @Test
    void anotherStudentCannotBeRevisedBeforeMutation() throws Exception {
        when(records.findById("r1")).thenReturn(Optional.of(record));
        assertRejectedUnchanged(NotFoundException.class, 99L, payload());
    }

    @ParameterizedTest
    @ValueSource(strings = {"type", "caseId", "subjectId"})
    void linksCannotBeChangedBeforeMutation(String field) throws Exception {
        when(records.findById("r1")).thenReturn(Optional.of(record));
        ObjectNode payload = payload();
        if (field.equals("type")) payload.put(field, "TUTOR_OBSERVATION");
        else payload.put(field, 99L);
        assertRejectedUnchanged(IllegalArgumentException.class, 1L, payload);
    }

    @Test
    void revokedSubjectCannotBeRevisedBeforeMutation() throws Exception {
        when(records.findById("r1")).thenReturn(Optional.of(record));
        when(access.canWritePedagogical(1L)).thenReturn(true);
        assertRejectedUnchanged(AccessDeniedException.class, 1L, payload());
    }

    @Test
    void authorWithoutCompatibleRoleCannotReviseBeforeMutation() throws Exception {
        user.setRoles(Set.of(RoleName.TUTOR));
        when(records.findById("r1")).thenReturn(Optional.of(record));
        assertRejectedUnchanged(AccessDeniedException.class, 1L, payload());
    }

    @Test
    void mongoConcurrentSaveFailureReturns409WithoutSuccessEventOrAudit() throws Exception {
        allowUpdate();
        when(records.save(any())).thenThrow(new OptimisticLockingFailureException("Concurrent update"));

        mvc.perform(put("/api/v1/students/1/records/r1").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(payload())))
                .andExpect(status().isConflict());

        verifyNoInteractions(events, audit);
    }

    @Test
    void existingCreationPayloadNeedsNoVersionAndKeepsDraftAndTemplateDefaults() throws Exception {
        when(access.canWritePedagogical(1L)).thenReturn(true);
        when(access.canViewSubject(1L, 2L)).thenReturn(true);
        when(templates.findByDocumentTypeAndActiveTrueOrderByUpdatedAtDesc("TEACHER_FEEDBACK"))
                .thenReturn(List.of(DocumentTemplate.builder().defaults(Map.of("fromTemplate", true, "notes", "Padrão")).build()));
        when(records.save(any())).thenAnswer(invocation -> {
            CareRecordDocument created = invocation.getArgument(0);
            created.setId("new-record");
            return created;
        });
        ObjectNode payload = payload();
        payload.remove("version");
        payload.remove("status");

        mvc.perform(post("/api/v1/students/1/records").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(payload)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.content.fromTemplate").value(true))
                .andExpect(jsonPath("$.content.notes").value("Texto revisado"))
                .andExpect(jsonPath("$.history").isEmpty())
                .andExpect(jsonPath("$.createdBy").value("autor@example.test"));
        var event = ArgumentCaptor.forClass(TimelineEventDocument.class);
        verify(events).save(event.capture());
        assertThat(event.getValue().getEventType()).isEqualTo("CARE_RECORD_CREATED");
        assertThat(event.getValue().getVisibility()).isEqualTo(TimelineVisibility.PEDAGOGICAL);
        assertThat(event.getValue().getData()).containsExactlyInAnyOrderEntriesOf(
                Map.of("recordId", "new-record", "type", "TEACHER_FEEDBACK", "subjectId", 2L));
    }

    private void allowUpdate() {
        when(records.findById("r1")).thenReturn(Optional.of(record));
        when(access.canWritePedagogical(1L)).thenReturn(true);
        when(access.canViewSubject(1L, 2L)).thenReturn(true);
    }

    private ObjectNode payload() {
        return json.createObjectNode().putNull("caseId").put("subjectId", 2L)
                .put("type", "TEACHER_FEEDBACK").put("status", "ACTIVE").put("title", "Título revisado")
                .put("version", 4L).set("content", json.valueToTree(Map.of("notes", "Texto revisado", "extra", Map.of("flag", true))));
    }

    private CareRecordService.CareRecordRequest request(ObjectNode payload) throws Exception {
        return json.treeToValue(payload, CareRecordService.CareRecordRequest.class);
    }

    private void assertRejectedUnchanged(Class<? extends Throwable> exception, Long studentId, ObjectNode payload) throws Exception {
        JsonNode before = json.valueToTree(record);
        CareRecordService.CareRecordRequest request = request(payload);
        assertThatThrownBy(() -> service.update(studentId, "r1", request, null, null)).isInstanceOf(exception);
        assertThat(json.<JsonNode>valueToTree(record)).isEqualTo(before);
        verify(records, never()).save(any());
        verifyNoInteractions(events, audit);
    }
}
