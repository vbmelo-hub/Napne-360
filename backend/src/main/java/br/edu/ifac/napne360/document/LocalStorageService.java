package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.common.NotFoundException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Set;
import java.util.UUID;

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

    public StoredFile store(Long studentId, MultipartFile file) throws IOException {
        if (file.isEmpty() || file.getSize() > 10L * 1024 * 1024) throw new IllegalArgumentException("O arquivo deve ter entre 1 byte e 10 MB.");
        if (!ALLOWED_TYPES.contains(file.getContentType())) throw new IllegalArgumentException("Tipo de arquivo não permitido.");
        byte[] bytes;
        try (InputStream input = file.getInputStream()) {
            bytes = input.readNBytes(10 * 1024 * 1024 + 1);
        }
        if (bytes.length > 10 * 1024 * 1024) throw new IllegalArgumentException("Arquivo muito grande.");
        String extension = validatedExtension(file.getContentType(), bytes);
        String storedName = studentId + "-" + UUID.randomUUID() + extension;
        Path destination = root.resolve(storedName).normalize();
        requireInsideRoot(destination);
        MessageDigest digest;
        try { digest = MessageDigest.getInstance("SHA-256"); }
        catch (Exception exception) { throw new IllegalStateException(exception); }
        digest.update(bytes);
        Files.write(destination, bytes, java.nio.file.StandardOpenOption.CREATE_NEW);
        return new StoredFile(storedName, HexFormat.of().formatHex(digest.digest()));
    }

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
