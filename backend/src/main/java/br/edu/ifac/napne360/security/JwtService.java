package br.edu.ifac.napne360.security;

import br.edu.ifac.napne360.identity.UserAccount;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.ExpiredJwtException;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.JwtParser;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.io.Decoders;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.core.AuthenticationException;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;

@Service
public class JwtService {
    public static final String STATUS_HEADER = "X-Session-Status";

    private final SecretKey key;
    private final JwtParser parser;
    private final Clock clock;
    private final Duration idleLimit;
    private final Duration warningLead;
    private final Duration continuousLimit;

    @Autowired
    public JwtService(@Value("${napne360.security.jwt-secret}") String secret,
                      @Value("${napne360.security.jwt-expiration-minutes:60}") long jwtMinutes,
                      @Value("${napne360.security.session-idle-minutes:30}") long idleMinutes,
                      @Value("${napne360.security.session-warning-minutes:5}") long warningMinutes,
                      @Value("${napne360.security.session-max-minutes:480}") long maxMinutes) {
        this(secret, jwtMinutes, idleMinutes, warningMinutes, maxMinutes, Clock.systemUTC());
    }

    JwtService(String secret, long jwtMinutes, long idleMinutes, long warningMinutes, long maxMinutes, Clock clock) {
        byte[] bytes;
        try {
            bytes = Decoders.BASE64.decode(secret);
        } catch (RuntimeException ignored) {
            bytes = secret.getBytes(StandardCharsets.UTF_8);
        }
        if (bytes.length < 32) {
            throw new IllegalArgumentException("JWT secret must contain at least 32 bytes");
        }
        if (jwtMinutes <= 0 || idleMinutes <= 0 || warningMinutes <= 0 || maxMinutes <= 0) {
            throw new IllegalArgumentException("Session durations must be positive");
        }
        this.key = Keys.hmacShaKeyFor(bytes);
        this.clock = clock;
        this.parser = Jwts.parser().verifyWith(key).clock(() -> Date.from(clock.instant())).build();
        this.idleLimit = Duration.ofMinutes(Math.min(jwtMinutes, idleMinutes));
        this.warningLead = Duration.ofMinutes(warningMinutes);
        this.continuousLimit = Duration.ofMinutes(maxMinutes);
    }

    public IssuedToken create(UserAccount user) {
        Instant now = clock.instant();
        return issue(user, user.getSessionVersion(), now, now.truncatedTo(ChronoUnit.SECONDS).plus(continuousLimit));
    }

    public IssuedToken refresh(UserAccount user, Session session) {
        Instant now = clock.instant();
        session.requireValidAt(now);
        session.requireAccount(user);
        return issue(user, session.version(), now, session.continuousEnd());
    }

    public void requireCurrentSession(UserAccount user, Session session) {
        session.requireValidAt(clock.instant());
        session.requireAccount(user);
    }

    public Session parse(String token) {
        try {
            var session = readSession(parser.parseSignedClaims(token).getPayload());
            session.requireValidAt(clock.instant());
            return session;
        } catch (ExpiredJwtException expired) {
            throw new SessionRejected(expiryReason(expired.getClaims()));
        } catch (JwtException | IllegalArgumentException invalid) {
            throw new SessionRejected(EndReason.SESSION_ENDED);
        }
    }

    public SessionTiming timing(Session session) {
        return timing(session.expiresAt(), session.reason(), clock.instant());
    }

    private IssuedToken issue(UserAccount user, long version, Instant now, Instant continuousEnd) {
        Instant idleEnd = now.truncatedTo(ChronoUnit.SECONDS).plus(idleLimit);
        boolean hitContinuousLimit = !idleEnd.isBefore(continuousEnd);
        Instant expiresAt = hitContinuousLimit ? continuousEnd : idleEnd;
        EndReason reason = hitContinuousLimit ? EndReason.MAX_DURATION : EndReason.IDLE_TIMEOUT;
        String token = Jwts.builder()
                .subject(user.getEmail())
                .claim("uid", user.getId())
                .claim("sessionVersion", version)
                .claim("campus", user.getCampus() == null ? 0L : user.getCampus().getId())
                .claim("roles", user.getRoles().stream().map(Enum::name).toList())
                .claim("sessionEnd", continuousEnd.getEpochSecond())
                .claim("expiryReason", reason.name())
                .issuedAt(Date.from(now))
                .expiration(Date.from(expiresAt))
                .signWith(key)
                .compact();
        return new IssuedToken(token, timing(expiresAt, reason, now));
    }

    private SessionTiming timing(Instant expiresAt, EndReason reason, Instant now) {
        return new SessionTiming(now.toEpochMilli(), expiresAt.minus(warningLead).toEpochMilli(),
                expiresAt.toEpochMilli(), reason);
    }

    private static Session readSession(Claims claims) {
        Long continuousEnd = claims.get("sessionEnd", Long.class);
        Long userId = claims.get("uid", Long.class);
        Long version = claims.get("sessionVersion", Long.class);
        var expiry = claims.getExpiration();
        if (continuousEnd == null || userId == null || version == null || claims.getSubject() == null || expiry == null) {
            throw new SessionRejected(EndReason.SESSION_ENDED);
        }
        return new Session(claims.getSubject(), userId, version, Instant.ofEpochSecond(continuousEnd),
                expiry.toInstant(), expiryReason(claims));
    }

    private static EndReason expiryReason(Claims claims) {
        return switch (claims.get("expiryReason", String.class)) {
            case "IDLE_TIMEOUT" -> EndReason.IDLE_TIMEOUT;
            case "MAX_DURATION" -> EndReason.MAX_DURATION;
            case null, default -> EndReason.SESSION_ENDED;
        };
    }

    public enum EndReason { IDLE_TIMEOUT, MAX_DURATION, SESSION_ENDED, REVOKED, ACCOUNT_INACTIVE }

    public record SessionTiming(long serverTime, long warningAt, long expiresAt, EndReason reason) {}
    public record IssuedToken(String token, SessionTiming timing) {}

    public record Session(String email, long userId, long version, Instant continuousEnd, Instant expiresAt,
                          EndReason reason) {
        private void requireValidAt(Instant now) {
            if (!now.isBefore(expiresAt)) {
                throw new SessionRejected(reason);
            }
        }

        public void requireAccount(UserAccount user) {
            if (user == null || user.getId() != userId || !email.equalsIgnoreCase(user.getEmail())) {
                throw new SessionRejected(EndReason.REVOKED);
            }
            if (!user.isActive()) {
                throw new SessionRejected(EndReason.ACCOUNT_INACTIVE);
            }
            if (user.getSessionVersion() != version) {
                throw new SessionRejected(EndReason.REVOKED);
            }
        }
    }

    public static final class SessionRejected extends AuthenticationException {
        private final EndReason reason;

        public SessionRejected(EndReason reason) {
            super("Session rejected");
            this.reason = reason;
        }

        public EndReason reason() {
            return reason;
        }
    }
}
