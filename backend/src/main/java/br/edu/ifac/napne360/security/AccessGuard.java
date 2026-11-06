package br.edu.ifac.napne360.security;

import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.student.Student;
import br.edu.ifac.napne360.student.StudentAssignmentRepository;
import br.edu.ifac.napne360.student.StudentRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Component;

import java.util.Set;

@Component("accessGuard")
@RequiredArgsConstructor
public class AccessGuard {
    private static final Set<RoleName> CAMPUS_PEDAGOGICAL = Set.of(
            RoleName.NAPNE);
    private final CurrentUserService currentUser;
    private final StudentRepository students;
    private final StudentAssignmentRepository assignments;

    public boolean canViewStudent(Long studentId) {
        UserAccount user = currentUser.require();
        Student student = students.findById(studentId).orElse(null);
        if (student == null || user.getCampus() == null || !user.getCampus().getId().equals(student.getCampus().getId())) return false;
        if (user.getRoles().stream().anyMatch(CAMPUS_PEDAGOGICAL::contains)) return true;
        return user.getRoles().stream().anyMatch(Set.of(RoleName.TEACHER, RoleName.TUTOR, RoleName.COTEP, RoleName.COURSE_COORDINATOR, RoleName.MANAGEMENT)::contains)
                && assignments.existsByStudentIdAndUserIdAndActiveTrue(studentId, user.getId());
    }

    public boolean canEditDossier(Long studentId) {
        UserAccount user = currentUser.require();
        return user.getRoles().contains(RoleName.NAPNE) && sameCampus(user, requireStudent(studentId));
    }

    public boolean canWritePedagogical(Long studentId) {
        UserAccount user = currentUser.require();
        Student student = requireStudent(studentId);
        if (!sameCampus(user, student)) return false;
        if (user.getRoles().contains(RoleName.NAPNE)) return true;
        return user.getRoles().stream().anyMatch(Set.of(RoleName.COTEP, RoleName.COURSE_COORDINATOR, RoleName.TEACHER, RoleName.TUTOR)::contains)
                && assignments.existsByStudentIdAndUserIdAndActiveTrue(studentId, user.getId());
    }

    public boolean canManagePei(Long studentId, Long subjectId) {
        UserAccount user = currentUser.require();
        Student student = requireStudent(studentId);
        if (!sameCampus(user, student)) return false;
        if (user.getRoles().contains(RoleName.NAPNE)) return true;
        if (subjectId == null) return false;
        if (user.getRoles().stream().anyMatch(Set.of(RoleName.COTEP, RoleName.COURSE_COORDINATOR)::contains)) {
            return assignments.existsByStudentIdAndUserIdAndActiveTrue(studentId, user.getId());
        }
        return user.getRoles().contains(RoleName.TEACHER)
                && assignments.existsByStudentIdAndUserIdAndSubjectIdAndActiveTrue(studentId, user.getId(), subjectId);
    }

    public boolean canViewSubject(Long studentId, Long subjectId) {
        if (!canViewStudent(studentId)) return false;
        UserAccount user = currentUser.require();
        if (user.getRoles().stream().anyMatch(Set.of(RoleName.NAPNE, RoleName.COTEP, RoleName.COURSE_COORDINATOR)::contains)) return true;
        return subjectId != null && assignments.existsByStudentIdAndUserIdAndSubjectIdAndActiveTrue(studentId, user.getId(), subjectId);
    }

    public Student requireView(Long studentId) {
        if (!canViewStudent(studentId)) throw new AccessDeniedException("Access denied");
        return requireStudent(studentId);
    }

    private Student requireStudent(Long id) { return students.findById(id).orElseThrow(); }
    private boolean sameCampus(UserAccount user, Student student) {
        return user.getCampus() != null && user.getCampus().getId().equals(student.getCampus().getId());
    }
}
