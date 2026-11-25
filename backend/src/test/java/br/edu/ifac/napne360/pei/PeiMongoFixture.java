package br.edu.ifac.napne360.pei;

import com.mongodb.client.result.UpdateResult;
import org.bson.Document;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.UpdateDefinition;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import static org.mockito.Mockito.*;

final class PeiMongoFixture {
    private final Map<String, PeiSeries> data = new ConcurrentHashMap<>();
    final MongoOperations mongo = mock(MongoOperations.class, withSettings().strictness(org.mockito.quality.Strictness.LENIENT));
    final PeiSeriesStore store;
    volatile Runnable beforeWrite = () -> {};

    PeiMongoFixture(PeiRepository legacy) {
        store = new PeiSeriesStore(mongo, legacy);
        when(mongo.findById(anyString(), eq(PeiSeries.class))).thenAnswer(call -> data.get(call.getArgument(0)));
        when(mongo.findOne(any(Query.class), eq(PeiSeries.class))).thenAnswer(call -> {
            var filter = call.<Query>getArgument(0).getQueryObject();
            return data.values().stream().filter(s -> s.studentId().equals(filter.get("studentId"))
                    && s.find(filter.getString("revisions.id")).isPresent()).findFirst().orElse(null);
        });
        when(mongo.find(any(Query.class), eq(PeiSeries.class))).thenAnswer(call -> {
            var filter = call.<Query>getArgument(0).getQueryObject();
            return data.values().stream().filter(s -> s.studentId().equals(filter.get("studentId"))).toList();
        });
        when(mongo.insert(any(PeiSeries.class))).thenAnswer(call -> {
            PeiSeries series = call.getArgument(0);
            beforeWrite.run();
            if (data.putIfAbsent(series.id(), series) != null) throw new DuplicateKeyException("duplicate _id");
            return series;
        });
        when(mongo.updateFirst(any(Query.class), any(UpdateDefinition.class), eq(PeiSeries.class))).thenAnswer(call -> {
            beforeWrite.run();
            var filter = call.<Query>getArgument(0).getQueryObject();
            var fields = call.<UpdateDefinition>getArgument(1).getUpdateObject().get("$set", Document.class);
            var id = filter.getString("id");
            var previous = data.get(id);
            if (previous == null || !previous.version().equals(filter.getLong("version"))) {
                return UpdateResult.acknowledged(0, 0L, null);
            }
            List<PeiDocument> revisions = fields.getList("revisions", PeiDocument.class);
            var next = new PeiSeries(id, previous.studentId(), previous.subjectId(), previous.academicTerm(),
                    fields.getLong("version"), revisions);
            boolean saved = data.replace(id, previous, next);
            return UpdateResult.acknowledged(saved ? 1 : 0, saved ? 1L : 0L, null);
        });
    }
}
