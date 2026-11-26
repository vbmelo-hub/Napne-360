package br.edu.ifac.napne360.pei;

import br.edu.ifac.napne360.common.ConflictException;
import lombok.RequiredArgsConstructor;
import org.bson.Document;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Repository;

import java.util.HashMap;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;
import java.util.stream.Stream;

@Repository
@RequiredArgsConstructor
class PeiSeriesStore {
    private final MongoOperations mongo;
    private final PeiRepository legacy;

    PeiSeries load(Long studentId, Long subjectId, String term) {
        var stored = mongo.findById(PeiSeries.key(studentId, subjectId, term), PeiSeries.class);
        if (stored != null) return stored;
        return PeiSeries.fromLegacy(studentId, subjectId, term,
                legacy.findByStudentIdAndSubjectIdAndAcademicTermOrderByRevisionDesc(studentId, subjectId, term));
    }

    Optional<PeiSeries> find(Long studentId, String revisionId) {
        var stored = mongo.findOne(Query.query(Criteria.where("studentId").is(studentId)
                .and("revisions.id").is(revisionId)), PeiSeries.class);
        if (stored != null) return Optional.of(stored);
        return legacy.findById(revisionId).filter(p -> studentId.equals(p.getStudentId()))
                .map(p -> load(studentId, p.getSubjectId(), p.getAcademicTerm()));
    }

    List<PeiSeries> list(Long studentId) {
        var groups = legacy.findByStudentIdOrderByUpdatedAtDesc(studentId).stream()
                .collect(Collectors.groupingBy(p -> PeiSeries.key(studentId, p.getSubjectId(), p.getAcademicTerm())));
        var series = new HashMap<String, PeiSeries>();
        groups.forEach((key, plans) -> {
            var first = plans.getFirst();
            series.put(key, PeiSeries.fromLegacy(studentId, first.getSubjectId(), first.getAcademicTerm(), plans));
        });
        for (var stored : mongo.find(Query.query(Criteria.where("studentId").is(studentId)), PeiSeries.class)) {
            series.put(stored.id(), stored);
        }
        return List.copyOf(series.values());
    }

    void save(PeiSeries before, PeiSeries after, PeiProjection projection) {
        if (before.version() == null) {
            try {
                mongo.insert(after);
                return;
            } catch (DuplicateKeyException collision) {
                throw conflict();
            }
        }
        var expected = Query.query(Criteria.where("id").is(before.id()).and("version").is(before.version()));
        var update = new Update().set("revisions", after.revisions()).set("version", after.version())
                .push("pendingProjections", projection);
        if (mongo.updateFirst(expected, update, PeiSeries.class).getMatchedCount() != 1) throw conflict();
    }

    Stream<PeiSeries> pendingProjections() {
        var query = Query.query(Criteria.where("pendingProjections.key").exists(true)).cursorBatchSize(50);
        query.fields().include("pendingProjections");
        return mongo.stream(query, PeiSeries.class);
    }

    void acknowledgeProjection(String seriesId, String projectionKey) {
        var filter = Query.query(Criteria.where("id").is(seriesId));
        var update = new Update().pull("pendingProjections", new Document("key", projectionKey));
        mongo.updateFirst(filter, update, PeiSeries.class);
    }

    private static ConflictException conflict() {
        return new ConflictException("A série de PEI foi alterada. Recarregue antes de continuar.");
    }
}
