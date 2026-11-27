package br.edu.ifac.napne360.timeline;

import br.edu.ifac.napne360.document.CareRecordService;
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

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.IntStream;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class TimelineControllerTest {
    @Test void peiEventsFollowDocumentPermissionsIncludingLegacyEventsWithoutASubject() {
        var campus = Campus.builder().id(4L).build();
        var users = mock(CurrentUserService.class);
        var students = mock(StudentRepository.class);
        var assignments = mock(StudentAssignmentRepository.class);
        var timeline = mock(TimelineRepository.class);
        var controller = new TimelineController(timeline, new AccessGuard(users, students, assignments), users, mock(CareRecordService.class));
        when(students.findById(1L)).thenReturn(Optional.of(Student.builder().id(1L).campus(campus).build()));
        when(assignments.existsByStudentIdAndUserIdAndActiveTrue(1L, 9L)).thenReturn(true);
        when(assignments.existsByStudentIdAndUserIdAndActiveTrue(1L, 10L)).thenReturn(true);
        when(assignments.existsByStudentIdAndUserIdAndSubjectIdAndAssignmentTypeAndActiveTrue(
                1L, 9L, 2L, AssignmentType.TEACHER)).thenReturn(true);
        when(assignments.existsByStudentIdAndUserIdAndSubjectIdAndActiveTrue(1L, 9L, 2L)).thenReturn(true);
        when(timeline.streamByStudentIdOrderByCreatedAtDescIdDesc(1L)).thenAnswer(invocation -> Stream.of(
                event("generic", "GUIDANCE", TimelineVisibility.PEDAGOGICAL, Map.of()),
                event("legacy", "PEI_RETURNED", TimelineVisibility.PEDAGOGICAL, Map.of("peiId", "old")),
                event("own", "PEI_SUBMITTED", TimelineVisibility.PEDAGOGICAL, Map.of("subjectId", 2L)),
                event("restricted", "PEI_TRANSFERRED", TimelineVisibility.RESTRICTED, Map.of("subjectId", 2L))));

        when(users.require()).thenReturn(UserAccount.builder().id(9L).campus(campus).roles(Set.of(RoleName.TEACHER)).build());
        assertThat(controller.list(1L, null, null, null, null, 100)).extracting(TimelineEventDocument::getId)
                .containsExactly("generic", "own");

        when(users.require()).thenReturn(UserAccount.builder().id(10L).campus(campus).roles(Set.of(RoleName.COTEP)).build());
        assertThat(controller.list(1L, null, null, null, null, 100)).extracting(TimelineEventDocument::getId)
                .containsExactly("generic");
        when(assignments.existsByStudentIdAndUserIdAndAssignmentTypeAndActiveTrue(
                1L, 10L, AssignmentType.COORDINATOR)).thenReturn(true);
        assertThat(controller.list(1L, null, null, null, null, 100)).extracting(TimelineEventDocument::getId)
                .containsExactly("generic", "legacy", "own");

        when(users.require()).thenReturn(UserAccount.builder().id(11L).campus(campus).roles(Set.of(RoleName.NAPNE)).build());
        assertThat(controller.list(1L, null, null, null, null, 100)).extracting(TimelineEventDocument::getId)
                .containsExactly("generic", "legacy", "own", "restricted");
    }

    @Test void pagedTimelineCountsOnlyVisibleMatchingEventsAndReachesBeyondTheLegacyLimit() {
        var campus = Campus.builder().id(4L).build();
        var users = mock(CurrentUserService.class);
        var students = mock(StudentRepository.class);
        var assignments = mock(StudentAssignmentRepository.class);
        var timeline = mock(TimelineRepository.class);
        var controller = new TimelineController(timeline, new AccessGuard(users, students, assignments), users, mock(CareRecordService.class));
        when(students.findById(1L)).thenReturn(Optional.of(Student.builder().id(1L).campus(campus).build()));
        when(assignments.existsByStudentIdAndUserIdAndActiveTrue(1L, 9L)).thenReturn(true);
        when(assignments.existsByStudentIdAndUserIdAndSubjectIdAndAssignmentTypeAndActiveTrue(
                1L, 9L, 2L, AssignmentType.TEACHER)).thenReturn(true);
        when(users.require()).thenReturn(UserAccount.builder().id(9L).campus(campus).roles(Set.of(RoleName.TEACHER)).build());
        when(timeline.streamByStudentIdOrderByCreatedAtDescIdDesc(1L)).thenAnswer(invocation -> Stream.concat(Stream.of(
                event("wrong-type", "CARE_RECORD_CREATED", TimelineVisibility.PEDAGOGICAL, Map.of()),
                event("wrong-subject", "PEI_SUBMITTED", TimelineVisibility.PEDAGOGICAL, Map.of("subjectId", 3L)),
                event("restricted", "PEI_TRANSFERRED", TimelineVisibility.RESTRICTED, Map.of("subjectId", 2L))),
                IntStream.range(0, 103).mapToObj(i -> event("pei-" + i, "PEI_SUBMITTED",
                        TimelineVisibility.PEDAGOGICAL, Map.of("subjectId", 2L)))));

        var first = controller.page(1L, "PEI", null, null, null, 0, 10);
        assertThat(first.totalElements()).isEqualTo(103);
        assertThat(first.totalPages()).isEqualTo(11);
        assertThat(first.content()).hasSize(10).first().extracting(TimelineEventDocument::getId).isEqualTo("pei-0");
        var last = controller.page(1L, "PEI", null, null, null, 10, 10);
        assertThat(last.content()).extracting(TimelineEventDocument::getId).containsExactly("pei-100", "pei-101", "pei-102");
    }

    @Test void hidesAcademicPeiEventsFromAnotherOfferingOfTheSamePeriodAndComponent() {
        var access = mock(AccessGuard.class);
        var users = mock(CurrentUserService.class);
        var timeline = mock(TimelineRepository.class);
        when(users.require()).thenReturn(UserAccount.builder().roles(Set.of(RoleName.TEACHER)).build());
        when(access.canViewPei(1L, 3L, "2026.2", 61L)).thenReturn(true);
        when(timeline.streamByStudentIdOrderByCreatedAtDescIdDesc(1L)).thenAnswer(invocation -> Stream.of(
                event("wrong-offering", "PEI_SUBMITTED", TimelineVisibility.PEDAGOGICAL,
                        Map.of("subjectId", 3L, "academicTerm", "2026.2", "offeringId", 60L)),
                event("right-offering", "PEI_SUBMITTED", TimelineVisibility.PEDAGOGICAL,
                        Map.of("subjectId", 3L, "academicTerm", "2026.2", "offeringId", 61L))));
        assertThat(new TimelineController(timeline, access, users, mock(CareRecordService.class)).list(1L, null, null, null, null, 10))
                .extracting(TimelineEventDocument::getId).containsExactly("right-offering");
    }

    @Test void combinesAuthorTypeDateAndPermissionsBeforePagination() {
        var access = mock(AccessGuard.class);
        var users = mock(CurrentUserService.class);
        var timeline = mock(TimelineRepository.class);
        var records = mock(CareRecordService.class);
        var controller = new TimelineController(timeline, access, users, records);
        when(users.require()).thenReturn(UserAccount.builder().roles(Set.of(RoleName.TEACHER)).build());
        var start = Instant.parse("2026-11-01T00:00:00Z");
        var end = Instant.parse("2026-11-02T00:00:00Z");
        when(records.canViewTimelineRecord(1L, "public")).thenReturn(true);
        var entries = List.of(
                datedEvent("old", "CARE_RECORD_CREATED", "Ana", start.minusSeconds(1), "public"),
                datedEvent("other-author", "CARE_RECORD_CREATED", "Joana", start, "public"),
                datedEvent("other-type", "PEI_CREATED", "Ana", start, "public"),
                datedEvent("hidden-draft", "CARE_RECORD_CREATED", "Ana", start, "private"),
                datedEvent("last", "CARE_RECORD_UPDATED", "ANA", end, "public"),
                datedEvent("first", "CARE_RECORD_CREATED", "Ana", start, "public"));
        when(timeline.streamByStudentIdOrderByCreatedAtDescIdDesc(1L)).thenAnswer(invocation -> entries.stream());
        var result = controller.page(1L, "care_record", " ana ", start, end, 1, 1);
        assertThat(result.totalElements()).isEqualTo(2);
        assertThat(result.totalPages()).isEqualTo(2);
        assertThat(result.content()).extracting(TimelineEventDocument::getId).containsExactly("first");
        assertThat(controller.list(1L, "care_record", "ana", start, end, 1))
                .extracting(TimelineEventDocument::getId).containsExactly("last");
        assertThatThrownBy(() -> controller.page(1L, null, null, end, start, 0, 10))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test void deniesBothQueriesBeforeReadingAnyEvents() {
        var access = mock(AccessGuard.class);
        var repository = mock(TimelineRepository.class);
        var users = mock(CurrentUserService.class);
        var controller = new TimelineController(repository, access, users, mock(CareRecordService.class));
        doThrow(new org.springframework.security.access.AccessDeniedException("Access denied"))
                .when(access).requireView(2L);
        assertThatThrownBy(() -> controller.page(2L, "PEI", "Ana", null, null, 0, 10))
                .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
        assertThatThrownBy(() -> controller.list(2L, "PEI", "Ana", null, null, 10))
                .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
        verifyNoInteractions(repository, users);
    }

    private TimelineEventDocument datedEvent(String id, String type, String actor, Instant date, String recordId) {
        return TimelineEventDocument.builder().id(id).studentId(1L).eventType(type).actor(actor).createdAt(date)
                .visibility(TimelineVisibility.PEDAGOGICAL).data(Map.of("recordId", recordId)).build();
    }

    private TimelineEventDocument event(String id, String type, TimelineVisibility visibility, Map<String, Object> data) {
        return TimelineEventDocument.builder().id(id).studentId(1L).eventType(type).visibility(visibility).data(data).build();
    }
}
