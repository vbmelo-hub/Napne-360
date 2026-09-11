package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.security.AccessGuard;
import br.edu.ifac.napne360.security.CurrentUserService;
import br.edu.ifac.napne360.timeline.TimelineService;
import br.edu.ifac.napne360.timeline.TimelineVisibility;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/students/{studentId}/attachments")
@RequiredArgsConstructor
public class AttachmentController {
    private final AttachmentRepository attachments;
    private final DocumentStorage storage;
    private final AccessGuard access;
    private final CurrentUserService currentUser;
    private final AuditService audit;
    private final TimelineService timeline;

    @GetMapping
    public List<AttachmentDocument> list(@PathVariable Long studentId) {
        access.requireView(studentId);
        if (!access.canEditDossier(studentId)) return List.of();
        return attachments.findByStudentIdAndArchivedFalseOrderByUploadedAtDesc(studentId);
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("@accessGuard.canEditDossier(#studentId)")
    public AttachmentDocument upload(@PathVariable Long studentId, @RequestParam String category,
                                     @RequestParam(required = false) String previousVersionId,
                                     @RequestPart MultipartFile file, Authentication auth, HttpServletRequest http) throws IOException {
        AttachmentDocument previous = previousVersionId == null ? null : attachments.findById(previousVersionId)
                .filter(a -> a.getStudentId().equals(studentId)).orElseThrow(() -> new NotFoundException("Versão anterior não encontrada."));
        DocumentStorage.StoredFile stored = storage.store(studentId, file);
        AttachmentDocument metadata = attachments.save(AttachmentDocument.builder().studentId(studentId).category(category)
                .previousVersionId(previousVersionId).revision(previous == null ? 1 : previous.getRevision()+1)
                .originalName(safeName(file.getOriginalFilename())).storedName(stored.storedName())
                .contentType(file.getContentType()).size(file.getSize()).sha256(stored.sha256())
                .uploadedBy(currentUser.require().getEmail()).build());
        audit.record(auth, http, "UPLOAD", "ATTACHMENT", metadata.getId(), "SUCCESS", category);
        timeline.append(studentId, "ATTACHMENT_UPLOADED", "Documento vinculado ao acompanhamento",
                currentUser.require().getName(), TimelineVisibility.RESTRICTED,
                Map.of("attachmentId", metadata.getId(), "category", category, "revision", metadata.getRevision()));
        return metadata;
    }

    @GetMapping("/{id}/content")
    @PreAuthorize("@accessGuard.canEditDossier(#studentId)")
    public ResponseEntity<Resource> download(@PathVariable Long studentId, @PathVariable String id,
                                             Authentication auth, HttpServletRequest http) {
        access.requireView(studentId);
        AttachmentDocument metadata = attachments.findById(id).filter(a -> a.getStudentId().equals(studentId) && !a.isArchived())
                .orElseThrow(() -> new NotFoundException("Documento não encontrado."));
        Resource resource = storage.load(metadata.getStoredName());
        audit.record(auth, http, "DOWNLOAD", "ATTACHMENT", metadata.getId(), "SUCCESS", metadata.getCategory());
        return ResponseEntity.ok().contentType(MediaType.parseMediaType(metadata.getContentType()))
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(metadata.getOriginalName(), StandardCharsets.UTF_8).build().toString())
                .body(resource);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("@accessGuard.canEditDossier(#studentId)")
    public void archive(@PathVariable Long studentId, @PathVariable String id, Authentication auth, HttpServletRequest http) {
        AttachmentDocument metadata = attachments.findById(id).filter(a -> a.getStudentId().equals(studentId))
                .orElseThrow(() -> new NotFoundException("Documento não encontrado."));
        metadata.setArchived(true);
        attachments.save(metadata);
        audit.record(auth, http, "ARCHIVE", "ATTACHMENT", metadata.getId(), "SUCCESS", metadata.getCategory());
        timeline.append(studentId, "ATTACHMENT_ARCHIVED", "Documento arquivado",
                currentUser.require().getName(), TimelineVisibility.RESTRICTED,
                Map.of("attachmentId", metadata.getId(), "category", metadata.getCategory()));
    }

    private String safeName(String value) {
        if (value == null || value.isBlank()) return "documento";
        return value.replaceAll("[\\r\\n\\t\\x00]", "_").replace('\\', '_').replace('/', '_');
    }
}
