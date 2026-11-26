package br.edu.ifac.napne360.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration(proxyBeanMethods = false)
class MutationProjectionConfiguration {
    @Bean(defaultCandidate = false)
    ThreadPoolTaskExecutor mutationProjectionExecutor() {
        var executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(64);
        executor.setThreadNamePrefix("mutation-projection-");
        return executor;
    }
}
