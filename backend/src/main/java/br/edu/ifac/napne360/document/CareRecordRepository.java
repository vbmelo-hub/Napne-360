package br.edu.ifac.napne360.document;

import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface CareRecordRepository extends MongoRepository<CareRecordDocument, String> {
    List<CareRecordDocument> findByStudentIdOrderByCreatedAtDesc(Long studentId);
    List<CareRecordDocument> findByStudentIdAndTypeOrderByCreatedAtDesc(Long studentId, CareRecordType type);
}
