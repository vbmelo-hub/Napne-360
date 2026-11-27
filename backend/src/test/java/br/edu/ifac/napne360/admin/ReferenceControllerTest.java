package br.edu.ifac.napne360.admin;
import br.edu.ifac.napne360.identity.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import java.util.Optional;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class ReferenceControllerTest {
    final ReferenceEntryRepository entries = mock(ReferenceEntryRepository.class);
    final ReferenceController controller = new ReferenceController(entries, mock(br.edu.ifac.napne360.academic.AcademicService.class));
    @ParameterizedTest @ValueSource(strings = {"code", "kind"})
    void immutableIdentityIsRejectedBeforeAnyMutation(String field) {
        var entry = ReferenceEntry.builder().id(1L).kind(ReferenceEntry.Kind.ACADEMIC_TERM).code("2026-2").label("Antes").description("Descrição").build();
        when(entries.findById(1L)).thenReturn(Optional.of(entry));
        assertThatThrownBy(() -> controller.update(1L,new ReferenceController.EntryRequest(field.equals("kind") ? ReferenceEntry.Kind.NEED_CATEGORY : entry.getKind(),field.equals("code") ? "novo" : entry.getCode(),"Depois","Outra")))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(entry.getCode()).isEqualTo("2026-2"); assertThat(entry.getLabel()).isEqualTo("Antes");
        assertThat(entry.getDescription()).isEqualTo("Descrição"); verify(entries,never()).save(any());
    }
    @Test void labelAndDescriptionCanChangeWithoutChangingCodeOrKind() {
        var entry = ReferenceEntry.builder().id(1L).kind(ReferenceEntry.Kind.NEED_CATEGORY).code("CAT").label("Antes").build();
        when(entries.findById(1L)).thenReturn(Optional.of(entry));
        when(entries.save(any())).thenAnswer(i -> i.getArgument(0));
        var result = controller.update(1L,new ReferenceController.EntryRequest(entry.getKind()," CAT "," Depois ","Descrição"));
        assertThat(result.getCode()).isEqualTo("CAT"); assertThat(result.getLabel()).isEqualTo("Depois"); assertThat(result.getDescription()).isEqualTo("Descrição");
    }
}
