package br.edu.ifac.napne360.casework;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "case_stage_configuration")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CaseStageConfiguration {
    @Id
    private Integer id;

    @Column(nullable = false)
    private long version;

    @Column(nullable = false, columnDefinition = "LONGTEXT")
    private String stagesJson;
}
