package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.common.ConflictException;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.timeline.MutationProjection;
import br.edu.ifac.napne360.timeline.TimelineVisibility;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.stream.Collectors;
import java.util.regex.Pattern;

@Service
@RequiredArgsConstructor
@Slf4j
class AttachmentService {
    private static final Pattern UPLOAD_KEY = Pattern.compile("[A-Za-z0-9._-]{1,128}");
    private final AttachmentRepository attachments;
    private final AttachmentStateStore state;
    private final DocumentStorage storage;
    private final AttachmentRecoveryService recovery;

    AttachmentDocument upload(Long studentId, String category, String previousVersionId, String key,
                              MultipartFile file, UserAccount actor, String ipAddress) {
        var id = operationId(studentId, actor.getId(), key);
        try {
            var prepared = storage.prepare(studentId, id, file);
            var originalName = safeName(file.getOriginalFilename());
            var metadata = attachments.findById(id).orElseGet(() -> reserve(newUpload(
                    studentId, id, category, previousVersionId, originalName, prepared, file.getContentType(), actor, ipAddress)));
            requireSameUpload(metadata, category, previousVersionId, originalName, file.getContentType(), prepared);
            if (metadata.isUploadPending()) {
                if (!completeFileExists(metadata)) {
                    storage.write(prepared);
                    if (!completeFileExists(metadata)) {
                        throw new IOException("O binário gravado não corresponde ao tamanho ou hash esperado.");
                    }
                }
                metadata = confirmUpload(id);
            }
            recovery.enqueue(metadata);
            return metadata;
        } catch (DataAccessException | IOException failure) {
            log.warn("Falha no armazenamento do anexo {}", id, failure);
            throw new UnavailableException(failure);
        }
    }

    void archive(Long studentId, String id, UserAccount actor, String ipAddress) {
        try {
            var metadata = findConfirmed(studentId, id);
            if (!metadata.isArchived()) {
                var event = projection(metadata, actor, ipAddress, "ARCHIVE", "ATTACHMENT_ARCHIVED",
                        "Documento arquivado", Map.of("attachmentId", id, "category", metadata.getCategory()), Instant.now());
                try {
                    var updated = state.archive(studentId, id, event);
                    metadata = updated == null ? findConfirmed(studentId, id) : updated;
                } catch (DataAccessException failure) {
                    metadata = confirmAfterFailure(id, AttachmentDocument::isArchived, failure);
                }
            }
            if (!metadata.isArchived()) throw new UnavailableException(null);
            recovery.enqueue(metadata);
        } catch (DataAccessException failure) {
            throw new UnavailableException(failure);
        }
    }

    AttachmentDocument findConfirmed(Long studentId, String id) {
        return attachments.findById(id)
                .filter(a -> studentId.equals(a.getStudentId()) && !a.isUploadPending())
                .orElseThrow(() -> new NotFoundException("Documento não encontrado."));
    }

    List<AttachmentDocument> versions(Long studentId, String id) {
        var confirmed = attachments.findConfirmedByStudentId(studentId);
        var byId = confirmed.stream().collect(Collectors.toMap(AttachmentDocument::getId, Function.identity()));
        var current = byId.get(id);
        if (current == null) throw new NotFoundException("Documento não encontrado.");

        var children = confirmed.stream()
                .filter(document -> document.getPreviousVersionId() != null)
                .collect(Collectors.groupingBy(AttachmentDocument::getPreviousVersionId));
        var pending = new ArrayDeque<AttachmentDocument>();
        var visited = new HashSet<String>();
        var history = new ArrayList<AttachmentDocument>();
        pending.add(current);
        while (!pending.isEmpty()) {
            var version = pending.removeFirst();
            if (!visited.add(version.getId())) continue;
            history.add(version);
            var previous = byId.get(version.getPreviousVersionId());
            if (previous != null) pending.add(previous);
            pending.addAll(children.getOrDefault(version.getId(), List.of()));
        }
        history.sort(Comparator.comparingInt(AttachmentDocument::getRevision).reversed()
                .thenComparing(AttachmentDocument::getUploadedAt, Comparator.nullsLast(Comparator.reverseOrder()))
                .thenComparing(AttachmentDocument::getId));
        return history;
    }

    private AttachmentDocument newUpload(Long studentId, String id, String category, String previousVersionId,
                                         String originalName, DocumentStorage.PreparedFile file, String contentType,
                                         UserAccount actor, String ipAddress) {
        var previous = previousVersionId == null ? null : attachments.findById(previousVersionId)
                .filter(a -> studentId.equals(a.getStudentId()) && !a.isUploadPending())
                .orElseThrow(() -> new NotFoundException("Versão anterior não encontrada."));
        var metadata = AttachmentDocument.builder().id(id).studentId(studentId).category(category)
                .previousVersionId(previousVersionId).revision(previous == null ? 1 : previous.getRevision() + 1)
                .originalName(originalName).storedName(file.storedName()).contentType(contentType)
                .size(file.size()).sha256(file.sha256()).uploadedBy(actor.getEmail()).uploadPending(true).build();
        var event = projection(metadata, actor, ipAddress, "UPLOAD", "ATTACHMENT_UPLOADED",
                "Documento vinculado ao acompanhamento",
                Map.of("attachmentId", id, "category", category, "revision", metadata.getRevision()), metadata.getUploadedAt());
        metadata.setPendingProjections(List.of(event));
        return metadata;
    }

    private AttachmentDocument reserve(AttachmentDocument metadata) {
        try {
            return attachments.insert(metadata);
        } catch (DataAccessException uncertain) {
            return confirmAfterFailure(metadata.getId(), a -> true, uncertain);
        }
    }

    private AttachmentDocument confirmUpload(String id) {
        try {
            var confirmed = state.confirmUpload(id);
            if (confirmed != null) return confirmed;
        } catch (DataAccessException uncertain) {
            return confirmAfterFailure(id, a -> !a.isUploadPending(), uncertain);
        }
        return attachments.findById(id).filter(a -> !a.isUploadPending())
                .orElseThrow(() -> new UnavailableException(null));
    }

    private AttachmentDocument confirmAfterFailure(String id, Predicate<AttachmentDocument> confirmed,
                                                     DataAccessException failure) {
        try {
            var result = attachments.findById(id).filter(confirmed);
            if (result.isPresent()) return result.get();
        } catch (DataAccessException readFailure) {
            failure.addSuppressed(readFailure);
        }
        throw failure;
    }

    private boolean completeFileExists(AttachmentDocument metadata) throws IOException {
        return storage.hasCompleteFile(metadata.getStoredName(), metadata.getSize(), metadata.getSha256());
    }

    private void requireSameUpload(AttachmentDocument metadata, String category, String previousVersionId,
                                   String originalName, String contentType, DocumentStorage.PreparedFile file) {
        if (!Objects.equals(metadata.getCategory(), category)
                || !Objects.equals(metadata.getPreviousVersionId(), previousVersionId)
                || !Objects.equals(metadata.getOriginalName(), originalName)
                || !Objects.equals(metadata.getContentType(), contentType)
                || !Objects.equals(metadata.getSha256(), file.sha256())
                || metadata.getSize() != file.size()) {
            throw new ConflictException("A chave de envio já está associada a outro documento.");
        }
    }

    private MutationProjection projection(AttachmentDocument metadata, UserAccount actor, String ipAddress,
                                          String action, String eventType, String title, Map<String, Object> data,
                                          Instant occurredAt) {
        return new MutationProjection("attachment:" + action + ":" + metadata.getId(), metadata.getStudentId(),
                eventType, title, actor.getName(), TimelineVisibility.RESTRICTED, data, actor.getId(), ipAddress,
                action, "ATTACHMENT", metadata.getId(), metadata.getCategory(), occurredAt);
    }

    private String operationId(Long studentId, Long actorId, String key) {
        if (key == null) return UUID.randomUUID().toString();
        if (!UPLOAD_KEY.matcher(key).matches()) throw new IllegalArgumentException("Chave de envio inválida.");
        var scopedKey = studentId + ":" + actorId + ":" + key;
        try {
            var hash = MessageDigest.getInstance("SHA-256").digest(scopedKey.getBytes(StandardCharsets.UTF_8));
            return "upload-" + HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException unavailable) {
            throw new IllegalStateException(unavailable);
        }
    }

    private String safeName(String value) {
        if (value == null || value.isBlank()) return "documento";
        return value.replaceAll("[\\r\\n\\t\\x00]", "_").replace('\\', '_').replace('/', '_');
    }

    static class UnavailableException extends RuntimeException {
        UnavailableException(Throwable cause) {
            super(cause);
        }
    }
}
