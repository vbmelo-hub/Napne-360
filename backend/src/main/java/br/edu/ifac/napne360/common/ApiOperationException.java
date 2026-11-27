package br.edu.ifac.napne360.common;

import org.springframework.http.HttpStatus;

/** A known failure whose code and message are safe to return to the caller. */
public class ApiOperationException extends RuntimeException {
    private final HttpStatus status;
    private final String code;

    public ApiOperationException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    public HttpStatus status() { return status; }
    public String code() { return code; }
}
