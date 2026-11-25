package br.edu.ifac.napne360.pei;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/v1/pei")
public class PeiAnnexController {
    @GetMapping("/anexo-i")
    public Map<String, Object> annex() {
        return PeiAnnexI.model();
    }
}
