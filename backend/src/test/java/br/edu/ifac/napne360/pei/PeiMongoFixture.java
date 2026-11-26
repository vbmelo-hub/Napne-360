package br.edu.ifac.napne360.pei;

import com.mongodb.client.result.UpdateResult;
import org.bson.Document;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.UpdateDefinition;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.mockito.Mockito.*;

final class PeiMongoFixture {
    private final Map<String, PeiSeries> data = new ConcurrentHashMap<>();
    final MongoOperations mongo = mock(MongoOperations.class, withSettings().strictness(org.mockito.quality.Strictness.LENIENT));
    final PeiSeriesStore store;
    volatile Runnable beforeWrite = () -> {};
    volatile Runnable beforeAcknowledge = () -> {};

    void seed(PeiSeries series) {
        data.put(series.id(), new PeiSeries(series.id(), series.studentId(), series.subjectId(),
                series.academicTerm(), 0L, series.revisions(), List.of()));
    }

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
        when(mongo.stream(any(Query.class), eq(PeiSeries.class))).thenAnswer(call ->
                data.values().stream().filter(s -> !s.pendingProjections().isEmpty()).toList().stream());
        when(mongo.insert(any(PeiSeries.class))).thenAnswer(call -> {
            PeiSeries series = call.getArgument(0);
            beforeWrite.run();
            if (data.putIfAbsent(series.id(), series) != null) throw new DuplicateKeyException("duplicate _id");
            return series;
        });
        when(mongo.updateFirst(any(Query.class), any(UpdateDefinition.class), eq(PeiSeries.class))).thenAnswer(call -> {
            var filter = call.<Query>getArgument(0).getQueryObject();
            var update = call.<UpdateDefinition>getArgument(1).getUpdateObject();
            var id = filter.getString("id");
            var matched = new AtomicBoolean();
            if (update.containsKey("$pull")) {
                beforeAcknowledge.run();
                var key = update.get("$pull", Document.class).get("pendingProjections", Document.class).getString("key");
                data.computeIfPresent(id, (keyId, previous) -> {
                    matched.set(true);
                    var remaining = previous.pendingProjections().stream().filter(p -> !p.key().equals(key)).toList();
                    return new PeiSeries(id, previous.studentId(), previous.subjectId(), previous.academicTerm(),
                            previous.version(), previous.revisions(), remaining);
                });
            } else {
                beforeWrite.run();
                var fields = update.get("$set", Document.class);
                var projection = update.get("$push", Document.class).get("pendingProjections", PeiProjection.class);
                data.computeIfPresent(id, (key, previous) -> {
                    if (!previous.version().equals(filter.getLong("version"))) return previous;
                    matched.set(true);
                    var pending = new ArrayList<>(previous.pendingProjections());
                    pending.add(projection);
                    return new PeiSeries(id, previous.studentId(), previous.subjectId(), previous.academicTerm(),
                            fields.getLong("version"), fields.getList("revisions", PeiDocument.class), List.copyOf(pending));
                });
            }
            return UpdateResult.acknowledged(matched.get() ? 1 : 0, matched.get() ? 1L : 0L, null);
        });
    }
}
