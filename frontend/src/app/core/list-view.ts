import { computed, linkedSignal, signal } from '@angular/core';

export const LIST_PAGE_SIZE = 10;

type SearchValue = string | number | null | undefined;

function normalizeSearch(value: SearchValue): string {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').trim();
}

export function createListView<T>(source: () => readonly T[], searchValues: (item: T) => readonly SearchValue[]) {
  const query = signal('');
  const terms = computed(() => normalizeSearch(query()).split(/\s+/).filter(Boolean));
  const filtered = computed(() => {
    const keywords = terms();
    const items = source();
    if (!keywords.length) return items;
    return items.filter(item => {
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
    page: page.asReadonly(),
    items: computed(() => filtered().slice(page() * LIST_PAGE_SIZE, (page() + 1) * LIST_PAGE_SIZE)),
    totalElements,
    totalPages,
    setQuery,
    setPage: (value: number) => page.set(clamp(value, totalPages())),
    reset: () => setQuery(''),
  };
}
