import { DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subscription } from 'rxjs';
import { errorMessage } from './presentation';

export function createFilterOptions<T>(initialValue: T) {
  const destroyRef = inject(DestroyRef);
  const value = signal(initialValue);
  const loading = signal(false);
  const error = signal('');
  let current: Subscription | undefined;

  function cancel() {
    current?.unsubscribe();
    loading.set(false);
  }

  function load(source: Observable<T>) {
    cancel();
    loading.set(true);
    error.set('');
    current = source.pipe(takeUntilDestroyed(destroyRef)).subscribe({
      next: options => {
        value.set(options);
        loading.set(false);
      },
      error: failure => {
        error.set(errorMessage(failure, 'carregar as opções de filtro'));
        loading.set(false);
      },
    });
  }

  return { value: value.asReadonly(), loading: loading.asReadonly(), error: error.asReadonly(), load, cancel };
}
