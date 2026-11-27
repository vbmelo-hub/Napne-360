package br.edu.ifac.napne360.audit;

import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.identity.UserAccountRepository;
import br.edu.ifac.napne360.identity.UserEmailHistoryRepository;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

@Service
@RequiredArgsConstructor
public class AuditService {
    private final AuditEventRepository repository;
    private final UserAccountRepository users;
    private final UserEmailHistoryRepository emailHistory;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(Authentication authentication, HttpServletRequest request, String action,
                       String resourceType, Object resourceId, String outcome, String details) {
        UserAccount actor = authentication == null ? null : users.findByEmailIgnoreCase(authentication.getName())
                .or(() -> emailHistory.owner(authentication.getName())).orElse(null);
        repository.save(AuditEvent.builder()
                .actor(actor)
                .action(action)
                .resourceType(resourceType)
                .resourceId(resourceId == null ? null : resourceId.toString())
                .outcome(outcome)
                .ipAddress(request == null ? null : request.getRemoteAddr())
                .details(sanitize(details))
                .build());
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void recordWithAccountLock(UserAccount actor, HttpServletRequest request, String action, String details) {
        repository.save(AuditEvent.builder().actor(actor).action(action).resourceType("USER")
                .resourceId(actor.getId().toString()).outcome("SUCCESS")
                .ipAddress(request == null ? null : request.getRemoteAddr()).details(sanitize(details)).build());
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, timeout = 10)
    public void recordPeiMutation(String key, Long actorId, String ipAddress, String action,
                                  String revisionId, int revision, Instant occurredAt) {
        recordProjection(key, actorId, ipAddress, action, "PEI", revisionId, "Revisão " + revision, occurredAt);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW, timeout = 10)
    public void recordProjection(String key, Long actorId, String ipAddress, String action, String resourceType,
                                 String resourceId, String details, Instant occurredAt) {
        repository.insertProjectionIfAbsent(key, actorId, action, resourceType, resourceId, ipAddress, occurredAt,
                sanitize(details));
    }

    private String sanitize(String value) {
        if (value == null) return null;
        return value.replaceAll("[\\r\\n\\t]", " ").substring(0, Math.min(value.length(), 500));
    }
}
