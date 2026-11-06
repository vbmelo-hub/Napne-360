package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.security.CurrentUserService;
import br.edu.ifac.napne360.timeline.TimelineService;
import br.edu.ifac.napne360.timeline.TimelineVisibility;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class CareRecordService {
    private static final Set<CareRecordType> PEDAGOGICAL_VISIBLE = Set.of(
            CareRecordType.PEDAGOGICAL_GUIDANCE, CareRecordType.ACTION_PLAN,
            CareRecordType.TEACHER_FEEDBACK, CareRecordType.TUTOR_OBSERVATION);
    private final CareRecordRepository records;
    private final CurrentUserService currentUser;
    private final TimelineService timeline;
    private final AuditService audit;
    private final br.edu.ifac.napne360.security.AccessGuard access;
    private final br.edu.ifac.napne360.casework.NapneCaseRepository cases;
    private final DocumentTemplateRepository templates;

    public List<CareRecordDocument> list(Long studentId, CareRecordType type) {
        UserAccount user = currentUser.require();
        List<CareRecordDocument> values = type == null
                ? records.findByStudentIdOrderByCreatedAtDesc(studentId)
                : records.findByStudentIdAndTypeOrderByCreatedAtDesc(studentId, type);
        if (user.getRoles().contains(RoleName.NAPNE)) return values;
        return values.stream().filter(value -> PEDAGOGICAL_VISIBLE.contains(value.getType()))
                .filter(value -> value.getSubjectId() == null || access.canViewSubject(studentId, value.getSubjectId()))
                .filter(value -> value.getStatus() != RecordStatus.DRAFT || user.getEmail().equals(value.getCreatedBy())).toList();
    }

    public CareRecordDocument create(Long studentId, CareRecordRequest request, Authentication auth, HttpServletRequest http) {
        UserAccount user = currentUser.require();
        validateType(user, request.type());
        validateScope(studentId, request, user);
        Map<String,Object> content = new java.util.LinkedHashMap<>();
        templates.findByDocumentTypeAndActiveTrueOrderByUpdatedAtDesc(request.type().name()).stream().findFirst()
                .ifPresent(model -> content.putAll(model.getDefaults()));
        if (request.content()!=null) content.putAll(request.content());
        CareRecordDocument value = records.save(CareRecordDocument.builder().studentId(studentId).caseId(request.caseId())
                .subjectId(request.subjectId()).type(request.type()).status(request.status() == null ? RecordStatus.DRAFT : request.status())
                .title(request.title()).content(content)
                .createdBy(user.getEmail()).updatedBy(user.getEmail()).build());
        TimelineVisibility visibility = request.type() == CareRecordType.PEDAGOGICAL_GUIDANCE
                || request.type() == CareRecordType.ACTION_PLAN || request.type() == CareRecordType.TEACHER_FEEDBACK
                || request.type() == CareRecordType.TUTOR_OBSERVATION
                ? TimelineVisibility.PEDAGOGICAL : TimelineVisibility.RESTRICTED;
        Map<String, Object> eventData = new java.util.LinkedHashMap<>();
        eventData.put("recordId", value.getId());
        eventData.put("type", value.getType().name());
        if (value.getSubjectId() != null) eventData.put("subjectId", value.getSubjectId());
        timeline.append(studentId, "CARE_RECORD_CREATED", "Registro de acompanhamento criado", user.getName(), visibility, eventData);
        audit.record(auth, http, "CREATE", "CARE_RECORD", value.getId(), "SUCCESS", value.getType().name());
        return value;
    }

    public CareRecordDocument update(Long studentId, String id, CareRecordRequest request, Authentication auth, HttpServletRequest http) {
        UserAccount user = currentUser.require();
        CareRecordDocument value = records.findById(id).orElseThrow(() -> new NotFoundException("Registro não encontrado."));
        if (!studentId.equals(value.getStudentId())) throw new NotFoundException("Registro não encontrado.");
        validateType(user, value.getType());
        if (request.type() != value.getType() || !java.util.Objects.equals(request.subjectId(), value.getSubjectId())
                || !java.util.Objects.equals(request.caseId(), value.getCaseId())) throw new IllegalArgumentException("Vínculos do registro são imutáveis.");
        validateScope(studentId, request, user);
        if (!user.getRoles().contains(RoleName.NAPNE) && !user.getEmail().equals(value.getCreatedBy()))
            throw new AccessDeniedException("Somente o autor ou o NAPNE pode revisar este registro.");
        value.getHistory().add(new CareRecordDocument.Revision(value.getVersion(), value.getTitle(), value.getStatus(),
                new java.util.LinkedHashMap<>(value.getContent()), value.getUpdatedBy(), value.getUpdatedAt()));
        value.setTitle(request.title());
        value.setStatus(request.status() == null ? value.getStatus() : request.status());
        value.setContent(request.content() == null ? Map.of() : request.content());
        value.setUpdatedBy(user.getEmail());
        value.setUpdatedAt(Instant.now());
        value = records.save(value);
        audit.record(auth, http, "UPDATE", "CARE_RECORD", value.getId(), "SUCCESS", value.getType().name());
        return value;
    }

    private void validateType(UserAccount user, CareRecordType type) {
        if (user.getRoles().contains(RoleName.NAPNE)) return;
        if (PEDAGOGICAL_VISIBLE.contains(type) && (user.getRoles().contains(RoleName.COTEP)
                || user.getRoles().contains(RoleName.COURSE_COORDINATOR))) return;
        if (type == CareRecordType.TEACHER_FEEDBACK && user.getRoles().contains(RoleName.TEACHER)) return;
        if (type == CareRecordType.TUTOR_OBSERVATION && user.getRoles().contains(RoleName.TUTOR)) return;
        throw new AccessDeniedException("Record type not permitted for current role");
    }

    private void validateScope(Long studentId, CareRecordRequest request, UserAccount user) {
        if (!access.canWritePedagogical(studentId)) throw new AccessDeniedException("Access denied");
        if (request.caseId() != null && !cases.findById(request.caseId()).map(c -> c.getStudent().getId().equals(studentId)).orElse(false))
            throw new IllegalArgumentException("Caso inválido para o estudante.");
        if (request.type() == CareRecordType.TEACHER_FEEDBACK && request.subjectId() == null)
            throw new IllegalArgumentException("Selecione o componente curricular da devolutiva.");
        if (request.subjectId() != null && !access.canViewSubject(studentId, request.subjectId()))
            throw new AccessDeniedException("Componente fora do vínculo autorizado.");
    }

    public record CareRecordRequest(Long caseId, Long subjectId, @NotNull CareRecordType type, RecordStatus status,
                                    @NotBlank String title, Map<String, Object> content) {}
}
