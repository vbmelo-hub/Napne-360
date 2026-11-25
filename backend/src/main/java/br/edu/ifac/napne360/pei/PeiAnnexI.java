package br.edu.ifac.napne360.pei;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ClassPathResource;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class PeiAnnexI {
    public static final String VERSION = "IFAC_76_2025";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final JsonNode MODEL = readModel();
    private static final List<String> ANSWERABLE_INDICATORS = readAnswerableIndicators();
    private static final Set<String> RATINGS = readRatings();

    private PeiAnnexI() {}

    public static Map<String, Object> model() {
        return JSON.convertValue(MODEL, new TypeReference<>() {});
    }

    static List<String> answerableIndicators() {
        return ANSWERABLE_INDICATORS;
    }

    static Set<String> ratings() {
        return RATINGS;
    }

    private static JsonNode readModel() {
        var resource = new ClassPathResource("pei/anexo-i-ifac-76-2025.json");
        try (var input = resource.getInputStream()) {
            return JSON.readTree(input);
        } catch (IOException exception) {
            throw new IllegalStateException("Não foi possível ler o modelo do Anexo I do PEI.", exception);
        }
    }

    private static List<String> readAnswerableIndicators() {
        var ids = new ArrayList<String>();
        for (var group : MODEL.get("inventoryGroups")) {
            for (var indicator : group.get("indicators")) {
                if (indicator.get("hasOptions").asBoolean()) {
                    ids.add(indicator.get("id").asText());
                }
            }
        }
        return List.copyOf(ids);
    }

    private static Set<String> readRatings() {
        var ratings = new HashSet<String>();
        MODEL.get("ratings").forEach(entry -> ratings.add(entry.get("value").asText()));
        return Set.copyOf(ratings);
    }
}
