package br.edu.ifac.napne360.common;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.net.URI;
import java.time.Instant;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(NotFoundException.class)
    ProblemDetail notFound(NotFoundException exception, HttpServletRequest request) {
        return problem(HttpStatus.NOT_FOUND, "Recurso não encontrado", exception.getMessage(), request);
    }

    @ExceptionHandler({ConflictException.class, DataIntegrityViolationException.class, org.springframework.dao.OptimisticLockingFailureException.class})
    ProblemDetail conflict(Exception exception, HttpServletRequest request) {
        return problem(HttpStatus.CONFLICT, "Conflito de dados", "A operação conflita com o estado atual do recurso.", request);
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ProblemDetail validation(MethodArgumentNotValidException exception, HttpServletRequest request) {
        String detail = exception.getBindingResult().getFieldErrors().stream()
                .map(error -> error.getField() + ": " + error.getDefaultMessage()).findFirst().orElse("Dados inválidos.");
        return problem(HttpStatus.BAD_REQUEST, "Dados inválidos", detail, request);
    }

    @ExceptionHandler(AccessDeniedException.class)
    ProblemDetail denied(AccessDeniedException exception, HttpServletRequest request) {
        return problem(HttpStatus.FORBIDDEN, "Acesso negado", "Você não possui permissão para esta operação.", request);
    }

    @ExceptionHandler(org.springframework.security.core.AuthenticationException.class)
    ProblemDetail unauthenticated(Exception exception, HttpServletRequest request) {
        return problem(HttpStatus.UNAUTHORIZED, "Autenticação inválida", "Confira suas credenciais ou entre novamente.", request);
    }

    @ExceptionHandler({IllegalArgumentException.class, org.springframework.http.converter.HttpMessageNotReadableException.class})
    ProblemDetail invalid(Exception exception, HttpServletRequest request) {
        return problem(HttpStatus.BAD_REQUEST, "Dados inválidos", "Confira os campos e o estado do documento antes de tentar novamente.", request);
    }

    @ExceptionHandler(org.springframework.web.multipart.MaxUploadSizeExceededException.class)
    ProblemDetail tooLarge(Exception exception, HttpServletRequest request) {
        return problem(HttpStatus.PAYLOAD_TOO_LARGE, "Arquivo muito grande", "O limite é de 10 MB por arquivo.", request);
    }

    @ExceptionHandler(Exception.class)
    ProblemDetail unexpected(Exception exception, HttpServletRequest request) {
        return problem(HttpStatus.INTERNAL_SERVER_ERROR, "Erro interno", "Não foi possível concluir a operação.", request);
    }

    @ExceptionHandler(br.edu.ifac.napne360.auth.LoginRateLimiter.TooManyAttemptsException.class)
    ProblemDetail rateLimited(Exception exception,HttpServletRequest request){
        return problem(HttpStatus.TOO_MANY_REQUESTS,"Limite de tentativas","Aguarde alguns minutos antes de tentar entrar novamente.",request);
    }

    private ProblemDetail problem(HttpStatus status, String title, String detail, HttpServletRequest request) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setTitle(title);
        problem.setInstance(URI.create(request.getRequestURI()));
        problem.setProperty("timestamp", Instant.now());
        return problem;
    }
}
