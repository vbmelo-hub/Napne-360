package br.edu.ifac.napne360.pei;

import org.bson.Document;
import org.bson.types.ObjectId;
import org.junit.jupiter.api.Test;
import org.springframework.data.mongodb.core.convert.MappingMongoConverter;
import org.springframework.data.mongodb.core.convert.NoOpDbRefResolver;
import org.springframework.data.mongodb.core.convert.QueryMapper;
import org.springframework.data.mongodb.core.convert.UpdateMapper;
import org.springframework.data.mongodb.core.mapping.MongoMappingContext;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;

import java.time.Instant;
import java.util.Date;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class PeiSeriesMappingTest {
    @Test void transferMetadataSurvivesMongoReadAndConditionalRevisionUpdate() {
        var context = new MongoMappingContext();
        var converter = new MappingMongoConverter(NoOpDbRefResolver.INSTANCE, context);
        context.setSimpleTypeHolder(converter.getCustomConversions().getSimpleTypeHolder());
        converter.afterPropertiesSet();
        var transfer = new Document("fromTeacherId", 9L).append("toTeacherId", 12L)
                .append("transferredBy", "napne@example.test")
                .append("transferredAt", Date.from(Instant.parse("2026-11-25T19:00:00Z")))
                .append("reason", "Substituição docente");
        var content = new Document("teacherName", "Docente fictício").append("contents", List.of(
                new Document("description", "Atividade prática").append("workloadHours", null).append("priority", true)));
        var raw = new Document("_id", "1:2:+2026-2").append("studentId", 1L).append("subjectId", 2L)
                .append("academicTerm", "2026-2").append("version", 2L)
                .append("revisions", List.of(new Document("_id", "previous").append("revision", 7),
                        new Document("_id", "transferred").append("revision", 8).append("transfer", transfer)
                                .append("formVersion", "IFAC_76_2025").append("content", content)));

        var series = converter.read(PeiSeries.class, raw);
        assertThat(series.pendingProjections()).isEmpty();
        var entity = context.getRequiredPersistentEntity(PeiSeries.class);
        var update = new UpdateMapper(converter).getMappedObject(
                new Update().set("revisions", series.revisions()).set("version", 3L).getUpdateObject(), entity);
        var revisions = update.get("$set", Document.class).getList("revisions", Document.class);
        assertThat(revisions.getFirst()).doesNotContainKeys("transfer", "formVersion");
        assertThat(revisions.getLast()).containsEntry("formVersion", "IFAC_76_2025")
                .containsEntry("content", content);
        assertThat(revisions.getLast().get("transfer", Document.class)).isEqualTo(transfer);
    }

    @Test void legacyObjectIdsAndNewStringIdsRemainAddressableAfterEmbeddingAndCasUpdate() {
        var context = new MongoMappingContext();
        var converter = new MappingMongoConverter(NoOpDbRefResolver.INSTANCE, context);
        context.setSimpleTypeHolder(converter.getCustomConversions().getSimpleTypeHolder());
        converter.afterPropertiesSet();
        var entity = context.getRequiredPersistentEntity(PeiSeries.class);
        var legacyId = "650102030405060708090a0b";
        var newId = "54f93678-aeb3-4929-9434-d4237f8d5617";
        var plans = List.of(
                PeiDocument.builder().id(legacyId).storageVersion(3L).build(),
                PeiDocument.builder().id(newId).storageVersion(0L).allowedActions(List.of("EDIT")).build());
        var series = new PeiSeries("1:2:+2026-2", 1L, 2L, "2026-2", 2L, plans, List.of());
        var raw = new Document();
        converter.write(series, raw);
        var revisions = raw.getList("revisions", Document.class);
        assertThat(revisions).extracting(row -> row.get("_id")).containsExactly(new ObjectId(legacyId), newId);
        assertThat(revisions.getLast()).doesNotContainKey("allowedActions");
        assertThat(converter.read(PeiSeries.class, raw).revisions()).extracting(PeiDocument::getId)
                .containsExactly(legacyId, newId);

        var queryMapper = new QueryMapper(converter);
        for (String id : List.of(legacyId, newId)) {
            var filter = queryMapper.getMappedObject(
                    Query.query(Criteria.where("studentId").is(1L).and("revisions.id").is(id)).getQueryObject(), entity);
            assertThat(filter).containsEntry("revisions._id", id.equals(legacyId) ? new ObjectId(id) : id);
        }
        var cas = queryMapper.getMappedObject(
                Query.query(Criteria.where("id").is(series.id()).and("version").is(2L)).getQueryObject(), entity);
        assertThat(cas).containsEntry("_id", series.id()).containsEntry("version", 2L);
        var update = new UpdateMapper(converter).getMappedObject(
                new Update().set("revisions", plans).set("version", 3L).getUpdateObject(), entity);
        var updatedPlans = update.get("$set", Document.class).getList("revisions", Document.class);
        assertThat(updatedPlans).extracting(row -> row.get("_id")).containsExactly(new ObjectId(legacyId), newId);
    }
}
