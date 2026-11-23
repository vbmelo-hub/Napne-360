package br.edu.ifac.napne360.casework;

import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

@Converter
public class CaseStageConverter implements AttributeConverter<CaseStage, String> {
    @Override
    public String convertToDatabaseColumn(CaseStage stage) {
        return stage == null ? null : stage.code();
    }

    @Override
    public CaseStage convertToEntityAttribute(String code) {
        return code == null ? null : new CaseStage(code);
    }
}
