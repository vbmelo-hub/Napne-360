package br.edu.ifac.napne360.academic;

import lombok.RequiredArgsConstructor;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Year;
import java.time.ZoneId;

@Service
@RequiredArgsConstructor
public class AcademicPeriods {
    private static final String CAMPUS_ZONE = "America/Rio_Branco";
    private final JdbcTemplate jdbc;

    public static String currentPeriodCode(int half) {
        return Year.now(ZoneId.of(CAMPUS_ZONE)).getValue() + "." + half;
    }

    @EventListener(ApplicationReadyEvent.class)
    @Scheduled(cron = "0 5 0 1 1 *", zone = CAMPUS_ZONE)
    @Transactional
    public void ensureCurrentYear() {
        int year = Year.now(ZoneId.of(CAMPUS_ZONE)).getValue();
        String first = year + ".1";
        String second = year + ".2";
        jdbc.update("""
                insert into reference_entry (kind, code, label, active, version)
                values ('ACADEMIC_TERM', ?, ?, true, 0), ('ACADEMIC_TERM', ?, ?, true, 0)
                on duplicate key update id = id
                """, first, first, second, second);
    }
}
