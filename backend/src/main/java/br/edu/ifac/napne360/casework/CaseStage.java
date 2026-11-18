package br.edu.ifac.napne360.casework;

import java.util.Arrays;
import java.util.List;

public enum CaseStage {
    RECEIVED,
    SCREENING,
    WELCOMING,
    CASE_STUDY,
    GUIDANCE_ISSUED,
    ACTION_PLAN,
    PEI,
    FOLLOW_UP,
    CLOSED,
    ARCHIVED;

    private static final List<CaseStage> DESTINATIONS_FROM_ACTIVE = Arrays.stream(values())
            .filter(stage -> stage != ARCHIVED).toList();

    boolean isActive() {
        return this != CLOSED && this != ARCHIVED;
    }

    List<CaseStage> allowedNextStages() {
        return switch (this) {
            case CLOSED -> List.of(SCREENING, ARCHIVED);
            case ARCHIVED -> List.of();
            default -> DESTINATIONS_FROM_ACTIVE.stream().filter(stage -> stage != this).toList();
        };
    }
}
