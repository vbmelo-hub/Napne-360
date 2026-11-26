package br.edu.ifac.napne360.pei;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration(proxyBeanMethods = false)
class PeiProjectionConfiguration {
    @Bean(defaultCandidate = false)
    ThreadPoolTaskExecutor peiProjectionExecutor() {
        var executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(64);
        executor.setThreadNamePrefix("pei-projection-");
        return executor;
    }
}
