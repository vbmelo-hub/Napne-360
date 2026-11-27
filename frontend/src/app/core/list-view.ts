import { Signal, computed, linkedSignal, signal } from '@angular/core';

export const LIST_PAGE_SIZE = 10;

type SearchValue = string | number | null | undefined;

function normalizeSearch(value: SearchValue): string {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').trim();
}

function localDate(value: string): string {
  if (!value || value.length === 10) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface FilterOption {
  value: string;
  label: string;
}

interface Criterion<T> {
  label: string;
  value: (item: T) => SearchValue | readonly SearchValue[];
  display?: (value: string) => string;
  options?: () => readonly FilterOption[];
  kind?: 'select' | 'from' | 'to';
}

export interface ListFilters {
  query: Signal<string>;
  filters: Signal<Readonly<Record<string, string>>>;
  fields: Signal<{ key: string; label: string; kind: 'select' | 'from' | 'to'; options: FilterOption[] }[]>;
  totalElements: Signal<number>;
  setQuery(value: string): void;
  setFilter(key: string, value: string): void;
  reset(): void;
}

export function createListView<T>(source: () => readonly T[], searchValues: (item: T) => readonly SearchValue[],
  criteria: Record<string, Criterion<T>> = {}) {
  const query = signal('');
  const filters = signal<Readonly<Record<string, string>>>({});
  const definitions = Object.entries(criteria);
  const terms = computed(() => normalizeSearch(query()).split(/\s+/).filter(Boolean));
  const values = (item: T, criterion: Criterion<T>) => {
    const value = criterion.value(item);
    return (Array.isArray(value) ? value : [value]).map(part => String(part ?? ''));
  };
  const fields = computed(() => definitions.map(([key, criterion]) => {
    const kind = criterion.kind ?? 'select';
    const available = new Map<string, string>();
    if (kind === 'select') {
      for (const item of source()) {
        for (const value of values(item, criterion)) {
          if (value && !available.has(value)) available.set(value, criterion.display?.(value) ?? value);
        }
      }
      for (const option of criterion.options?.() ?? []) available.set(option.value, option.label);
    }
    const options = Array.from(available, ([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR', { numeric: true }));
    const current = filters()[key];
    if (kind === 'select' && current && !options.some(option => option.value === current)) {
      options.push({ value: current, label: criterion.display?.(current) ?? current });
    }
    return { key, label: criterion.label, kind, options };
  }));
  const filtered = computed(() => {
    const keywords = terms();
    const selected = filters();
    const active = definitions.filter(([key]) => selected[key]);
    const items = source();
    if (!keywords.length && !active.length) return items;
    return items.filter(item => {
      if (!active.every(([key, criterion]) => values(item, criterion).some(value => {
        if (criterion.kind === 'from' || criterion.kind === 'to') {
          const date = localDate(value);
          return !!date && (criterion.kind === 'from' ? date >= selected[key] : date <= selected[key]);
        }
        return value === selected[key];
      }))) return false;
      if (!keywords.length) return true;
      const fields = searchValues(item).map(normalizeSearch);
      return keywords.every(keyword => fields.some(field => field.includes(keyword)));
    });
  });
  const totalElements = computed(() => filtered().length);
  const totalPages = computed(() => Math.ceil(totalElements() / LIST_PAGE_SIZE));
  const clamp = (page: number, pages: number) => Math.max(0, Math.min(page, pages - 1));
  const page = linkedSignal<number, number>({
    source: totalPages,
    computation: (pages: number, previous) => clamp(previous?.value ?? 0, pages),
  });

  function setQuery(value: string) {
    query.set(value);
    page.set(0);
  }

  return {
    query: query.asReadonly(),
    filters: filters.asReadonly(),
    fields,
    page: page.asReadonly(),
    items: computed(() => filtered().slice(page() * LIST_PAGE_SIZE, (page() + 1) * LIST_PAGE_SIZE)),
    totalElements,
    totalPages,
    setQuery,
    setPage: (value: number) => page.set(clamp(value, totalPages())),
    setFilter: (key: string, value: string) => {
      filters.update(current => ({ ...current, [key]: value }));
      page.set(0);
    },
    reset: () => {
      filters.set({});
      setQuery('');
    },
  };
}
