package br.edu.ifac.napne360.document;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

@Configuration(proxyBeanMethods = false)
class AttachmentRecoveryConfiguration {
    @Bean(defaultCandidate = false)
    ThreadPoolTaskExecutor attachmentRecoveryExecutor() {
        var executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(64);
        executor.setThreadNamePrefix("attachment-recovery-");
        return executor;
    }
}
