package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.common.ApiOperationException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.mock.web.MockMultipartFile;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import javax.imageio.ImageIO;
import static org.assertj.core.api.Assertions.*;

class LocalStorageServiceTest {
    @TempDir Path directory;

    @Test void rejectsExecutableDisguisedAsPdf() throws Exception {
        var storage = new LocalStorageService(directory.toString());
        assertThatThrownBy(() -> storage.store(1L, new MockMultipartFile("file", "laudo.pdf", "application/pdf", "MZ executable".getBytes())))
                .isInstanceOf(ApiOperationException.class);
    }

    @Test void storesWithServerExtensionAndHash() throws Exception {
        var storage = new LocalStorageService(directory.toString());
        var stored = storage.store(1L, new MockMultipartFile("file", "../../document.exe", "application/pdf", "%PDF-1.7\n%%EOF".getBytes()));
        assertThat(stored.storedName()).startsWith("1-").endsWith(".pdf").doesNotContain("..", "exe");
        assertThat(stored.sha256()).hasSize(64);
        assertThat(storage.load(stored.storedName()).exists()).isTrue();
    }

    @Test void storesPngJpegAndDocxWithValidatedExtension() throws Exception {
        var storage = new LocalStorageService(directory.toString());
        for (String format : List.of("png", "jpeg")) {
            var image = new BufferedImage(2, 2, BufferedImage.TYPE_INT_RGB);
            var bytes = new ByteArrayOutputStream();
            assertThat(ImageIO.write(image, format, bytes)).isTrue();
            var file = new MockMultipartFile("file", "ficticio." + format, "image/" + format, bytes.toByteArray());
            var stored = storage.store(1L, file);
            assertThat(stored.storedName()).endsWith(format.equals("jpeg") ? ".jpg" : ".png");
            assertThat(storage.load(stored.storedName()).getContentAsByteArray()).isEqualTo(bytes.toByteArray());
        }

        var bytes = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(bytes)) {
            for (String part : List.of("[Content_Types].xml", "word/document.xml")) {
                zip.putNextEntry(new ZipEntry(part));
                zip.write("<ficticio/>".getBytes(StandardCharsets.UTF_8));
                zip.closeEntry();
            }
        }
        var docx = new MockMultipartFile("file", "ficticio.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document", bytes.toByteArray());
        var stored = storage.store(1L, docx);
        assertThat(stored.storedName()).endsWith(".docx");
        assertThat(storage.load(stored.storedName()).getContentAsByteArray()).isEqualTo(bytes.toByteArray());
    }

    @Test void rejectsPathTraversal() throws Exception {
        var storage = new LocalStorageService(directory.toString());
        assertThatThrownBy(() -> storage.load("../outside")).isInstanceOf(SecurityException.class);
    }
}
