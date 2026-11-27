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

  function openPicker() {
    root.querySelector<HTMLButtonElement>('app-searchable-select[formControlName="teacherId"] button')!.click();
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
    http.expectOne(candidates).flush({ content: [teacher], totalElements: 35, selected: null });
    fixture.detectChanges();
  }

  it('usa o total da consulta inicial e envia o ID escolhido pelo teclado', fakeAsync(() => {
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
    expect(root.querySelector('app-searchable-select')?.textContent).toContain('MAT-21');

    const validation = http.expectOne(candidates);
    expect(validation.request.body).toEqual(jasmine.objectContaining({ selectedId: otherTeacher.id, query: '' }));
    validation.flush({ content: [teacher], totalElements: 35, selected: otherTeacher });
    fixture.detectChanges();
    fixture.componentInstance.saveTeaching();
    const request = http.expectOne('/api/v1/admin/academic/teaching');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ offeringId: offer.id, teacherId: otherTeacher.id });
    request.flush({});
    http.expectOne(request => request.url.endsWith('/academic/teaching')).flush({ content: [], totalElements: 0, totalPages: 0 });
  }));

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
    fixture.componentInstance.openTeaching(offer, {
      id: 15, teacherId: teacher.id, teacherName: teacher.name, offering: offer, active: true, version: 3,
    });
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
    http.expectOne(request => request.url.endsWith('/academic/teaching')).flush({ content: [], totalElements: 0, totalPages: 0 });
  });
});
