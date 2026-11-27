import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function formatCpf(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  const parts = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9)].filter(Boolean);
  return parts.join('.') + (digits.length > 9 ? '-' + digits.slice(9) : '');
}

export function cpfDigits(input: string): string | null {
  return /^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/.test(input) ? input.replace(/\D/g, '') : null;
}

function isValid(digits: string): boolean {
  if (/^(\d)\1{10}$/.test(digits)) return false;
  for (const length of [9, 10]) {
    let sum = 0;
    for (let index = 0; index < length; index++) sum += Number(digits[index]) * (length + 1 - index);
    if (sum * 10 % 11 % 10 !== Number(digits[length])) return false;
  }
  return true;
}

export const validateCpf: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  if (!control.value) return null;
  const digits = cpfDigits(control.value);
  return digits && isValid(digits) ? null : { cpf: true };
};
