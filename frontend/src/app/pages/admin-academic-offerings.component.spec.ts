import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { AcademicOffering } from '../core/academic-api.service';
import { UserView } from '../core/models';
import { AdminAcademicOfferingsComponent } from './admin-academic-offerings.component';

describe('Seleção de professor para uma oferta curricular', () => {
  const offer: AcademicOffering = {
    id: 40, subjectId: 3, subjectName: 'Algoritmos', groupCode: 'A', campusId: 1, campusName: 'Rio Branco',
    courseId: 7, courseName: 'Sistemas', periodId: 2, periodCode: '2026.2', periodLabel: '2026.2', active: true,
  };
  const teacher: UserView = {
    id: 20, name: 'José da Silva', email: 'jose@ifac.edu.br', institutionalRegistration: 'MAT-20',
    campusId: 1, active: true, roles: ['TEACHER'],
  };
  const otherTeacher = { ...teacher, id: 21, email: 'jose2@ifac.edu.br', institutionalRegistration: 'MAT-21' };
  const candidates = '/api/v1/admin/users/candidates';
  let fixture: ComponentFixture<AdminAcademicOfferingsComponent>;
  let http: HttpTestingController;
  let root: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminAcademicOfferingsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(AdminAcademicOfferingsComponent);
    fixture.componentRef.setInput('courses', []);
    fixture.componentRef.setInput('subjects', []);
    http = TestBed.inject(HttpTestingController);
    root = fixture.nativeElement;
    fixture.detectChanges();
    http.expectOne(request => request.url.endsWith('/academic/periods')).flush({ content: [], totalElements: 0, totalPages: 0 });
  });

  afterEach(() => http.verify());

  it('espera a digitação, cancela buscas anteriores e volta à primeira página', fakeAsync(() => {
    const component = fixture.componentInstance;
    component.load(2);
    const pageRequest = http.expectOne(req => req.url.endsWith('/academic/periods') && req.params.get('page') === '2');
    const search = root.querySelector<HTMLInputElement>('input[type="search"]')!;
    type(search, '202');
    tick(100);
    http.expectNone(req => req.params.get('query') === '202');
    type(search, '2026');
    tick(250);
    expect(pageRequest.cancelled).toBeTrue();
    const request = http.expectOne(req => req.url.endsWith('/academic/periods') && req.params.get('query') === '2026');
    expect(request.request.params.get('page')).toBe('0');
    request.flush({ content: [], totalElements: 0, totalPages: 0, number: 0, size: 10 });
  }));

  it('oferece períodos e turmas históricas e envia as opções selecionadas antes da paginação', () => {
    const component = fixture.componentInstance;
    component.selectSection('offerings');
    const endpoint = '/api/v1/admin/academic/offerings';
    const emptyPage = { content: [], totalElements: 0, totalPages: 0, number: 0, size: 10 };
    http.expectOne(request => request.url === endpoint).flush(emptyPage);
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('.filters-toggle')!.click();
    fixture.detectChanges();
    http.expectOne(endpoint + '/filter-options').flush({ subjects: [], periodCodes: ['2024.2'], groupCodes: ['HIST'] });
    fixture.detectChanges();

    const period = root.querySelector<HTMLSelectElement>('select[formControlName="periodCode"]')!;
    period.value = '2024.2';
    period.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    http.expectOne(endpoint + '/filter-options?periodCode=2024.2')
      .flush({ subjects: [], periodCodes: ['2024.2'], groupCodes: ['HIST'] });
    fixture.detectChanges();
    const group = root.querySelector<HTMLElement>('app-searchable-select[formControlName="groupCode"]')!;
    group.querySelector('button')!.click();
    fixture.detectChanges();
    group.querySelector<HTMLElement>('[role="option"]')!.click();
    component.applyFilters();
    const page = http.expectOne(request => request.url === endpoint);
    expect(page.request.params.get('periodCode')).toBe('2024.2');
    expect(page.request.params.get('groupCode')).toBe('HIST');
    expect(page.request.params.get('page')).toBe('0');
    page.flush(emptyPage);
  });

  function openPicker() {
    root.querySelector<HTMLButtonElement>('[role="dialog"] app-searchable-select[formControlName="teacherId"] button')!.click();
    fixture.detectChanges();
    return root.querySelector<HTMLInputElement>('[role="combobox"]')!;
  }

  function type(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
  }

  function press(input: HTMLElement, key: string) {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    fixture.detectChanges();
  }

  function startTeaching() {
    fixture.componentInstance.openTeaching(offer);
    fixture.detectChanges();
    const request = http.expectOne(candidates);
    expect(request.request.body.includeInactive).toBeUndefined();
    request.flush({ content: [teacher], totalElements: 35, selected: null });
    fixture.detectChanges();
  }

  it('busca curso e componente pelos rótulos e combina os IDs nos filtros', () => {
    const course = { id: 7, name: 'Sistemas', code: 'SIS', campusId: 1, campus: 'Rio Branco', active: false };
    const subject = { id: 3, name: 'Algoritmos', code: 'ALG', courseId: 7, active: false, workloadHours: 60 };
    fixture.componentRef.setInput('allCourses', [course]);
    fixture.componentRef.setInput('subjects', [subject]);
    const component = fixture.componentInstance;
    component.selectSection('offerings');
    const matches = (request: {url: string}) => request.url.endsWith('/academic/offerings');
    const emptyPage = { content: [], totalElements: 0, totalPages: 0 };
    http.expectOne(matches).flush(emptyPage);
    fixture.detectChanges();
    for (const [control, query, label] of [['courseId', 'sis rio branco', 'Sistemas'], ['subjectId', 'alg', 'Algoritmos']]) {
      const picker = root.querySelector<HTMLElement>(`app-searchable-select[formControlName="${control}"]`)!;
      expect(picker.querySelector('button')?.textContent).toContain('Todos');
      picker.querySelector('button')!.click();
      fixture.detectChanges();
      type(picker.querySelector('input')!, query);
      const option = picker.querySelector<HTMLElement>('[role="option"]')!;
      expect(option.textContent).toContain(label);
      option.click();
      fixture.detectChanges();
    }
    component.applyFilters();
    const request = http.expectOne(matches);
    expect(request.request.params.get('courseId')).toBe('7');
    expect(request.request.params.get('subjectId')).toBe('3');
    request.flush(emptyPage);
    component.clearFilters();
    const cleared = http.expectOne(matches);
    expect(cleared.request.params.has('courseId')).toBeFalse();
    expect(cleared.request.params.has('subjectId')).toBeFalse();
    cleared.flush(emptyPage);
  });

  it('inclui professores inativos somente na consulta do filtro histórico', () => {
    fixture.componentInstance.selectSection('offerings');
    http.expectOne(request => request.url.endsWith('/academic/offerings')).flush({ content: [], totalElements: 0, totalPages: 0 });
    fixture.detectChanges();
    const filter = root.querySelector<HTMLButtonElement>('app-searchable-select[formControlName="teacherId"] button')!;
    filter.click();
    fixture.detectChanges();
    const request = http.expectOne(candidates);
    expect(request.request.body).toEqual(jasmine.objectContaining({ roles: ['TEACHER'], includeInactive: true }));
    request.flush({ content: [{ ...teacher, active: false }], totalElements: 1, selected: null });
    fixture.detectChanges();
    expect(root.querySelector('[role="option"]')?.textContent).toContain(teacher.name);
  });

  it('usa o total da consulta inicial e envia o ID escolhido pelo teclado', fakeAsync(() => {
    const component = fixture.componentInstance;
    const offerings = '/api/v1/admin/academic/offerings';
    const page = { content: [offer], totalElements: 1, totalPages: 1, number: 0, size: 10 };
    component.selectSection('offerings');
    http.expectOne(req => req.url === offerings).flush(page);
    component.filters.controls.periodCode.setValue(offer.periodCode);
    component.applyFilters();
    http.expectOne(req => req.url === offerings && req.params.get('periodCode') === offer.periodCode).flush(page);
    startTeaching();
    const input = openPicker();
    expect(fixture.componentInstance.teacherForm.controls.teacherId.value).toBe('');
    type(input, 'jose MAT-21');
    tick(250);
    http.expectOne(candidates).flush({ content: [otherTeacher], totalElements: 1, selected: null });
    fixture.detectChanges();
    expect(root.querySelectorAll('[role="option"]')).toHaveSize(1);
    expect(fixture.componentInstance.teacherForm.controls.teacherId.value).toBe('');
    press(input, 'ArrowDown');
    press(input, 'Enter');
    expect(root.querySelector('[role="combobox"]')).toBeNull();
    expect(root.querySelector('[role="dialog"] app-searchable-select')?.textContent).toContain('MAT-21');

    const validation = http.expectOne(candidates);
    expect(validation.request.body).toEqual(jasmine.objectContaining({ selectedId: otherTeacher.id, query: '' }));
    validation.flush({ content: [teacher], totalElements: 35, selected: otherTeacher });
    fixture.detectChanges();
    fixture.componentInstance.saveTeaching();
    const request = http.expectOne('/api/v1/admin/academic/teaching');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ offeringId: offer.id, teacherId: otherTeacher.id });
    request.flush({});
    expect(component.section()).toBe('offerings');
    const refreshed = http.expectOne(req => req.url === offerings);
    expect(refreshed.request.params.get('periodCode')).toBe(offer.periodCode);
    expect(refreshed.request.params.get('page')).toBe('0');
    refreshed.flush(page);
  }));

  it('bloqueia o envio quando a atribuição troca de escopo antes de revalidar', () => {
    startTeaching();
    const component = fixture.componentInstance;
    component.teacherForm.controls.teacherId.setValue(String(teacher.id));
    fixture.detectChanges();
    http.expectOne(candidates).flush({ content: [teacher], totalElements: 35, selected: teacher });
    fixture.detectChanges();

    component.selectedOffer.set({ ...offer, campusId: 2 });
    component.saveTeaching();
    http.expectNone(request => request.method === 'POST' && request.url.endsWith('/academic/teaching'));
  });

  it('envia CPF pelo POST escopado com debounce e cancela pesquisas obsoletas', fakeAsync(() => {
    startTeaching();
    const input = openPicker();
    type(input, '12345678909');
    tick(249);
    http.expectNone(candidates);
    tick(1);
    const previous = http.expectOne(candidates);
    expect(previous.request.method).toBe('POST');
    expect(previous.request.body).toEqual(jasmine.objectContaining({
      campusId: 1, roles: ['TEACHER'], query: '12345678909',
    }));
    http.expectNone('/api/v1/admin/users/cpf-search');
    http.expectNone('/api/v1/admin/users');

    type(input, '98765432100');
    expect(previous.cancelled).toBeTrue();
    tick(250);
    http.expectOne(candidates).flush({ content: [], totalElements: 0, selected: null });
    fixture.detectChanges();
    expect(root.querySelectorAll('[role="option"]')).toHaveSize(0);
    expect(root.querySelector('app-searchable-select [role="status"]')?.textContent).toContain('Nenhum resultado');

    type(input, '12345678909');
    tick(250);
    http.expectOne(candidates).flush({}, { status: 500, statusText: 'Error' });
    fixture.detectChanges();
    expect(root.querySelector('app-searchable-select [role="status"]')?.textContent).toContain('Não foi possível concluir a consulta');

    type(input, '98765432100');
    tick(250);
    http.expectOne(candidates).flush({ content: [teacher], totalElements: 1, selected: null });
    fixture.detectChanges();
    expect(root.querySelectorAll('[role="option"]')).toHaveSize(1);
    expect(root.querySelector('[role="option"]')?.textContent).not.toContain('98765432100');
    press(input, 'Escape');
    http.expectOne(candidates).flush({ content: [teacher, otherTeacher], totalElements: 2, selected: null });
    fixture.detectChanges();
    expect(root.querySelector('[role="combobox"]')).toBeNull();
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    expect(fixture.componentInstance.teacherForm.controls.teacherId.value).toBe('');
  }));

  it('seleciona a única substituição elegível e envia a versão da atribuição anterior', async () => {
    const component = fixture.componentInstance;
    const teaching = '/api/v1/admin/academic/teaching';
    const assignment = {
      id: 15, teacherId: teacher.id, teacherName: teacher.name, offering: offer, active: true, version: 3,
    };
    const page = { content: [assignment], totalElements: 11, totalPages: 2, number: 1, size: 10 };
    component.selectSection('teaching');
    http.expectOne(req => req.url === teaching && req.params.get('page') === '0').flush({ ...page, number: 0 });
    component.load(1);
    http.expectOne(req => req.url === teaching && req.params.get('page') === '1').flush(page);
    component.openTeaching(offer, assignment);
    fixture.detectChanges();
    const initial = http.expectOne(candidates);
    expect(initial.request.body).toEqual(jasmine.objectContaining({ campusId: 1, roles: ['TEACHER'], excludedId: teacher.id }));
    initial.flush({ content: [otherTeacher], totalElements: 1, selected: null });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.teacherForm.controls.teacherId.value).toBe(String(otherTeacher.id));
    http.expectOne(candidates).flush({ content: [otherTeacher], totalElements: 1, selected: otherTeacher });
    fixture.detectChanges();
    fixture.componentInstance.saveTeaching();
    const request = http.expectOne('/api/v1/admin/academic/teaching/15');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ teacherId: otherTeacher.id, version: 3 });
    request.flush({});
    expect(component.section()).toBe('teaching');
    http.expectOne(req => req.url === teaching && req.params.get('page') === '1').flush(page);
  });
});
