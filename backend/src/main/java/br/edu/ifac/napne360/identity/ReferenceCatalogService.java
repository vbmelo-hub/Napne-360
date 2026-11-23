package br.edu.ifac.napne360.identity;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.math.BigInteger;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/** Validates new associations and preserves snapshots belonging to existing documents. */
@Service
@RequiredArgsConstructor
public class ReferenceCatalogService {
    private final ReferenceEntryRepository entries;

    public Map<String, Object> category(Map<String, Object> incoming, Map<String, Object> previous) {
        Map<String, Object> result = incoming == null ? new LinkedHashMap<>() : new LinkedHashMap<>(incoming);
        Map<String, Object> stored = previous == null ? Map.of() : previous;
        if (!result.containsKey("categoryId")) {
            // Old clients can keep an association, but cannot replace its identity or snapshot.
            if (stored.get("categoryId") == null && result.containsKey("category")
                    && !Objects.equals(result.get("category"), stored.get("category"))
                    && !(stored.get("category") == null && (result.get("category") == null || "".equals(result.get("category"))))) {
                throw new IllegalArgumentException("Selecione uma categoria válida do catálogo.");
            }
            preserve(result, stored, "categoryId");
            preserve(result, stored, "category");
        } else if (result.get("categoryId") == null) {
            result.put("category", "");
        } else {
            Long id = positiveId(result.get("categoryId"));
            if (stored.get("categoryId") != null && id.equals(positiveId(stored.get("categoryId")))) {
                result.put("categoryId", id);
                preserve(result, stored, "category");
            } else {
                ReferenceEntry entry = active(id, ReferenceEntry.Kind.NEED_CATEGORY);
                result.put("categoryId", entry.getId());
                result.put("category", entry.getLabel());
            }
        }
        return result;
    }

    public ReferenceEntry academicTerm(Long id, String code) {
        if (id != null) return active(positiveId(id), ReferenceEntry.Kind.ACADEMIC_TERM);
        if (code == null || code.isBlank()) throw new IllegalArgumentException("Selecione um período letivo ativo.");
        ReferenceEntry entry = entries.findByKindAndCode(ReferenceEntry.Kind.ACADEMIC_TERM, code)
                .orElseThrow(() -> new IllegalArgumentException("Selecione um período letivo ativo."));
        // SQL collations may be insensitive to case or trailing spaces. Compatibility requires an exact code.
        if (!entry.isActive() || !code.equals(entry.getCode()))
            throw new IllegalArgumentException("Selecione um período letivo ativo.");
        return entry;
    }

    private ReferenceEntry active(Long id, ReferenceEntry.Kind kind) {
        ReferenceEntry entry = entries.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Item de catálogo inválido."));
        if (entry.getKind() != kind || !entry.isActive())
            throw new IllegalArgumentException("Selecione um item ativo do catálogo correto.");
        return entry;
    }

    private Long positiveId(Object value) {
        try {
            long id;
            if (value instanceof BigInteger integer) id = integer.longValueExact();
            else if (value instanceof Long || value instanceof Integer || value instanceof Short || value instanceof Byte)
                id = ((Number) value).longValue();
            else throw new IllegalArgumentException("O identificador do catálogo deve ser um inteiro positivo.");
            if (id <= 0) throw new IllegalArgumentException("O identificador do catálogo deve ser um inteiro positivo.");
            return id;
        } catch (ArithmeticException invalid) {
            throw new IllegalArgumentException("Identificador de catálogo inválido.", invalid);
        }
    }

    private void preserve(Map<String, Object> result, Map<String, Object> stored, String key) {
        if (stored.containsKey(key)) result.put(key, stored.get(key));
        else result.remove(key);
    }
}
