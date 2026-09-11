package br.edu.ifac.napne360.casework;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.security.CurrentUserService;
import br.edu.ifac.napne360.student.Student;
import br.edu.ifac.napne360.timeline.TimelineService;
import br.edu.ifac.napne360.timeline.TimelineVisibility;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class CaseService {
    private final NapneCaseRepository cases;
    private final CurrentUserService currentUser;
    private final TimelineService timeline;
    private final AuditService audit;

    @Transactional(readOnly = true)
    public List<CaseView> list(Student student) {
        if (!currentUser.require().getRoles().contains(br.edu.ifac.napne360.identity.RoleName.NAPNE)) return List.of();
        return cases.findByStudentIdOrderByOpenedAtDesc(student.getId()).stream().map(this::view).toList();
    }

    @Transactional
    public CaseView create(Student student, CaseRequest request, Authentication auth, HttpServletRequest http) {
        UserAccount user = currentUser.require();
        NapneCase value = cases.save(NapneCase.builder().student(student).source(request.source().trim())
                .summary(request.summary()).responsible(user).build());
        timeline.append(student.getId(), "CASE_OPENED", "Caso NAPNE aberto", user.getName(), TimelineVisibility.RESTRICTED,
                Map.of("caseId", value.getId(), "stage", value.getStage().name()));
        audit.record(auth, http, "CREATE", "NAPNE_CASE", value.getId(), "SUCCESS", null);
        return view(value);
    }

    @Transactional
    public CaseView changeStage(Long caseId, CaseStageRequest request, Authentication auth, HttpServletRequest http) {
        NapneCase value = cases.findById(caseId).orElseThrow(() -> new NotFoundException("Caso não encontrado."));
        CaseStage previous = value.getStage();
        value.setStage(request.stage());
        value.setSummary(request.summary());
        if (request.stage() == CaseStage.CLOSED || request.stage() == CaseStage.ARCHIVED) value.setClosedAt(Instant.now());
        else value.setClosedAt(null);
        value = cases.save(value);
        UserAccount user = currentUser.require();
        timeline.append(value.getStudent().getId(), "CASE_STAGE_CHANGED", "Etapa do caso atualizada", user.getName(),
                TimelineVisibility.RESTRICTED, Map.of("from", previous.name(), "to", request.stage().name()));
        audit.record(auth, http, "UPDATE_STAGE", "NAPNE_CASE", value.getId(), "SUCCESS", previous + " -> " + request.stage());
        return view(value);
    }

    @Transactional(readOnly = true)
    public Long studentId(Long caseId) {
        return cases.findById(caseId).orElseThrow(() -> new NotFoundException("Caso não encontrado.")).getStudent().getId();
    }

    private CaseView view(NapneCase value) {
        return new CaseView(value.getId(), value.getStudent().getId(), value.getStage(), value.getSource(), value.getOpenedAt(),
                value.getClosedAt(), value.getResponsible().getId(), value.getResponsible().getName(), value.getSummary(), value.getVersion());
    }

    public record CaseRequest(@NotBlank String source, String summary) {}
    public record CaseStageRequest(@NotNull CaseStage stage, String summary) {}
    public record CaseView(Long id, Long studentId, CaseStage stage, String source, Instant openedAt, Instant closedAt,
                           Long responsibleId, String responsible, String summary, long version) {}
}
