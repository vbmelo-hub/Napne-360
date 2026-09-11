package br.edu.ifac.napne360.document;

import org.springframework.core.io.Resource;
import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;

/** Binary storage boundary. Metadata and authorization belong to the application. */
public interface DocumentStorage {
    StoredFile store(Long studentId, MultipartFile file) throws IOException;
    Resource load(String storedName);
    record StoredFile(String storedName, String sha256) {}
}
