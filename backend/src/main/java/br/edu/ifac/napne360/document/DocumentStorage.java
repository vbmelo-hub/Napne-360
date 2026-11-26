package br.edu.ifac.napne360.document;

import org.springframework.core.io.Resource;
import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;
import java.util.UUID;

/** Binary storage boundary. Metadata and authorization belong to the application. */
public interface DocumentStorage {
    PreparedFile prepare(Long studentId, String operationId, MultipartFile file) throws IOException;
    void write(PreparedFile file) throws IOException;
    boolean hasCompleteFile(String storedName, long size, String sha256) throws IOException;
    Resource load(String storedName);

    default StoredFile store(Long studentId, MultipartFile file) throws IOException {
        var prepared = prepare(studentId, UUID.randomUUID().toString(), file);
        write(prepared);
        return new StoredFile(prepared.storedName(), prepared.sha256());
    }

    record PreparedFile(String storedName, String sha256, byte[] bytes) {
        public long size() {
            return bytes.length;
        }
    }

    record StoredFile(String storedName, String sha256) {}
}
