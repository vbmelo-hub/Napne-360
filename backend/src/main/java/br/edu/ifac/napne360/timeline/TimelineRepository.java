package br.edu.ifac.napne360.timeline;

import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;

public interface TimelineRepository extends MongoRepository<TimelineEventDocument, String> {
    List<TimelineEventDocument> findByStudentIdOrderByCreatedAtDesc(Long studentId);
}
