package br.edu.ifac.napne360.casework;

import java.util.List;

import static br.edu.ifac.napne360.casework.CaseStage.*;

public record CaseStageCatalogue(long version, List<Option> stages) {
    static final CaseStageCatalogue DEFAULTS = new CaseStageCatalogue(0, List.of(
            new Option(RECEIVED, "Recebido"),
            new Option(SCREENING, "Triagem"),
            new Option(WELCOMING, "Acolhimento"),
            new Option(CASE_STUDY, "Estudo de caso"),
            new Option(GUIDANCE_ISSUED, "Orientações emitidas"),
            new Option(ACTION_PLAN, "Plano de ação"),
            new Option(PEI, "PEI"),
            new Option(FOLLOW_UP, "Acompanhamento"),
            new Option(CLOSED, "Encerrado"),
            new Option(ARCHIVED, "Arquivado")));

    public CaseStageCatalogue {
        stages = List.copyOf(stages);
    }

    List<Option> nextOptions(CaseStage stage) {
        return stages.stream().filter(option -> stage.allows(option.code())).toList();
    }

    String label(CaseStage stage) {
        return stage == null ? null : stages.stream().filter(option -> option.code().equals(stage))
                .findFirst().map(Option::label).orElseGet(() -> originalLabel(stage));
    }

    static String originalLabel(CaseStage stage) {
        return stage == null ? null : DEFAULTS.stages.stream().filter(option -> option.code().equals(stage))
                .findFirst().map(Option::label).orElse(stage.code());
    }

    public record Option(CaseStage code, String label) {}
}
