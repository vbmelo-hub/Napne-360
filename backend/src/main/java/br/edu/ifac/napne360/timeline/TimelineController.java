package br.edu.ifac.napne360.timeline;

import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.security.AccessGuard;
import br.edu.ifac.napne360.security.CurrentUserService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.function.Predicate;

@RestController
@RequestMapping("/api/v1/students/{studentId}/timeline")
@RequiredArgsConstructor
public class TimelineController {
    private final TimelineRepository timeline;
    private final AccessGuard access;
    private final CurrentUserService currentUser;

    @GetMapping
    public List<TimelineEventDocument> list(@PathVariable Long studentId,
                                            @RequestParam(required = false) String type,
                                            @RequestParam(required = false) Instant from,
                                            @RequestParam(required = false) Instant to,
                                            @RequestParam(defaultValue = "100") int limit) {
        var visible = visibleEvents(studentId, type, from, to);
        int safeLimit = Math.max(1, Math.min(limit, 200));
        return timeline.findByStudentIdOrderByCreatedAtDesc(studentId).stream()
                .filter(visible)
                .limit(safeLimit)
                .toList();
    }

    @GetMapping("/page")
    public TimelinePage page(@PathVariable Long studentId,
                             @RequestParam(required = false) String type,
                             @RequestParam(required = false) Instant from,
                             @RequestParam(required = false) Instant to,
                             @RequestParam(defaultValue = "0") int page,
                             @RequestParam(defaultValue = "10") int size) {
        var visible = visibleEvents(studentId, type, from, to);
        if (page < 0 || size < 1 || size > 100) throw new IllegalArgumentException("Paginação inválida.");
        long offset = (long) page * size;
        long total = 0;
        var content = new ArrayList<TimelineEventDocument>(size);
        try (var results = timeline.streamByStudentIdOrderByCreatedAtDescIdDesc(studentId)) {
            var entries = results.filter(visible).iterator();
            while (entries.hasNext()) {
                var event = entries.next();
                if (total >= offset && content.size() < size) content.add(event);
                total++;
            }
        }
        long totalPages = (total + size - 1) / size;
        return new TimelinePage(content, total, totalPages, page, size);
    }

    private Predicate<TimelineEventDocument> visibleEvents(Long studentId, String type, Instant from, Instant to) {
        access.requireView(studentId);
        boolean canViewRestricted = currentUser.require().getRoles().contains(RoleName.NAPNE);
        String typePrefix = type == null || type.isBlank() ? "" : type.toUpperCase(Locale.ROOT);
        var peiPermissions = new HashMap<PeiScope, Boolean>();
        var subjectPermissions = new HashMap<Long, Boolean>();
        return event -> {
            String eventType = event.getEventType();
            if (!canViewRestricted && event.getVisibility() == TimelineVisibility.RESTRICTED
                    || !typePrefix.isEmpty() && (eventType == null || !eventType.toUpperCase(Locale.ROOT).startsWith(typePrefix))
                    || from != null && event.getCreatedAt().isBefore(from)
                    || to != null && event.getCreatedAt().isAfter(to)) return false;

            var data = event.getData();
            var subject = data.get("subjectId");
            if (eventType != null && eventType.startsWith("PEI_")) {
                Long subjectId = subject instanceof Number id ? id.longValue() : null;
                String term = data.get("academicTerm") instanceof String code ? code : null;
                Long offeringId = data.get("offeringId") instanceof Number id ? id.longValue() : null;
                var scope = new PeiScope(subjectId, term, offeringId);
                return peiPermissions.computeIfAbsent(scope, key -> term == null && offeringId == null
                        ? access.canViewPei(studentId, subjectId)
                        : access.canViewPei(studentId, subjectId, term, offeringId));
            }
            return !data.containsKey("subjectId")
                    || subject instanceof Number id
                            && subjectPermissions.computeIfAbsent(id.longValue(), key -> access.canViewSubject(studentId, key));
        };
    }

    private record PeiScope(Long subjectId, String term, Long offeringId) {}

    public record TimelinePage(List<TimelineEventDocument> content, long totalElements, long totalPages, int number, int size) {}
}
