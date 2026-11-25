package br.edu.ifac.napne360.pei;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.security.AccessGuard;
import com.lowagie.text.pdf.PdfReader;
import com.lowagie.text.pdf.parser.PdfTextExtractor;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class PeiPdfTest {
    private final AccessGuard access = mock(AccessGuard.class);
    private final PeiService service = mock(PeiService.class);
    private final AuditService audit = mock(AuditService.class);
    private final Authentication auth = mock(Authentication.class);
    private final MockHttpServletRequest http = new MockHttpServletRequest();
    private final PeiPdfController endpoint = new PeiPdfController(access, service, new PeiPdfRenderer(), audit);

    @Test
    void exportsSavedFormWithIndividualAnswersAndWithoutInternalInformation() throws Exception {
        PeiDocument plan = example();
        when(service.get(5L, "rev2")).thenReturn(plan);
        var response = endpoint.download(5L, "rev2", auth, http);
        assertThat(response.getHeaders().getContentDisposition().getFilename()).isEqualTo("pei-revisao-2-rascunho.pdf");
        assertThat(response.getHeaders().getContentDisposition().getType()).isEqualTo("attachment");
        assertThat(response.getHeaders().getContentType().toString()).isEqualTo("application/pdf");
        var order = inOrder(access, service, audit);
        order.verify(access).requireView(5L);
        order.verify(service).get(5L, "rev2");
        order.verify(audit).record(eq(auth), eq(http), eq("DOWNLOAD"), eq("PEI"), eq("rev2"), eq("SUCCESS"), anyString());
        String text = extract(response.getBody());
        assertThat(text).contains("ANEXO I", "Docente Fictícia", "Estudante Fictício", "Disciplina Fictícia", "Período de exemplo",
                "Trabalho em duplas", "Relato oral", "Permite demonstrar", "Obra fictícia", "Autora fictícia", "AB-456",
                "Bibliografia Complementar", "Observação fictícia", "Assinatura do Docente", "Acre", "25/11/2026")
            .doesNotContain("Sigilo fictício", "informacao-interna", "ANEXO II");
        assertThat(text).containsPattern("Expressa ideias.+?\\[X] Realiza com ajuda");
        assertThat(text).contains("Demonstra autonomia no uso de softwares aplicados ao curso técnico");
        assertThat(text.split("Realiza com ajuda", -1)).hasSize(29);
        assertThat(text.split("\\[X] Não foi observado", -1)).hasSize(28);
        assertThat(text.split("Não foi observado", -1)).hasSize(29);
    }

    @Test
    void preservesLongValuesAcrossPageAndColumnBreaks() throws Exception {
        PeiDocument plan = example();
        String longText = "Explicação educacional detalhada para este exemplo. ".repeat(190);
        plan.getContent().put("generalObjectives", longText + "MARCAOBJETIVOFINAL");
        plan.getContent().put("assessmentInstruments", List.of(Map.of("description", "Exemplo",
                "justification", longText + "MARCAAVALIACAOFINAL")));
        plan.getContent().put("complementaryBibliography", List.of(Map.of("title", longText + "MARCALIVROFINAL")));
        var renderer = new PeiPdfRenderer();
        byte[] bytes = renderer.render(plan);
        String text = extract(bytes);
        assertThat(text).contains("MARCAOBJETIVOFINAL", "MARCAAVALIACAOFINAL", "MARCALIVROFINAL", "Observação fictícia");
        assertThat(text.split("Explicação", -1)).hasSize(571);
        assertThat(text.split("detalhada", -1)).hasSize(571);
    }

    @Test
    void restrictsExportToVisibleStudentAndPeiRevision() {
        doThrow(new AccessDeniedException("Acesso negado")).when(access).requireView(5L);
        assertThatThrownBy(() -> endpoint.download(5L, "rev2", auth, http)).isInstanceOf(AccessDeniedException.class);
        verifyNoInteractions(service, audit);
        reset(access);
        when(service.get(5L, "rev2")).thenThrow(new AccessDeniedException("Vínculo ausente"));
        assertThatThrownBy(() -> endpoint.download(5L, "rev2", auth, http)).isInstanceOf(AccessDeniedException.class);
        verifyNoInteractions(audit);
    }

    @Test
    void rejectsLegacyFormInsteadOfGeneratingInventedOfficialResponses() {
        PeiDocument plan = example();
        plan.setFormVersion(null);
        when(service.get(5L, "rev2")).thenReturn(plan);
        assertThatThrownBy(() -> endpoint.download(5L, "rev2", auth, http)).isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(audit);
    }

    static PeiDocument example() {
        var content = new LinkedHashMap<String, Object>();
        content.put("student", "Estudante Fictício");
        content.put("course", "Curso de exemplo");
        content.put("teacherName", "Docente Fictícia");
        content.put("subject", "Disciplina Fictícia");
        content.put("workloadHours", 60);
        content.put("generalObjectives", "Desenvolver autonomia em atividades.");
        content.put("specificObjectives", List.of("Ler textos curtos", "Produzir sínteses"));
        content.put("contents", List.of(Map.of("description", "Trabalho em duplas", "workloadHours", 12, "priority", true)));
        content.put("assessmentInstruments", List.of(Map.of("description", "Relato oral", "justification", "Permite demonstrar as etapas.")));
        content.put("basicBibliography", List.of(Map.of("title", "Obra fictícia", "author", "Autora fictícia", "lt", "AB-456")));
        content.put("observations", "Observação fictícia");
        content.put("documentDate", "2026-11-25");
        content.put("location", "Acre");
        Map<String, String> inventory = new LinkedHashMap<>();
        PeiAnnexI.answerableIndicators().forEach(id -> inventory.put(id, "NAO_OBSERVADO"));
        inventory.put("oralCommunication1", "REALIZA_COM_AJUDA");
        content.put("skillsInventory", inventory);
        content.put("privateNote", "informacao-interna");
        return PeiDocument.builder().id("rev2").revision(2).formVersion(PeiAnnexI.VERSION)
                .studentId(5L).academicTermLabel("Período de exemplo").content(content)
                .transfer(new PeiDocument.Transfer(1L, 2L, "interno", null, "Sigilo fictício")).build();
    }

    private static String extract(byte[] bytes) throws IOException {
        try (var reader = new PdfReader(bytes)) {
            var extractor = new PdfTextExtractor(reader);
            var text = new StringBuilder();
            for (int i = 1; i <= reader.getNumberOfPages(); i++) text.append(' ').append(extractor.getTextFromPage(i));
            return text.toString().replaceAll("\\s+", " ");
        }
    }
}
