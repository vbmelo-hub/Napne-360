package br.edu.ifac.napne360.casework;

import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.common.ConflictException;
import br.edu.ifac.napne360.identity.ReferenceIdDeserializer;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.identity.UserAccountRepository;
import br.edu.ifac.napne360.security.AccessGuard;
import br.edu.ifac.napne360.security.CurrentUserService;
import br.edu.ifac.napne360.student.Student;
import br.edu.ifac.napne360.timeline.MutationProjection;
import br.edu.ifac.napne360.timeline.TimelineVisibility;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.security.access.AccessDeniedException;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.Objects;

@Service
@RequiredArgsConstructor
public class CaseService {
    private final NapneCaseRepository cases;
    private final CurrentUserService currentUser;
    private final CaseMutationOutbox projections;
    private final CaseHistoryRepository history;
    private final UserAccountRepository users;
    private final AccessGuard access;
    private final CaseStageConfigurationService stageConfiguration;

    @Transactional(readOnly = true)
    public List<CaseView> list(Student student) {
        if (!currentUser.require().getRoles().contains(RoleName.NAPNE)) return List.of();
        var catalogue = stageConfiguration.current();
        return cases.findByStudentIdOrderByOpenedAtDesc(student.getId()).stream()
                .map(value -> view(value, catalogue)).toList();
    }

    @Transactional
    public CaseView create(Student student, CaseRequest request, Authentication auth, HttpServletRequest http) {
        requireCampusAccess(student.getId());
        UserAccount user = currentUser.require();
        var catalogue = stageConfiguration.current();
        NapneCase value = cases.saveAndFlush(NapneCase.builder().student(student).source(request.source().trim())
                .summary(request.summary()).responsible(user).build());
        recordHistory(value, CaseHistory.Type.OPENED, null, null, user, value.getOpenedAt(), null, catalogue);
        stageProjection(value, user, auth, http, value.getOpenedAt(), "CASE_OPENED", "Caso NAPNE aberto",
                Map.of("caseId", value.getId(), "stage", value.getStage().code()), "CREATE", null);
        return view(value, catalogue);
    }

    @Transactional
    public CaseView changeStage(Long caseId, CaseStageRequest request, Authentication auth, HttpServletRequest http) {
        NapneCase value = requireCase(caseId);
        requireVersion(value, request.version());
        var catalogue = stageConfiguration.current();
        CaseStage previous = value.getStage();
        CaseStage next = request.stage();
        boolean sameStage = previous.equals(next);
        if (sameStage && Objects.equals(value.getSummary(), request.summary())) return view(value, catalogue);
        boolean allowed = sameStage ? previous.isActive()
                : catalogue.nextOptions(previous).stream().anyMatch(option -> option.code().equals(next));
        if (!allowed) throw new IllegalArgumentException("A alteração não é permitida nesta etapa do caso.");

        String reason = null;
        if (previous.equals(CaseStage.CLOSED) && next.equals(CaseStage.SCREENING)) {
            reason = CaseText.trimBrowserWhitespace(request.reason());
            if (reason.isEmpty() || reason.length() > 500)
                throw new IllegalArgumentException("Informe um motivo de reabertura de até 500 caracteres.");
        }

        UserAccount user = currentUser.require();
        // MySQL stores both case and history timestamps with microsecond precision.
        Instant occurredAt = Instant.now().truncatedTo(ChronoUnit.MICROS);
        value.setStage(next);
        value.setSummary(request.summary());
        if (next.equals(CaseStage.CLOSED)) value.setClosedAt(occurredAt);
        else if (next.isActive()) value.setClosedAt(null);
        value = cases.saveAndFlush(value);
        recordHistory(value, CaseHistory.Type.STAGE_CHANGED, previous, value.getResponsible(), user, occurredAt, reason, catalogue);
        stageProjection(value, user, auth, http, occurredAt, "CASE_STAGE_CHANGED", "Etapa do caso atualizada",
                Map.of("caseId", value.getId(), "from", previous.code(), "to", next.code()), "UPDATE_STAGE",
                previous.code() + " -> " + next.code());
        return view(value, catalogue);
    }

    @Transactional(readOnly = true)
    public Long studentId(Long caseId) {
        return cases.findById(caseId).orElseThrow(() -> new NotFoundException("Caso não encontrado.")).getStudent().getId();
    }

    @Transactional(readOnly = true)
    public CaseView get(Long caseId) {
        return view(requireCase(caseId), stageConfiguration.current());
    }

    @Transactional(readOnly = true)
    public List<ResponsibleCandidate> candidates(Long caseId) {
        NapneCase value = requireCase(caseId);
        return users.findResponsibleCandidates(value.getStudent().getCampus().getId(), RoleName.NAPNE).stream()
                .map(user -> new ResponsibleCandidate(user.getId(), user.getName())).toList();
    }

    @Transactional
    public CaseView transfer(Long caseId, ResponsibleRequest request, Authentication auth, HttpServletRequest http) {
        NapneCase value = requireCase(caseId);
        requireVersion(value, request.version());
        if (!value.getStage().isActive())
            throw new ConflictException("Não é possível transferir um caso encerrado ou arquivado.");
        if (request.responsibleId() == null || request.responsibleId() <= 0)
            throw new IllegalArgumentException("Responsável inválido.");
        UserAccount next = users.findById(request.responsibleId()).orElseThrow(() -> new IllegalArgumentException("Responsável inválido."));
        if (!next.isActive() || !next.getRoles().contains(RoleName.NAPNE) || next.getCampus() == null
                || !next.getCampus().getId().equals(value.getStudent().getCampus().getId()))
            throw new IllegalArgumentException("O responsável deve ser NAPNE ativo do mesmo campus.");
        var catalogue = stageConfiguration.current();
        UserAccount previous = value.getResponsible();
        if (previous.getId().equals(next.getId())) return view(value, catalogue);
        UserAccount actor = currentUser.require();
        value.setResponsible(next);
        value = cases.saveAndFlush(value);
        Instant occurredAt = Instant.now();
        recordHistory(value, CaseHistory.Type.RESPONSIBLE_CHANGED, value.getStage(), previous, actor,
                occurredAt, request.reason(), catalogue);
        stageProjection(value, actor, auth, http, occurredAt, "CASE_RESPONSIBLE_CHANGED", "Responsável pelo caso atualizado",
                Map.of("caseId", value.getId(), "fromResponsibleId", previous.getId(), "toResponsibleId", next.getId()),
                "UPDATE_RESPONSIBLE", null);
        return view(value, catalogue);
    }

    @Transactional(readOnly = true)
    public HistoryPage history(Long caseId, int page, int size, CaseHistory.Type type) {
        requireCase(caseId);
        if (page < 0 || size < 1 || size > 100 || (long) page * size > Integer.MAX_VALUE)
            throw new IllegalArgumentException("Paginação inválida.");
        var pagination = PageRequest.of(page, size, Sort.by(Sort.Direction.DESC, "version", "id"));
        var values = type == null ? history.findByNapneCaseId(caseId, pagination)
                : history.findByNapneCaseIdAndType(caseId, type, pagination);
        return new HistoryPage(values.getContent().stream().map(entry -> new CaseHistoryView(entry.getId(), caseId, entry.getVersion(), entry.getType(),
                entry.getFromStage(), entry.getToStage(), entry.getFromResponsibleId(), entry.getFromResponsible(),
                entry.getToResponsibleId(), entry.getToResponsible(), entry.getActorId(), entry.getActor(), entry.getOccurredAt(), entry.getReason(),
                historyLabel(entry.getFromStage(), entry.getFromStageLabel()), historyLabel(entry.getToStage(), entry.getToStageLabel()))).toList(),
                values.getTotalElements(), values.getTotalPages(), values.getNumber(), values.getSize());
    }

    private static String historyLabel(CaseStage stage, String snapshot) {
        return snapshot == null ? CaseStageCatalogue.originalLabel(stage) : snapshot;
    }

    private NapneCase requireCase(Long caseId) {
        NapneCase value = cases.findById(caseId).orElseThrow(() -> new NotFoundException("Caso não encontrado."));
        requireCampusAccess(value.getStudent().getId());
        return value;
    }

    private void requireCampusAccess(Long studentId) {
        if (!access.canEditDossier(studentId)) throw new AccessDeniedException("Access denied");
    }

    private void requireVersion(NapneCase value, Long version) {
        if (version == null || version != value.getVersion()) throw new ConflictException("O caso foi alterado. Sincronize antes de salvar.");
    }

    private void recordHistory(NapneCase value, CaseHistory.Type type, CaseStage fromStage, UserAccount from,
                               UserAccount actor, Instant occurredAt, String reason, CaseStageCatalogue catalogue) {
        history.saveAndFlush(CaseHistory.builder().napneCase(value).version(value.getVersion()).type(type)
                .fromStage(fromStage).toStage(value.getStage())
                .fromStageLabel(catalogue.label(fromStage)).toStageLabel(catalogue.label(value.getStage()))
                .fromResponsibleId(from == null ? null : from.getId())
                .fromResponsible(from == null ? null : from.getName()).toResponsibleId(value.getResponsible().getId())
                .toResponsible(value.getResponsible().getName()).actorId(actor.getId()).actor(actor.getName())
                .occurredAt(occurredAt).reason(reason).build());
    }

    private void stageProjection(NapneCase value, UserAccount actor, Authentication auth, HttpServletRequest http, Instant occurredAt,
                                 String type, String title, Map<String, Object> data, String action, String details) {
        projections.stage(new MutationProjection("case:" + value.getId() + ":" + value.getVersion(), value.getStudent().getId(),
                type, title, actor.getName(), TimelineVisibility.RESTRICTED, data, auth == null ? null : actor.getId(),
                http == null ? null : http.getRemoteAddr(), action, "NAPNE_CASE", value.getId().toString(), details, occurredAt));
    }

    private CaseView view(NapneCase value, CaseStageCatalogue catalogue) {
        var stage = value.getStage();
        var options = catalogue.nextOptions(stage);
        return new CaseView(value.getId(), value.getStudent().getId(), stage, value.getSource(), value.getOpenedAt(),
                value.getClosedAt(), value.getResponsible().getId(), value.getResponsible().getName(), value.getSummary(), value.getVersion(),
                options.stream().map(CaseStageCatalogue.Option::code).toList(), catalogue.label(stage), options);
    }

    public record CaseRequest(@NotBlank String source, String summary) {}
    public record CaseStageRequest(@NotNull CaseStage stage, String summary,
                                   @JsonDeserialize(using = ReferenceIdDeserializer.class) Long version, String reason) {}
    public record ResponsibleRequest(@JsonDeserialize(using = ReferenceIdDeserializer.class) Long responsibleId,
                                     @JsonDeserialize(using = ReferenceIdDeserializer.class) Long version, @Size(max = 500) String reason) {}
    public record ResponsibleCandidate(Long id, String name) {}
    public record CaseHistoryView(Long id, Long caseId, long version, CaseHistory.Type type, CaseStage fromStage, CaseStage toStage,
                                  Long fromResponsibleId, String fromResponsible, Long toResponsibleId, String toResponsible,
                                  Long actorId, String actor, Instant occurredAt, String reason,
                                  String fromStageLabel, String toStageLabel) {}
    public record HistoryPage(List<CaseHistoryView> content, long totalElements, int totalPages, int number, int size) {}
    public record CaseView(Long id, Long studentId, CaseStage stage, String source, Instant openedAt, Instant closedAt,
                           Long responsibleId, String responsible, String summary, long version, List<CaseStage> allowedNextStages,
                           String stageLabel, List<CaseStageCatalogue.Option> stageOptions) {}
}
