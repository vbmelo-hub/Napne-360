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
public class AdminAuditConfiguration implements WebMvcConfigurer {
    private static final String UNCHANGED = AdminAuditConfiguration.class.getName() + ".unchanged";
    private final AuditService audit;

    public static void markUnchanged(HttpServletRequest request) {
        request.setAttribute(UNCHANGED, true);
    }
    @Override public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new HandlerInterceptor() {
            @Override public void afterCompletion(HttpServletRequest request, HttpServletResponse response,Object handler,Exception error) {
                if (Boolean.TRUE.equals(request.getAttribute(UNCHANGED))) return;
                var auth=SecurityContextHolder.getContext().getAuthentication();
                if(auth==null || !auth.isAuthenticated())return;
                Object variables=request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);
                Object id=variables instanceof Map<?,?> map?map.get("id"):null;
                Object path = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
                boolean read = request.getMethod().equals("GET") || "/api/v1/admin/users/cpf-search".equals(path)
                        || "/api/v1/admin/users/page".equals(path);
                audit.record(auth,request,read ? "ADMIN_VIEW" : "ADMIN_CHANGE","CONFIGURATION",id,
                        response.getStatus()<400?"SUCCESS":"DENIED", request.getMethod()+" "+path);
            }
        }).addPathPatterns("/api/v1/admin/**");
    }
}
