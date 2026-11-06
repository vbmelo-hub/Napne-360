package br.edu.ifac.napne360.audit;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import java.util.Map;

@Configuration
@RequiredArgsConstructor
public class ReadAuditConfiguration implements WebMvcConfigurer {
    private final AuditService audit;

    @Override public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            @Override public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception exception) {
                if (!request.getMethod().equals("GET")) return;
                Object variables = request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
                if (!(variables instanceof Map<?,?> path)) return;
                Object studentId = path.containsKey("studentId") ? path.get("studentId") : path.get("id");
                var actor = SecurityContextHolder.getContext().getAuthentication();
                if (actor == null || !actor.isAuthenticated()) return;
                // Only route templates and identifiers; never query strings or response bodies.
                Object pattern = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
                audit.record(actor,request,"VIEW","STUDENT",studentId,response.getStatus()<400?"SUCCESS":"DENIED",String.valueOf(pattern));
            }
        }).addPathPatterns("/api/v1/students/**");
    }
}
