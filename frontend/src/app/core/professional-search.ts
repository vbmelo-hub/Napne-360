import type { SearchableLookup } from '../shared/searchable-select.component';
import { Signal, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, distinctUntilChanged, map, of, switchMap } from 'rxjs';
import { ApiService } from './api.service';
import { cpfDigits } from './cpf';
import { UserView } from './models';

export function createCpfLookup(query: Signal<string>) {
  const api = inject(ApiService);
  const match = toSignal(toObservable(query).pipe(
    map(value => value.trim().split(/\s+/).find(term => cpfDigits(term) !== null) ?? null),
    distinctUntilChanged(),
    switchMap(term => term
      ? api.searchUserCpf(term).pipe(map(result => ({ term, id: result.id })), catchError(() => of(null)))
      : of(null))
  ), { initialValue: null });
  return (user: UserView) => {
    const current = match();
    return current?.id === user.id && query().trim().split(/\s+/).includes(current.term) ? current.term : null;
  };
}

export function createProfessionalCandidates() {
  const api = inject(ApiService);
  return (criteria: { roles: readonly string[]; campusId?: number; excludedId?: number }): SearchableLookup =>
    (query, selectedId) => api.userCandidates({ ...criteria, query, selectedId: selectedId ? Number(selectedId) : undefined }).pipe(
      map(({ content, totalElements, selected }) => ({
        content: content.map(professionalOption),
        totalElements,
        selected: selected ? professionalOption(selected) : null,
      })),
    );
}

function professionalOption(user: UserView) {
  return {
    id: String(user.id),
    label: user.name,
    detail: [user.institutionalRegistration, user.email].filter(Boolean).join(' · '),
  };
}
