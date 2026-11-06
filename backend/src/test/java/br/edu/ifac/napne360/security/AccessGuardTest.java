package br.edu.ifac.napne360.security;

import br.edu.ifac.napne360.identity.Campus;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.student.Student;
import br.edu.ifac.napne360.student.StudentAssignmentRepository;
import br.edu.ifac.napne360.student.StudentRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AccessGuardTest {
    @Mock CurrentUserService currentUser;
    @Mock StudentRepository students;
    @Mock StudentAssignmentRepository assignments;
    private AccessGuard guard;
    private Campus campus;
    private Student student;

    @BeforeEach
    void setUp() {
        guard = new AccessGuard(currentUser, students, assignments);
        campus = Campus.builder().id(1L).name("Campus A").code("A").build();
        student = Student.builder().id(7L).campus(campus).registration("1").civilName("Aluno").build();
        when(students.findById(7L)).thenReturn(Optional.of(student));
    }

    @Test
    void napneCanEditDossierOnlyInsideOwnCampus() {
        when(currentUser.require()).thenReturn(user(2L, campus, RoleName.NAPNE));
        assertThat(guard.canEditDossier(7L)).isTrue();

        Campus other = Campus.builder().id(2L).name("Campus B").code("B").build();
        when(currentUser.require()).thenReturn(user(2L, other, RoleName.NAPNE));
        assertThat(guard.canEditDossier(7L)).isFalse();
    }

    @Test
    void assignedTeacherCanViewButCannotEditSensitiveDossier() {
        UserAccount teacher = user(3L, campus, RoleName.TEACHER);
        when(currentUser.require()).thenReturn(teacher);
        when(assignments.existsByStudentIdAndUserIdAndActiveTrue(7L, 3L)).thenReturn(true);

        assertThat(guard.canViewStudent(7L)).isTrue();
        assertThat(guard.canEditDossier(7L)).isFalse();
    }

    @Test
    void technicalAdminDoesNotReceiveDossierAccessAutomatically() {
        when(currentUser.require()).thenReturn(user(1L, null, RoleName.ADMIN));
        assertThat(guard.canViewStudent(7L)).isFalse();
    }

    private UserAccount user(Long id, Campus value, RoleName role) {
        return UserAccount.builder().id(id).campus(value).name("User").email("user" + id + "@test.local")
                .passwordHash("ignored").roles(Set.of(role)).build();
    }

    @Test
    void tutorAssignmentDoesNotAuthorizePeiEditing() {
        when(currentUser.require()).thenReturn(user(5L, campus, RoleName.TUTOR));
        assertThat(guard.canManagePei(7L, 10L)).isFalse();
    }

    @Test
    void teacherCannotManageDifferentSubject() {
        when(currentUser.require()).thenReturn(user(3L, campus, RoleName.TEACHER));
        when(assignments.existsByStudentIdAndUserIdAndSubjectIdAndActiveTrue(7L, 3L, 10L)).thenReturn(true);
        assertThat(guard.canManagePei(7L, 10L)).isTrue();
        assertThat(guard.canManagePei(7L, 11L)).isFalse();
    }

    @Test
    void managementAndCotepNeedExplicitStudentAssignments() {
        when(currentUser.require()).thenReturn(user(4L, campus, RoleName.MANAGEMENT));
        assertThat(guard.canViewStudent(7L)).isFalse();
        when(currentUser.require()).thenReturn(user(4L, campus, RoleName.COTEP));
        assertThat(guard.canViewStudent(7L)).isFalse();
        assertThat(guard.canWritePedagogical(7L)).isFalse();
    }

    @Test
    void assignmentCannotGrantAccessAcrossCampus() {
        when(currentUser.require()).thenReturn(user(3L, Campus.builder().id(99L).build(), RoleName.TEACHER));
        assertThat(guard.canViewStudent(7L)).isFalse();
        assertThat(guard.canManagePei(7L, 10L)).isFalse();
    }
}
