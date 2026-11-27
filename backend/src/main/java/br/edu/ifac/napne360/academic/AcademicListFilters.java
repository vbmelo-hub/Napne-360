package br.edu.ifac.napne360.academic;

public record AcademicListFilters(Long courseId, Long subjectId, String subject, String groupCode,
                                  String periodCode, Long teacherId, Boolean active) {
    static final AcademicListFilters NONE = new AcademicListFilters(null, null, null, null, null, null, null);
}
