package br.edu.ifac.napne360.timeline;

import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.security.AccessGuard;
import br.edu.ifac.napne360.security.CurrentUserService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;
import java.util.Set;

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
        access.requireView(studentId);
        UserAccount user = currentUser.require();
        boolean restricted = user.getRoles().contains(RoleName.NAPNE);
        int safeLimit = Math.max(1, Math.min(limit, 200));
        return timeline.findByStudentIdOrderByCreatedAtDesc(studentId).stream()
                .filter(event -> restricted || event.getVisibility() != TimelineVisibility.RESTRICTED)
                .filter(event -> !event.getData().containsKey("subjectId") ||
                        access.canViewSubject(studentId, ((Number) event.getData().get("subjectId")).longValue()))
                .filter(event -> type == null || type.isBlank() || event.getEventType().toUpperCase().startsWith(type.toUpperCase()))
                .filter(event -> from == null || !event.getCreatedAt().isBefore(from))
                .filter(event -> to == null || !event.getCreatedAt().isAfter(to))
                .limit(safeLimit)
                .toList();
    }
}
