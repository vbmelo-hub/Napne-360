package br.edu.ifac.napne360.pei;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.common.ConflictException;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.document.DossierDocument;
import br.edu.ifac.napne360.document.DossierRepository;
import br.edu.ifac.napne360.identity.Subject;
import br.edu.ifac.napne360.identity.SubjectRepository;
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

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class PeiService {
    private final PeiRepository peis;
    private final DossierRepository dossiers;
    private final SubjectRepository subjects;
    private final CurrentUserService currentUser;
    private final TimelineService timeline;
    private final AuditService audit;
    private final br.edu.ifac.napne360.security.AccessGuard access;
    private final br.edu.ifac.napne360.identity.UserAccountRepository users;
    private final br.edu.ifac.napne360.student.StudentAssignmentRepository assignments;
    private final br.edu.ifac.napne360.document.DocumentTemplateRepository templates;

    public List<PeiDocument> list(Long studentId) {
        return peis.findByStudentIdOrderByUpdatedAtDesc(studentId).stream()
                .filter(p -> access.canViewSubject(studentId, p.getSubjectId())).toList();
    }

    public PeiDocument get(Long studentId, String id) {
        PeiDocument pei = peis.findById(id).orElseThrow(() -> new NotFoundException("PEI não encontrado."));
        if (!studentId.equals(pei.getStudentId())) throw new NotFoundException("PEI não encontrado.");
        if (!access.canViewSubject(studentId, pei.getSubjectId())) throw new org.springframework.security.access.AccessDeniedException("Access denied");
        return pei;
    }

    public PeiDocument createDraft(Student student, PeiCreateRequest request, Authentication auth, HttpServletRequest http) {
        Subject subject = subjects.findById(request.subjectId()).orElseThrow(() -> new NotFoundException("Componente não encontrado."));
        if (!subject.getCourse().getId().equals(student.getCourse().getId())) {
            throw new IllegalArgumentException("O componente deve pertencer ao curso do estudante.");
        }
        UserAccount user = currentUser.require();
        Long teacherId = request.teacherId() == null && user.getRoles().contains(br.edu.ifac.napne360.identity.RoleName.TEACHER)
                ? user.getId() : request.teacherId();
        if (teacherId != null) {
            UserAccount teacher = users.findById(teacherId).orElseThrow(() -> new IllegalArgumentException("Docente inválido."));
            if (!teacher.isActive() || !teacher.getRoles().contains(br.edu.ifac.napne360.identity.RoleName.TEACHER)
                    || teacher.getCampus() == null || !teacher.getCampus().getId().equals(student.getCampus().getId())
                    || !assignments.existsByStudentIdAndUserIdAndSubjectIdAndActiveTrue(student.getId(), teacherId, subject.getId())) {
                throw new IllegalArgumentException("O docente deve estar ativo e vinculado ao estudante e componente.");
            }
        }
        int revision = peis.findByStudentIdAndSubjectIdAndAcademicTermOrderByRevisionDesc(
                student.getId(), subject.getId(), request.academicTerm()).stream().findFirst().map(PeiDocument::getRevision).orElse(0) + 1;
        PeiDocument pei = PeiDocument.builder().studentId(student.getId()).subjectId(subject.getId()).teacherId(teacherId)
                .academicTerm(request.academicTerm()).revision(revision).content(template(student, subject)).createdBy(user.getEmail())
                .updatedBy(user.getEmail()).build();
        pei = peis.save(pei);
        timeline.append(student.getId(), "PEI_CREATED", "Rascunho de PEI criado", user.getName(), TimelineVisibility.PEDAGOGICAL,
                Map.of("peiId", pei.getId(), "subjectId", subject.getId(), "revision", revision));
        audit.record(auth, http, "CREATE", "PEI", pei.getId(), "SUCCESS", "Rascunho determinístico; revisão humana obrigatória");
        return pei;
    }

    public PeiDocument createVersion(Long studentId, String id, PeiUpdateRequest request,
                                     Authentication auth, HttpServletRequest http) {
        PeiDocument previous = get(studentId, id);
        if (previous.getStatus() == PeiStatus.ARCHIVED || previous.getStatus() == PeiStatus.SUPERSEDED)
            throw new ConflictException("Somente a versão atual pode ser revisada.");
        if (request.status() != null && request.status() != PeiStatus.DRAFT && request.status() != PeiStatus.IN_REVIEW)
            throw new IllegalArgumentException("Revisões devem ser rascunhos ou estar em revisão. A aprovação exige a operação de revisão humana.");
        UserAccount user = currentUser.require();
        previous.setStatus(PeiStatus.SUPERSEDED);
        previous.setUpdatedBy(user.getEmail());
        previous.setUpdatedAt(Instant.now());
        PeiDocument next = PeiDocument.builder().studentId(previous.getStudentId()).subjectId(previous.getSubjectId())
                .teacherId(previous.getTeacherId()).academicTerm(previous.getAcademicTerm()).revision(previous.getRevision() + 1)
                .status(request.status() == null ? PeiStatus.DRAFT : request.status())
                .content(request.content() == null ? Map.of() : new LinkedHashMap<>(request.content()))
                .createdBy(previous.getCreatedBy()).updatedBy(user.getEmail()).build();
        next = peis.save(next);
        peis.save(previous);
        timeline.append(studentId, "PEI_REVISED", "Nova versão do PEI", user.getName(), TimelineVisibility.PEDAGOGICAL,
                Map.of("peiId", next.getId(), "revision", next.getRevision(), "subjectId", next.getSubjectId()));
        audit.record(auth, http, "REVISE", "PEI", next.getId(), "SUCCESS", "Revisão " + next.getRevision());
        return next;
    }

    public PeiDocument approve(Long studentId, String id, Authentication auth, HttpServletRequest http) {
        PeiDocument pei = get(studentId, id);
        if (pei.getStatus() != PeiStatus.IN_REVIEW) {
            throw new ConflictException("Envie a versão atual para revisão antes de aprovar.");
        }
        for (String field : List.of("generalObjectives", "specificObjectives", "contents", "teachingStrategies", "assessmentCriteria", "assessmentInstruments")) {
            Object value = pei.getContent().get(field);
            if (value == null || value.toString().isBlank() || value instanceof java.util.Collection<?> c && c.isEmpty())
                throw new IllegalArgumentException("Preencha os objetivos, conteúdos, estratégias e avaliação antes de aprovar.");
        }
        if (pei.getTeacherId() == null) throw new IllegalArgumentException("Identifique o docente responsável antes da aprovação.");
        if (!(pei.getContent().get("skillsInventory") instanceof Map<?,?> inventory))
            throw new IllegalArgumentException("Preencha o inventário de habilidades.");
        for (String dimension : emptyInventory().keySet()) {
            if (!(inventory.get(dimension) instanceof String rating) || !java.util.Set.of("REALIZA_COM_AJUDA", "REALIZA_SEM_AJUDA", "NAO_REALIZA", "NAO_OBSERVADO").contains(rating))
                throw new IllegalArgumentException("Escolha uma opção válida em cada dimensão do inventário.");
        }
        UserAccount reviewer = currentUser.require();
        pei.setStatus(PeiStatus.APPROVED);
        pei.setReviewedBy(reviewer.getEmail());
        pei.setReviewedAt(Instant.now());
        pei.setUpdatedAt(Instant.now());
        pei = peis.save(pei);
        timeline.append(studentId, "PEI_APPROVED", "PEI aprovado após revisão humana", reviewer.getName(),
                TimelineVisibility.PEDAGOGICAL, Map.of("peiId", pei.getId(), "revision", pei.getRevision(), "subjectId", pei.getSubjectId()));
        audit.record(auth, http, "APPROVE", "PEI", pei.getId(), "SUCCESS", "Revisão humana registrada");
        return pei;
    }

    private Map<String, Object> template(Student student, Subject subject) {
        DossierDocument dossier = dossiers.findByStudentId(student.getId()).orElse(null);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("student", student.getDisplayName());
        result.put("course", student.getCourse().getName());
        result.put("subject", subject.getName());
        result.put("workloadHours", subject.getWorkloadHours());
        result.put("syllabus", subject.getSyllabus() == null ? "" : subject.getSyllabus());
        result.put("generalObjectives", "");
        result.put("specificObjectives", List.of());
        result.put("eliminatedObjectives", List.of());
        result.put("alternativeObjectives", List.of());
        result.put("complementaryObjectives", List.of());
        result.put("professionalSkills", List.of());
        result.put("prerequisites", "");
        result.put("contents", List.of());
        result.put("teachingStrategies", dossier == null ? Map.of() : dossier.getInitialInterventions());
        result.put("methodologicalResources", List.of());
        result.put("assessmentCriteria", List.of());
        result.put("assessmentInstruments", List.of());
        result.put("recoveryProposal", "");
        result.put("basicBibliography", List.of());
        result.put("complementaryBibliography", List.of());
        result.put("skillsInventory", emptyInventory());
        templates.findByDocumentTypeAndActiveTrueOrderByUpdatedAtDesc("PEI").stream().findFirst().ifPresent(model -> {
            model.getDefaults().forEach((key,value) -> {
                if (result.containsKey(key) && !java.util.Set.of("student","course","subject","workloadHours","reviewWarning").contains(key))
                    result.put(key,value);
            });
        });
        result.put("reviewWarning", "Rascunho de apoio. Deve ser revisado pelo docente e pela equipe responsável antes da aprovação.");
        return result;
    }

    private Map<String, Object> emptyInventory() {
        return Map.of(
                "oralCommunication", "NAO_OBSERVADO",
                "readingAndWriting", "NAO_OBSERVADO",
                "logicalMathematicalReasoning", "NAO_OBSERVADO",
                "socioemotionalSkills", "NAO_OBSERVADO",
                "functionalAutonomy", "NAO_OBSERVADO",
                "digitalTechnologies", "NAO_OBSERVADO");
    }

    public record PeiCreateRequest(@NotNull Long subjectId, Long teacherId, @NotBlank String academicTerm) {}
    public record PeiUpdateRequest(PeiStatus status, Map<String, Object> content) {}
}
