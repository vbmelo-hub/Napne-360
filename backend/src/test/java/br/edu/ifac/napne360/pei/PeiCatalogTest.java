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
        mvc = MockMvcBuilders.standaloneSetup(new PeiController(service,access), new PeiAnnexController()).setControllerAdvice(new ApiExceptionHandler())
                .setMessageConverters(new MappingJackson2HttpMessageConverter(json)).build();
        var course = Course.builder().id(2L).name("Curso fictício").build();
        var student = Student.builder().id(1L).civilName("Estudante fictício").course(course).build();
        when(access.requireView(1L)).thenReturn(student);
        when(access.canTeachPei(1L,3L)).thenReturn(true);
        when(subjects.findById(3L)).thenReturn(Optional.of(Subject.builder().id(3L).course(course).name("Componente fictício").workloadHours(60).build()));
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

    @Test void annexEndpointExposesTheOfficialDescriptionAndAnswerOrder() throws Exception {
        var response = mvc.perform(get("/api/v1/pei/anexo-i"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value("IFAC_76_2025"))
                .andExpect(jsonPath("$.title").value("Plano de Ensino Individualizado - PEI"))
                .andExpect(jsonPath("$.labels.teacherName").value("PROFESSOR(ES):"))
                .andExpect(jsonPath("$.inventoryGroups.length()").value(6))
                .andExpect(jsonPath("$.inventoryGroups[0].indicators[0].id").value("oralCommunication1"))
                .andExpect(jsonPath("$.inventoryGroups[5].indicators[4].id").value("digitalTechnologies5"))
                .andExpect(jsonPath("$.inventoryGroups[5].indicators[4].hasOptions").value(false))
                .andExpect(jsonPath("$.ratings[*].value").value(org.hamcrest.Matchers.contains(
                        "REALIZA_COM_AJUDA", "REALIZA_SEM_AJUDA", "NAO_REALIZA", "NAO_OBSERVADO")))
                .andReturn();
        var groups = json.readTree(response.getResponse().getContentAsString()).get("inventoryGroups");
        var indicators = new ArrayList<com.fasterxml.jackson.databind.JsonNode>();
        groups.forEach(group -> group.get("indicators").forEach(indicators::add));
        assertThat(indicators).hasSize(29);
        assertThat(indicators.stream().filter(value -> !value.get("hasOptions").asBoolean()))
                .singleElement().satisfies(value -> assertThat(value.get("id").asText()).isEqualTo("digitalTechnologies5"));
    }

    @Test void officialDraftUsesServerIdentificationAndPreparesOnlyAnswerableIndicators() throws Exception {
        mvc.perform(post("/api/v1/students/1/peis").contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"subjectId":3,"academicTermId":9,"formVersion":"forjado",
                         "content":{"student":"forjado","teacherName":"forjado"}}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.formVersion").value("IFAC_76_2025"))
                .andExpect(jsonPath("$.content.student").value("Estudante fictício"))
                .andExpect(jsonPath("$.content.course").value("Curso fictício"))
                .andExpect(jsonPath("$.content.subject").value("Componente fictício"))
                .andExpect(jsonPath("$.content.workloadHours").value(60))
                .andExpect(jsonPath("$.content.teacherName").value("Docente"))
                .andExpect(jsonPath("$.content.skillsInventory.length()").value(28))
                .andExpect(jsonPath("$.content.skillsInventory.digitalTechnologies4").value("NAO_OBSERVADO"))
                .andExpect(jsonPath("$.content.skillsInventory.digitalTechnologies5").doesNotHaveJsonPath())
                .andExpect(jsonPath("$.content.observations").value(""))
                .andExpect(jsonPath("$.content.location").value(""))
                .andExpect(jsonPath("$.content.documentDate").value(""));
    }

    @Test void officialDraftReusesInstitutionalTemplateTextWithoutFabricatingHoursOrRatings() throws Exception {
        var defaults = Map.of("contents", List.of("Atividade institucional"),
                "assessmentInstruments", List.of("Relato oral"),
                "basicBibliography", List.of("Referência institucional fictícia"),
                "skillsInventory", Map.of("oralCommunication", "REALIZA_COM_AJUDA"),
                "teacherName", "Docente do exemplo");
        when(templates.findByDocumentTypeAndActiveTrueOrderByUpdatedAtDesc("PEI"))
                .thenReturn(List.of(DocumentTemplate.builder().defaults(defaults).build()));

        mvc.perform(post("/api/v1/students/1/peis").contentType(MediaType.APPLICATION_JSON)
                .content("{\"subjectId\":3,\"academicTermId\":9}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.contents[0].description").value("Atividade institucional"))
                .andExpect(jsonPath("$.content.contents[0].workloadHours").hasJsonPath())
                .andExpect(jsonPath("$.content.contents[0].workloadHours").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.content.contents[0].priority").value(false))
                .andExpect(jsonPath("$.content.assessmentInstruments[0].description").value("Relato oral"))
                .andExpect(jsonPath("$.content.assessmentInstruments[0].justification").value(""))
                .andExpect(jsonPath("$.content.basicBibliography[0].title").value("Referência institucional fictícia"))
                .andExpect(jsonPath("$.content.basicBibliography[0].author").value(""))
                .andExpect(jsonPath("$.content.skillsInventory.oralCommunication1").value("NAO_OBSERVADO"))
                .andExpect(jsonPath("$.content.skillsInventory.oralCommunication").doesNotHaveJsonPath())
                .andExpect(jsonPath("$.content.teacherName").value("Docente"));
    }

    @Test void officialSaveProtectsIdentificationAndRetainsStructuredContent() throws Exception {
        var created = mvc.perform(post("/api/v1/students/1/peis").contentType(MediaType.APPLICATION_JSON)
                .content("{\"subjectId\":3,\"academicTermId\":9}"))
                .andExpect(status().isOk()).andReturn();
        var id = json.readTree(created.getResponse().getContentAsString()).get("id").asText();

        var saved = mvc.perform(put("/api/v1/students/1/peis/" + id).contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"version":0,"teacherId":98,"academicTerm":"forjado","formVersion":"forjado",
                         "content":{"student":"forjado","course":"forjado","subject":"forjado","workloadHours":8,
                           "teacherName":"forjado","contents":[{"description":"Atividade prática","workloadHours":2.5,"priority":true}],
                           "assessmentInstruments":[{"description":"Relato oral","justification":"Permite explicar as etapas"}],
                           "basicBibliography":[{"title":"Título fictício","author":"Autoria fictícia","edition":"2","location":"Rio Branco","publisher":"Editora fictícia","year":"2020","lt":"Livre"}],
                           "documentDate":"2026-11-25","observations":"Texto fictício","location":"Rio Branco","reviewWarning":"forjado"}}
                        """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.formVersion").value("IFAC_76_2025"))
                .andExpect(jsonPath("$.teacherId").value(12))
                .andExpect(jsonPath("$.academicTerm").value("2026-2"))
                .andExpect(jsonPath("$.content.student").value("Estudante fictício"))
                .andExpect(jsonPath("$.content.course").value("Curso fictício"))
                .andExpect(jsonPath("$.content.subject").value("Componente fictício"))
                .andExpect(jsonPath("$.content.workloadHours").value(60))
                .andExpect(jsonPath("$.content.teacherName").value("Docente"))
                .andExpect(jsonPath("$.content.contents[0].workloadHours").value(2.5))
                .andExpect(jsonPath("$.content.contents[0].priority").value(true))
                .andExpect(jsonPath("$.content.assessmentInstruments[0].justification").value("Permite explicar as etapas"))
                .andExpect(jsonPath("$.content.basicBibliography[0].lt").value("Livre"))
                .andExpect(jsonPath("$.content.documentDate").value("2026-11-25"))
                .andExpect(jsonPath("$.content.reviewWarning").value(org.hamcrest.Matchers.startsWith("Rascunho de apoio.")))
                .andReturn();

        var savedId = json.readTree(saved.getResponse().getContentAsString()).get("id").asText();
        var series = mongo.store.load(1L, 3L, "2026-2");
        assertThat(series.find(id).orElseThrow().getContent().get("contents")).isEqualTo(List.of());
        assertThat(series.find(savedId).orElseThrow().getContent().get("observations")).isEqualTo("Texto fictício");
    }

    @ParameterizedTest @ValueSource(strings = {"2026-02-30", "25/11/2026", "+12026-11-25"})
    void officialDraftRejectsInvalidCalendarDateWithoutCreatingARevision(String date) throws Exception {
        var created = mvc.perform(post("/api/v1/students/1/peis").contentType(MediaType.APPLICATION_JSON)
                .content("{\"subjectId\":3,\"academicTermId\":9}")).andReturn();
        var id = json.readTree(created.getResponse().getContentAsString()).get("id").asText();
        var body = Map.of("version", 0, "content", Map.of("documentDate", date));

        mvc.perform(put("/api/v1/students/1/peis/" + id).contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsBytes(body))).andExpect(status().isBadRequest());

        assertThat(mongo.store.load(1L, 3L, "2026-2").revisions()).hasSize(1);
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
