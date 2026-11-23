package br.edu.ifac.napne360.casework;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/admin/case-stages")
@PreAuthorize("hasRole('ADMIN')")
@RequiredArgsConstructor
public class CaseStageConfigurationController {
    private final CaseStageConfigurationService service;

    @GetMapping
    public CaseStageCatalogue get() {
        return service.current();
    }

    @PutMapping
    public CaseStageCatalogue update(@Valid @RequestBody CaseStageConfigurationService.UpdateRequest request) {
        return service.update(request);
    }
}
