package br.edu.ifac.napne360.document;

import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.data.mongodb.repository.Query;

import java.util.List;

public interface AttachmentRepository extends MongoRepository<AttachmentDocument, String> {
    @Query(value = "{ 'studentId': ?0, 'archived': { '$ne': true }, 'uploadPending': { '$ne': true } }",
           sort = "{ 'uploadedAt': -1 }")
    List<AttachmentDocument> findActiveByStudentId(Long studentId);

    @Query(value = "{ 'studentId': ?0, 'uploadPending': { '$ne': true } }",
           sort = "{ 'uploadedAt': -1 }")
    List<AttachmentDocument> findConfirmedByStudentId(Long studentId);
}
