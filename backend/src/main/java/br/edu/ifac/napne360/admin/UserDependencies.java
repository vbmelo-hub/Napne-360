package br.edu.ifac.napne360.admin;

import br.edu.ifac.napne360.academic.AcademicRepository;
import br.edu.ifac.napne360.casework.CaseStage;
import br.edu.ifac.napne360.casework.NapneCaseRepository;
import br.edu.ifac.napne360.common.ApiOperationException;
import br.edu.ifac.napne360.document.CareRecordDocument;
import br.edu.ifac.napne360.document.CareRecordService;
import br.edu.ifac.napne360.document.CareRecordType;
import br.edu.ifac.napne360.document.RecordStatus;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.identity.UserEmailHistoryService;
import br.edu.ifac.napne360.pei.PeiSeriesStore;
import br.edu.ifac.napne360.student.AssignmentType;
import br.edu.ifac.napne360.student.StudentAssignmentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.mongodb.core.MongoOperations;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.List;
import java.util.regex.Pattern;
import java.util.Set;

@Component
@RequiredArgsConstructor
class UserDependencies {
    private static final Set<RoleName> COORDINATION_ROLES =
            Set.of(RoleName.COTEP, RoleName.COURSE_COORDINATOR, RoleName.MANAGEMENT);

    private final StudentAssignmentRepository assignments;
    private final NapneCaseRepository cases;
    private final AcademicRepository academic;
    private final PeiSeriesStore pei;
    private final MongoOperations documents;
    private final UserEmailHistoryService emailHistory;

    void requireNoActiveDependencies(UserAccount user) {
        if (!assignments.findActiveTypesForUser(user.getId()).isEmpty() || academic.hasActiveTeaching(user.getId())) {
            throw conflict("USER_ACTIVE_ASSIGNMENTS", "Resolva os vínculos e as atribuições ativas da conta antes de continuar.");
        }
        if (hasActiveCases(user)) throw caseConflict();
        if (user.getRoles().contains(RoleName.TEACHER) && pei.hasOpenWorkForTeacher(user.getId())) throw peiConflict();
        if (hasDrafts(user, null)) throw draftConflict();
    }

    void validateRoles(UserAccount user, Set<RoleName> roles) {
        Set<RoleName> previous = user.getRoles();
        if (roles.containsAll(previous)) return;
        if (assignments.findActiveTypesForUser(user.getId()).stream()
                .anyMatch(type -> allows(previous, type) && !allows(roles, type))) {
            throw conflict("USER_ACTIVE_ASSIGNMENTS", "Os perfis informados deixariam vínculos ativos da conta sem acesso.");
        }
        if (removed(previous, roles, RoleName.NAPNE) && hasActiveCases(user)) throw caseConflict();
        if (removed(previous, roles, RoleName.TEACHER)) {
            if (academic.hasActiveTeaching(user.getId())) {
                throw conflict("USER_ACTIVE_ASSIGNMENTS", "Resolva as atribuições docentes ativas antes de retirar o perfil Professor.");
            }
            if (pei.hasOpenWorkForTeacher(user.getId())) throw peiConflict();
        }
        var types = Arrays.stream(CareRecordType.values()).filter(type -> CareRecordService.allowsType(previous, type)
                && !CareRecordService.allowsType(roles, type)).toList();
        if (!types.isEmpty() && hasDrafts(user, types)) throw draftConflict();
    }

    private boolean hasActiveCases(UserAccount user) {
        return cases.existsByResponsibleIdAndStageNotIn(user.getId(), List.of(CaseStage.CLOSED, CaseStage.ARCHIVED));
    }

    private boolean hasDrafts(UserAccount user, List<CareRecordType> types) {
        if (user.getRoles().stream().allMatch(role -> role == RoleName.ADMIN)) return false;
        var authors = emailHistory.previouslyOwnedAddresses(user).stream()
                .map(email -> Pattern.compile("^" + Pattern.quote(email) + "$", Pattern.CASE_INSENSITIVE)).toList();
        var draft = Criteria.where("status").is(RecordStatus.DRAFT).and("createdBy").in(authors);
        if (types != null) draft.and("type").in(types);
        return documents.exists(Query.query(draft), CareRecordDocument.class);
    }

    private static boolean removed(Set<RoleName> previous, Set<RoleName> current, RoleName role) {
        return previous.contains(role) && !current.contains(role);
    }

    private static boolean allows(Set<RoleName> roles, AssignmentType type) {
        return switch (type) {
            case NAPNE -> roles.contains(RoleName.NAPNE);
            case TUTOR -> roles.contains(RoleName.TUTOR);
            case TEACHER -> roles.contains(RoleName.TEACHER);
            case COORDINATOR -> roles.stream().anyMatch(COORDINATION_ROLES::contains);
        };
    }

    private static ApiOperationException caseConflict() {
        return conflict("USER_ACTIVE_CASES", "Transfira os casos em andamento sob responsabilidade desta conta antes de continuar.");
    }

    private static ApiOperationException peiConflict() {
        return conflict("USER_ACTIVE_PEIS", "Resolva os PEIs vigentes ou em elaboração sob responsabilidade desta conta antes de continuar.");
    }

    private static ApiOperationException draftConflict() {
        return conflict("USER_ACTIVE_RECORDS", "Resolva os rascunhos de acompanhamento da conta antes de continuar.");
    }

    private static ApiOperationException conflict(String code, String message) {
        return new ApiOperationException(HttpStatus.CONFLICT, code, message);
    }
}
