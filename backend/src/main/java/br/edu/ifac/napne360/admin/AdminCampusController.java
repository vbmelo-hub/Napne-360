package br.edu.ifac.napne360.admin;

import br.edu.ifac.napne360.academic.AcademicRepository;
import br.edu.ifac.napne360.audit.AdminAuditConfiguration;
import br.edu.ifac.napne360.casework.CaseStage;
import br.edu.ifac.napne360.casework.NapneCaseRepository;
import br.edu.ifac.napne360.common.ApiOperationException;
import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.identity.Campus;
import br.edu.ifac.napne360.identity.CampusRepository;
import br.edu.ifac.napne360.identity.CourseRepository;
import br.edu.ifac.napne360.identity.UserAccountRepository;
import br.edu.ifac.napne360.student.StudentAssignmentRepository;
import br.edu.ifac.napne360.student.StudentRepository;
import br.edu.ifac.napne360.student.StudentStatus;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Locale;

@RestController
@RequestMapping("/api/v1/admin/campuses")
@PreAuthorize("hasRole('ADMIN')")
@RequiredArgsConstructor
public class AdminCampusController {
    private final CampusRepository campuses;
    private final CourseRepository courses;
    private final StudentRepository students;
    private final UserAccountRepository users;
    private final StudentAssignmentRepository assignments;
    private final NapneCaseRepository cases;
    private final AcademicRepository academic;

    @GetMapping
    @Transactional(readOnly = true)
    public List<CampusView> list() {
        return campuses.findAll(Sort.by("name", "id")).stream().map(CampusView::of).toList();
    }

    @GetMapping("/{id}")
    @Transactional(readOnly = true)
    public CampusView get(@PathVariable Long id) {
        return CampusView.of(campuses.findById(id).orElseThrow(() -> new NotFoundException("Campus não encontrado.")));
    }

    @PostMapping
    @Transactional
    public CampusView create(@Valid @RequestBody CampusRequest request) {
        return save(Campus.builder().name(request.name()).code(request.code()).build());
    }

    @PutMapping("/{id}")
    @Transactional
    public CampusView update(@PathVariable Long id, @Valid @RequestBody CampusRequest request, HttpServletRequest http) {
        Campus campus = lock(id);
        if (campus.getName().equals(request.name()) && campus.getCode().equals(request.code())) {
            AdminAuditConfiguration.markUnchanged(http);
            return CampusView.of(campus);
        }
        campus.setName(request.name());
        campus.setCode(request.code());
        return save(campus);
    }

    @PatchMapping("/{id}/active")
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public CampusView setActive(@PathVariable Long id, @Valid @RequestBody ActiveRequest request, HttpServletRequest http) {
        Campus campus = lock(id);
        if (campus.isActive() == request.active()) {
            AdminAuditConfiguration.markUnchanged(http);
            return CampusView.of(campus);
        }
        if (!request.active()) validateArchive(id);
        campus.setActive(request.active());
        return CampusView.of(campus);
    }

    private void validateArchive(Long id) {
        if (courses.existsByCampusIdAndActiveTrue(id)) {
            throw conflict("CAMPUS_ACTIVE_COURSES", "Arquive os cursos ativos antes de arquivar este campus.");
        }
        if (users.existsByCampusIdAndActiveTrue(id)) {
            throw conflict("CAMPUS_ACTIVE_USERS", "Resolva o vínculo das contas ativas antes de arquivar este campus.");
        }
        if (students.existsByCampusIdAndStatus(id, StudentStatus.ACTIVE)) {
            throw conflict("CAMPUS_ACTIVE_STUDENTS", "Este campus possui estudantes ativos vinculados.");
        }
        if (assignments.existsByStudentCampusIdAndActiveTrue(id) || academic.hasActiveCampusDependencies(id)) {
            throw conflict("CAMPUS_ACTIVE_ASSIGNMENTS", "Este campus possui vínculos, matrículas, ofertas ou atribuições ativas.");
        }
        if (cases.existsByStudentCampusIdAndStageNotIn(id, List.of(CaseStage.CLOSED, CaseStage.ARCHIVED))) {
            throw conflict("CAMPUS_ACTIVE_CASES", "Este campus possui casos em andamento.");
        }
    }

    private Campus lock(Long id) {
        return campuses.findByIdForUpdate(id).orElseThrow(() -> new NotFoundException("Campus não encontrado."));
    }

    private CampusView save(Campus campus) {
        try {
            return CampusView.of(campuses.saveAndFlush(campus));
        } catch (DataIntegrityViolationException exception) {
            throw conflict("CAMPUS_CODE_DUPLICATE", "Já existe um campus com este código.");
        }
    }

    private ApiOperationException conflict(String code, String message) {
        return new ApiOperationException(HttpStatus.CONFLICT, code, message);
    }

    public record CampusRequest(@NotBlank @Size(max = 160) String name, @NotBlank @Size(max = 40) String code) {
        public CampusRequest {
            name = name == null ? null : name.strip();
            code = code == null ? null : code.strip().toUpperCase(Locale.ROOT);
        }
    }

    public record ActiveRequest(@NotNull Boolean active) {}

    public record CampusView(Long id, String name, String code, boolean active) {
        static CampusView of(Campus campus) {
            return new CampusView(campus.getId(), campus.getName(), campus.getCode(), campus.isActive());
        }
    }
}
