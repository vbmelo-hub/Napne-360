package br.edu.ifac.napne360.pei;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.common.ConflictException;
import br.edu.ifac.napne360.document.CareRecordService;
import br.edu.ifac.napne360.identity.SubjectRepository;
import br.edu.ifac.napne360.identity.RoleName;
import br.edu.ifac.napne360.identity.UserAccount;
import br.edu.ifac.napne360.security.AccessGuard;
import br.edu.ifac.napne360.security.CurrentUserService;
import br.edu.ifac.napne360.student.StudentAssignmentRepository;
import br.edu.ifac.napne360.timeline.TimelineService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.Optional;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class PeiServiceTest {
    PeiMongoFixture mongo;
    @Mock PeiRepository peis;
    @Mock CareRecordService careRecords;
    @Mock SubjectRepository subjects;
    @Mock CurrentUserService currentUser;
    @Mock TimelineService timeline;
    @Mock AuditService audit;
    @Mock AccessGuard access;
    @Mock StudentAssignmentRepository assignments;
    @Mock br.edu.ifac.napne360.document.DocumentTemplateRepository templates;
    PeiService service;
    PeiDocument pei;

    @BeforeEach void setup() {
        mongo = new PeiMongoFixture(peis);
        service = new PeiService(mock(br.edu.ifac.napne360.identity.ReferenceCatalogService.class), mongo.store,
                careRecords, subjects, currentUser, new PeiProjectionService(mongo.store, timeline, audit, Runnable::run),
                access, templates, assignments);
        pei = PeiDocument.builder().id("p1").studentId(1L).subjectId(2L).teacherId(9L).academicTerm("2026-2").build();
        when(peis.findById("p1")).thenReturn(Optional.of(pei));
        lenient().when(peis.findByStudentIdAndSubjectIdAndAcademicTermOrderByRevisionDesc(1L, 2L, "2026-2"))
                .thenReturn(List.of(pei));
    }

    @Test void anotherStudentsPeiCannotBeRead() {
        assertThatThrownBy(() -> service.get(99L,"p1")).isInstanceOf(br.edu.ifac.napne360.common.NotFoundException.class);
    }

    @Test void anotherSubjectCannotBeRead() {
        actor(RoleName.TEACHER);
        assertThatThrownBy(() -> service.get(1L,"p1")).isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
    }

    @Test void supersededVersionCannotBeEdited() {
        actor(RoleName.TEACHER);
        when(access.canTeachPei(1L,2L)).thenReturn(true);
        pei.setStatus(PeiStatus.SUPERSEDED);
        assertThatThrownBy(() -> service.createVersion(1L,"p1",new PeiService.PeiUpdateRequest(Map.of(), 0L),null,null))
                .isInstanceOf(ConflictException.class);
        verify(mongo.mongo, never()).insert(any(PeiSeries.class));
        verifyNoInteractions(timeline, audit);
    }

    @Test void emptyPeiCannotBeApproved() {
        actor(RoleName.NAPNE);
        when(access.canEditDossier(1L)).thenReturn(true);
        pei.setStatus(PeiStatus.IN_REVIEW);
        assertThatThrownBy(() -> service.transition(1L, "p1", PeiService.Action.APPROVE, 0L, null, null)).isInstanceOf(IllegalArgumentException.class);
        verify(mongo.mongo, never()).insert(any(PeiSeries.class));
        verifyNoInteractions(timeline, audit);
    }
    private void actor(RoleName role) {
        when(currentUser.require()).thenReturn(UserAccount.builder().id(9L).roles(Set.of(role)).build());
    }
}
