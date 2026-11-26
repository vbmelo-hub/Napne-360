package br.edu.ifac.napne360.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.mongo.MongoClientSettingsBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.concurrent.TimeUnit;

@Configuration(proxyBeanMethods = false)
class MongoSocketConfiguration {
    @Bean
    MongoClientSettingsBuilderCustomizer mongoReadTimeout(
            @Value("${napne360.mongo.socket-timeout-ms}") int timeoutMillis) {
        return settings -> settings.applyToSocketSettings(socket -> socket.readTimeout(timeoutMillis, TimeUnit.MILLISECONDS));
    }
}
