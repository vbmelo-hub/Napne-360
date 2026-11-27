package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.common.ConflictException;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.identity.ReferenceIdDeserializer;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.SubjectRepository;
import br.edu.ifac.napne360.identity.UserAccount;
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

    public List<CareRecordDocument> list(Long studentId, CareRecordType type) {
        UserAccount user = currentUser.require();
        List<CareRecordDocument> values = type == null
                ? records.findByStudentIdOrderByCreatedAtDesc(studentId)
                : records.findByStudentIdAndTypeOrderByCreatedAtDesc(studentId, type);
        if (!user.getRoles().contains(RoleName.NAPNE)) {
            values = values.stream().filter(value -> PEDAGOGICAL_VISIBLE.contains(value.getType()))
                    .filter(value -> value.getSubjectId() == null || access.canViewSubject(studentId, value.getSubjectId()))
                    .filter(value -> value.getStatus() != RecordStatus.DRAFT || user.getEmail().equals(value.getCreatedBy())).toList();
        }
        return values.stream().map(value -> projectCaseLink(value, user)).toList();
    }

    public CareRecordDocument create(Long studentId, CareRecordRequest request, Authentication auth, HttpServletRequest http) {
        UserAccount user = currentUser.require();
        validateType(user, request.type());
        validateScope(studentId, request);
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
        CareRecordDocument value = withLinkLocks(draft.getCaseId(), studentId, draft.getSubjectId(),
                () -> records.save(draft));
        projections.enqueue(value.getId(), CareRecordDocument.class, event);
        return value;
    }

    private CareRecordDocument withLinkLocks(Long caseId, Long studentId, Long subjectId,
                                             Supplier<CareRecordDocument> mutation) {
        if (caseId == null && subjectId == null) return mutation.get();

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
        if (!napne && !user.getEmail().equals(value.getCreatedBy()))
            throw new AccessDeniedException("Somente o autor ou o NAPNE pode revisar este registro.");
        if (request.type() != value.getType() || !java.util.Objects.equals(request.subjectId(), value.getSubjectId()))
            throw new IllegalArgumentException("Vínculos do registro são imutáveis.");
        validateScope(studentId, request);
        boolean caseLinkPreserved = java.util.Objects.equals(request.caseId(), value.getCaseId())
                || (!napne && request.caseId() == null);
        if (!caseLinkPreserved) throw new IllegalArgumentException("Vínculos do registro são imutáveis.");
        if (request.version() == null || !java.util.Objects.equals(request.version(), value.getVersion()))
            throw new ConflictException("O registro foi alterado. Recarregue antes de salvar.");
        value.getHistory().add(new CareRecordDocument.Revision(value.getVersion(), value.getTitle(), value.getStatus(),
                new java.util.LinkedHashMap<>(value.getContent()), value.getUpdatedBy(), value.getUpdatedAt()));
        value.setTitle(request.title());
        value.setStatus(request.status() == null ? value.getStatus() : request.status());
        value.setContent(request.content() == null ? Map.of() : request.content());
        value.setUpdatedBy(user.getEmail());
        value.setUpdatedAt(Instant.now());
        long version = value.getVersion() + 1;
        var event = mutation(value, version, "UPDATE", "CARE_RECORD_UPDATED", "Registro de acompanhamento atualizado", user, auth, http);
        var changes = new Update().set("title", value.getTitle()).set("status", value.getStatus())
                .set("content", value.getContent()).set("history", value.getHistory())
                .set("updatedBy", value.getUpdatedBy()).set("updatedAt", value.getUpdatedAt());
        Long subjectLock = value.getStatus() == RecordStatus.DRAFT ? value.getSubjectId() : null;
        withLinkLocks(null, studentId, subjectLock, () -> {
            projections.update(value.getId(), value.getVersion(), changes, event, CareRecordDocument.class);
            return value;
        });
        value.setVersion(version);
        projections.enqueue(value.getId(), CareRecordDocument.class, event);
        return projectCaseLink(value, user);
    }

    private MutationProjection mutation(CareRecordDocument value, long version, String action, String eventType,
                                        String title, UserAccount user, Authentication auth, HttpServletRequest http) {
        TimelineVisibility visibility = PEDAGOGICAL_VISIBLE.contains(value.getType())
                ? TimelineVisibility.PEDAGOGICAL : TimelineVisibility.RESTRICTED;
        Map<String, Object> eventData = new java.util.LinkedHashMap<>();
        eventData.put("recordId", value.getId());
        eventData.put("type", value.getType().name());
        if (value.getSubjectId() != null) eventData.put("subjectId", value.getSubjectId());
        return new MutationProjection("care-record:" + value.getId() + ":" + version, value.getStudentId(), eventType,
                title, user.getName(), visibility, eventData, auth == null ? null : user.getId(), http == null ? null : http.getRemoteAddr(),
                action, "CARE_RECORD", value.getId(), value.getType().name(), value.getUpdatedAt());
    }

    private void validateType(UserAccount user, CareRecordType type) {
        if (user.getRoles().contains(RoleName.NAPNE)) return;
        if (PEDAGOGICAL_VISIBLE.contains(type) && (user.getRoles().contains(RoleName.COTEP)
                || user.getRoles().contains(RoleName.COURSE_COORDINATOR))) return;
        if (type == CareRecordType.TEACHER_FEEDBACK && user.getRoles().contains(RoleName.TEACHER)) return;
        if (type == CareRecordType.TUTOR_OBSERVATION && user.getRoles().contains(RoleName.TUTOR)) return;
        throw new AccessDeniedException("Record type not permitted for current role");
    }

    private void validateScope(Long studentId, CareRecordRequest request) {
        if (!access.canWritePedagogical(studentId)) throw new AccessDeniedException("Access denied");
        if (request.type() == CareRecordType.TEACHER_FEEDBACK && request.subjectId() == null)
            throw new IllegalArgumentException("Selecione o componente curricular da devolutiva.");
        if (request.subjectId() != null && !access.canViewSubject(studentId, request.subjectId()))
            throw new AccessDeniedException("Componente fora do vínculo autorizado.");
    }

    private CareRecordDocument projectCaseLink(CareRecordDocument value, UserAccount user) {
        if (user.getRoles().contains(RoleName.NAPNE)) return value;
        return value.toBuilder().caseId(null).build();
    }

    public record CareRecordRequest(@JsonDeserialize(using = ReferenceIdDeserializer.class) Long caseId,
                                    Long subjectId, @NotNull CareRecordType type, RecordStatus status,
                                    @NotBlank String title, Map<String, Object> content, Long version) {}
}
