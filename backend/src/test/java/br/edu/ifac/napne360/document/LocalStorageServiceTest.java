package br.edu.ifac.napne360.document;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;
import java.nio.file.Path;
import static org.assertj.core.api.Assertions.*;

class LocalStorageServiceTest {
    @TempDir Path directory;

    @Test void rejectsExecutableDisguisedAsPdf() throws Exception {
        var storage = new LocalStorageService(directory.toString());
        assertThatThrownBy(() -> storage.store(1L, new MockMultipartFile("file", "laudo.pdf", "application/pdf", "MZ executable".getBytes())))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test void storesWithServerExtensionAndHash() throws Exception {
        var storage = new LocalStorageService(directory.toString());
        var stored = storage.store(1L, new MockMultipartFile("file", "../../document.exe", "application/pdf", "%PDF-1.7\n%%EOF".getBytes()));
        assertThat(stored.storedName()).startsWith("1-").endsWith(".pdf").doesNotContain("..", "exe");
        assertThat(stored.sha256()).hasSize(64);
        assertThat(storage.load(stored.storedName()).exists()).isTrue();
    }

    @Test void rejectsPathTraversal() throws Exception {
        var storage = new LocalStorageService(directory.toString());
        assertThatThrownBy(() -> storage.load("../outside")).isInstanceOf(SecurityException.class);
    }
}
