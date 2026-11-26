package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.common.NotFoundException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Set;

@Service
public class LocalStorageService implements DocumentStorage {
    private static final Set<String> ALLOWED_TYPES = Set.of(
            "application/pdf", "image/jpeg", "image/png",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    private final Path root;

    public LocalStorageService(@Value("${napne360.storage.root}") String root) throws IOException {
        this.root = Path.of(root).toAbsolutePath().normalize();
        Files.createDirectories(this.root);
    }

    @Override
    public PreparedFile prepare(Long studentId, String operationId, MultipartFile file) throws IOException {
        if (file.isEmpty() || file.getSize() > 10L * 1024 * 1024) throw new IllegalArgumentException("O arquivo deve ter entre 1 byte e 10 MB.");
        if (file.getContentType() == null || !ALLOWED_TYPES.contains(file.getContentType())) {
            throw new IllegalArgumentException("Tipo de arquivo não permitido.");
        }
        byte[] bytes;
        try (InputStream input = file.getInputStream()) {
            bytes = input.readNBytes(10 * 1024 * 1024 + 1);
        }
        if (bytes.length > 10 * 1024 * 1024) throw new IllegalArgumentException("Arquivo muito grande.");
        String extension = validatedExtension(file.getContentType(), bytes);
        String storedName = studentId + "-" + operationId + extension;
        return new PreparedFile(storedName, HexFormat.of().formatHex(sha256().digest(bytes)), bytes);
    }

    @Override
    public void write(PreparedFile file) throws IOException {
        Path destination = root.resolve(file.storedName()).normalize();
        requireInsideRoot(destination);
        // All writers for this path share the reserved hash. Writing the same bytes
        // without truncation keeps a verified file valid even if requests overlap.
        Files.write(destination, file.bytes(), StandardOpenOption.CREATE, StandardOpenOption.WRITE,
                StandardOpenOption.SYNC, LinkOption.NOFOLLOW_LINKS);
    }

    @Override
    public boolean hasCompleteFile(String storedName, long size, String expectedSha256) throws IOException {
        Path path = root.resolve(storedName).normalize();
        requireInsideRoot(path);
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS) || Files.size(path) != size) return false;
        var digest = sha256();
        try (var input = new DigestInputStream(Files.newInputStream(path, LinkOption.NOFOLLOW_LINKS), digest)) {
            return input.transferTo(OutputStream.nullOutputStream()) == size
                    && HexFormat.of().formatHex(digest.digest()).equals(expectedSha256);
        }
    }

    @Override
    public Resource load(String storedName) {
        try {
            Path path = root.resolve(storedName).normalize();
            requireInsideRoot(path);
            Resource resource = new UrlResource(path.toUri());
            if (!resource.exists() || !resource.isReadable()) throw new NotFoundException("Arquivo não encontrado.");
            return resource;
        } catch (java.net.MalformedURLException exception) {
            throw new NotFoundException("Arquivo não encontrado.");
        }
    }

    private void requireInsideRoot(Path path) {
        if (!path.startsWith(root)) throw new SecurityException("Invalid storage path");
    }

    private MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private String validatedExtension(String type, byte[] bytes) throws IOException {
        if (type.equals("application/pdf") && startsWith(bytes, new byte[]{37, 80, 68, 70, 45})) return ".pdf";
        if (type.equals("image/png") && startsWith(bytes, new byte[]{(byte)137,80,78,71,13,10,26,10})
                && javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(bytes)) != null) return ".png";
        if (type.equals("image/jpeg") && startsWith(bytes, new byte[]{(byte)255,(byte)216,(byte)255})
                && javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(bytes)) != null) return ".jpg";
        if (type.equals("application/vnd.openxmlformats-officedocument.wordprocessingml.document")) {
            boolean contentTypes = false;
            boolean document = false;
            long expanded = 0;
            int entries = 0;
            try (var zip = new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(bytes))) {
                java.util.zip.ZipEntry entry;
                byte[] buffer = new byte[8192];
                while ((entry = zip.getNextEntry()) != null) {
                    if (++entries > 2000 || entry.getName().contains("..") || entry.getName().startsWith("/")
                            || entry.getName().toLowerCase(java.util.Locale.ROOT).contains("vbaproject"))
                        throw new IllegalArgumentException("Documento inválido.");
                    contentTypes |= entry.getName().equals("[Content_Types].xml");
                    document |= entry.getName().equals("word/document.xml");
                    int count;
                    while ((count = zip.read(buffer)) != -1) {
                        expanded += count;
                        if (expanded > 50L * 1024 * 1024) throw new IllegalArgumentException("Documento expandido excede o limite.");
                    }
                }
            }
            if (contentTypes && document) return ".docx";
        }
        throw new IllegalArgumentException("O conteúdo não corresponde ao tipo de arquivo informado.");
    }

    private boolean startsWith(byte[] bytes, byte[] prefix) {
        return bytes.length >= prefix.length && java.util.Arrays.equals(java.util.Arrays.copyOf(bytes, prefix.length), prefix);
    }
}
