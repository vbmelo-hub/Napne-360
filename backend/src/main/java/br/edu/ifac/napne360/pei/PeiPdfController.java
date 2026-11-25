package br.edu.ifac.napne360.pei;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.security.AccessGuard;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class PeiPdfController {
    private final AccessGuard access;
    private final PeiService service;
    private final PeiPdfRenderer renderer;
    private final AuditService audit;

    @GetMapping(value = "/api/v1/students/{studentId}/peis/{id}/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> download(@PathVariable Long studentId, @PathVariable String id,
                                           Authentication auth, HttpServletRequest http) {
        access.requireView(studentId);
        PeiDocument plan = service.get(studentId, id);
        if (!PeiAnnexI.VERSION.equals(plan.getFormVersion())) {
            throw new IllegalArgumentException("O PDF do Anexo I está disponível para revisões elaboradas neste formulário.");
        }
        byte[] bytes = renderer.render(plan);
        String filename = "pei-revisao-" + plan.getRevision()
                + (plan.getStatus() == PeiStatus.DRAFT ? "-rascunho" : "") + ".pdf";
        audit.record(auth, http, "DOWNLOAD", "PEI", plan.getId(), "SUCCESS", "Anexo I, revisão " + plan.getRevision());
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_PDF).cacheControl(CacheControl.noStore())
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment().filename(filename).build().toString())
                .contentLength(bytes.length).body(bytes);
    }
}
