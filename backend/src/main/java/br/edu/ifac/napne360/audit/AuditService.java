package br.edu.ifac.napne360.audit;

import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.identity.UserAccountRepository;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class AuditService {
    private final AuditEventRepository repository;
    private final UserAccountRepository users;

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void record(Authentication authentication, HttpServletRequest request, String action,
                       String resourceType, Object resourceId, String outcome, String details) {
        UserAccount actor = authentication == null ? null : users.findByEmailIgnoreCase(authentication.getName()).orElse(null);
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

    private String sanitize(String value) {
        if (value == null) return null;
        return value.replaceAll("[\\r\\n\\t]", " ").substring(0, Math.min(value.length(), 500));
    }
}
