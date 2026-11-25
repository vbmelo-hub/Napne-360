package br.edu.ifac.napne360;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class Napne360BackendApplicationTests {
    @Autowired MockMvc mvc;

    @Test void annexCatalogRequiresAnAuthenticatedSession() throws Exception {
        mvc.perform(get("/api/v1/pei/anexo-i"))
                .andExpect(status().isUnauthorized());

        mvc.perform(get("/api/v1/pei/anexo-i").with(user("pessoa@example.test").roles("COTEP")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value("IFAC_76_2025"));
    }
}
