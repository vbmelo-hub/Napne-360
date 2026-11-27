package br.edu.ifac.napne360.admin;

import br.edu.ifac.napne360.common.ApiOperationException;
import org.springframework.http.HttpStatus;

final class Cpf {
    private Cpf() {}

    static String parse(String value) {
        if (value == null || value.isBlank()) return null;
        String input = value.strip();
        if (!input.matches("[0-9]{11}|[0-9]{3}\\.[0-9]{3}\\.[0-9]{3}-[0-9]{2}")) throw invalid();
        String digits = input.replace(".", "").replace("-", "");
        if (digits.chars().allMatch(c -> c == digits.charAt(0))
                || checkDigit(digits, 9) != digits.charAt(9) - '0'
                || checkDigit(digits, 10) != digits.charAt(10) - '0') throw invalid();
        return digits;
    }

    static String require(String input) {
        String cpf = parse(input);
        if (cpf == null) {
            throw new ApiOperationException(HttpStatus.BAD_REQUEST, "USER_CPF_REQUIRED", "Informe o CPF.");
        }
        return cpf;
    }

    static String mask(String cpf) {
        return cpf == null ? null : "***.***.***-" + cpf.substring(9);
    }

    private static int checkDigit(String cpf, int count) {
        int sum = 0;
        for (int i = 0; i < count; i++) sum += (cpf.charAt(i) - '0') * (count + 1 - i);
        return (sum * 10 % 11) % 10;
    }

    private static ApiOperationException invalid() {
        return new ApiOperationException(HttpStatus.BAD_REQUEST, "USER_CPF_INVALID", "Informe um CPF válido.");
    }
}
