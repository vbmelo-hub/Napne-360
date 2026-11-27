package br.edu.ifac.napne360.timeline;

import br.edu.ifac.napne360.document.CareRecordService;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.security.AccessGuard;
import br.edu.ifac.napne360.security.CurrentUserService;
import br.edu.ifac.napne360.student.StudentStatusHistory;
import br.edu.ifac.napne360.student.StudentStatusHistoryRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Spliterator;
import java.util.Spliterators;
import java.util.function.Consumer;
import java.util.function.Predicate;
import java.util.stream.Stream;
import java.util.stream.StreamSupport;

@RestController
@RequestMapping("/api/v1/students/{studentId}/timeline")
@RequiredArgsConstructor
public class TimelineController {
    private final TimelineRepository timeline;
    private final AccessGuard access;
    private final CurrentUserService currentUser;
    private final CareRecordService careRecords;
    private final StudentStatusHistoryRepository statusHistory;

    @GetMapping
    public List<TimelineEventDocument> list(@PathVariable Long studentId,
                                            @RequestParam(required = false) String type,
                                            @RequestParam(required = false) String actor,
                                            @RequestParam(required = false) Instant from,
                                            @RequestParam(required = false) Instant to,
                                            @RequestParam(defaultValue = "100") int limit) {
        var visible = visibleEvents(studentId, type, actor, from, to);
        int safeLimit = Math.max(1, Math.min(limit, 200));
        try (var results = streamEvents(studentId)) {
            return results.filter(visible).limit(safeLimit).toList();
        }
    }

    @GetMapping("/page")
    public TimelinePage page(@PathVariable Long studentId,
                             @RequestParam(required = false) String type,
                             @RequestParam(required = false) String actor,
                             @RequestParam(required = false) String actorKey,
                             @RequestParam(required = false) Instant from,
                             @RequestParam(required = false) Instant to,
                             @RequestParam(defaultValue = "0") int page,
                             @RequestParam(defaultValue = "10") int size) {
        var visible = visibleEvents(studentId, type, actor, from, to);
        if (page < 0 || size < 1 || size > 100) throw new IllegalArgumentException("Paginação inválida.");
        long offset = (long) page * size;
        long total = 0;
        var content = new ArrayList<TimelineEventDocument>(size);
        try (var results = streamEvents(studentId)) {
            var entries = results.filter(event -> actorKey == null || actorKey.equals(authorKey(event)))
                    .filter(visible).iterator();
            while (entries.hasNext()) {
                var event = entries.next();
                if (total >= offset && content.size() < size) content.add(event);
                total++;
            }
        }
        long totalPages = (total + size - 1) / size;
        return new TimelinePage(content, total, totalPages, page, size);
    }

    @GetMapping("/actors")
    public List<AuthorOption> actors(@PathVariable Long studentId) {
        var visible = visibleEvents(studentId, null, null, null, null);
        var authors = new LinkedHashMap<String, TimelineEventDocument>();
        try (var results = streamEvents(studentId)) {
            results.filter(visible).filter(event -> event.getActor() != null && !event.getActor().isBlank())
                    .forEach(event -> authors.putIfAbsent(authorKey(event), event));
        }
        var countsByName = new HashMap<String, Integer>();
        authors.values().forEach(event -> countsByName.merge(event.getActor().toLowerCase(Locale.ROOT), 1, Integer::sum));
        return authors.entrySet().stream().map(entry -> {
            var event = entry.getValue();
            String label = event.getActor();
            String detail = countsByName.get(label.toLowerCase(Locale.ROOT)) == 1 ? null
                    : event.getActorId() == null ? "Nome histórico sem identificação individual" : "Conta #" + event.getActorId();
            return new AuthorOption(entry.getKey(), label, detail);
        }).sorted(Comparator.comparing(AuthorOption::label, String.CASE_INSENSITIVE_ORDER).thenComparing(AuthorOption::id))
                .toList();
    }

    private static String authorKey(TimelineEventDocument event) {
        if (event.getActorId() != null) return "account:" + event.getActorId();
        return event.getActor() == null ? null : "name:" + event.getActor();
    }

    private Predicate<TimelineEventDocument> visibleEvents(Long studentId, String type, String actor,
                                                           Instant from, Instant to) {
        access.requireView(studentId);
        if (from != null && to != null && from.isAfter(to)) {
            throw new IllegalArgumentException("A data inicial deve ser anterior ou igual à data final.");
        }
        boolean canViewRestricted = currentUser.require().getRoles().contains(RoleName.NAPNE);
        String typePrefix = type == null ? "" : type.strip().toUpperCase(Locale.ROOT);
        String author = actor == null ? "" : actor.strip();
        var peiPermissions = new HashMap<PeiScope, Boolean>();
        var subjectPermissions = new HashMap<Long, Boolean>();
        var recordPermissions = new HashMap<String, Boolean>();
        return event -> {
            if (!studentId.equals(event.getStudentId()) || event.getVisibility() == null
                    || (!canViewRestricted && event.getVisibility() == TimelineVisibility.RESTRICTED)) return false;
            String eventType = event.getEventType() == null ? "" : event.getEventType().toUpperCase(Locale.ROOT);
            Instant date = event.getCreatedAt();
            if (!eventType.startsWith(typePrefix) || (!author.isEmpty() && !author.equalsIgnoreCase(event.getActor()))
                    || (from != null && (date == null || date.isBefore(from)))
                    || (to != null && (date == null || date.isAfter(to)))) return false;

            var data = event.getData();
            if (data == null) return false;
            var subject = data.get("subjectId");
            if (eventType.startsWith("PEI_")) {
                Long subjectId = subject instanceof Number id ? id.longValue() : null;
                String term = data.get("academicTerm") instanceof String code ? code : null;
                Long offeringId = data.get("offeringId") instanceof Number id ? id.longValue() : null;
                if ((data.get("academicTerm") != null && term == null)
                        || (data.get("offeringId") != null && offeringId == null)) return false;
                var scope = new PeiScope(subjectId, term, offeringId);
                return peiPermissions.computeIfAbsent(scope, key -> term == null && offeringId == null
                        ? access.canViewPei(studentId, subjectId)
                        : access.canViewPei(studentId, subjectId, term, offeringId));
            }
            if (eventType.startsWith("CARE_RECORD_") && !canViewRestricted) {
                if (!(data.get("recordId") instanceof String id)
                        || !recordPermissions.computeIfAbsent(id, key -> careRecords.canViewTimelineRecord(studentId, key))) {
                    return false;
                }
            }
            return !data.containsKey("subjectId")
                    || subject instanceof Number id
                            && subjectPermissions.computeIfAbsent(id.longValue(), key -> access.canViewSubject(studentId, key));
        };
    }

    private Stream<TimelineEventDocument> streamEvents(Long studentId) {
        if (!currentUser.require().getRoles().contains(RoleName.NAPNE))
            return timeline.streamByStudentIdOrderByCreatedAtDescIdDesc(studentId);
        var history = statusHistory.findByStudentIdOrderByRecordedAtDescIdDesc(studentId);
        var documents = timeline.streamByStudentIdOrderByCreatedAtDescIdDesc(studentId);
        if (history.isEmpty()) return documents;

        var events = documents.iterator();
        var changes = history.stream().map(TimelineController::statusEvent).iterator();
        var dateOrder = Comparator.nullsLast(Comparator.<Instant>reverseOrder());
        var merged = new Spliterators.AbstractSpliterator<TimelineEventDocument>(Long.MAX_VALUE, Spliterator.ORDERED) {
            private TimelineEventDocument event;
            private TimelineEventDocument change;

            @Override
            public boolean tryAdvance(Consumer<? super TimelineEventDocument> emit) {
                if (event == null && events.hasNext()) event = events.next();
                if (change == null && changes.hasNext()) change = changes.next();
                if (event == null && change == null) return false;
                if (change == null || event != null && dateOrder.compare(event.getCreatedAt(), change.getCreatedAt()) < 0) {
                    emit.accept(event);
                    event = null;
                } else {
                    emit.accept(change);
                    change = null;
                }
                return true;
            }
        };
        return StreamSupport.stream(merged, false).onClose(documents::close);
    }

    private static TimelineEventDocument statusEvent(StudentStatusHistory value) {
        var data = new LinkedHashMap<String, Object>();
        data.put("effectiveDate", value.getEffectiveDate().toString());
        if (value.getPreviousStatus() != null) data.put("previousStatus", value.getPreviousStatus().name());
        if (value.getNewStatus() != null) data.put("newStatus", value.getNewStatus().name());
        if (value.getReason() != null) data.put("reason", value.getReason().name());
        if (value.getObservations() != null) data.put("observations", value.getObservations());
        var title = switch (value.getAction()) {
            case STATUS_CHANGED -> "Situação acadêmica alterada";
            case ARCHIVED -> "Cadastro do estudante arquivado";
            case UNARCHIVED -> "Cadastro do estudante desarquivado";
        };
        return TimelineEventDocument.builder().id("student-status:" + value.getId()).studentId(value.getStudentId())
                .eventType("STUDENT_" + value.getAction().name()).title(title).actor(value.getAuthorName())
                .actorId(value.getAuthorId())
                .visibility(TimelineVisibility.RESTRICTED).createdAt(value.getRecordedAt()).data(data).build();
    }

    private record PeiScope(Long subjectId, String term, Long offeringId) {}

    public record AuthorOption(String id, String label, String detail) {}

    public record TimelinePage(List<TimelineEventDocument> content, long totalElements, long totalPages, int number, int size) {}
}
