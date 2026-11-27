package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.common.ConflictException;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.identity.ReferenceIdDeserializer;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.SubjectRepository;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.identity.UserAccountRepository;
import br.edu.ifac.napne360.identity.UserEmailHistoryService;
import br.edu.ifac.napne360.security.CurrentUserService;
import br.edu.ifac.napne360.timeline.MutationProjection;
import br.edu.ifac.napne360.timeline.TimelineVisibility;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.bson.types.ObjectId;
import org.springframework.data.mongodb.core.query.Update;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;

@Service
@RequiredArgsConstructor
@Slf4j
public class CareRecordService {
    private static final Set<CareRecordType> PEDAGOGICAL_VISIBLE = Set.of(
            CareRecordType.PEDAGOGICAL_GUIDANCE, CareRecordType.ACTION_PLAN,
            CareRecordType.TEACHER_FEEDBACK, CareRecordType.TUTOR_OBSERVATION);
    private final CareRecordRepository records;
    private final CurrentUserService currentUser;
    private final DocumentMutationOutbox projections;
    private final br.edu.ifac.napne360.security.AccessGuard access;
    private final br.edu.ifac.napne360.casework.NapneCaseRepository cases;
    private final DocumentTemplateRepository templates;
    private final SubjectRepository subjects;
    private final TransactionTemplate transactions;
    private final UserEmailHistoryService emailHistory;
    private final UserAccountRepository users;

    public List<CareRecordDocument> list(Long studentId, CareRecordType type) {
        UserAccount user = currentUser.require();
        List<CareRecordDocument> values = type == null
                ? records.findByStudentIdOrderByCreatedAtDesc(studentId)
                : records.findByStudentIdAndTypeOrderByCreatedAtDesc(studentId, type);
        boolean napne = user.getRoles().contains(RoleName.NAPNE);
        var authorEmails = napne ? Set.<String>of() : emailHistory.previouslyOwnedAddresses(user);
        if (!napne) {
            values = values.stream().filter(value -> visibleToPedagogicalTeam(studentId, value, authorEmails)).toList();
        }
        boolean writable = !values.isEmpty() && access.canWritePedagogical(studentId);
        return values.stream().map(value -> project(value, napne, writable && allowsType(user.getRoles(), value.getType())
                && (napne || authoredBy(value, authorEmails)))).toList();
    }

    public boolean canViewTimelineRecord(Long studentId, String recordId) {
        UserAccount user = currentUser.require();
        return records.findById(recordId)
                .filter(record -> studentId.equals(record.getStudentId()))
                .filter(record -> user.getRoles().contains(RoleName.NAPNE)
                        || visibleToPedagogicalTeam(studentId, record, emailHistory.previouslyOwnedAddresses(user)))
                .isPresent();
    }

    private boolean visibleToPedagogicalTeam(Long studentId, CareRecordDocument value, Set<String> authorEmails) {
        return PEDAGOGICAL_VISIBLE.contains(value.getType())
                && (value.getSubjectId() == null || access.canViewSubject(studentId, value.getSubjectId()))
                && (value.getStatus() != RecordStatus.DRAFT || authoredBy(value, authorEmails));
    }

    public CareRecordDocument create(Long studentId, CareRecordRequest request, Authentication auth, HttpServletRequest http) {
        UserAccount user = currentUser.require();
        validateType(user, request.type());
        if (request.status() == RecordStatus.ARCHIVED || request.status() == RecordStatus.SUPERSEDED)
            throw new IllegalArgumentException("Selecione Rascunho ou Finalizado ao criar um acompanhamento.");
        validateScope(studentId, request, user);
        if (request.caseId() != null && !user.getRoles().contains(RoleName.NAPNE)) {
            throw new AccessDeniedException("Somente o NAPNE pode vincular um caso ao criar o registro.");
        }
        Map<String,Object> content = new java.util.LinkedHashMap<>();
        templates.findByDocumentTypeAndActiveTrueOrderByUpdatedAtDesc(request.type().name()).stream().findFirst()
                .ifPresent(model -> content.putAll(model.getDefaults()));
        if (request.content()!=null) content.putAll(request.content());
        CareRecordDocument draft = CareRecordDocument.builder().id(new ObjectId().toHexString()).studentId(studentId).caseId(request.caseId())
                .subjectId(request.subjectId()).type(request.type()).status(request.status() == null ? RecordStatus.DRAFT : request.status())
                .title(request.title()).content(content)
                .createdBy(user.getEmail()).updatedBy(user.getEmail()).build();
        var event = mutation(draft, 0L, "CREATE", "CARE_RECORD_CREATED", "Registro de acompanhamento criado", user, auth, http);
        draft.setPendingProjections(List.of(event));
        UserAccount draftAuthor = draft.getStatus() == RecordStatus.DRAFT ? user : null;
        CareRecordDocument value = withLinkLocks(draft.getCaseId(), studentId, draft.getSubjectId(), draftAuthor,
                () -> records.save(draft));
        projections.enqueue(value.getId(), CareRecordDocument.class, event);
        return value;
    }

    private CareRecordDocument withLinkLocks(Long caseId, Long studentId, Long subjectId,
                                             UserAccount draftAuthor, Supplier<CareRecordDocument> mutation) {
        if (caseId == null && subjectId == null && draftAuthor == null) return mutation.get();

        var saved = new AtomicReference<CareRecordDocument>();
        try {
            return transactions.execute(status -> {
                if (caseId != null) {
                    var linkedCase = cases.findByIdAndStudentIdForLink(caseId, studentId)
                            .orElseThrow(() -> new IllegalArgumentException("Caso inválido para o estudante."));
                    if (!linkedCase.getStage().isActive()) throw new IllegalArgumentException("O caso não está ativo.");
                }
                if (subjectId != null) {
                    var subject = subjects.findByIdForUpdate(subjectId)
                            .orElseThrow(() -> new NotFoundException("Componente não encontrado."));
                    if (!subject.isActive() || !subject.getCourse().isActive()) {
                        throw new ConflictException("O componente está arquivado.");
                    }
                }
                if (draftAuthor != null) {
                    var account = users.findByIdForUpdate(draftAuthor.getId()).orElseThrow(
                            () -> new AccessDeniedException("Acesso negado."));
                    if (!account.isActive() || account.getSessionVersion() != draftAuthor.getSessionVersion()) {
                        throw new AccessDeniedException("A conta não pode mais salvar este rascunho. Entre novamente.");
                    }
                }
                var record = mutation.get();
                saved.set(record);
                return record;
            });
        } catch (RuntimeException e) {
            var record = saved.get();
            if (record == null) throw e;
            // Mongo has already acknowledged the write. The SQL transaction only holds link locks.
            log.warn("Falha ao concluir o bloqueio de vínculos após a gravação do acompanhamento {}", record.getId(), e);
            return record;
        }
    }

    public CareRecordDocument update(Long studentId, String id, CareRecordRequest request, Authentication auth, HttpServletRequest http) {
        UserAccount user = currentUser.require();
        CareRecordDocument value = records.findById(id).orElseThrow(() -> new NotFoundException("Registro não encontrado."));
        if (!studentId.equals(value.getStudentId())) throw new NotFoundException("Registro não encontrado.");
        validateType(user, value.getType());
        boolean napne = user.getRoles().contains(RoleName.NAPNE);
        if (!napne && !authoredBy(value, emailHistory.previouslyOwnedAddresses(user)))
            throw new AccessDeniedException("Somente o autor ou o NAPNE pode revisar este registro.");
        if (request.type() != value.getType() || !java.util.Objects.equals(request.subjectId(), value.getSubjectId()))
            throw new IllegalArgumentException("Vínculos do registro são imutáveis.");
        validateScope(studentId, request, user);
        boolean caseLinkPreserved = java.util.Objects.equals(request.caseId(), value.getCaseId())
                || (!napne && request.caseId() == null);
        if (!caseLinkPreserved) throw new IllegalArgumentException("Vínculos do registro são imutáveis.");
        if (request.version() == null || !java.util.Objects.equals(request.version(), value.getVersion()))
            throw new ConflictException("O registro foi alterado. Recarregue antes de salvar.");
        var status = request.status() == null ? value.getStatus() : request.status();
        var content = request.content() == null ? Map.<String, Object>of() : request.content();
        if (java.util.Objects.equals(value.getTitle(), request.title()) && value.getStatus() == status
                && java.util.Objects.equals(value.getContent(), content)) return project(value, napne, true);
        if (value.getStatus() == RecordStatus.ARCHIVED || value.getStatus() == RecordStatus.SUPERSEDED
                || status == RecordStatus.SUPERSEDED)
            throw new ConflictException("O acompanhamento histórico não permite alterações.");
        boolean archive = status == RecordStatus.ARCHIVED;
        if (archive && (!java.util.Objects.equals(value.getTitle(), request.title())
                || !java.util.Objects.equals(value.getContent(), content)))
            throw new IllegalArgumentException("Arquive o registro sem alterar seu conteúdo.");
        value.getHistory().add(new CareRecordDocument.Revision(value.getVersion(), value.getTitle(), value.getStatus(),
                new java.util.LinkedHashMap<>(value.getContent()), value.getUpdatedBy(), value.getUpdatedAt()));
        value.setTitle(request.title());
        value.setStatus(status);
        value.setContent(content);
        value.setUpdatedBy(user.getEmail());
        value.setUpdatedAt(Instant.now());
        long version = value.getVersion() + 1;
        var event = archive
                ? mutation(value, version, "ARCHIVE", "CARE_RECORD_ARCHIVED", "Registro de acompanhamento arquivado", user, auth, http)
                : mutation(value, version, "UPDATE", "CARE_RECORD_UPDATED", "Registro de acompanhamento atualizado", user, auth, http);
        var changes = new Update().set("title", value.getTitle()).set("status", value.getStatus())
                .set("content", value.getContent()).set("history", value.getHistory())
                .set("updatedBy", value.getUpdatedBy()).set("updatedAt", value.getUpdatedAt());
        Long subjectLock = value.getStatus() == RecordStatus.DRAFT ? value.getSubjectId() : null;
        UserAccount draftAuthor = status == RecordStatus.DRAFT ? user : null;
        withLinkLocks(null, studentId, subjectLock, draftAuthor, () -> {
            projections.update(value.getId(), value.getVersion(), changes, event, CareRecordDocument.class);
            return value;
        });
        value.setVersion(version);
        projections.enqueue(value.getId(), CareRecordDocument.class, event);
        return project(value, napne, true);
    }

    private MutationProjection mutation(CareRecordDocument value, long version, String action, String eventType,
                                        String title, UserAccount user, Authentication auth, HttpServletRequest http) {
        TimelineVisibility visibility = value.getStatus() != RecordStatus.ARCHIVED && PEDAGOGICAL_VISIBLE.contains(value.getType())
                ? TimelineVisibility.PEDAGOGICAL : TimelineVisibility.RESTRICTED;
        Map<String, Object> eventData = new java.util.LinkedHashMap<>();
        eventData.put("recordId", value.getId());
        eventData.put("type", value.getType().name());
        if (value.getSubjectId() != null) eventData.put("subjectId", value.getSubjectId());
        return new MutationProjection("care-record:" + value.getId() + ":" + version, value.getStudentId(), eventType,
                title, user.getName(), visibility, eventData, auth == null ? null : user.getId(), http == null ? null : http.getRemoteAddr(),
                action, "CARE_RECORD", value.getId(), value.getType().name(), value.getUpdatedAt());
    }

    private boolean authoredBy(CareRecordDocument value, Set<String> addresses) {
        return value.getCreatedBy() != null && addresses.contains(UserEmailHistoryService.normalize(value.getCreatedBy()));
    }

    public static boolean allowsType(Set<RoleName> roles, CareRecordType type) {
        return roles.contains(RoleName.NAPNE)
                || PEDAGOGICAL_VISIBLE.contains(type) && (roles.contains(RoleName.COTEP) || roles.contains(RoleName.COURSE_COORDINATOR))
                || type == CareRecordType.TEACHER_FEEDBACK && roles.contains(RoleName.TEACHER)
                || type == CareRecordType.TUTOR_OBSERVATION && roles.contains(RoleName.TUTOR);
    }

    private void validateType(UserAccount user, CareRecordType type) {
        if (!allowsType(user.getRoles(), type)) throw new AccessDeniedException("Tipo de acompanhamento fora do perfil autorizado.");
    }

    private void validateScope(Long studentId, CareRecordRequest request, UserAccount user) {
        if (!access.canWritePedagogical(studentId)) throw new AccessDeniedException("Access denied");
        if (request.type() == CareRecordType.TEACHER_FEEDBACK && request.subjectId() == null)
            throw new IllegalArgumentException("Selecione o componente curricular da devolutiva.");
        if (request.type() == CareRecordType.TEACHER_FEEDBACK && user.getRoles().contains(RoleName.TEACHER)
                && !user.getRoles().contains(RoleName.NAPNE)
                && !access.canTeachPei(studentId, request.subjectId()))
            throw new AccessDeniedException("O componente deve estar vinculado a uma atribuição docente válida.");
        if (request.subjectId() != null && !access.canViewSubject(studentId, request.subjectId()))
            throw new AccessDeniedException("Componente fora do vínculo autorizado.");
    }

    private CareRecordDocument project(CareRecordDocument value, boolean napne, boolean writable) {
        boolean editable = writable && value.getStatus() != RecordStatus.ARCHIVED && value.getStatus() != RecordStatus.SUPERSEDED;
        if (!napne) return value.toBuilder().caseId(null).editable(editable).build();
        value.setEditable(editable);
        return value;
    }

    public record CareRecordRequest(@JsonDeserialize(using = ReferenceIdDeserializer.class) Long caseId,
                                    Long subjectId, @NotNull CareRecordType type, RecordStatus status,
                                    @NotBlank String title, Map<String, Object> content, Long version) {}
}
