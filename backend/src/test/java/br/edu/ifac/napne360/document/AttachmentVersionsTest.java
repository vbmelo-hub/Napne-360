package br.edu.ifac.napne360.document;

import br.edu.ifac.napne360.common.NotFoundException;
import br.edu.ifac.napne360.security.AccessGuard;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class AttachmentVersionsTest {
    private final AttachmentRepository repository = mock(AttachmentRepository.class);
    private final AttachmentService service = new AttachmentService(repository, null, null, null);

    @Test
    void returnsTheLinkedFamilyIncludingArchivedAndBranchedRevisions() {
        when(repository.findConfirmedByStudentId(7L)).thenReturn(List.of(
                version("root", null, 1, true), version("second", "root", 2, false),
                version("branch", "root", 2, false), version("third", "second", 3, false),
                version("unrelated", null, 1, false)));

        assertThat(service.versions(7L, "second")).extracting(AttachmentDocument::getId)
                .containsExactly("third", "branch", "second", "root");
    }

    @Test
    void cannotReadHistoryForAnIdOutsideTheConfirmedStudentDocuments() {
        when(repository.findConfirmedByStudentId(8L)).thenReturn(List.of(version("other", null, 1, false)));

        assertThatThrownBy(() -> service.versions(8L, "second")).isInstanceOf(NotFoundException.class);
    }

    @Test
    void listsArchivedDocumentsOnlyWhenRequestedBySomeoneWithDossierAccess() throws Exception {
        var archived = version("archived", null, 1, true);
        when(repository.findActiveByStudentId(7L)).thenReturn(List.of());
        when(repository.findConfirmedByStudentId(7L)).thenReturn(List.of(archived));
        var access = mock(AccessGuard.class);
        when(access.canEditDossier(7L)).thenReturn(true);
        var mvc = MockMvcBuilders.standaloneSetup(
                new AttachmentController(repository, null, access, null, null, service)).build();
        var path = "/api/v1/students/7/attachments";

        mvc.perform(get(path)).andExpect(status().isOk()).andExpect(content().json("[]"));
        mvc.perform(get(path).param("includeArchived", "true"))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].archived").value(true));
        mvc.perform(get(path + "/archived/versions"))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].archived").value(true));
    }

    @Test
    void optionalArchiveListingDoesNotRevealMetadataToUsersWithoutDossierAccess() {
        var access = mock(AccessGuard.class);
        var controller = new AttachmentController(repository, null, access, null, null, service);

        assertThat(controller.list(7L, true)).isEmpty();
        verifyNoInteractions(repository);
    }

    private AttachmentDocument version(String id, String previous, int revision, boolean archived) {
        return AttachmentDocument.builder().id(id).previousVersionId(previous).revision(revision)
                .archived(archived).uploadedAt(java.time.Instant.EPOCH).build();
    }
}
