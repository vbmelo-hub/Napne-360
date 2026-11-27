import { Signal, computed, signal } from '@angular/core';

export type FormValue = string | number | boolean | null | undefined | readonly FormValue[] | {
  readonly [key: string]: FormValue;
};

export function sameFormValue(current: FormValue, saved: FormValue): boolean {
  if (Object.is(current, saved)) return true;
  if (Array.isArray(current) || Array.isArray(saved)) {
    return Array.isArray(current) && Array.isArray(saved)
      && current.length === saved.length
      && current.every((value, index) => sameFormValue(value, saved[index]));
  }
  if (!current || !saved || typeof current !== 'object' || typeof saved !== 'object') return false;
  const values = current as Record<string, FormValue>;
  const baseline = saved as Record<string, FormValue>;
  const keys = Object.keys(values);
  return keys.length === Object.keys(baseline).length
    && keys.every(key => Object.hasOwn(baseline, key) && sameFormValue(values[key], baseline[key]));
}

export function trackFormChanges<T extends FormValue>(current: Signal<T>) {
  const saved = signal<T>(structuredClone(current()));
  return {
    changed: computed(() => !sameFormValue(current(), saved())),
    saved: saved.asReadonly(),
    capture: () => saved.set(structuredClone(current())),
  };
}
