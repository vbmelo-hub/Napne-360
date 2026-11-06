package br.edu.ifac.napne360.auth;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
class LoginRateLimiterTest {
    @Test void repeatedFailuresAreLimited(){
        var limiter=new LoginRateLimiter();
        for(int i=0;i<5;i++)limiter.acquire("student@example.invalid","127.0.0.1");
        assertThatThrownBy(()->limiter.acquire("STUDENT@example.invalid","127.0.0.1")).isInstanceOf(LoginRateLimiter.TooManyAttemptsException.class);
        assertThatCode(()->limiter.acquire("another@example.invalid","127.0.0.1")).doesNotThrowAnyException();
    }
    @Test void successfulLoginClearsAccountFailureWindow(){
        var limiter=new LoginRateLimiter();
        for(int i=0;i<5;i++)limiter.acquire("student@example.invalid","127.0.0.1");
        limiter.success("student@example.invalid","127.0.0.1");
        assertThatCode(()->limiter.acquire("student@example.invalid","127.0.0.1")).doesNotThrowAnyException();
    }
}
