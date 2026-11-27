package br.edu.ifac.napne360.admin;

import br.edu.ifac.napne360.audit.AdminAuditConfiguration;
import br.edu.ifac.napne360.common.ApiOperationException;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.identity.Campus;
import br.edu.ifac.napne360.identity.CampusRepository;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.identity.UserAccountRepository;
import br.edu.ifac.napne360.identity.UserEmailHistoryService;
import br.edu.ifac.napne360.security.CurrentUserService;
import jakarta.persistence.criteria.Predicate;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;

@RestController
@RequestMapping("/api/v1/admin/users")
@PreAuthorize("hasRole('ADMIN')")
@RequiredArgsConstructor
public class AdminUserController {
    private static final int CANDIDATE_PAGE_SIZE = 30;
    private final UserAccountRepository users;
    private final CampusRepository campuses;
    private final UserEmailHistoryService emailHistory;
    private final UserDependencies dependencies;
    private final CurrentUserService currentUser;
    private final PasswordEncoder passwordEncoder;

    @GetMapping
    @Transactional(readOnly = true)
    public List<UserView> list() {
        return users.findAll(Sort.by("name", "id")).stream().map(UserView::of).toList();
    }

    @PostMapping("/page")
    @Transactional(readOnly = true)
    public ResponseEntity<UserPage> page(@Valid @RequestBody UserPageRequest request) {
        int page = request.page();
        int size = request.size();
        if (page < 0 || size < 1 || size > 100 || (long) page * size > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("Paginação inválida.");
        }
        var result = users.findAll(userFilters(request.query(), request.campus(), request.role(), request.status()),
                PageRequest.of(page, size, Sort.by("name", "id")));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new UserPage(
                result.getContent().stream().map(UserView::of).toList(), result.getTotalElements(),
                result.getTotalPages(), result.getNumber(), result.getSize()));
    }

    @PostMapping("/candidates")
    @Transactional(readOnly = true)
    public ResponseEntity<UserCandidates> candidates(@Valid @RequestBody CandidateRequest request) {
        if (request.page() < 0 || (long) request.page() * CANDIDATE_PAGE_SIZE > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("Paginação inválida.");
        }
        Specification<UserAccount> scope = accountScope(request.campusId(), false, request.roles(), UserStatus.ACTIVE);
        if (request.excludedId() != null) {
            scope = scope.and((user, criteria, cb) -> cb.notEqual(user.get("id"), request.excludedId()));
        }
        var result = users.findAll(scope.and(accountSearch(request.query())),
                PageRequest.of(request.page(), CANDIDATE_PAGE_SIZE, Sort.by("name", "id")));
        UserView selected = request.selectedId() == null ? null
                : users.findOne(scope.and((user, criteria, cb) -> cb.equal(user.get("id"), request.selectedId())))
                        .map(UserView::of).orElse(null);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new UserCandidates(
                result.getContent().stream().map(UserView::of).toList(), result.getTotalElements(), selected));
    }

    public record CandidateRequest(@Positive Long campusId, @NotEmpty Set<@NotNull RoleName> roles,
                                   @Size(max = 200) String query, @Positive Long selectedId, @Positive Long excludedId,
                                   int page) {}

    public record UserCandidates(List<UserView> content, long totalElements, UserView selected) {}

    private Specification<UserAccount> userFilters(String query, String campus, RoleName role, UserStatus status) {
        boolean withoutCampus = "none".equals(campus);
        Long campusId = campus == null || withoutCampus ? null : numericId(campus);
        if (campus != null && !withoutCampus && campusId == null) {
            throw new IllegalArgumentException("Campus inválido.");
        }
        return accountScope(campusId, withoutCampus, role == null ? Set.of() : Set.of(role), status)
                .and(accountSearch(query));
    }

    private Specification<UserAccount> accountScope(Long campusId, boolean withoutCampus, Set<RoleName> roles,
                                                    UserStatus status) {
        return (user, criteria, cb) -> {
            var filters = new ArrayList<Predicate>();
            if (withoutCampus) filters.add(cb.isNull(user.get("campus")));
            if (campusId != null) filters.add(cb.equal(user.get("campus").get("id"), campusId));
            if (!roles.isEmpty()) {
                var memberships = roles.stream().map(role -> cb.isMember(role, user.<Set<RoleName>>get("roles")));
                filters.add(cb.or(memberships.toArray(Predicate[]::new)));
            }
            if (status != null) {
                filters.add(cb.equal(user.get("active"), status == UserStatus.ACTIVE));
                if (status != UserStatus.ACTIVE) {
                    filters.add(cb.equal(user.get("securityBlocked"), status == UserStatus.BLOCKED));
                }
            }
            return cb.and(filters.toArray(Predicate[]::new));
        };
    }

    private Specification<UserAccount> accountSearch(String query) {
        String[] terms = (query == null ? "" : query).strip().toLowerCase(Locale.ROOT).split("\\s+");
        return (user, criteria, cb) -> {
            var filters = new ArrayList<Predicate>();
            for (String term : terms) {
                if (term.isEmpty()) continue;
                String pattern = "%" + term.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%";
                var matches = new ArrayList<>(List.of(
                        cb.like(cb.lower(user.get("name")), pattern, '!'),
                        cb.like(cb.lower(user.get("email")), pattern, '!'),
                        cb.like(cb.lower(user.get("institutionalRegistration")), pattern, '!')));
                Long id = numericId(term);
                if (id != null) matches.add(cb.equal(user.get("id"), id));
                String cpf = validSearchCpf(term);
                if (cpf != null) matches.add(cb.equal(user.get("cpf"), cpf));
                filters.add(cb.or(matches.toArray(Predicate[]::new)));
            }
            return cb.and(filters.toArray(Predicate[]::new));
        };
    }

    private static String validSearchCpf(String term) {
        if (!term.matches("[0-9]{11}|[0-9]{3}\\.[0-9]{3}\\.[0-9]{3}-[0-9]{2}")) return null;
        try {
            return Cpf.parse(term);
        } catch (ApiOperationException invalid) {
            return null;
        }
    }

    private static Long numericId(String value) {
        try {
            long id = Long.parseLong(value);
            return id > 0 ? id : null;
        } catch (NumberFormatException invalid) {
            return null;
        }
    }

    public enum UserStatus { ACTIVE, INACTIVE, BLOCKED }

    public record UserPageRequest(@Size(max = 200) String query, String campus, RoleName role, UserStatus status,
                                  int page, int size) {}

    public record UserPage(List<UserView> content, long totalElements, int totalPages, int number, int size) {}

    @GetMapping("/{id}")
    @Transactional(readOnly = true)
    public ResponseEntity<UserDetails> get(@PathVariable Long id) {
        UserAccount user = users.findById(id).orElseThrow(() -> new NotFoundException("Usuário não encontrado."));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(UserDetails.of(user));
    }

    @PostMapping("/cpf-search")
    @Transactional(readOnly = true)
    public ResponseEntity<CpfSearchResult> searchCpf(@Valid @RequestBody CpfSearch request) {
        var matchingId = users.findByCpf(Cpf.require(request.cpf())).map(UserAccount::getId).orElse(null);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new CpfSearchResult(matchingId));
    }

    @PostMapping
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public UserView create(@Valid @RequestBody CreateRequest request) {
        String email = request.email();
        String cpf = Cpf.require(request.cpf());
        Campus campus = lockActiveCampus(request.campusId());
        validateRolesHaveCampus(request.roles(), campus);
        // Serialize CPF checks so a rejected duplicate never reaches JDBC error logging.
        lockActiveAdmins();
        validateUnique(email, cpf, null);
        UserAccount user = UserAccount.builder().name(request.name()).email(email).cpf(cpf)
                .institutionalRegistration(blankToNull(request.institutionalRegistration()))
                .campus(campus).roles(new HashSet<>(request.roles()))
                .passwordHash(passwordEncoder.encode(request.password())).build();
        save(user);
        emailHistory.reserve(email, user.getId());
        return UserView.of(user);
    }

    @PutMapping("/{id}")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public UserView update(@PathVariable Long id, @Valid @RequestBody UpdateRequest request, HttpServletRequest http) {
        Campus targetCampus = lockCampus(request.campusId());
        if (request.cpf() != null) lockActiveAdmins();
        UserAccount user = lockUser(id);
        Long oldCampusId = campusId(user);
        String oldEmail = user.getEmail();
        String email = request.email();
        // A legacy account may remain without a CPF until an administrator can verify it.
        String cpf = request.cpf() == null ? user.getCpf() : Cpf.parse(request.cpf());
        String registration = blankToNull(request.institutionalRegistration());
        boolean changedCampus = !Objects.equals(oldCampusId, request.campusId());
        boolean changedEmail = !oldEmail.equalsIgnoreCase(email);
        if (cpf == null && user.getCpf() != null) Cpf.require(request.cpf());
        if (!changedCampus && !changedEmail && user.getName().equals(request.name())
                && Objects.equals(cpf, user.getCpf()) && Objects.equals(registration, user.getInstitutionalRegistration())) {
            AdminAuditConfiguration.markUnchanged(http);
            return UserView.of(user);
        }
        if (changedCampus) {
            ensureCampusActive(targetCampus);
            validateRolesHaveCampus(user.getRoles(), targetCampus);
            dependencies.requireNoActiveDependencies(user);
        }
        validateUnique(email, cpf, id);
        if (changedEmail) {
            emailHistory.reserve(oldEmail, id);
            emailHistory.reserve(email, id);
            user.setEmail(email);
        }
        if (changedEmail || changedCampus) invalidateSessions(user);
        user.setName(request.name());
        user.setCpf(cpf);
        user.setInstitutionalRegistration(registration);
        user.setCampus(targetCampus);
        return UserView.of(save(user));
    }

    @PutMapping("/{id}/roles")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public UserView updateRoles(@PathVariable Long id, @Valid @RequestBody RolesRequest request, HttpServletRequest http) {
        var remainingAdmins = request.roles().contains(RoleName.ADMIN) ? List.<UserAccount>of() : lockActiveAdmins();
        UserAccount user = lockUser(id);
        if (user.getRoles().equals(request.roles())) {
            AdminAuditConfiguration.markUnchanged(http);
            return UserView.of(user);
        }
        if (!request.roles().contains(RoleName.ADMIN)) {
            if (id.equals(currentUser.require().getId())) {
                throw problem(HttpStatus.BAD_REQUEST, "USER_SELF_ADMIN", "Mantenha seu próprio perfil de administrador.");
            }
            ensureAnotherAdmin(user, remainingAdmins);
        }
        validateRolesHaveCampus(request.roles(), user.getCampus());
        if (request.roles().stream().anyMatch(role -> !user.getRoles().contains(role))) {
            ensureCampusActive(user.getCampus());
        }
        dependencies.validateRoles(user, request.roles());
        user.getRoles().retainAll(request.roles());
        user.getRoles().addAll(request.roles());
        invalidateSessions(user);
        return UserView.of(user);
    }

    @PostMapping("/{id}/password")
    @Transactional
    public void resetPassword(@PathVariable Long id, @Valid @RequestBody PasswordRequest request) {
        UserAccount user = lockUser(id);
        user.setPasswordHash(passwordEncoder.encode(request.password()));
        invalidateSessions(user);
    }

    @PostMapping("/{id}/sessions/revoke")
    @Transactional
    public void revokeSessions(@PathVariable Long id) {
        invalidateSessions(lockUser(id));
    }

    @PatchMapping("/{id}/active")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public UserView setActive(@PathVariable Long id, @Valid @RequestBody ActiveRequest request, HttpServletRequest http) {
        if (!request.active()) return deactivate(id, false, http);
        Long lockedCampusId = users.findCampusId(id).orElse(null);
        Campus campus = lockCampus(lockedCampusId);
        UserAccount user = lockUser(id);
        if (!Objects.equals(lockedCampusId, campusId(user))) {
            throw problem(HttpStatus.CONFLICT, "USER_CAMPUS_CHANGED", "O campus desta conta foi alterado. Atualize a listagem e tente novamente.");
        }
        if (user.isActive()) {
            AdminAuditConfiguration.markUnchanged(http);
            return UserView.of(user);
        }
        ensureCampusActive(campus);
        validateRolesHaveCampus(user.getRoles(), campus);
        user.setActive(true);
        user.setSecurityBlocked(false);
        invalidateSessions(user);
        return UserView.of(user);
    }

    @PostMapping("/{id}/block")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public UserView blockAccess(@PathVariable Long id, HttpServletRequest http) {
        return deactivate(id, true, http);
    }

    private UserView deactivate(Long id, boolean securityBlock, HttpServletRequest http) {
        var activeAdmins = lockActiveAdmins();
        UserAccount user = lockUser(id);
        if (!user.isActive() && (securityBlock || !user.isSecurityBlocked())) {
            AdminAuditConfiguration.markUnchanged(http);
            return UserView.of(user);
        }
        if (id.equals(currentUser.require().getId())) {
            throw problem(HttpStatus.BAD_REQUEST, "USER_SELF_ADMIN", "Mantenha sua própria conta de administrador ativa.");
        }
        ensureAnotherAdmin(user, activeAdmins);
        if (!securityBlock) dependencies.requireNoActiveDependencies(user);
        user.setActive(false);
        user.setSecurityBlocked(securityBlock);
        invalidateSessions(user);
        return UserView.of(user);
    }

    private void validateUnique(String email, String cpf, Long accountId) {
        if (users.findByEmailIgnoreCase(email).filter(account -> !account.getId().equals(accountId)).isPresent()) {
            throw UserEmailHistoryService.duplicateEmail();
        }
        emailHistory.ensureAvailable(email, accountId);
        if (cpf != null && users.findByCpf(cpf).filter(account -> !account.getId().equals(accountId)).isPresent()) {
            throw duplicateCpf();
        }
    }

    private UserAccount save(UserAccount user) {
        try {
            return users.saveAndFlush(user);
        } catch (DataIntegrityViolationException exception) {
            for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
                if (cause instanceof org.hibernate.exception.ConstraintViolationException violation
                        && violation.getConstraintName() != null
                        && violation.getConstraintName().toLowerCase(java.util.Locale.ROOT).contains("uk_app_user_cpf")) {
                    throw duplicateCpf();
                }
            }
            throw UserEmailHistoryService.duplicateEmail();
        }
    }

    private UserAccount lockUser(Long id) {
        return users.findByIdForUpdate(id).orElseThrow(() -> new NotFoundException("Usuário não encontrado."));
    }

    private Campus lockCampus(Long id) {
        return id == null ? null : campuses.findByIdForUpdate(id)
                .orElseThrow(() -> new NotFoundException("Campus não encontrado."));
    }

    private Campus lockActiveCampus(Long id) {
        Campus campus = lockCampus(id);
        ensureCampusActive(campus);
        return campus;
    }

    private void ensureCampusActive(Campus campus) {
        if (campus != null && !campus.isActive()) {
            throw problem(HttpStatus.CONFLICT, "USER_CAMPUS_ARCHIVED", "Reative o campus ou selecione um campus ativo.");
        }
    }

    private static void validateRolesHaveCampus(Set<RoleName> roles, Campus campus) {
        if (campus != null) return;
        roles.stream().filter(role -> role != RoleName.ADMIN).sorted().findFirst().ifPresent(role -> {
            String label = switch (role) {
                case NAPNE -> "Equipe NAPNE";
                case COURSE_COORDINATOR -> "Coordenação de curso";
                case TEACHER -> "Professor";
                case TUTOR -> "Monitor/Tutor";
                case MANAGEMENT -> "Gestão";
                default -> role.name();
            };
            throw problem(HttpStatus.BAD_REQUEST, "USER_CAMPUS_REQUIRED",
                    "Para conceder o perfil " + label + ", é necessário vincular este usuário a um campus.");
        });
    }

    private List<UserAccount> lockActiveAdmins() {
        return users.lockActiveAccountsWithRole(RoleName.ADMIN);
    }

    private void ensureAnotherAdmin(UserAccount user, List<UserAccount> activeAdmins) {
        if (user.isActive() && user.getRoles().contains(RoleName.ADMIN)
                && activeAdmins.stream().noneMatch(account -> !account.getId().equals(user.getId())
                && account.isActive() && account.getRoles().contains(RoleName.ADMIN))) {
            throw problem(HttpStatus.CONFLICT, "USER_LAST_ADMIN", "O sistema deve manter ao menos um administrador ativo.");
        }
    }

    private static void invalidateSessions(UserAccount user) {
        user.setSessionVersion(user.getSessionVersion() + 1);
    }

    private static Long campusId(UserAccount user) {
        return user.getCampus() == null ? null : user.getCampus().getId();
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    private static ApiOperationException duplicateCpf() {
        return problem(HttpStatus.CONFLICT, "USER_CPF_DUPLICATE", "Este CPF já está cadastrado.");
    }

    private static ApiOperationException problem(HttpStatus status, String code, String message) {
        return new ApiOperationException(status, code, message);
    }

    public record CreateRequest(@NotBlank @Size(max = 160) String name,
                                @Email @NotBlank @Size(max = 190) String email,
                                @Size(max = 20) String cpf,
                                @Size(max = 60) String institutionalRegistration,
                                @NotBlank @Size(min = 12, max = 72) String password,
                                Long campusId, @NotEmpty Set<@NotNull RoleName> roles) {
        public CreateRequest {
            name = name == null ? null : name.strip();
            email = email == null ? null : UserEmailHistoryService.normalize(email);
        }
    }

    public record UpdateRequest(@NotBlank @Size(max = 160) String name,
                                @Email @NotBlank @Size(max = 190) String email,
                                @Size(max = 20) String cpf,
                                @Size(max = 60) String institutionalRegistration, Long campusId) {
        public UpdateRequest {
            name = name == null ? null : name.strip();
            email = email == null ? null : UserEmailHistoryService.normalize(email);
        }
    }

    public record RolesRequest(@NotEmpty Set<@NotNull RoleName> roles) {}
    public record ActiveRequest(@NotNull Boolean active) {}
    public record PasswordRequest(@NotBlank @Size(min = 12, max = 72) String password) {}
    public record CpfSearch(@Size(max = 20) String cpf) {}
    public record CpfSearchResult(Long id) {}

    public record UserView(Long id, String name, String email, String cpfMasked, String institutionalRegistration,
                           boolean active, boolean securityBlocked, Long campusId, Set<RoleName> roles) {
        static UserView of(UserAccount user) {
            return new UserView(user.getId(), user.getName(), user.getEmail(), Cpf.mask(user.getCpf()),
                    user.getInstitutionalRegistration(), user.isActive(), user.isSecurityBlocked(), AdminUserController.campusId(user),
                    Set.copyOf(user.getRoles()));
        }
    }

    public record UserDetails(Long id, String name, String email, String cpf, String institutionalRegistration, Long campusId) {
        static UserDetails of(UserAccount user) {
            return new UserDetails(user.getId(), user.getName(), user.getEmail(), user.getCpf(),
                    user.getInstitutionalRegistration(), AdminUserController.campusId(user));
        }
    }
}
