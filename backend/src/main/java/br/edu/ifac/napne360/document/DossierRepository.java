package br.edu.ifac.napne360.document;

import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.Optional;

public interface DossierRepository extends MongoRepository<DossierDocument, String> {
    Optional<DossierDocument> findByStudentId(Long studentId);
}
