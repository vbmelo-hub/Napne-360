package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.security.AccessGuard;
import br.edu.ifac.napne360.security.CurrentUserService;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.List;

@RestController
@RequestMapping("/api/v1/students/{studentId}/attachments")
@RequiredArgsConstructor
public class AttachmentController {
    private final AttachmentRepository attachments;
    private final DocumentStorage storage;
    private final AccessGuard access;
    private final CurrentUserService currentUser;
    private final AuditService audit;
    private final AttachmentService operations;

    @GetMapping
    public List<AttachmentDocument> list(@PathVariable Long studentId) {
        access.requireView(studentId);
        if (!access.canEditDossier(studentId)) return List.of();
        return attachments.findActiveByStudentId(studentId);
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("@accessGuard.canEditDossier(#studentId)")
    public AttachmentDocument upload(@PathVariable Long studentId, @RequestParam String category,
                                     @RequestParam(required = false) String previousVersionId,
                                     @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                     @RequestPart MultipartFile file, HttpServletRequest http) {
        return operations.upload(studentId, category, previousVersionId, key, file, currentUser.require(), http.getRemoteAddr());
    }

    @GetMapping("/{id}/content")
    @PreAuthorize("@accessGuard.canEditDossier(#studentId)")
    public ResponseEntity<Resource> download(@PathVariable Long studentId, @PathVariable String id,
                                             Authentication auth, HttpServletRequest http) {
        access.requireView(studentId);
        AttachmentDocument metadata = operations.findConfirmed(studentId, id);
        if (metadata.isArchived()) throw new NotFoundException("Documento não encontrado.");
        Resource resource = storage.load(metadata.getStoredName());
        audit.record(auth, http, "DOWNLOAD", "ATTACHMENT", metadata.getId(), "SUCCESS", metadata.getCategory());
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(metadata.getContentType()))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(metadata.getOriginalName(), StandardCharsets.UTF_8).build().toString())
                .body(resource);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("@accessGuard.canEditDossier(#studentId)")
    public void archive(@PathVariable Long studentId, @PathVariable String id, HttpServletRequest http) {
        operations.archive(studentId, id, currentUser.require(), http.getRemoteAddr());
    }

    @ExceptionHandler(AttachmentService.UnavailableException.class)
    ProblemDetail unavailable() {
        return ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE,
                "A confirmação está temporariamente indisponível. Consulte os anexos antes de reenviar.");
    }
}
