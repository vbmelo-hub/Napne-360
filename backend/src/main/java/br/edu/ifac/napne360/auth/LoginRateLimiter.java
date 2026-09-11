package br.edu.ifac.napne360.auth;

import org.springframework.stereotype.Component;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Map;

@Component
public class LoginRateLimiter {
    private final Clock clock;
    private final Map<String,Window> windows=new HashMap<>();
    public LoginRateLimiter(){this(Clock.systemUTC());}
    LoginRateLimiter(Clock clock){this.clock=clock;}
    public synchronized void acquire(String email,String address){
        long now=clock.millis();
        windows.entrySet().removeIf(e->e.getValue().expiresAt<=now);
        check("ip:"+digest(address),60,60_000,now);
        check(key(email,address),5,15*60_000,now);
    }
    public synchronized void success(String email,String address){windows.remove(key(email,address));}
    private void check(String key,int limit,long duration,long now){
        Window window=windows.get(key);
        if(window==null){
            if(windows.size()>=10_000)throw new TooManyAttemptsException();
            window=new Window(now+duration);windows.put(key,window);
        }
        if(window.attempts>=limit)throw new TooManyAttemptsException();
        window.attempts++;
    }
    private String key(String email,String address){return digest(email.trim().toLowerCase(Locale.ROOT)+"\n"+address);}
    private String digest(String value){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}catch(java.security.NoSuchAlgorithmException e){throw new IllegalStateException(e);}}
    private static class Window{final long expiresAt;int attempts;Window(long expiresAt){this.expiresAt=expiresAt;}}
    public static class TooManyAttemptsException extends RuntimeException{}
}
