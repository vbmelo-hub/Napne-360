package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.identity.UserAccount;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AttachmentRecoveryTest {
    @TempDir Path directory;

    @Test
    void repeatingUploadAfterMetadataFailureLeavesOnlyThePreviousFileAndOneNewRevision() throws Exception {
        var attachments = mock(AttachmentRepository.class);
        var actor = UserAccount.builder().id(7L).name("Equipe fictícia").email("teste@example.test").build();
        var state = mock(AttachmentStateStore.class);
        var storage = new LocalStorageService(directory.toString());
        var service = new AttachmentService(attachments, state, storage, mock(AttachmentRecoveryService.class));
        var previousFile = pdf("anterior.pdf", "%PDF-1.7\nAnterior");
        var previous = AttachmentDocument.builder().id("anterior").studentId(42L).revision(1)
                .storedName(storage.store(42L, previousFile).storedName()).build();
        var reserved = new AtomicReference<AttachmentDocument>();
        when(attachments.findById(any())).thenAnswer(invocation -> "anterior".equals(invocation.getArgument(0))
                ? Optional.of(previous) : Optional.ofNullable(reserved.get()));
        when(attachments.insert(any(AttachmentDocument.class))).thenAnswer(invocation -> {
            reserved.set(invocation.getArgument(0));
            return reserved.get();
        });
        when(state.confirmUpload(any()))
                .thenAnswer(invocation -> {
                    assertThat(directory).isDirectoryContaining(path -> !path.endsWith(previous.getStoredName()));
                    throw new DataAccessResourceFailureException("Falha após gravar o binário");
                })
                .thenAnswer(invocation -> {
                    reserved.get().setUploadPending(false);
                    return reserved.get();
                });

        var revisionFile = pdf("novo.pdf", "%PDF-1.7\nAtualização");
        assertThatThrownBy(() -> service.upload(42L, "Teste", "anterior", "envio-ficticio", revisionFile, actor, null))
                .isInstanceOf(AttachmentService.UnavailableException.class);
        var result = service.upload(42L, "Teste", "anterior", "envio-ficticio", revisionFile, actor, null);

        assertThat(result.getRevision()).isEqualTo(2);
        assertThat(result.getPreviousVersionId()).isEqualTo("anterior");
        assertThat(storage.load(previous.getStoredName()).getContentAsByteArray()).isEqualTo(previousFile.getBytes());
        assertThat(storage.load(result.getStoredName()).getContentAsByteArray()).isEqualTo(revisionFile.getBytes());
        try (var paths = Files.list(directory)) {
            assertThat(paths.toList()).hasSize(2);
        }
    }

    private MockMultipartFile pdf(String fileName, String text) {
        return new MockMultipartFile("file", fileName, "application/pdf", text.getBytes(StandardCharsets.UTF_8));
    }
}
