package br.edu.ifac.napne360.admin;

import br.edu.ifac.napne360.document.CareRecordDocument;
import br.edu.ifac.napne360.document.RecordStatus;
import br.edu.ifac.napne360.identity.Subject;
import br.edu.ifac.napne360.pei.PeiSeriesStore;
import br.edu.ifac.napne360.timeline.TimelineEventDocument;
import lombok.RequiredArgsConstructor;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
@RequiredArgsConstructor
class CourseSubjectReferences {
    private final MongoOperations mongo;
    private final PeiSeriesStore pei;

    boolean hasHistory(List<Subject> subjects) {
        if (subjects.isEmpty()) return false;
        var ids = subjects.stream().map(Subject::getId).toList();
        return mongo.exists(Query.query(Criteria.where("subjectId").in(ids)), CareRecordDocument.class)
                || pei.hasHistory(ids)
                || mongo.exists(Query.query(Criteria.where("data.subjectId").in(ids)), TimelineEventDocument.class);
    }

    boolean hasOpenWork(List<Subject> subjects) {
        if (subjects.isEmpty()) return false;
        var ids = subjects.stream().map(Subject::getId).toList();
        return mongo.exists(Query.query(Criteria.where("subjectId").in(ids).and("status").is(RecordStatus.DRAFT)),
                CareRecordDocument.class) || pei.hasOpenWork(ids);
    }
}
