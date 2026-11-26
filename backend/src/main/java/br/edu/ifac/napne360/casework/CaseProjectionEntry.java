package br.edu.ifac.napne360.casework;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "case_projection_outbox")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
@AllArgsConstructor
class CaseProjectionEntry {
    @Id
    @Column(length = 128)
    private String projectionKey;

    @Column(nullable = false, columnDefinition = "LONGTEXT")
    private String payload;
}
