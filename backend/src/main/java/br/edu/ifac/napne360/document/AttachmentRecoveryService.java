package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.timeline.MutationProjectionPublisher;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;

@Service
@Slf4j
class AttachmentRecoveryService {
    private static final String RETRY_DELAY = "${napne360.attachments.recovery.delay-ms:30000}";
    private final AttachmentStateStore state;
    private final DocumentStorage storage;
    private final MutationProjectionPublisher publisher;
    private final Executor executor;

    AttachmentRecoveryService(AttachmentStateStore state, DocumentStorage storage, MutationProjectionPublisher publisher,
                              @Qualifier("attachmentRecoveryExecutor") Executor executor) {
        this.state = state;
        this.storage = storage;
        this.publisher = publisher;
        this.executor = executor;
    }

    void enqueue(AttachmentDocument metadata) {
        if (metadata.getPendingProjections() == null || metadata.getPendingProjections().isEmpty()) return;
        try {
            executor.execute(() -> publish(metadata));
        } catch (RejectedExecutionException unavailable) {
            log.debug("O histórico do anexo {} será retomado na próxima varredura", metadata.getId());
        }
    }

    @Scheduled(initialDelayString = RETRY_DELAY, fixedDelayString = RETRY_DELAY)
    void recover() {
        try (var uploads = state.pendingUploads()) {
            uploads.forEach(this::recoverUpload);
        } catch (RuntimeException failure) {
            log.warn("Falha ao consultar anexos com gravação pendente", failure);
        }
        try (var history = state.pendingProjections()) {
            history.forEach(this::publish);
        } catch (RuntimeException failure) {
            log.warn("Falha ao consultar o histórico pendente de anexos", failure);
        }
    }

    private void recoverUpload(AttachmentDocument metadata) {
        try {
            if (storage.hasCompleteFile(metadata.getStoredName(), metadata.getSize(), metadata.getSha256())) {
                state.confirmUpload(metadata.getId());
            }
        } catch (IOException | RuntimeException failure) {
            log.warn("Falha ao recuperar a gravação do anexo {}", metadata.getId(), failure);
        }
    }

    private void publish(AttachmentDocument metadata) {
        for (var event : metadata.getPendingProjections()) {
            try {
                publisher.publish(event);
                state.acknowledgeProjection(metadata.getId(), event.key());
            } catch (RuntimeException failure) {
                log.warn("Falha ao registrar o histórico do anexo {}", event.key(), failure);
            }
        }
    }
}
