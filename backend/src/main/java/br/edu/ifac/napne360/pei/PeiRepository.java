package br.edu.ifac.napne360.pei;

import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface PeiRepository extends MongoRepository<PeiDocument, String> {
    List<PeiDocument> findByStudentIdOrderByUpdatedAtDesc(Long studentId);
    List<PeiDocument> findByStudentIdAndSubjectIdAndAcademicTermOrderByRevisionDesc(Long studentId, Long subjectId, String academicTerm);
}
