package br.edu.ifac.napne360.timeline;

import org.springframework.data.mongodb.repository.MongoRepository;

import java.util.List;
import java.util.stream.Stream;

public interface TimelineRepository extends MongoRepository<TimelineEventDocument, String> {
    List<TimelineEventDocument> findByStudentIdOrderByCreatedAtDesc(Long studentId);
    Stream<TimelineEventDocument> streamByStudentIdOrderByCreatedAtDescIdDesc(Long studentId);
}
