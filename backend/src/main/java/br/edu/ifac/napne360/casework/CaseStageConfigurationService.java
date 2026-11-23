package br.edu.ifac.napne360.casework;

import br.edu.ifac.napne360.common.ConflictException;
import br.edu.ifac.napne360.identity.ReferenceIdDeserializer;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;
import java.util.UUID;
import java.util.stream.Collectors;

import static br.edu.ifac.napne360.casework.CaseStage.ARCHIVED;
import static br.edu.ifac.napne360.casework.CaseStage.CLOSED;

@Service
@RequiredArgsConstructor
public class CaseStageConfigurationService {
    private static final int CONFIGURATION_ID = 1;
    private static final TypeReference<List<CaseStageCatalogue.Option>> OPTIONS = new TypeReference<>() {};

    private final CaseStageConfigurationRepository repository;
    private final ObjectMapper json;

    @Transactional(readOnly = true)
    public CaseStageCatalogue current() {
        return repository.findById(CONFIGURATION_ID).map(this::read).orElse(CaseStageCatalogue.DEFAULTS);
    }

    @Transactional
    public CaseStageCatalogue update(UpdateRequest request) {
        var current = current();
        if (request.version() != current.version()) throw staleConfiguration();
        var options = validateOptions(request.stages(), current);
        if (repository.updateIfCurrent(CONFIGURATION_ID, current.version(), encode(options)) != 1) {
            throw staleConfiguration();
        }
        return new CaseStageCatalogue(current.version() + 1, options);
    }

    private List<CaseStageCatalogue.Option> validateOptions(List<StageRequest> requested, CaseStageCatalogue current) {
        var remaining = current.stages().stream().map(CaseStageCatalogue.Option::code).collect(Collectors.toSet());
        var labels = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        var options = new ArrayList<CaseStageCatalogue.Option>(requested.size());
        for (var entry : requested) {
            String label = entry.label().textValue();
            if (label == null) throw new IllegalArgumentException("Informe um nome para cada etapa.");
            label = CaseText.trimBrowserWhitespace(label);
            if (label.isEmpty() || !labels.add(label)) {
                throw new IllegalArgumentException("Informe nomes únicos para as etapas.");
            }
            CaseStage code = entry.code();
            if (code == null) {
                code = new CaseStage("CUSTOM_" + UUID.randomUUID().toString().replace("-", ""));
            } else if (!remaining.remove(code)) {
                throw new IllegalArgumentException("O código da etapa é desconhecido ou está duplicado.");
            }
            options.add(new CaseStageCatalogue.Option(code, label));
        }
        if (!remaining.isEmpty()) {
            throw new IllegalArgumentException("Inclua todas as etapas existentes.");
        }
        if (!options.get(options.size() - 2).code().equals(CLOSED) || !options.getLast().code().equals(ARCHIVED)) {
            throw new IllegalArgumentException("As etapas de encerramento e arquivamento devem ficar no final.");
        }
        return options;
    }

    private CaseStageCatalogue read(CaseStageConfiguration row) {
        try {
            return new CaseStageCatalogue(row.getVersion(), json.readValue(row.getStagesJson(), OPTIONS));
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Configuração de etapas inválida.", error);
        }
    }

    private String encode(List<CaseStageCatalogue.Option> options) {
        try {
            return json.writeValueAsString(options);
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Não foi possível gravar a configuração de etapas.", error);
        }
    }

    private static ConflictException staleConfiguration() {
        return new ConflictException("A configuração de etapas foi alterada. Recarregue antes de salvar.");
    }

    public record UpdateRequest(@NotNull @JsonDeserialize(using = ReferenceIdDeserializer.class) Long version,
                                @NotEmpty List<@NotNull @Valid StageRequest> stages) {}
    public record StageRequest(@JsonProperty(required = true) CaseStage code, @NotNull JsonNode label) {}
}
