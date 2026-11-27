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
import br.edu.ifac.napne360.student.StudentStatus;
import br.edu.ifac.napne360.student.StudentStatusHistory;
import br.edu.ifac.napne360.student.StudentStatusHistoryRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import br.edu.ifac.napne360.student.StudentStatusReason;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.IntStream;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class TimelineControllerTest {
    @Test void listsOnlyVisibleAuthorsAndDistinguishesIdentifiedHomonymsFromUnidentifiedHistoricalLabels() throws Exception {
        var access = mock(AccessGuard.class);
        var users = mock(CurrentUserService.class);
        var timeline = mock(TimelineRepository.class);
        var controller = new TimelineController(timeline, access, users, mock(CareRecordService.class), mock(StudentStatusHistoryRepository.class));
        var mvc = MockMvcBuilders.standaloneSetup(controller).build();
        when(users.require()).thenReturn(UserAccount.builder().roles(Set.of(RoleName.TEACHER)).build());
        var date = Instant.parse("2026-11-01T00:00:00Z");
        var restricted = datedEvent("hidden", "DOSSIER_UPDATED", "Restrito", date, "dossier");
        restricted.setVisibility(TimelineVisibility.RESTRICTED);
        var otherStudent = datedEvent("other", "GUIDANCE", "Outra pessoa", date, "other");
        otherStudent.setStudentId(2L);
        var identified = datedEvent("identified", "GUIDANCE", "Ana", date, "identified");
        identified.setActorId(53L);
        var homonym = datedEvent("homonym", "GUIDANCE", "Ana", date, "homonym");
        homonym.setActorId(75L);
        var previousName = datedEvent("renamed", "GUIDANCE", "Nome anterior", date.minusSeconds(60), "renamed");
        previousName.setActorId(53L);
        when(timeline.streamByStudentIdOrderByCreatedAtDescIdDesc(1L)).thenAnswer(invocation -> Stream.of(
                identified, homonym,
                datedEvent("one", "GUIDANCE", "Ana", date, "one"),
                datedEvent("two", "GUIDANCE", "ANA", date, "two"),
                datedEvent("three", "GUIDANCE", "Ana", date, "three"),
                datedEvent("legacy", "GUIDANCE", "Nome histórico", date, "legacy"),
                restricted, otherStudent, previousName, event("blank", "GUIDANCE", TimelineVisibility.PEDAGOGICAL, Map.of())));

        byte[] body = mvc.perform(get("/api/v1/students/1/timeline/actors")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();
        List<TimelineController.AuthorOption> options = new ObjectMapper().readValue(body, new TypeReference<>() {});
        assertThat(options).hasSize(5).extracting(TimelineController.AuthorOption::id, TimelineController.AuthorOption::label)
                .contains(tuple("name:Nome histórico", "Nome histórico"), tuple("account:53", "Ana"));
        mvc.perform(get("/api/v1/students/1/timeline/page").param("actorKey", "name:ANA")).andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].id").value("two"));
        mvc.perform(get("/api/v1/students/1/timeline/page").param("actorKey", "account:53")).andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2))
                .andExpect(jsonPath("$.content[0].id").value("identified"))
                .andExpect(jsonPath("$.content[0].actorId").doesNotHaveJsonPath())
                .andExpect(jsonPath("$.content[1].id").value("renamed"));
    }

    @Test void peiEventsFollowDocumentPermissionsIncludingLegacyEventsWithoutASubject() {
        var campus = Campus.builder().id(4L).build();
        var users = mock(CurrentUserService.class);
        var students = mock(StudentRepository.class);
        var assignments = mock(StudentAssignmentRepository.class);
        var timeline = mock(TimelineRepository.class);
        var controller = new TimelineController(timeline, new AccessGuard(users, students, assignments), users, mock(CareRecordService.class), mock(StudentStatusHistoryRepository.class));
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
        var controller = new TimelineController(timeline, new AccessGuard(users, students, assignments), users, mock(CareRecordService.class), mock(StudentStatusHistoryRepository.class));
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

        var first = controller.page(1L, "PEI", null, null, null, null, 0, 10);
        assertThat(first.totalElements()).isEqualTo(103);
        assertThat(first.totalPages()).isEqualTo(11);
        assertThat(first.content()).hasSize(10).first().extracting(TimelineEventDocument::getId).isEqualTo("pei-0");
        var last = controller.page(1L, "PEI", null, null, null, null, 10, 10);
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
        assertThat(new TimelineController(timeline, access, users, mock(CareRecordService.class), mock(StudentStatusHistoryRepository.class)).list(1L, null, null, null, null, 10))
                .extracting(TimelineEventDocument::getId).containsExactly("right-offering");
    }

    @Test void combinesAuthorTypeDateAndPermissionsBeforePagination() {
        var access = mock(AccessGuard.class);
        var users = mock(CurrentUserService.class);
        var timeline = mock(TimelineRepository.class);
        var records = mock(CareRecordService.class);
        var controller = new TimelineController(timeline, access, users, records, mock(StudentStatusHistoryRepository.class));
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
        var result = controller.page(1L, "care_record", " ana ", null, start, end, 1, 1);
        assertThat(result.totalElements()).isEqualTo(2);
        assertThat(result.totalPages()).isEqualTo(2);
        assertThat(result.content()).extracting(TimelineEventDocument::getId).containsExactly("first");
        assertThat(controller.list(1L, "care_record", "ana", start, end, 1))
                .extracting(TimelineEventDocument::getId).containsExactly("last");
        assertThatThrownBy(() -> controller.page(1L, null, null, null, end, start, 0, 10))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test void deniesBothQueriesBeforeReadingAnyEvents() {
        var access = mock(AccessGuard.class);
        var repository = mock(TimelineRepository.class);
        var users = mock(CurrentUserService.class);
        var controller = new TimelineController(repository, access, users, mock(CareRecordService.class), mock(StudentStatusHistoryRepository.class));
        doThrow(new org.springframework.security.access.AccessDeniedException("Access denied"))
                .when(access).requireView(2L);
        assertThatThrownBy(() -> controller.page(2L, "PEI", "Ana", null, null, null, 0, 10))
                .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
        assertThatThrownBy(() -> controller.list(2L, "PEI", "Ana", null, null, 10))
                .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
        assertThatThrownBy(() -> controller.actors(2L))
                .isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
        verifyNoInteractions(repository, users);
    }

    @Test void mergesAcademicStatusHistoryBeforePaginationAndKeepsItRestricted() {
        var access = mock(AccessGuard.class);
        var users = mock(CurrentUserService.class);
        var timeline = mock(TimelineRepository.class);
        var history = mock(StudentStatusHistoryRepository.class);
        var controller = new TimelineController(timeline, access, users, mock(CareRecordService.class), history);
        var occurred = Instant.parse("2026-11-17T13:00:00Z");
        var effective = LocalDate.of(2026, 11, 11);
        when(history.findByStudentIdOrderByRecordedAtDescIdDesc(1L)).thenReturn(List.of(
                StudentStatusHistory.builder().id(5L).studentId(1L).action(StudentStatusHistory.Action.STATUS_CHANGED)
                        .previousStatus(StudentStatus.ACTIVE).newStatus(StudentStatus.TRANSFERRED)
                        .reason(StudentStatusReason.TRANSFER).effectiveDate(effective).recordedAt(occurred)
                        .authorId(14L).authorName("Autora NAPNE").observations("Documento recebido.").build()));
        when(timeline.streamByStudentIdOrderByCreatedAtDescIdDesc(1L)).thenAnswer(invocation -> Stream.of(
                datedEvent("new", "GUIDANCE", "Novo", occurred.plusSeconds(5), "new"),
                datedEvent("old", "GUIDANCE", "Antigo", occurred.minusSeconds(5), "old")));

        when(users.require()).thenReturn(UserAccount.builder().roles(Set.of(RoleName.TEACHER)).build());
        assertThat(controller.list(1L, null, null, null, null, 100))
                .extracting(TimelineEventDocument::getId).containsExactly("new", "old");
        verifyNoInteractions(history);

        when(users.require()).thenReturn(UserAccount.builder().roles(Set.of(RoleName.NAPNE)).build());
        var page = controller.page(1L, null, null, null, null, null, 1, 1);
        assertThat(page.totalElements()).isEqualTo(3);
        assertThat(page.content()).singleElement().satisfies(event -> {
            assertThat(event.getEventType()).isEqualTo("STUDENT_STATUS_CHANGED");
            assertThat(event.getActor()).isEqualTo("Autora NAPNE");
            assertThat(event.getCreatedAt()).isEqualTo(occurred);
            assertThat(event.getData()).containsEntry("effectiveDate", effective.toString())
                    .containsEntry("previousStatus", StudentStatus.ACTIVE.name())
                    .containsEntry("newStatus", StudentStatus.TRANSFERRED.name())
                    .containsEntry("reason", StudentStatusReason.TRANSFER.name())
                    .containsEntry("observations", "Documento recebido.");
        });
        assertThat(controller.actors(1L)).extracting(TimelineController.AuthorOption::label).contains("Autora NAPNE");
    }

    private TimelineEventDocument datedEvent(String id, String type, String actor, Instant date, String recordId) {
        return TimelineEventDocument.builder().id(id).studentId(1L).eventType(type).actor(actor).createdAt(date)
                .visibility(TimelineVisibility.PEDAGOGICAL).data(Map.of("recordId", recordId)).build();
    }

    private TimelineEventDocument event(String id, String type, TimelineVisibility visibility, Map<String, Object> data) {
        return TimelineEventDocument.builder().id(id).studentId(1L).eventType(type).visibility(visibility).data(data).build();
    }
}
