package br.edu.ifac.napne360.pei;

import br.edu.ifac.napne360.academic.AcademicService;

import br.edu.ifac.napne360.common.ConflictException;
import br.edu.ifac.napne360.common.ApiOperationException;
import org.springframework.http.HttpStatus;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.document.CareRecordDocument;
import br.edu.ifac.napne360.document.CareRecordService;
import br.edu.ifac.napne360.document.CareRecordType;
import br.edu.ifac.napne360.document.RecordStatus;
import br.edu.ifac.napne360.identity.ReferenceCatalogService;
import br.edu.ifac.napne360.identity.ReferenceIdDeserializer;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.Subject;
import br.edu.ifac.napne360.identity.SubjectRepository;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.security.CurrentUserService;
import br.edu.ifac.napne360.student.AssignmentType;
import br.edu.ifac.napne360.student.Student;
import br.edu.ifac.napne360.student.StudentAssignment;
import br.edu.ifac.napne360.student.StudentAssignmentRepository;
import br.edu.ifac.napne360.timeline.TimelineVisibility;
import com.fasterxml.jackson.annotation.JsonSetter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class PeiService {
    private static final List<String> REQUIRED_TEXT_LISTS = List.of("specificObjectives", "contents",
            "teachingStrategies", "assessmentCriteria", "assessmentInstruments");
    private static final List<String> IDENTIFICATION = List.of("student", "course", "subject", "workloadHours", "teacherName");
    private static final Set<String> BIBLIOGRAPHY_FIELDS = Set.of("title", "author", "edition", "location", "publisher", "year", "lt");
    private final ReferenceCatalogService catalog;
    private final PeiSeriesStore store;
    private final CareRecordService careRecords;
    private final SubjectRepository subjects;
    private final CurrentUserService currentUser;
    private final PeiProjectionService projections;
    private final br.edu.ifac.napne360.security.AccessGuard access;
    private final br.edu.ifac.napne360.document.DocumentTemplateRepository templates;
    private final StudentAssignmentRepository assignments;
    private final AcademicService academic;

    public List<PeiDocument> list(Long studentId) {
        UserAccount actor = currentUser.require();
        return store.list(studentId).stream()
                .flatMap(series -> series.revisions().stream()
                        .filter(pei -> access.canViewPei(studentId, series.subjectId(), series.academicTerm(), pei.getAcademicOfferingId()))
                        .map(pei -> project(series, pei, actor, permissions(actor, series, pei))))
                .sorted(Comparator.comparing(PeiDocument::getUpdatedAt, Comparator.nullsLast(Comparator.reverseOrder()))
                        .thenComparing(PeiDocument::getId))
                .toList();
    }

    public PeiDocument get(Long studentId, String id) {
        PeiSeries series = requireSeries(studentId, id);
        PeiDocument pei = requirePlan(series, id);
        UserAccount actor = currentUser.require();
        if (!access.canViewPei(studentId, series.subjectId(), series.academicTerm(), pei.getAcademicOfferingId())) {
            throw denied();
        }
        return project(series, pei, actor, permissions(actor, series, pei));
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public PeiDocument createDraft(Student student, PeiCreateRequest request, Authentication auth, HttpServletRequest http) {
        UserAccount actor = currentUser.require();
        if (!actor.getRoles().contains(RoleName.TEACHER)) throw denied();
        if (!student.acceptsNewOperations())
            throw new ApiOperationException(HttpStatus.CONFLICT, "ACADEMIC_STUDENT_INACTIVE",
                    "A situação acadêmica do estudante não permite iniciar um PEI.");
        if (request.teacherId() != null && !request.teacherId().equals(actor.getId())) {
            throw new IllegalArgumentException("O docente responsável deve ser o autor do rascunho.");
        }
        var term = request.offeringId() == null ? catalog.academicTerm(request.academicTermId(), request.academicTerm()) : null;
        var offering = academic.requirePeiOffering(student.getId(), request.offeringId(), request.subjectId(),
                term == null ? null : term.getId(), term == null ? null : term.getCode());
        Subject subject = subjects.findByIdForUpdate(offering.subjectId()).orElseThrow(() -> new NotFoundException("Componente não encontrado."));
        if (!subject.isActive() || !subject.getCourse().isActive()) {
            throw new ApiOperationException(HttpStatus.CONFLICT, "PEI_SUBJECT_ARCHIVED", "O componente está arquivado.");
        }
        if (!subject.getCourse().getId().equals(student.getCourse().getId())) {
            throw new IllegalArgumentException("O componente deve pertencer ao curso do estudante.");
        }
        var series = store.load(student.getId(), subject.getId(), offering.periodCode());
        if (series.hasOpenWork() || series.current().isPresent()) {
            throw new ApiOperationException(HttpStatus.CONFLICT, "PEI_DRAFT_EXISTS", "Já existe um PEI em andamento ou vigente para este componente e período.");
        }
        var now = recordedAt();
        var plan = PeiDocument.builder().id(newId()).studentId(student.getId()).subjectId(subject.getId())
                .teacherId(actor.getId()).academicTerm(offering.periodCode()).academicTermId(offering.periodId())
                .academicTermLabel(offering.periodLabel()).academicOfferingId(offering.id()).formVersion(PeiAnnexI.VERSION)
                .revision(series.nextRevision()).storageVersion(0L)
                .content(template(student, subject, actor)).createdBy(actor.getEmail()).updatedBy(actor.getEmail())
                .createdAt(now).updatedAt(now).build();
        var revisions = new ArrayList<>(series.revisions());
        revisions.add(plan);
        return persist(series, revisions, plan, actor, new Permissions(true, false), "CREATE",
                "PEI_CREATED", "Rascunho de PEI criado", auth, http);
    }

    public PeiDocument createVersion(Long studentId, String id, PeiUpdateRequest request,
                                     Authentication auth, HttpServletRequest http) {
        var series = requireSeries(studentId, id);
        var previous = requirePlan(series, id);
        var actor = currentUser.require();
        var permissions = permissions(actor, series, previous);
        requireAction(series, previous, actor, permissions, Action.EDIT, request.version());
        var content = isAnnex(previous) ? annexEdit(previous, request.content()) : new LinkedHashMap<>(request.content());
        if (Objects.equals(previous.getContent(), content)) return project(series, previous, actor, permissions);
        var now = recordedAt();
        var next = newDraft(series, previous, actor, now, content, previous.getCreatedBy())
                .teacherId(actor.getId()).build();
        var revisions = replace(series, advance(previous, PeiStatus.SUPERSEDED, actor, now).build());
        revisions.add(next);
        return persist(series, revisions, next, actor, permissions, "REVISE", "PEI_REVISED",
                "Nova versão do PEI", auth, http);
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public PeiDocument transition(Long studentId, String id, Action action, Long version,
                                  Authentication auth, HttpServletRequest http) {
        var series = requireSeries(studentId, id);
        var previous = requirePlan(series, id);
        var actor = currentUser.require();
        var permissions = permissions(actor, series, previous);
        requireAction(series, previous, actor, permissions, action, version);
        var now = recordedAt();

        if (action == Action.START_REVISION) {
            if (previous.getAcademicOfferingId() != null)
                academic.requirePeiOffering(studentId, previous.getAcademicOfferingId(), null, null, null);
            else
                academic.lockStudentForNewPei(studentId);
            var next = newDraft(series, previous, actor, now, contentForTeacher(previous, actor.getName()), actor.getEmail())
                    .teacherId(actor.getId()).build();
            var revisions = replace(series, previous.toBuilder()
                    .storageVersion(Math.incrementExact(previous.getStorageVersion())).build());
            revisions.add(next);
            return persist(series, revisions, next, actor, permissions, "REVISE", "PEI_REVISED",
                    "Rascunho de substituição do PEI criado", auth, http);
        }
        var status = switch (action) {
            case SUBMIT -> PeiStatus.IN_REVIEW;
            case RETURN -> PeiStatus.DRAFT;
            case APPROVE -> PeiStatus.APPROVED;
            case ARCHIVE -> PeiStatus.ARCHIVED;
            default -> throw new IllegalArgumentException("Operação de PEI inválida.");
        };
        var changed = advance(previous, status, actor, now);
        if (action == Action.APPROVE) {
            validateApproval(previous);
            changed.reviewedBy(actor.getEmail()).reviewedAt(now);
        }
        var result = changed.build();
        var revisions = replace(series, result);
        if (action == Action.APPROVE) {
            series.current().ifPresent(vigent -> revisions.replaceAll(p -> p.getId().equals(vigent.getId())
                    ? advance(p, PeiStatus.SUPERSEDED, actor, now).build() : p));
        }
        return switch (action) {
            case SUBMIT -> persist(series, revisions, result, actor, permissions, "SUBMIT", "PEI_SUBMITTED",
                    "PEI enviado para revisão", auth, http);
            case RETURN -> persist(series, revisions, result, actor, permissions, "RETURN", "PEI_RETURNED",
                    "PEI devolvido para ajustes", auth, http);
            case APPROVE -> persist(series, revisions, result, actor, permissions, "APPROVE", "PEI_APPROVED",
                    "PEI aprovado após revisão humana", auth, http);
            case ARCHIVE -> persist(series, revisions, result, actor, permissions, "ARCHIVE", "PEI_ARCHIVED",
                    "PEI arquivado", auth, http);
            default -> throw new IllegalArgumentException("Operação de PEI inválida.");
        };
    }

    public List<TransferCandidate> transferCandidates(Long studentId, String id) {
        var actor = requireTransferActor(studentId);
        var series = requireSeries(studentId, id);
        var draft = requirePlan(series, id);
        if (!available(series, draft, Action.TRANSFER)) throw revisionConflict();
        return eligibleTransferTeachers(series, draft, actor.getCampus().getId());
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public PeiDocument transfer(Long studentId, String id, PeiTransferRequest request,
                                Authentication auth, HttpServletRequest http) {
        var actor = requireTransferActor(studentId);
        var series = requireSeries(studentId, id);
        var previous = requirePlan(series, id);
        var permissions = permissions(actor, series, previous);
        requireAction(series, previous, actor, permissions, Action.TRANSFER, request.version());

        var reason = trimTransferReason(request.reason());
        if (reason.isEmpty() || reason.length() > 500) {
            throw new IllegalArgumentException("Informe um motivo de até 500 caracteres para a transferência.");
        }
        var successor = eligibleTransferTeachers(series, previous, actor.getCampus().getId()).stream()
                .filter(candidate -> candidate.id().equals(request.teacherId()))
                .findFirst().orElseThrow(() -> new IllegalArgumentException(
                        "O docente escolhido deve ter vínculo ativo com o estudante e o componente."));

        if (previous.getAcademicOfferingId() != null) {
            academic.lockPeiTransferCandidate(studentId, previous.getAcademicOfferingId(), successor.id());
            if (!available(series, previous, Action.TRANSFER)) throw revisionConflict();
        }

        var now = recordedAt();
        var next = newDraft(series, previous, actor, now, contentForTeacher(previous, successor.name()), previous.getCreatedBy())
                .teacherId(successor.id())
                .transfer(new PeiDocument.Transfer(previous.getTeacherId(), request.teacherId(), actor.getEmail(), now, reason))
                .build();
        var revisions = replace(series, advance(previous, PeiStatus.SUPERSEDED, actor, now).build());
        revisions.add(next);
        return persist(series, revisions, next, actor, permissions, "TRANSFER", "PEI_TRANSFERRED",
                "Rascunho de PEI transferido", TimelineVisibility.RESTRICTED, auth, http);
    }

    private static String trimTransferReason(JsonNode reason) {
        if (reason == null || !reason.isTextual()) return "";
        var text = reason.textValue();
        int start = 0;
        int end = text.length();
        while (start < end && isTransferWhitespace(text.charAt(start))) {
            start++;
        }
        while (start < end && isTransferWhitespace(text.charAt(end - 1))) {
            end--;
        }
        return text.substring(start, end);
    }

    private static boolean isTransferWhitespace(char character) {
        // The editor's trim() also removes U+FEFF.
        return Character.isWhitespace(character) || Character.isSpaceChar(character) || character == '\uFEFF';
    }

    private UserAccount requireTransferActor(Long studentId) {
        var actor = currentUser.require();
        if (!canReview(actor, studentId)) throw denied();
        return actor;
    }

    private List<TransferCandidate> eligibleTransferTeachers(PeiSeries series, PeiDocument source, Long campusId) {
        return assignments.findByStudentIdAndActiveTrue(series.studentId()).stream()
                .filter(link -> link.getAssignmentType() == AssignmentType.TEACHER && link.getSubject() != null
                        && series.subjectId().equals(link.getSubject().getId()))
                .filter(link -> source.getAcademicOfferingId() == null
                        ? link.getPeriod() == null || Objects.equals(series.academicTerm(), link.getPeriod().getCode())
                        : assignments.canTeachOffering(series.studentId(), link.getUser().getId(), source.getAcademicOfferingId()))
                .map(StudentAssignment::getUser)
                .filter(user -> !user.getId().equals(source.getTeacherId()) && user.isActive()
                        && user.getRoles().contains(RoleName.TEACHER)
                        && user.getCampus() != null && campusId.equals(user.getCampus().getId()))
                .map(user -> new TransferCandidate(user.getId(), user.getName()))
                .distinct()
                .sorted(Comparator.comparing(TransferCandidate::name).thenComparing(TransferCandidate::id))
                .toList();
    }

    private PeiSeries requireSeries(Long studentId, String id) {
        return store.find(studentId, id).orElseThrow(() -> new NotFoundException("PEI não encontrado."));
    }

    private PeiDocument requirePlan(PeiSeries series, String id) {
        return series.find(id).orElseThrow(() -> new NotFoundException("PEI não encontrado."));
    }

    private Permissions permissions(UserAccount actor, PeiSeries series, PeiDocument pei) {
        return new Permissions(actor.getRoles().contains(RoleName.TEACHER)
                && access.canTeachPei(series.studentId(), series.subjectId(), series.academicTerm(), pei.getAcademicOfferingId()),
                canReview(actor, series.studentId()));
    }

    private boolean canReview(UserAccount actor, Long studentId) {
        return actor.getRoles().contains(RoleName.NAPNE) && access.canEditDossier(studentId);
    }

    private void requireAction(PeiSeries series, PeiDocument pei, UserAccount actor, Permissions permissions,
                               Action action, Long version) {
        if (!authorized(pei, actor, permissions, action)) throw denied();
        if (version == null || !Objects.equals(version, pei.getStorageVersion())
                || !available(series, pei, action)) {
            throw revisionConflict();
        }
    }

    private static ConflictException revisionConflict() {
        return new ConflictException("O PEI foi alterado ou a operação não está disponível nesta revisão.");
    }

    private static boolean authorized(PeiDocument pei, UserAccount actor, Permissions permissions, Action action) {
        return switch (action) {
            case EDIT, SUBMIT -> permissions.teacher()
                    && (pei.getTeacherId() == null || Objects.equals(pei.getTeacherId(), actor.getId()));
            case START_REVISION -> permissions.teacher();
            case APPROVE, RETURN, ARCHIVE, TRANSFER -> permissions.reviewer();
        };
    }

    private boolean available(PeiSeries series, PeiDocument pei, Action action) {
        return switch (action) {
            case EDIT -> pei.getStatus() == PeiStatus.DRAFT;
            case SUBMIT -> pei.getStatus() == PeiStatus.DRAFT && pei.getTeacherId() != null;
            case START_REVISION -> pei.getStatus() == PeiStatus.APPROVED && !series.hasOpenWork();
            case APPROVE, RETURN -> pei.getStatus() == PeiStatus.IN_REVIEW;
            case ARCHIVE -> pei.getStatus() == PeiStatus.APPROVED;
            case TRANSFER -> pei.getStatus() == PeiStatus.DRAFT && pei.getTeacherId() != null
                    && series.subjectId() != null && !teacherStillAssigned(series, pei);
        };
    }

    private boolean teacherStillAssigned(PeiSeries series, PeiDocument pei) {
        return pei.getAcademicOfferingId() == null
                ? assignments.existsEffectiveTeaching(series.studentId(), pei.getTeacherId(), series.subjectId(), series.academicTerm(), true)
                : assignments.canTeachOffering(series.studentId(), pei.getTeacherId(), pei.getAcademicOfferingId());
    }

    private PeiDocument project(PeiSeries series, PeiDocument pei, UserAccount actor, Permissions permissions) {
        var actions = java.util.Arrays.stream(Action.values())
                .filter(action -> authorized(pei, actor, permissions, action) && available(series, pei, action))
                .map(Action::name).toList();
        return pei.toBuilder().allowedActions(actions).transfer(permissions.reviewer() ? pei.getTransfer() : null).build();
    }

    private PeiDocument persist(PeiSeries series, List<PeiDocument> revisions, PeiDocument plan, UserAccount actor,
                                Permissions permissions, String action, String event, String title,
                                Authentication auth, HttpServletRequest http) {
        return persist(series, revisions, plan, actor, permissions, action, event, title, TimelineVisibility.PEDAGOGICAL, auth, http);
    }

    private PeiDocument persist(PeiSeries series, List<PeiDocument> revisions, PeiDocument plan, UserAccount actor,
                                Permissions permissions, String action, String event, String title,
                                TimelineVisibility visibility, Authentication auth, HttpServletRequest http) {
        var projection = new PeiProjection("pei:" + plan.getId() + ":" + plan.getStorageVersion(),
                plan.getStudentId(), plan.getSubjectId(), plan.getId(), plan.getRevision(), plan.getUpdatedAt(),
                auth == null ? null : actor.getId(), actor.getName(), http == null ? null : http.getRemoteAddr(),
                action, event, title, visibility, plan.getAcademicTerm(), plan.getAcademicOfferingId());
        var after = series.next(revisions, projection);
        var response = project(after, plan, actor, permissions);
        store.save(series, after, projection);
        projections.enqueue(series.id(), projection);
        return response;
    }

    private static ArrayList<PeiDocument> replace(PeiSeries series, PeiDocument plan) {
        var revisions = new ArrayList<>(series.revisions());
        revisions.replaceAll(p -> p.getId().equals(plan.getId()) ? plan : p);
        return revisions;
    }

    private static PeiDocument.PeiDocumentBuilder advance(PeiDocument plan, PeiStatus status, UserAccount actor, Instant now) {
        return plan.toBuilder().status(status).storageVersion(Math.incrementExact(plan.getStorageVersion()))
                .updatedBy(actor.getEmail()).updatedAt(now);
    }

    private static PeiDocument.PeiDocumentBuilder newDraft(PeiSeries series, PeiDocument source, UserAccount actor,
                                                           Instant now, Map<String, Object> content, String author) {
        return source.toBuilder().id(newId()).revision(series.nextRevision())
                .status(PeiStatus.DRAFT).storageVersion(0L).content(content)
                .createdBy(author).createdAt(now).updatedBy(actor.getEmail()).updatedAt(now)
                .reviewedBy(null).reviewedAt(null).transfer(null);
    }

    private static String newId() {
        return UUID.randomUUID().toString();
    }

    private static Instant recordedAt() {
        return Instant.now().truncatedTo(ChronoUnit.MILLIS);
    }

    private static AccessDeniedException denied() {
        return new AccessDeniedException("Sem permissão para esta operação no PEI.");
    }

    private static boolean isAnnex(PeiDocument pei) {
        return PeiAnnexI.VERSION.equals(pei.getFormVersion());
    }

    private static Map<String, Object> contentForTeacher(PeiDocument source, String teacherName) {
        var stored = source.getContent();
        if (!isAnnex(source)) return stored == null ? null : new LinkedHashMap<>(stored);
        var content = new LinkedHashMap<>(stored);
        content.put("teacherName", teacherName);
        return content;
    }

    private static Map<String, Object> annexEdit(PeiDocument source, Map<String, Object> submitted) {
        var stored = source.getContent();
        var content = new LinkedHashMap<String, Object>();
        for (var field : IDENTIFICATION) {
            content.put(field, stored.get(field));
        }
        submitted.forEach((field, value) -> {
            if (IDENTIFICATION.contains(field) || "reviewWarning".equals(field)) {
                return;
            }
            if (!validAnnexField(field, value)) {
                throw new IllegalArgumentException("Campo inválido no Anexo I do PEI: " + field);
            }
            content.put(field, value);
        });
        content.put("reviewWarning", stored.get("reviewWarning"));
        return content;
    }

    private static boolean validAnnexField(String field, Object value) {
        return switch (field) {
            case "generalObjectives", "syllabus", "prerequisites", "recoveryProposal",
                 "observations", "location" -> value instanceof String;
            case "specificObjectives", "eliminatedObjectives", "alternativeObjectives", "complementaryObjectives",
                 "professionalSkills", "teachingStrategies", "methodologicalResources", "assessmentCriteria" ->
                    value instanceof List<?> texts && texts.stream().allMatch(String.class::isInstance);
            case "documentDate" -> validAnnexDate(value);
            case "contents" -> value instanceof List<?> rows && rows.stream().allMatch(row ->
                    row instanceof Map<?, ?> map && map.keySet().equals(Set.of("description", "workloadHours", "priority"))
                            && map.get("description") instanceof String && map.get("priority") instanceof Boolean
                            && (map.get("workloadHours") == null || finiteHours(map.get("workloadHours"))));
            case "assessmentInstruments" -> allTextRows(value, Set.of("description", "justification"));
            case "basicBibliography", "complementaryBibliography" -> allTextRows(value, BIBLIOGRAPHY_FIELDS);
            case "skillsInventory" -> value instanceof Map<?, ?> inventory
                    && PeiAnnexI.answerableIndicators().containsAll(inventory.keySet())
                    && inventory.values().stream().allMatch(PeiService::validRating);
            default -> false;
        };
    }

    private static boolean validAnnexDate(Object value) {
        if (!(value instanceof String text)) return false;
        if (text.isEmpty()) return true;
        if (!text.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) return false;
        try {
            return LocalDate.parse(text).getYear() > 0;
        } catch (DateTimeParseException invalid) {
            return false;
        }
    }

    private static boolean finiteHours(Object value) {
        return value instanceof Number number && Double.isFinite(number.doubleValue());
    }

    private static boolean allTextRows(Object value, Set<String> fields) {
        return value instanceof List<?> rows && rows.stream().allMatch(row ->
                row instanceof Map<?, ?> map && map.keySet().equals(fields)
                        && map.values().stream().allMatch(String.class::isInstance));
    }

    private static boolean validRating(Object value) {
        return value instanceof String rating && PeiAnnexI.ratings().contains(rating);
    }

    private void validateApproval(PeiDocument pei) {
        if (isAnnex(pei)) {
            validateAnnexApproval(pei);
            return;
        }
        var content = pei.getContent();
        if (content == null || !hasText(content.get("generalObjectives"))
                || REQUIRED_TEXT_LISTS.stream().anyMatch(field -> !hasTextList(content.get(field)))) {
            throw new IllegalArgumentException("Preencha os objetivos, conteúdos, estratégias e avaliação antes de aprovar.");
        }
        if (pei.getTeacherId() == null) throw new IllegalArgumentException("Identifique o docente responsável antes da aprovação.");
        if (!(pei.getContent().get("skillsInventory") instanceof Map<?,?> inventory))
            throw new IllegalArgumentException("Preencha o inventário de habilidades.");
        for (String dimension : emptyInventory().keySet()) {
            if (!(inventory.get(dimension) instanceof String rating) || !java.util.Set.of("REALIZA_COM_AJUDA", "REALIZA_SEM_AJUDA", "NAO_REALIZA", "NAO_OBSERVADO").contains(rating))
                throw new IllegalArgumentException("Escolha uma opção válida em cada dimensão do inventário.");
        }
    }

    private static void validateAnnexApproval(PeiDocument pei) {
        var content = pei.getContent();
        if (pei.getTeacherId() == null || content == null || !hasText(content.get("teacherName"))) {
            throw new IllegalArgumentException("Identifique o docente responsável antes da aprovação.");
        }
        if (!hasText(content.get("generalObjectives")) || !hasTextList(content.get("teachingStrategies"))
                || !hasTextList(content.get("assessmentCriteria"))) {
            throw new IllegalArgumentException("Preencha os objetivos, as estratégias e os critérios de avaliação antes de aprovar.");
        }
        if (!(content.get("specificObjectives") instanceof List<?> objectives)
                || objectives.size() < 2 || objectives.size() > 4 || !hasTextList(objectives)) {
            throw new IllegalArgumentException("Preencha de 2 a 4 objetivos específicos antes de aprovar.");
        }
        if (!(content.get("contents") instanceof List<?> rows) || rows.isEmpty()
                || !validAnnexField("contents", rows) || rows.stream().map(Map.class::cast).anyMatch(row ->
                        !hasText(row.get("description")) || !(row.get("workloadHours") instanceof Number hours)
                                || hours.doubleValue() <= 0)) {
            throw new IllegalArgumentException("Informe os conteúdos e a carga horária de cada um antes de aprovar.");
        }
        if (!(content.get("assessmentInstruments") instanceof List<?> instruments) || instruments.isEmpty()
                || !allTextRows(instruments, Set.of("description", "justification"))
                || instruments.stream().map(Map.class::cast).anyMatch(instrument ->
                        !hasText(instrument.get("description")) || !hasText(instrument.get("justification")))) {
            throw new IllegalArgumentException("Informe os instrumentos de avaliação e justifique o uso de cada um.");
        }
        if (!(content.get("skillsInventory") instanceof Map<?, ?> inventory)
                || !validAnnexField("skillsInventory", inventory)
                || inventory.size() != PeiAnnexI.answerableIndicators().size()) {
            throw new IllegalArgumentException("Escolha uma opção válida em cada indicador do inventário.");
        }
    }

    private static boolean hasText(Object value) {
        return value instanceof String text && !text.isBlank();
    }

    private static boolean hasTextList(Object value) {
        return value instanceof List<?> texts && !texts.isEmpty() && texts.stream().allMatch(PeiService::hasText);
    }

    private Map<String, Object> template(Student student, Subject subject, UserAccount teacher) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("student", student.getDisplayName());
        result.put("course", student.getCourse().getName());
        result.put("subject", subject.getName());
        result.put("workloadHours", subject.getWorkloadHours());
        result.put("teacherName", teacher.getName());
        result.put("syllabus", subject.getSyllabus() == null ? "" : subject.getSyllabus());
        result.put("generalObjectives", "");
        result.put("specificObjectives", List.of());
        result.put("eliminatedObjectives", List.of());
        result.put("alternativeObjectives", List.of());
        result.put("complementaryObjectives", List.of());
        result.put("professionalSkills", List.of());
        result.put("prerequisites", "");
        result.put("contents", List.of());
        result.put("teachingStrategies", suggestedStrategies(student.getId(), subject.getId()));
        result.put("methodologicalResources", List.of());
        result.put("assessmentCriteria", List.of());
        result.put("assessmentInstruments", List.of());
        result.put("recoveryProposal", "");
        result.put("basicBibliography", List.of());
        result.put("complementaryBibliography", List.of());
        result.put("observations", "");
        result.put("location", "");
        result.put("documentDate", "");
        var inventory = new LinkedHashMap<String, Object>();
        PeiAnnexI.answerableIndicators().forEach(indicator -> inventory.put(indicator, "NAO_OBSERVADO"));
        result.put("skillsInventory", inventory);
        templates.findByDocumentTypeAndActiveTrueOrderByUpdatedAtDesc("PEI").stream().findFirst().ifPresent(model ->
                model.getDefaults().forEach((field, value) -> {
                    if (!result.containsKey(field) || IDENTIFICATION.contains(field) || "skillsInventory".equals(field)) {
                        return;
                    }
                    var annexValue = annexTemplateValue(field, value);
                    if (validAnnexField(field, annexValue)) {
                        result.put(field, annexValue);
                    }
                }));
        result.put("reviewWarning", "Rascunho de apoio. Deve ser revisado pelo docente e pela equipe responsável antes da aprovação.");
        return result;
    }

    private static Object annexTemplateValue(String field, Object value) {
        if (!(value instanceof List<?> texts) || !texts.stream().allMatch(String.class::isInstance)) {
            return value;
        }
        return switch (field) {
            case "contents" -> texts.stream().map(text -> {
                var row = new LinkedHashMap<String, Object>();
                row.put("description", text);
                row.put("workloadHours", null);
                row.put("priority", false);
                return row;
            }).toList();
            case "assessmentInstruments" -> texts.stream()
                    .map(text -> Map.of("description", text, "justification", "")).toList();
            case "basicBibliography", "complementaryBibliography" -> texts.stream()
                    .map(text -> Map.of("title", text, "author", "", "edition", "", "location", "",
                            "publisher", "", "year", "", "lt", "")).toList();
            default -> value;
        };
    }

    private List<String> suggestedStrategies(Long studentId, Long subjectId) {
        return careRecords.list(studentId, CareRecordType.PEDAGOGICAL_GUIDANCE).stream()
                .filter(record -> record.getStatus() == RecordStatus.ACTIVE)
                .filter(record -> record.getSubjectId() == null || subjectId.equals(record.getSubjectId()))
                .map(CareRecordDocument::getContent)
                .filter(Objects::nonNull)
                .map(content -> content.get("adaptations"))
                .filter(String.class::isInstance)
                .map(String.class::cast)
                .map(text -> text.lines().map(String::strip).filter(line -> !line.isEmpty()).toList())
                .filter(strategies -> !strategies.isEmpty())
                .findFirst().orElseGet(List::of);
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

    public record PeiCreateRequest(@Positive @JsonDeserialize(using = ReferenceIdDeserializer.class) Long subjectId,
                                   Long teacherId, String academicTerm,
                                   @Positive @JsonDeserialize(using = ReferenceIdDeserializer.class) Long academicTermId,
                                   @Positive @JsonDeserialize(using = ReferenceIdDeserializer.class) Long offeringId) {}
    enum Action { EDIT, START_REVISION, SUBMIT, RETURN, APPROVE, ARCHIVE, TRANSFER }
    private record Permissions(boolean teacher, boolean reviewer) {}

    public record PeiUpdateRequest(@NotNull Map<String, Object> content,
                                   @NotNull @PositiveOrZero @JsonDeserialize(using = ReferenceIdDeserializer.class) Long version) {
        @JsonSetter("status")
        public void rejectStatus(JsonNode ignored) {
            throw new IllegalArgumentException("Use as ações do PEI para alterar o status.");
        }
    }

    public record PeiActionRequest(
            @NotNull @PositiveOrZero @JsonDeserialize(using = ReferenceIdDeserializer.class) Long version) {}

    public record PeiTransferRequest(
            @NotNull @Positive @JsonDeserialize(using = ReferenceIdDeserializer.class) Long teacherId,
            JsonNode reason,
            @JsonDeserialize(using = ReferenceIdDeserializer.class) Long version) {}

    public record TransferCandidate(Long id, String name) {}
}
