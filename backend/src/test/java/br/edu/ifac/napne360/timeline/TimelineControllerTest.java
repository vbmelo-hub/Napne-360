package br.edu.ifac.napne360.timeline;

import br.edu.ifac.napne360.identity.Campus;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.security.AccessGuard;
import br.edu.ifac.napne360.security.CurrentUserService;
import br.edu.ifac.napne360.student.AssignmentType;
import br.edu.ifac.napne360.student.Student;
import br.edu.ifac.napne360.student.StudentAssignmentRepository;
import br.edu.ifac.napne360.student.StudentRepository;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class TimelineControllerTest {
    @Test void peiEventsFollowDocumentPermissionsIncludingLegacyEventsWithoutASubject() {
        var campus = Campus.builder().id(4L).build();
        var users = mock(CurrentUserService.class);
        var students = mock(StudentRepository.class);
        var assignments = mock(StudentAssignmentRepository.class);
        var timeline = mock(TimelineRepository.class);
        var controller = new TimelineController(timeline, new AccessGuard(users, students, assignments), users);
        when(students.findById(1L)).thenReturn(Optional.of(Student.builder().id(1L).campus(campus).build()));
        when(assignments.existsByStudentIdAndUserIdAndActiveTrue(1L, 9L)).thenReturn(true);
        when(assignments.existsByStudentIdAndUserIdAndActiveTrue(1L, 10L)).thenReturn(true);
        when(assignments.existsByStudentIdAndUserIdAndSubjectIdAndAssignmentTypeAndActiveTrue(
                1L, 9L, 2L, AssignmentType.TEACHER)).thenReturn(true);
        when(assignments.existsByStudentIdAndUserIdAndSubjectIdAndActiveTrue(1L, 9L, 2L)).thenReturn(true);
        when(timeline.findByStudentIdOrderByCreatedAtDesc(1L)).thenReturn(List.of(
                event("generic", "GUIDANCE", TimelineVisibility.PEDAGOGICAL, Map.of()),
                event("legacy", "PEI_RETURNED", TimelineVisibility.PEDAGOGICAL, Map.of("peiId", "old")),
                event("own", "PEI_SUBMITTED", TimelineVisibility.PEDAGOGICAL, Map.of("subjectId", 2L)),
                event("restricted", "PEI_TRANSFERRED", TimelineVisibility.RESTRICTED, Map.of("subjectId", 2L))));

        when(users.require()).thenReturn(UserAccount.builder().id(9L).campus(campus).roles(Set.of(RoleName.TEACHER)).build());
        assertThat(controller.list(1L, null, null, null, 100)).extracting(TimelineEventDocument::getId)
                .containsExactly("generic", "own");

        when(users.require()).thenReturn(UserAccount.builder().id(10L).campus(campus).roles(Set.of(RoleName.COTEP)).build());
        assertThat(controller.list(1L, null, null, null, 100)).extracting(TimelineEventDocument::getId)
                .containsExactly("generic");
        when(assignments.existsByStudentIdAndUserIdAndAssignmentTypeAndActiveTrue(
                1L, 10L, AssignmentType.COORDINATOR)).thenReturn(true);
        assertThat(controller.list(1L, null, null, null, 100)).extracting(TimelineEventDocument::getId)
                .containsExactly("generic", "legacy", "own");

        when(users.require()).thenReturn(UserAccount.builder().id(11L).campus(campus).roles(Set.of(RoleName.NAPNE)).build());
        assertThat(controller.list(1L, null, null, null, 100)).extracting(TimelineEventDocument::getId)
                .containsExactly("generic", "legacy", "own", "restricted");
    }

    private TimelineEventDocument event(String id, String type, TimelineVisibility visibility, Map<String, Object> data) {
        return TimelineEventDocument.builder().id(id).eventType(type).visibility(visibility).data(data).build();
    }
}
