package br.edu.ifac.napne360.pei;

import br.edu.ifac.napne360.audit.AuditService;
import br.edu.ifac.napne360.common.ConflictException;
import br.edu.ifac.napne360.document.DossierRepository;
import br.edu.ifac.napne360.identity.SubjectRepository;
import br.edu.ifac.napne360.identity.UserAccountRepository;
import br.edu.ifac.napne360.security.AccessGuard;
import br.edu.ifac.napne360.security.CurrentUserService;
import br.edu.ifac.napne360.student.StudentAssignmentRepository;
import br.edu.ifac.napne360.timeline.TimelineService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import java.util.Map;
import java.util.Optional;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class PeiServiceTest {
    @Mock PeiRepository peis;
    @Mock DossierRepository dossiers;
    @Mock SubjectRepository subjects;
    @Mock CurrentUserService currentUser;
    @Mock TimelineService timeline;
    @Mock AuditService audit;
    @Mock AccessGuard access;
    @Mock UserAccountRepository users;
    @Mock StudentAssignmentRepository assignments;
    @Mock br.edu.ifac.napne360.document.DocumentTemplateRepository templates;
    PeiService service;
    PeiDocument pei;

    @BeforeEach void setup() {
        service = new PeiService(peis,dossiers,subjects,currentUser,timeline,audit,access,users,assignments,templates);
        pei = PeiDocument.builder().id("p1").studentId(1L).subjectId(2L).build();
        when(peis.findById("p1")).thenReturn(Optional.of(pei));
    }

    @Test void approvalCannotBeInjectedThroughRevision() {
        when(access.canViewSubject(1L,2L)).thenReturn(true);
        assertThatThrownBy(() -> service.createVersion(1L,"p1",new PeiService.PeiUpdateRequest(PeiStatus.APPROVED,Map.of()),null,null))
                .isInstanceOf(IllegalArgumentException.class);
        verify(peis,never()).save(any());
        assertThat(pei.getStatus()).isEqualTo(PeiStatus.DRAFT);
    }

    @Test void anotherStudentsPeiCannotBeRead() {
        assertThatThrownBy(() -> service.get(99L,"p1")).isInstanceOf(br.edu.ifac.napne360.common.NotFoundException.class);
    }

    @Test void anotherSubjectCannotBeRead() {
        assertThatThrownBy(() -> service.get(1L,"p1")).isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
    }

    @Test void supersededVersionCannotBeEdited() {
        when(access.canViewSubject(1L,2L)).thenReturn(true);
        pei.setStatus(PeiStatus.SUPERSEDED);
        assertThatThrownBy(() -> service.createVersion(1L,"p1",new PeiService.PeiUpdateRequest(PeiStatus.DRAFT,Map.of()),null,null))
                .isInstanceOf(ConflictException.class);
        verify(peis,never()).save(any());
    }

    @Test void emptyPeiCannotBeApproved() {
        when(access.canViewSubject(1L,2L)).thenReturn(true);
        pei.setStatus(PeiStatus.IN_REVIEW);
        assertThatThrownBy(() -> service.approve(1L,"p1",null,null)).isInstanceOf(IllegalArgumentException.class);
        verify(peis,never()).save(any());
    }
}
