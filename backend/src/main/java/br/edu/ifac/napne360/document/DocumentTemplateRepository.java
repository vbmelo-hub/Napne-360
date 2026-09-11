package br.edu.ifac.napne360.document;
import org.springframework.data.mongodb.repository.MongoRepository;
import java.util.List;
public interface DocumentTemplateRepository extends MongoRepository<DocumentTemplate,String>{
    List<DocumentTemplate> findByDocumentTypeAndActiveTrueOrderByUpdatedAtDesc(String documentType);
}
