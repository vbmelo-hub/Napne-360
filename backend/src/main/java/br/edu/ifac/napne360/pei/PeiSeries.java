package br.edu.ifac.napne360.pei;

import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

@Document("pei_series")
record PeiSeries(@Id String id, @Indexed Long studentId, Long subjectId, String academicTerm,
                 Long version, List<PeiDocument> revisions) {
    private static final Comparator<PeiDocument> LEGACY_PRIORITY = Comparator
            .comparingInt(PeiDocument::getRevision)
            .thenComparing(PeiDocument::getId);

    static String key(Long studentId, Long subjectId, String term) {
        return studentId + ":" + subjectId + ":" + (term == null ? "-" : "+" + term);
    }

    static PeiSeries fromLegacy(Long studentId, Long subjectId, String term, List<PeiDocument> legacy) {
        var open = legacy.stream().filter(PeiSeries::isOpen).max(LEGACY_PRIORITY);
        var current = legacy.stream().filter(p -> p.getStatus() == PeiStatus.APPROVED).max(LEGACY_PRIORITY);
        // Preserve every revision. In each slot, the highest revision wins, with ID as a stable tie breaker.
        var revisions = legacy.stream().map(p -> {
            boolean duplicate = (isOpen(p) && open.orElseThrow() != p)
                    || (p.getStatus() == PeiStatus.APPROVED && current.orElseThrow() != p);
            return p.toBuilder().status(duplicate ? PeiStatus.SUPERSEDED : p.getStatus())
                    .storageVersion(Objects.requireNonNullElse(p.getStorageVersion(), 0L))
                    .content(legacyContent(p)).build();
        }).toList();
        return new PeiSeries(key(studentId, subjectId, term), studentId, subjectId, term, null, revisions);
    }

    private static Map<String, Object> legacyContent(PeiDocument plan) {
        var content = plan.getContent();
        if (content == null || !(content.get("teachingStrategies") instanceof Map<?, ?>)) {
            return content;
        }
        var normalized = new LinkedHashMap<>(content);
        normalized.remove("teachingStrategies");
        return normalized;
    }

    Optional<PeiDocument> find(String revisionId) {
        return revisions.stream().filter(p -> p.getId().equals(revisionId)).findFirst();
    }

    Optional<PeiDocument> current() {
        return revisions.stream().filter(p -> p.getStatus() == PeiStatus.APPROVED).findFirst();
    }

    boolean hasOpenWork() {
        return revisions.stream().anyMatch(PeiSeries::isOpen);
    }

    int nextRevision() {
        return Math.incrementExact(revisions.stream().mapToInt(PeiDocument::getRevision).max().orElse(0));
    }

    PeiSeries next(List<PeiDocument> newRevisions) {
        return new PeiSeries(id, studentId, subjectId, academicTerm,
                version == null ? 0L : Math.incrementExact(version), List.copyOf(newRevisions));
    }

    private static boolean isOpen(PeiDocument p) {
        return p.getStatus() == PeiStatus.DRAFT || p.getStatus() == PeiStatus.IN_REVIEW;
    }
}
