import { signal } from '@angular/core';
import { createListView } from './list-view';

describe('createListView', () => {
  const courses = Array.from({ length: 21 }, (_, index) => ({
    id: index + 1,
    name: index === 20 ? 'Introdução à Administração' : `Curso ${index + 1}`,
    campus: index === 20 ? 'Sena Madureira' : 'Rio Branco',
  }));

  it('limita cada página a 10 itens e mantém a página válida após exclusões', () => {
    const source = signal(courses);
    const list = createListView(source, course => [course.name, course.campus]);

    expect(list.items().map(course => course.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(list.totalPages()).toBe(3);
    list.setPage(2);
    expect(list.items().map(course => course.id)).toEqual([21]);

    source.set(courses.slice(0, 20));
    expect(list.page()).toBe(1);
    expect(list.items().length).toBe(10);
    source.set(courses);
    expect(list.page()).toBe(1);
  });

  it('filtra a lista completa, aceita termos sem acento e volta à primeira página', () => {
    const list = createListView(() => courses, course => [course.id, course.name, course.campus]);
    list.setPage(2);
    list.setQuery('  21  ADMINISTRACAO   sena  ');

    expect(list.query()).toBe('  21  ADMINISTRACAO   sena  ');
    expect(list.totalElements()).toBe(1);
    expect(list.page()).toBe(0);
    expect(list.items().map(course => course.id)).toEqual([21]);
    list.setQuery('sem resultados');
    list.setPage(4);
    expect(list.items()).toEqual([]);
    expect(list.totalPages()).toBe(0);
    expect(list.page()).toBe(0);
    list.reset();
    expect(list.totalElements()).toBe(21);
  });
});
