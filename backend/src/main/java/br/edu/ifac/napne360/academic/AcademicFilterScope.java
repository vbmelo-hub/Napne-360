package br.edu.ifac.napne360.academic;

import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

public record AcademicFilterScope(@Positive Long courseId, @Positive Long subjectId, @Size(max = 80) String periodCode) {}
