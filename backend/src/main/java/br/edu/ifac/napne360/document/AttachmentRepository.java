package br.edu.ifac.napne360.document;

import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface AttachmentRepository extends MongoRepository<AttachmentDocument, String> {
    List<AttachmentDocument> findByStudentIdAndArchivedFalseOrderByUploadedAtDesc(Long studentId);
}
