package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.identity.*;
import br.edu.ifac.napne360.security.CurrentUserService;
import br.edu.ifac.napne360.timeline.TimelineService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class DossierCatalogTest {
    final DossierRepository dossiers = mock(DossierRepository.class);
    final ReferenceEntryRepository entries = mock(ReferenceEntryRepository.class);
    final CurrentUserService currentUser = mock(CurrentUserService.class);
    final TimelineService timeline = mock(TimelineService.class);
    final AuditService audit = mock(AuditService.class);
    final ObjectMapper json = Jackson2ObjectMapperBuilder.json().build();
    DossierService service;
    DossierDocument document;

    @BeforeEach void setup() {
        service = new DossierService(dossiers, currentUser, timeline, audit, new ReferenceCatalogService(entries));
        document = DossierDocument.builder().id("d1").studentId(1L).version(3L)
                .educationalNeeds(new LinkedHashMap<>(Map.of("categoryId", 7L, "category", "Nome histórico", "notes", "Antes", "extra", Map.of("ok", true)))).build();
        when(dossiers.findByStudentId(1L)).thenReturn(Optional.of(document));
        when(currentUser.require()).thenReturn(UserAccount.builder().name("NAPNE").email("napne@example.test").roles(Set.of(RoleName.NAPNE)).build());
        lenient().when(dossiers.save(any())).thenAnswer(i -> i.getArgument(0));
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
        verify(dossiers, never()).save(any()); verifyNoInteractions(timeline,audit);
    }
}
