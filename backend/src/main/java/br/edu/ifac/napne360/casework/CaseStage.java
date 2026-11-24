package br.edu.ifac.napne360.casework;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import com.fasterxml.jackson.databind.JsonNode;

import java.util.regex.Pattern;

public record CaseStage(String code) {
    private static final Pattern CODE = Pattern.compile("[A-Z][A-Z_]{0,39}|CUSTOM_[0-9a-f]{32}");

    public static final CaseStage RECEIVED = new CaseStage("RECEIVED");
    public static final CaseStage SCREENING = new CaseStage("SCREENING");
    public static final CaseStage WELCOMING = new CaseStage("WELCOMING");
    public static final CaseStage CASE_STUDY = new CaseStage("CASE_STUDY");
    public static final CaseStage GUIDANCE_ISSUED = new CaseStage("GUIDANCE_ISSUED");
    public static final CaseStage ACTION_PLAN = new CaseStage("ACTION_PLAN");
    public static final CaseStage PEI = new CaseStage("PEI");
    public static final CaseStage FOLLOW_UP = new CaseStage("FOLLOW_UP");
    public static final CaseStage CLOSED = new CaseStage("CLOSED");
    public static final CaseStage ARCHIVED = new CaseStage("ARCHIVED");

    public CaseStage {
        if (code == null || !CODE.matcher(code).matches()) {
            throw new IllegalArgumentException("Código de etapa inválido.");
        }
    }

    @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
    public static CaseStage fromJson(JsonNode value) {
        return new CaseStage(value.textValue());
    }

    @JsonValue
    public String code() { return code; }

    public boolean isActive() {
        return !equals(CLOSED) && !equals(ARCHIVED);
    }

    boolean allows(CaseStage next) {
        if (equals(CLOSED)) return next.equals(SCREENING) || next.equals(ARCHIVED);
        return isActive() && !equals(next) && !next.equals(ARCHIVED);
    }
}
