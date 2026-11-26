package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.timeline.MutationProjection;
import lombok.RequiredArgsConstructor;
import org.bson.Document;
import org.springframework.data.mongodb.core.FindAndModifyOptions;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.stereotype.Repository;

import java.util.stream.Stream;

@Repository
@RequiredArgsConstructor
class AttachmentStateStore {
    private final MongoOperations mongo;

    AttachmentDocument confirmUpload(String id) {
        var criteria = Criteria.where("id").is(id).and("uploadPending").is(true);
        return update(criteria, new Update().unset("uploadPending"));
    }

    AttachmentDocument archive(Long studentId, String id, MutationProjection event) {
        var criteria = Criteria.where("id").is(id).and("studentId").is(studentId)
                .and("uploadPending").ne(true).and("archived").ne(true);
        return update(criteria, new Update().set("archived", true).push("pendingProjections", event));
    }

    Stream<AttachmentDocument> pendingUploads() {
        var query = Query.query(Criteria.where("uploadPending").is(true)).cursorBatchSize(50);
        return mongo.stream(query, AttachmentDocument.class);
    }

    Stream<AttachmentDocument> pendingProjections() {
        var query = Query.query(Criteria.where("pendingProjections.key").exists(true)
                .and("uploadPending").ne(true)).cursorBatchSize(50);
        query.fields().include("pendingProjections");
        return mongo.stream(query, AttachmentDocument.class);
    }

    void acknowledgeProjection(String id, String key) {
        var query = Query.query(Criteria.where("id").is(id));
        var update = new Update().pull("pendingProjections", new Document("key", key));
        mongo.updateFirst(query, update, AttachmentDocument.class);
    }

    private AttachmentDocument update(Criteria criteria, Update update) {
        return mongo.findAndModify(Query.query(criteria), update, FindAndModifyOptions.options().returnNew(true),
                AttachmentDocument.class);
    }
}
