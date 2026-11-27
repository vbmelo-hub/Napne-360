package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.casework.NapneCase;
import br.edu.ifac.napne360.casework.NapneCaseRepository;
import br.edu.ifac.napne360.common.ApiExceptionHandler;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.identity.Course;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.Subject;
import br.edu.ifac.napne360.identity.SubjectRepository;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.identity.UserAccountRepository;
import br.edu.ifac.napne360.identity.UserEmailHistoryService;
import br.edu.ifac.napne360.security.AccessGuard;
import br.edu.ifac.napne360.security.CurrentUserService;
import br.edu.ifac.napne360.student.Student;
import br.edu.ifac.napne360.timeline.MutationProjection;
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
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

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
    @Mock DocumentMutationOutbox projections;
    @Mock AccessGuard access;
    @Mock NapneCaseRepository cases;
    @Mock DocumentTemplateRepository templates;
    @Mock SubjectRepository subjects;
    @Mock PlatformTransactionManager transactionManager;
    @Mock UserEmailHistoryService emailHistory;
    @Mock UserAccountRepository users;
    private final ObjectMapper json = Jackson2ObjectMapperBuilder.json().build();
    private CareRecordService service;
    private MockMvc mvc;
    private UserAccount user;
    private CareRecordDocument record;

    @BeforeEach
    void setUp() {
        lenient().when(transactionManager.getTransaction(any())).thenAnswer(call -> new SimpleTransactionStatus());
        service = new CareRecordService(records, currentUser, projections, access, cases,
                templates, subjects, new TransactionTemplate(transactionManager), emailHistory, users);
        mvc = MockMvcBuilders.standaloneSetup(new CareRecordController(service, access))
                .setControllerAdvice(new ApiExceptionHandler())
                .setMessageConverters(new MappingJackson2HttpMessageConverter(json)).build();
        user = UserAccount.builder().id(5L).name("Docente de teste").email("autor@example.test")
                .roles(Set.of(RoleName.TEACHER)).build();
        lenient().when(currentUser.require()).thenReturn(user);
        lenient().when(users.findByIdForUpdate(5L)).thenReturn(Optional.of(user));
        lenient().when(emailHistory.previouslyOwnedAddresses(user)).thenReturn(Set.of("autor@example.test"));
        lenient().when(subjects.findByIdForUpdate(2L)).thenReturn(Optional.of(Subject.builder().id(2L)
                .course(Course.builder().id(1L).build()).build()));
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
                () -> verifyNoInteractions(projections));
    }

    @Test
    void persistedRecordWithoutStoredVersionStillRejectsMissingClientVersion() throws Exception {
        allowUpdate();
        record.setVersion(null);
        ObjectNode payload = payload();
        payload.remove("version");
        JsonNode before = json.valueToTree(record);

        var response = mvc.perform(put("/api/v1/students/1/records/r1")
                .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(payload))).andReturn();

        assertAll(
                () -> assertThat(response.getResponse().getStatus()).isEqualTo(409),
                () -> assertThat(json.<JsonNode>valueToTree(record)).isEqualTo(before),
                () -> verify(records, never()).save(any()),
                () -> verifyNoInteractions(projections));
    }

    @ParameterizedTest
    @CsvSource({"TEACHER,TEACHER_FEEDBACK", "TUTOR,TUTOR_OBSERVATION", "NAPNE,CASE_STUDY"})
    void currentVersionPreservesPreviousRevisionAndImmutableFields(RoleName role, CareRecordType type) throws Exception {
        user.setRoles(Set.of(role));
        record.setType(type);
        record.setCaseId(7L);
        allowUpdate();
        Instant beforeUpdate = Instant.now();
        ObjectNode payload = payload();
        payload.put("caseId", 7L);
        payload.put("type", type.name());

        CareRecordDocument result = service.update(1L, "r1", request(payload), null, null);

        assertThat(result.getTitle()).isEqualTo("Título revisado");
        assertThat(result.getStatus()).isEqualTo(RecordStatus.ACTIVE);
        assertThat(result.getContent()).containsExactlyInAnyOrderEntriesOf(Map.of("notes", "Texto revisado", "extra", Map.of("flag", true)));
        assertThat(result.getStudentId()).isEqualTo(1L);
        assertThat(result.getCaseId()).isEqualTo(role == RoleName.NAPNE ? 7L : null);
        assertThat(record.getCaseId()).isEqualTo(7L);
        assertThat(result.getSubjectId()).isEqualTo(2L);
        assertThat(result.getType()).isEqualTo(type);
        assertThat(result.getCreatedBy()).isEqualTo("autor@example.test");
        assertThat(result.getCreatedAt()).isEqualTo(Instant.parse("2026-11-01T10:00:00Z"));
        assertThat(result.getUpdatedBy()).isEqualTo(user.getEmail());
        assertThat(result.getUpdatedAt()).isAfterOrEqualTo(beforeUpdate);
        assertThat(result.getVersion()).isEqualTo(5L);
        assertThat(result.getHistory()).containsExactly(
                new CareRecordDocument.Revision(3L, "Versão mais antiga", RecordStatus.DRAFT,
                        Map.of("notes", "Texto inicial"), "autor@example.test", Instant.parse("2026-11-01T10:00:00Z")),
                new CareRecordDocument.Revision(4L, "Rascunho anterior", RecordStatus.DRAFT,
                        Map.of("notes", "Texto anterior", "extra", Map.of("flag", true)),
                        "revisor@example.test", Instant.parse("2026-11-02T11:00:00Z")));
        var event = ArgumentCaptor.forClass(MutationProjection.class);
        verify(projections).update(eq("r1"), eq(4L), any(), event.capture(), eq(CareRecordDocument.class));
        assertThat(event.getValue().action()).isEqualTo("UPDATE");
        assertThat(event.getValue().resourceId()).isEqualTo("r1");
        assertThat(event.getValue().details()).isEqualTo(type.name());
    }

    // Losing the append or widening restricted records to PEDAGOGICAL must fail this contract.
    @ParameterizedTest
    @EnumSource(CareRecordType.class)
    void successfulUpdateEmitsOnlyScopedMetadataWithCreationVisibility(CareRecordType type) throws Exception {
        user.setRoles(Set.of(RoleName.NAPNE));
        record.setType(type);
        allowUpdate();
        ObjectNode payload = payload();
        payload.put("type", type.name());

        service.update(1L, "r1", request(payload), null, null);

        var event = ArgumentCaptor.forClass(MutationProjection.class);
        verify(projections).enqueue(anyString(), eq(CareRecordDocument.class), event.capture());
        assertThat(event.getValue().studentId()).isEqualTo(1L);
        assertThat(event.getValue().eventType()).isEqualTo("CARE_RECORD_UPDATED");
        assertThat(event.getValue().actorName()).isEqualTo("Docente de teste");
        assertThat(event.getValue().title()).isEqualTo("Registro de acompanhamento atualizado");
        TimelineVisibility expected = switch (type) {
            case PEDAGOGICAL_GUIDANCE, ACTION_PLAN, TEACHER_FEEDBACK, TUTOR_OBSERVATION -> TimelineVisibility.PEDAGOGICAL;
            default -> TimelineVisibility.RESTRICTED;
        };
        assertThat(event.getValue().visibility()).isEqualTo(expected);
        assertThat(event.getValue().data()).containsExactlyInAnyOrderEntriesOf(
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
        ObjectNode payload = payload();
        payload.put("type", "CASE_STUDY");
        payload.putNull("subjectId");

        service.update(1L, "r1", request(payload), null, null);

        var event = ArgumentCaptor.forClass(MutationProjection.class);
        verify(projections).enqueue(anyString(), eq(CareRecordDocument.class), event.capture());
        assertThat(event.getValue().data()).containsExactlyInAnyOrderEntriesOf(Map.of("recordId", "r1", "type", "CASE_STUDY"));
        assertThat(event.getValue().visibility()).isEqualTo(TimelineVisibility.RESTRICTED);
        assertThat(record.getCreatedBy()).isEqualTo("outro@example.test");
    }

    @ParameterizedTest
    @ValueSource(longs = {7L, 99L})
    void anotherAuthorGetsForbiddenWhetherCaseIdMatchesOrNot(long caseId) throws Exception {
        when(records.findById("r1")).thenReturn(Optional.of(record));
        lenient().when(access.canWritePedagogical(1L)).thenReturn(true);
        lenient().when(access.canViewSubject(1L, 2L)).thenReturn(true);
        lenient().when(access.canTeachPei(1L, 2L)).thenReturn(true);
        record.setCreatedBy("outro@example.test");
        record.setCaseId(7L);
        var before = json.<JsonNode>valueToTree(record);
        mvc.perform(put("/api/v1/students/1/records/r1").contentType(MediaType.APPLICATION_JSON)
                        .content(payload().put("caseId", caseId).toString()))
                .andExpect(status().isForbidden());
        assertThat(json.<JsonNode>valueToTree(record)).isEqualTo(before);
        verify(records, never()).save(any());
        verifyNoInteractions(projections);
    }

    @Test
    void anotherStudentCannotBeRevisedBeforeMutation() throws Exception {
        when(records.findById("r1")).thenReturn(Optional.of(record));
        assertRejectedUnchanged(NotFoundException.class, 99L, payload());
    }

    @ParameterizedTest
    @ValueSource(strings = {"type", "caseId", "subjectId"})
    void linksCannotBeChangedBeforeMutation(String field) throws Exception {
        if (field.equals("caseId")) allowUpdate();
        else when(records.findById("r1")).thenReturn(Optional.of(record));
        ObjectNode payload = payload();
        if (field.equals("type")) payload.put(field, "TUTOR_OBSERVATION");
        else payload.put(field, 99L);
        assertRejectedUnchanged(IllegalArgumentException.class, 1L, payload);
    }

    @Test
    void revokedSubjectCannotBeRevisedBeforeMutation() throws Exception {
        when(records.findById("r1")).thenReturn(Optional.of(record));
        when(access.canWritePedagogical(1L)).thenReturn(true);
        assertRejectedUnchanged(AccessDeniedException.class, 1L, payload().put("caseId", 99L));
    }

    @Test
    void fractionalCaseIdCannotBeTruncatedToExistingLinkOnUpdate() throws Exception {
        record.setCaseId(7L);
        lenient().when(records.findById("r1")).thenReturn(Optional.of(record));
        lenient().when(access.canWritePedagogical(1L)).thenReturn(true);
        lenient().when(access.canViewSubject(1L, 2L)).thenReturn(true);
        lenient().when(access.canTeachPei(1L, 2L)).thenReturn(true);
        var before = json.<JsonNode>valueToTree(record);

        mvc.perform(put("/api/v1/students/1/records/r1").contentType(MediaType.APPLICATION_JSON)
                        .content(payload().put("caseId", 7.5).toString()))
                .andExpect(status().isBadRequest());
        assertThat(json.<JsonNode>valueToTree(record)).isEqualTo(before);
        verifyNoInteractions(currentUser, records, cases, projections);
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
        doThrow(new OptimisticLockingFailureException("Concurrent update")).when(projections)
                .update(eq("r1"), eq(4L), any(), any(), eq(CareRecordDocument.class));

        mvc.perform(put("/api/v1/students/1/records/r1").contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsBytes(payload())))
                .andExpect(status().isConflict());

        verify(projections, never()).enqueue(any(), any(), any());
    }

    @Test
    void existingCreationPayloadNeedsNoVersionAndKeepsDraftAndTemplateDefaults() throws Exception {
        when(access.canWritePedagogical(1L)).thenReturn(true);
        when(access.canViewSubject(1L, 2L)).thenReturn(true);
        lenient().when(access.canTeachPei(1L, 2L)).thenReturn(true);
        when(templates.findByDocumentTypeAndActiveTrueOrderByUpdatedAtDesc("TEACHER_FEEDBACK"))
                .thenReturn(List.of(DocumentTemplate.builder().defaults(Map.of("fromTemplate", true, "notes", "Padrão")).build()));
        when(records.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
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
                .andExpect(jsonPath("$.createdBy").value("autor@example.test"))
                .andExpect(jsonPath("$.pendingProjections").doesNotExist());
        var event = ArgumentCaptor.forClass(MutationProjection.class);
        verify(projections).enqueue(anyString(), eq(CareRecordDocument.class), event.capture());
        assertThat(event.getValue().eventType()).isEqualTo("CARE_RECORD_CREATED");
        assertThat(event.getValue().visibility()).isEqualTo(TimelineVisibility.PEDAGOGICAL);
        assertThat(event.getValue().data()).containsExactlyInAnyOrderEntriesOf(
                Map.of("recordId", event.getValue().resourceId(), "type", "TEACHER_FEEDBACK", "subjectId", 2L));
    }

    @Test
    void napneCanCreateLinkedRecordForActiveCaseWithoutAddingCaseToTimelineEvent() {
        user.setRoles(Set.of(RoleName.NAPNE));
        Student student = Student.builder().id(1L).build();
        NapneCase activeCase = NapneCase.builder().id(7L).student(student)
                .stage(new br.edu.ifac.napne360.casework.CaseStage("CUSTOM_0123456789abcdef0123456789abcdef")).build();
        when(access.canWritePedagogical(1L)).thenReturn(true);
        when(cases.findByIdAndStudentIdForLink(7L, 1L)).thenReturn(Optional.of(activeCase));
        when(records.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        var request = new CareRecordService.CareRecordRequest(7L, null, CareRecordType.CASE_STUDY,
                RecordStatus.ACTIVE, "Encaminhamento", Map.of("notes", "nota"), null);

        CareRecordDocument created = service.create(1L, request, null, null);

        assertThat(created.getCaseId()).isEqualTo(7L);
        verify(cases).findByIdAndStudentIdForLink(7L, 1L);
        verify(cases, never()).findById(7L);
        var event = ArgumentCaptor.forClass(MutationProjection.class);
        verify(projections).enqueue(anyString(), eq(CareRecordDocument.class), event.capture());
        assertThat(event.getValue().data()).doesNotContainKey("caseId");
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing", "other-student", "closed", "archived"})
    void creationRejectsInvalidOrTerminalLinkedCaseBeforeAnyWrite(String scenario) {
        user.setRoles(Set.of(RoleName.NAPNE));
        when(access.canWritePedagogical(1L)).thenReturn(true);
        if (!scenario.equals("missing")) {
            Long owner = scenario.equals("other-student") ? 2L : 1L;
            var stage = switch (scenario) {
                case "closed" -> br.edu.ifac.napne360.casework.CaseStage.CLOSED;
                case "archived" -> br.edu.ifac.napne360.casework.CaseStage.ARCHIVED;
                default -> br.edu.ifac.napne360.casework.CaseStage.RECEIVED;
            };
            if (owner.equals(1L)) when(cases.findByIdAndStudentIdForLink(7L, 1L)).thenReturn(Optional.of(NapneCase.builder().id(7L)
                    .student(Student.builder().id(owner).build()).stage(stage).build()));
        }
        var request = new CareRecordService.CareRecordRequest(7L, null, CareRecordType.CASE_STUDY,
                RecordStatus.ACTIVE, "Encaminhamento", Map.of(), null);

        assertThatThrownBy(() -> service.create(1L, request, null, null)).isInstanceOf(IllegalArgumentException.class);

        verify(records, never()).save(any());
        verify(cases).findByIdAndStudentIdForLink(7L, 1L);
        verifyNoInteractions(projections);
    }

    @Test
    void nonNapneCannotCreateLinkedRecord() {
        user.setRoles(Set.of(RoleName.COTEP));
        when(access.canWritePedagogical(1L)).thenReturn(true);
        var request = new CareRecordService.CareRecordRequest(7L, null, CareRecordType.PEDAGOGICAL_GUIDANCE,
                RecordStatus.ACTIVE, "Encaminhamento", Map.of(), null);

        assertThatThrownBy(() -> service.create(1L, request, null, null)).isInstanceOf(AccessDeniedException.class);

        verify(records, never()).save(any());
        verify(cases, never()).findByIdAndStudentIdForLink(any(), any());
        verifyNoInteractions(projections);
    }

    @Test
    void nonNapneListRedactsCaseIdOnCopiesOnly() {
        record.setCaseId(7L);
        when(records.findByStudentIdOrderByCreatedAtDesc(1L)).thenReturn(List.of(record));
        when(access.canViewSubject(1L, 2L)).thenReturn(true);
        lenient().when(access.canTeachPei(1L, 2L)).thenReturn(true);

        List<CareRecordDocument> result = service.list(1L, null);

        assertThat(result).hasSize(1);
        assertThat(result.getFirst().getCaseId()).isNull();
        assertThat(record.getCaseId()).isEqualTo(7L);
        assertThat(result.getFirst()).isNotSameAs(record);
    }

    @Test
    void napneListDoesNotHidePersistedCaseLink() {
        user.setRoles(Set.of(RoleName.NAPNE));
        record.setCaseId(7L);
        record.setType(CareRecordType.CASE_STUDY);
        when(records.findByStudentIdOrderByCreatedAtDesc(1L)).thenReturn(List.of(record));

        List<CareRecordDocument> result = service.list(1L, null);

        assertThat(result).containsExactly(record);
        assertThat(result.getFirst().getCaseId()).isEqualTo(7L);
    }

    @Test
    void previousEmailKeepsDraftVisibleAndEditableByTheSameAccount() throws Exception {
        user.setEmail("novo@example.test");
        when(emailHistory.previouslyOwnedAddresses(user)).thenReturn(Set.of("autor@example.test", "novo@example.test"));
        when(records.findByStudentIdOrderByCreatedAtDesc(1L)).thenReturn(List.of(record));
        allowUpdate();

        var drafts = service.list(1L, null);
        assertThat(drafts).singleElement().satisfies(draft -> assertThat(draft.getEditable()).isTrue());

        var updated = service.update(1L, "r1", request(payload()), null, null);
        assertThat(updated.getCreatedBy()).isEqualTo("autor@example.test");
        assertThat(updated.getUpdatedBy()).isEqualTo("novo@example.test");
        assertThat(updated.getEditable()).isTrue();
    }

    @Test
    void nonNapneUpdateAcceptsRedactedNullAndReturnsRedactedCopy() throws Exception {
        record.setCaseId(7L);
        allowUpdate();
        ObjectNode payload = payload();
        payload.putNull("caseId");

        CareRecordDocument result = service.update(1L, "r1", request(payload), null, null);

        assertThat(record.getCaseId()).isEqualTo(7L);
        assertThat(result.getCaseId()).isNull();
        assertThat(result).isNotSameAs(record);
        assertThat(result.getVersion()).isEqualTo(5L);
        assertThat(result.getHistory()).hasSize(2);
    }

    private void allowUpdate() {
        when(records.findById("r1")).thenReturn(Optional.of(record));
        when(access.canWritePedagogical(1L)).thenReturn(true);
        when(access.canViewSubject(1L, 2L)).thenReturn(true);
        lenient().when(access.canTeachPei(1L, 2L)).thenReturn(true);
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
        verifyNoInteractions(projections);
    }
}
