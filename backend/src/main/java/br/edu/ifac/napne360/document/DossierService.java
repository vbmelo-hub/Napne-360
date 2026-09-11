package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.security.CurrentUserService;
import br.edu.ifac.napne360.timeline.TimelineService;
import br.edu.ifac.napne360.timeline.TimelineVisibility;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class DossierService {
    private final DossierRepository dossiers;
    private final CurrentUserService currentUser;
    private final TimelineService timeline;
    private final AuditService audit;

    public DossierView get(Long studentId, Authentication auth, HttpServletRequest http) {
        DossierDocument document = dossiers.findByStudentId(studentId)
                .orElseGet(() -> DossierDocument.builder().studentId(studentId).build());
        UserAccount user = currentUser.require();
        boolean full = user.getRoles().contains(RoleName.NAPNE);
        audit.record(auth, http, "VIEW", "DOSSIER", studentId, "SUCCESS", full ? "full" : "pedagogical-redacted");
        return view(document, full);
    }

    public DossierView save(Long studentId, DossierRequest request, Authentication auth, HttpServletRequest http) {
        UserAccount user = currentUser.require();
        DossierDocument document = dossiers.findByStudentId(studentId)
                .orElseGet(() -> DossierDocument.builder().studentId(studentId).build());
        if (!java.util.Objects.equals(request.version(), document.getVersion()))
            throw new br.edu.ifac.napne360.common.ConflictException("O dossiê foi alterado. Recarregue antes de salvar.");
        if (document.getId() != null) document.getHistory().add(new DossierDocument.Revision(document.getVersion(),
                Map.of("identification", copy(document.getIdentification()), "educationalNeeds", copy(document.getEducationalNeeds()),
                        "healthAndSupport", copy(document.getHealthAndSupport()), "familyContext", copy(document.getFamilyContext()),
                        "schoolHistory", copy(document.getSchoolHistory()), "strengths", copy(document.getStrengths()),
                        "difficulties", copy(document.getDifficulties()), "initialInterventions", copy(document.getInitialInterventions())),
                document.getUpdatedBy(), document.getUpdatedAt()));
        document.setIdentification(copy(request.identification()));
        document.setEducationalNeeds(copy(request.educationalNeeds()));
        document.setHealthAndSupport(copy(request.healthAndSupport()));
        document.setFamilyContext(copy(request.familyContext()));
        document.setSchoolHistory(copy(request.schoolHistory()));
        document.setStrengths(copy(request.strengths()));
        document.setDifficulties(copy(request.difficulties()));
        document.setInitialInterventions(copy(request.initialInterventions()));
        document.setUpdatedBy(user.getEmail());
        document.setUpdatedAt(Instant.now());
        document = dossiers.save(document);
        timeline.append(studentId, "DOSSIER_UPDATED", "Dossiê atualizado", user.getName(), TimelineVisibility.RESTRICTED,
                Map.of("version", document.getVersion() == null ? 0 : document.getVersion()));
        audit.record(auth, http, "UPDATE", "DOSSIER", studentId, "SUCCESS", "Versão atualizada");
        return view(document, true);
    }

    private DossierView view(DossierDocument d, boolean full) {
        return new DossierView(d.getId(), d.getStudentId(), full ? d.getIdentification() : Map.of(), full ? d.getEducationalNeeds() : Map.of(),
                full ? d.getHealthAndSupport() : Map.of(), full ? d.getFamilyContext() : Map.of(),
                full ? d.getSchoolHistory() : Map.of(), full ? d.getStrengths() : Map.of(), full ? d.getDifficulties() : Map.of(), full ? d.getInitialInterventions() : Map.of(),
                d.getUpdatedBy(), d.getUpdatedAt(), d.getVersion(), !full);
    }

    private Map<String, Object> copy(Map<String, Object> source) {
        return source == null ? new LinkedHashMap<>() : new LinkedHashMap<>(source);
    }

    public record DossierRequest(Map<String, Object> identification, Map<String, Object> educationalNeeds,
                                 Map<String, Object> healthAndSupport, Map<String, Object> familyContext,
                                 Map<String, Object> schoolHistory, Map<String, Object> strengths,
                                 Map<String, Object> difficulties, Map<String, Object> initialInterventions, Long version) {}
    public record DossierView(String id, Long studentId, Map<String, Object> identification,
                              Map<String, Object> educationalNeeds, Map<String, Object> healthAndSupport,
                              Map<String, Object> familyContext, Map<String, Object> schoolHistory,
                              Map<String, Object> strengths, Map<String, Object> difficulties,
                              Map<String, Object> initialInterventions, String updatedBy, Instant updatedAt,
                              Long version, boolean redacted) {}
}
