package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.common.ApiExceptionHandler;
import br.edu.ifac.napne360.identity.*;
import br.edu.ifac.napne360.security.AccessGuard;
import br.edu.ifac.napne360.security.CurrentUserService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.http.converter.json.MappingJackson2HttpMessageConverter;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class DossierCatalogTest {
    final DossierRepository dossiers = mock(DossierRepository.class);
    final ReferenceEntryRepository entries = mock(ReferenceEntryRepository.class);
    final CurrentUserService currentUser = mock(CurrentUserService.class);
    final DocumentMutationOutbox projections = mock(DocumentMutationOutbox.class);
    final AuditService audit = mock(AuditService.class);
    final ObjectMapper json = Jackson2ObjectMapperBuilder.json().build();
    DossierService service;
    DossierDocument document;
    MockMvc mvc;

    @BeforeEach void setup() {
        service = new DossierService(dossiers, currentUser, projections, audit, new ReferenceCatalogService(entries));
        document = DossierDocument.builder().id("d1").studentId(1L).version(3L)
                .educationalNeeds(new LinkedHashMap<>(Map.of("categoryId", 7L, "category", "Nome histórico", "notes", "Antes", "extra", Map.of("ok", true)))).build();
        when(dossiers.findByStudentId(1L)).thenReturn(Optional.of(document));
        when(currentUser.require()).thenReturn(UserAccount.builder().name("NAPNE").email("napne@example.test").roles(Set.of(RoleName.NAPNE)).build());
        lenient().when(dossiers.save(any())).thenAnswer(i -> i.getArgument(0));
        mvc = MockMvcBuilders.standaloneSetup(new DossierController(service, mock(AccessGuard.class), dossiers))
                .setControllerAdvice(new ApiExceptionHandler())
                .setMessageConverters(new MappingJackson2HttpMessageConverter(json))
                .build();
    }

    @ParameterizedTest
    @CsvSource({
            "identification,false", "identification,true",
            "educationalNeeds,false", "educationalNeeds,true",
            "healthAndSupport,false", "healthAndSupport,true",
            "familyContext,false", "familyContext,true",
            "schoolHistory,false", "schoolHistory,true",
            "strengths,false", "strengths,true",
            "difficulties,false", "difficulties,true",
            "initialInterventions,false", "initialInterventions,true"
    })
    void putRejectsMissingOrNullSectionBeforeAnyEffects(String section, boolean explicitNull) throws Exception {
        document.setIdentification(Map.of("notes", "Identificação anterior"));
        document.getHistory().add(new DossierDocument.Revision(2L, Map.of(), "napne@example.test",
                java.time.Instant.parse("2026-11-23T12:00:00Z")));
        JsonNode before = json.valueToTree(document);
        ObjectNode body = completePutBody().put("version", 3);
        if (explicitNull) body.putNull(section);
        else body.remove(section);

        var result = mvc.perform(put("/api/v1/students/1/dossier")
                .contentType(MediaType.APPLICATION_JSON).content(body.toString())).andReturn();

        org.junit.jupiter.api.Assertions.assertAll(
                () -> assertThat(result.getResponse().getStatus()).isEqualTo(400),
                () -> assertThat(json.<JsonNode>valueToTree(document)).isEqualTo(before),
                () -> verifyNoInteractions(dossiers, entries, projections, audit));
    }

    @Test void putAcceptsEmptySectionsAndNullInitialVersion() throws Exception {
        when(dossiers.findByStudentId(1L)).thenReturn(Optional.empty());

        mvc.perform(put("/api/v1/students/1/dossier").contentType(MediaType.APPLICATION_JSON)
                        .content(completePutBody().putNull("version").toString()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.identification").isEmpty())
                .andExpect(jsonPath("$.educationalNeeds").isEmpty());
        verify(dossiers).save(argThat(saved -> saved.getStudentId().equals(1L) && saved.getHistory().isEmpty()));
    }

    @Test void completePutWithObsoleteVersionReturnsConflictWithoutEffects() throws Exception {
        JsonNode before = json.valueToTree(document);
        mvc.perform(put("/api/v1/students/1/dossier").contentType(MediaType.APPLICATION_JSON)
                        .content(completePutBody().put("version", 2).toString()))
                .andExpect(status().isConflict());
        assertThat(json.<JsonNode>valueToTree(document)).isEqualTo(before);
        verify(dossiers, never()).save(any());
        verifyNoInteractions(entries, projections, audit);
    }

    private ObjectNode completePutBody() {
        ObjectNode body = json.createObjectNode();
        for (String section : List.of("identification", "educationalNeeds", "healthAndSupport",
                "familyContext", "schoolHistory", "strengths", "difficulties", "initialInterventions")) {
            body.putObject(section);
        }
        return body;
    }

    // Removing validation must allow invalid input to mutate history and the stored document.
    @ParameterizedTest @ValueSource(strings = {"99", "-1", "0", "7.5", "\"7\"", "true", "{}", "[]", "9223372036854775808"})
    void malformedOrUnknownIdDoesNotMutateAnything(String raw) throws Exception {
        reject(json.readValue("{\"categoryId\":" + raw + ",\"category\":\"Forjado\",\"notes\":\"Depois\"}", new TypeReference<Map<String,Object>>() {}));
    }

    @ParameterizedTest @ValueSource(strings = {"wrong-kind", "inactive"})
    void wrongKindOrNewInactiveAssociationIsRejected(String scenario) {
        when(entries.findById(8L)).thenReturn(Optional.of(ReferenceEntry.builder().id(8L).code("CAT")
                .kind(scenario.equals("wrong-kind") ? ReferenceEntry.Kind.ACADEMIC_TERM : ReferenceEntry.Kind.NEED_CATEGORY)
                .label("Categoria").active(!scenario.equals("inactive")).build()));
        reject(Map.of("categoryId", 8L));
    }

    @Test void activeSelectionUsesServerSnapshotAndPreservesExtrasAndHistory() {
        when(entries.findById(8L)).thenReturn(Optional.of(ReferenceEntry.builder().id(8L).kind(ReferenceEntry.Kind.NEED_CATEGORY).code("CAT").label("Catálogo ativo").build()));
        var result = save(Map.of("categoryId", 8, "category", "Forjado", "notes", "Depois", "extra", Map.of("ok", true)));
        assertThat(result.educationalNeeds()).containsEntry("categoryId", 8L).containsEntry("category", "Catálogo ativo")
                .containsEntry("notes", "Depois").containsEntry("extra", Map.of("ok", true));
        assertThat(document.getHistory()).hasSize(1);
        assertThat(document.getHistory().getFirst().fields().get("educationalNeeds")).isEqualTo(Map.of("categoryId", 7L, "category", "Nome histórico", "notes", "Antes", "extra", Map.of("ok", true)));
    }

    @Test void sameHistoricalIdDoesNotRequireActiveCatalogOrTrustClientSnapshot() {
        var result = save(Map.of("categoryId", 7, "category", "Nome alterado", "notes", "Depois"));
        assertThat(result.educationalNeeds()).containsEntry("categoryId", 7L).containsEntry("category", "Nome histórico");
        verifyNoInteractions(entries);
    }

    @Test void omittedIdPreservesHistoricalIdentityAndSnapshot() {
        var result = save(Map.of("category", "Forjado", "notes", "Depois"));
        assertThat(result.educationalNeeds()).containsEntry("categoryId", 7L).containsEntry("category", "Nome histórico");
    }

    @Test void nullSectionPreservesHistoricalIdentity() {
        assertThat(save(null).educationalNeeds()).containsEntry("categoryId", 7L).containsEntry("category", "Nome histórico");
    }

    @Test void explicitNullRemovesIdAndLabel() {
        var input = new LinkedHashMap<String,Object>();
        input.put("categoryId", null); input.put("category", "Forjado"); input.put("notes", "Depois");
        var result = save(input);
        assertThat(result.educationalNeeds().get("categoryId")).isNull();
        assertThat(result.educationalNeeds().get("category")).isIn(null, "");
        assertThat(result.educationalNeeds()).containsEntry("notes", "Depois");
    }

    @Test void legacyTextSurvivesUnchangedWithoutInventingId() {
        document.setEducationalNeeds(new LinkedHashMap<>(Map.of("category", "Texto antigo")));
        var result = save(Map.of("category", "Texto antigo", "notes", "Depois"));
        assertThat(result.educationalNeeds()).containsEntry("category", "Texto antigo").doesNotContainKey("categoryId");
        verifyNoInteractions(entries);
    }

    @Test void omittedLegacyTextSurvivesWithoutInventingId() {
        document.setEducationalNeeds(new LinkedHashMap<>(Map.of("category", "Texto antigo")));
        assertThat(save(Map.of("notes", "Depois")).educationalNeeds()).containsEntry("category", "Texto antigo").doesNotContainKey("categoryId");
    }

    @ParameterizedTest @ValueSource(strings = {"Novo texto", ""})
    void legacyTextCannotBeChangedWithoutId(String text) {
        document.setEducationalNeeds(new LinkedHashMap<>(Map.of("category", "Texto antigo")));
        reject(Map.of("category", text));
    }

    @Test void newFreeTextIsRejected() {
        document.setEducationalNeeds(new LinkedHashMap<>());
        reject(Map.of("category", "Texto novo"));
    }

    @Test void pedagogicalProjectionNeverLeaksCategoryOrId() {
        when(currentUser.require()).thenReturn(UserAccount.builder().roles(Set.of(RoleName.TEACHER)).build());
        assertThat(service.get(1L,null,null).educationalNeeds()).isEmpty();
    }

    private DossierService.DossierView save(Map<String,Object> needs) {
        return service.save(1L,new DossierService.DossierRequest(Map.of(),needs,Map.of(),Map.of(),Map.of(),Map.of(),Map.of(),Map.of(),3L),null,null);
    }
    private void reject(Map<String,Object> needs) {
        JsonNode before = json.valueToTree(document);
        assertThatThrownBy(() -> save(needs)).isInstanceOf(IllegalArgumentException.class);
        assertThat(json.<JsonNode>valueToTree(document)).isEqualTo(before);
        verify(dossiers, never()).save(any()); verifyNoInteractions(projections, audit);
    }
}
