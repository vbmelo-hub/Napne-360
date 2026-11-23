package br.edu.ifac.napne360.casework;

final class CaseText {
    private CaseText() {}

    static String trimBrowserWhitespace(String value) {
        if (value == null) return "";
        int start = 0;
        int end = value.length();
        while (start < end && isTrimSpace(value.charAt(start))) start++;
        while (end > start && isTrimSpace(value.charAt(end - 1))) end--;
        return value.substring(start, end);
    }

    private static boolean isTrimSpace(char value) {
        // Match String.trim() in the browser, including non-breaking spaces and the BOM.
        return Character.isSpaceChar(value) || (value >= '\t' && value <= '\r') || value == '\uFEFF';
    }
}
