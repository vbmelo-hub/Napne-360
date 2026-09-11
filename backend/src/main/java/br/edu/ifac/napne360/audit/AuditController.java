package br.edu.ifac.napne360.audit;

import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;

@RestController
@RequestMapping("/api/v1/audit")
@PreAuthorize("hasRole('NAPNE')")
@RequiredArgsConstructor
public class AuditController {
    private final AuditEventRepository events;
    private final br.edu.ifac.napne360.security.CurrentUserService currentUser;

    @GetMapping
    @Transactional(readOnly = true)
    public Page<AuditView> list(@RequestParam String resourceType, @RequestParam String resourceId, Pageable pageable) {
        var user = currentUser.require();
        if (user.getCampus() == null) throw new org.springframework.security.access.AccessDeniedException("Campus required");
        return events.findByResourceTypeAndResourceIdAndActorCampusIdOrderByOccurredAtDesc(resourceType, resourceId, user.getCampus().getId(), pageable)
                .map(e -> new AuditView(e.getId(), e.getActor() == null ? null : e.getActor().getEmail(), e.getAction(),
                        e.getResourceType(), e.getResourceId(), e.getOutcome(), e.getOccurredAt(), e.getDetails()));
    }

    public record AuditView(Long id, String actor, String action, String resourceType, String resourceId,
                            String outcome, Instant occurredAt, String details) {}
}
