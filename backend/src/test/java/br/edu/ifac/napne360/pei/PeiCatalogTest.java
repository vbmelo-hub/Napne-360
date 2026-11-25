package br.edu.ifac.napne360.pei;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.common.ApiExceptionHandler;
import br.edu.ifac.napne360.document.*;
import br.edu.ifac.napne360.identity.*;
import br.edu.ifac.napne360.security.*;
import br.edu.ifac.napne360.student.*;
import br.edu.ifac.napne360.timeline.TimelineService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class PeiCatalogTest {
    final PeiRepository peis = mock(PeiRepository.class);
    final PeiMongoFixture mongo = new PeiMongoFixture(peis);
    final CareRecordService careRecords = mock(CareRecordService.class);
    final SubjectRepository subjects = mock(SubjectRepository.class);
    final CurrentUserService current = mock(CurrentUserService.class);
    final TimelineService timeline = mock(TimelineService.class);
    final AuditService audit = mock(AuditService.class);
    final AccessGuard access = mock(AccessGuard.class);
    final DocumentTemplateRepository templates = mock(DocumentTemplateRepository.class);
    final ReferenceEntryRepository entries = mock(ReferenceEntryRepository.class);
    final ObjectMapper json = Jackson2ObjectMapperBuilder.json().build();
    PeiService service;
    MockMvc mvc;
    ReferenceEntry term;

    @BeforeEach void setup() {
        service = new PeiService(new ReferenceCatalogService(entries), mongo.store, careRecords, subjects, current, timeline,
                audit, access, templates, mock(StudentAssignmentRepository.class));
        mvc = MockMvcBuilders.standaloneSetup(new PeiController(service,access)).setControllerAdvice(new ApiExceptionHandler())
                .setMessageConverters(new MappingJackson2HttpMessageConverter(json)).build();
        var course = Course.builder().id(2L).name("Curso fictício").build();
        var student = Student.builder().id(1L).civilName("Estudante fictício").course(course).build();
        when(access.requireView(1L)).thenReturn(student);
        when(access.canTeachPei(1L,3L)).thenReturn(true);
        when(subjects.findById(3L)).thenReturn(Optional.of(Subject.builder().id(3L).course(course).name("Componente fictício").build()));
        when(current.require()).thenReturn(UserAccount.builder().id(12L).name("Docente").email("docente@example.test").roles(Set.of(RoleName.TEACHER)).build());
        term = ReferenceEntry.builder().id(9L).kind(ReferenceEntry.Kind.ACADEMIC_TERM).code("2026-2").label("Segundo semestre").build();
        when(entries.findById(9L)).thenReturn(Optional.of(term));
        when(entries.findByKindAndCode(ReferenceEntry.Kind.ACADEMIC_TERM,"2026-2")).thenReturn(Optional.of(term));
    }

    @ParameterizedTest @ValueSource(strings = {"{\"academicTermId\":99,\"academicTerm\":\"2026-2\"}","{\"academicTermId\":0,\"academicTerm\":\"2026-2\"}","{\"academicTermId\":-1,\"academicTerm\":\"2026-2\"}","{\"academicTerm\":\"Texto livre\"}"})
    void unknownOrNonpositiveIdAndFreeTextAreRejectedBeforeSave(String fields) throws Exception { postRejected(fields); }

    @ParameterizedTest @ValueSource(strings={"9.5", "\"9\"", "true", "{}", "[]", "9223372036854775808"})
    void malformedIdsCannotBeCoercedToAnExistingTerm(String raw) throws Exception {
        postRejected("{\"academicTermId\":"+raw+",\"academicTerm\":\"2026-2\"}");
    }

    @ParameterizedTest @ValueSource(strings={"inactive","wrong-kind"})
    void inactiveAndWrongKindTermAreRejected(String scenario) throws Exception {
        if(scenario.equals("inactive")) term.setActive(false); else term.setKind(ReferenceEntry.Kind.NEED_CATEGORY);
        postRejected("{\"academicTermId\":9,\"academicTerm\":\"2026-2\"}");
    }

    @Test void numericIdAloneCreatesServerSnapshotsAndUsesCodeForRevisionGrouping() throws Exception {
        when(peis.findByStudentIdAndSubjectIdAndAcademicTermOrderByRevisionDesc(1L,3L,"2026-2"))
                .thenReturn(List.of(PeiDocument.builder().id("histórico").revision(2).status(PeiStatus.ARCHIVED).build()));
        mvc.perform(post("/api/v1/students/1/peis").contentType(MediaType.APPLICATION_JSON)
                .content("{\"subjectId\":3,\"academicTermId\":9,\"academicTermLabel\":\"Forjado\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.academicTermId").value(9))
                .andExpect(jsonPath("$.academicTerm").value("2026-2")).andExpect(jsonPath("$.academicTermLabel").value("Segundo semestre"))
                .andExpect(jsonPath("$.revision").value(3));
    }

    @Test void suppliedIdWinsOverClientCodeAndLabel() throws Exception {
        mvc.perform(post("/api/v1/students/1/peis").contentType(MediaType.APPLICATION_JSON)
                .content("{\"subjectId\":3,\"academicTermId\":9,\"academicTerm\":\"Forjado\",\"academicTermLabel\":\"Forjado\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.academicTerm").value("2026-2"))
                .andExpect(jsonPath("$.academicTermId").value(9)).andExpect(jsonPath("$.academicTermLabel").value("Segundo semestre"));
    }

    @Test void exactLegacyCodeGetsSnapshots() throws Exception {
        mvc.perform(post("/api/v1/students/1/peis").contentType(MediaType.APPLICATION_JSON).content("{\"subjectId\":3,\"academicTerm\":\"2026-2\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.academicTermId").value(9)).andExpect(jsonPath("$.academicTermLabel").value("Segundo semestre"));
    }

    @Test void draftUsesOnlyAdaptationsFromRecentActiveGuidanceInScope() throws Exception {
        when(careRecords.list(1L, CareRecordType.PEDAGOGICAL_GUIDANCE)).thenReturn(List.of(
                CareRecordDocument.builder().subjectId(3L).status(RecordStatus.DRAFT)
                        .content(Map.of("adaptations", "CA16-RASCUNHO")).build(),
                CareRecordDocument.builder().subjectId(4L).status(RecordStatus.ACTIVE)
                        .content(Map.of("adaptations", "CA16-OUTRO-COMPONENTE")).build(),
                CareRecordDocument.builder().subjectId(3L).status(RecordStatus.ACTIVE)
                        .content(Map.of("adaptations", "  \n")).build(),
                CareRecordDocument.builder().status(RecordStatus.ACTIVE)
                        .content(Map.of("adaptations", "CA16-ESTRATEGIA\n\nDividir tarefas em etapas",
                                "notes", "CA16-NOTA-LIVRE")).build(),
                CareRecordDocument.builder().subjectId(3L).status(RecordStatus.ACTIVE)
                        .content(Map.of("adaptations", "CA16-ORIENTACAO-ANTERIOR")).build()));

        var response = mvc.perform(post("/api/v1/students/1/peis").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"subjectId\":3,\"academicTermId\":9}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.content.teachingStrategies[0]").value("CA16-ESTRATEGIA"))
                .andExpect(jsonPath("$.content.teachingStrategies[1]").value("Dividir tarefas em etapas"))
                .andExpect(jsonPath("$.content.teachingStrategies.length()").value(2))
                .andReturn().getResponse().getContentAsString();

        assertThat(response).doesNotContain("CA16-RASCUNHO", "CA16-OUTRO-COMPONENTE",
                "CA16-ORIENTACAO-ANTERIOR", "CA16-NOTA-LIVRE");
    }

    @ParameterizedTest @ValueSource(strings={"Segundo semestre","2026-2 ","2026-2x","2026-2"})
    void legacyCodeMustMatchExactlyAndRemainActive(String code) throws Exception {
        if(code.equals("2026-2")) term.setActive(false);
        when(entries.findByKindAndCode(ReferenceEntry.Kind.ACADEMIC_TERM,code)).thenReturn(Optional.of(term));
        postRejected(json.writeValueAsString(Map.of("academicTerm",code)));
    }

    @ParameterizedTest @ValueSource(strings={"historic","legacy"})
    void revisionInheritsIdentityAndSnapshotWithoutConsultingCatalog(String scenario) throws Exception {
        var node=json.createObjectNode().put("id","p1").put("studentId",1).put("subjectId",3).put("academicTerm","código antigo").put("revision",4);
        node.put("teacherId",12);
        if(scenario.equals("historic")) node.put("academicTermId",9).put("academicTermLabel","Nome histórico");
        PeiDocument previous=json.treeToValue(node,PeiDocument.class);
        when(peis.findById("p1")).thenReturn(Optional.of(previous)); when(access.canViewSubject(1L,3L)).thenReturn(true);
        when(peis.findByStudentIdAndSubjectIdAndAcademicTermOrderByRevisionDesc(1L,3L,"código antigo"))
                .thenReturn(List.of(previous));
        clearInvocations(entries);
        mvc.perform(put("/api/v1/students/1/peis/p1").contentType(MediaType.APPLICATION_JSON)
                .content("{\"version\":0,\"content\":{\"notes\":\"Revisão\"},\"academicTermId\":99,\"academicTerm\":\"Forjado\",\"academicTermLabel\":\"Forjado\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.academicTerm").value("código antigo"))
                .andExpect(jsonPath("$.academicTermId").value(scenario.equals("historic") ? 9 : null))
                .andExpect(jsonPath("$.academicTermLabel").value(scenario.equals("historic") ? "Nome histórico" : null))
                .andExpect(jsonPath("$.revision").value(5));
        assertThat(previous.getStatus()).isEqualTo(PeiStatus.DRAFT);
        assertThat(mongo.store.find(1L, "p1").orElseThrow().find("p1").orElseThrow().getStatus())
                .isEqualTo(PeiStatus.SUPERSEDED);
        verifyNoInteractions(entries);
    }

    private void postRejected(String fields) throws Exception {
        var node=json.readTree(fields).deepCopy(); ((com.fasterxml.jackson.databind.node.ObjectNode)node).put("subjectId",3);
        mvc.perform(post("/api/v1/students/1/peis").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(node))).andExpect(status().isBadRequest());
        verify(peis,never()).save(any()); verifyNoInteractions(timeline,audit);
    }
}
