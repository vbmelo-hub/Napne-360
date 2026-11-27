import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { StudentsComponent } from './students.component';
import { ToastService } from '../core/toast.service';

describe('StudentsComponent — envio da busca', () => {
  let fixture: ComponentFixture<StudentsComponent>;
  let http: HttpTestingController;
  let initialLoad: TestRequest;
  const student = { id: 1, registration: 'TEST-1', displayName: 'Pessoa inicial',
    course: 'Curso', campus: 'Campus', status: 'ACTIVE' };

  beforeEach(async () => {
    sessionStorage.setItem('napne360.session', JSON.stringify({ token: 'test', id: 2,
      name: 'NAPNE fictício', email: 'napne@test.local', roles: ['NAPNE'], campusId: 1 }));
    await TestBed.configureTestingModule({ imports: [StudentsComponent], providers: [
      provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
      { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['show']) }
    ] }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StudentsComponent); fixture.detectChanges();
    initialLoad = http.expectOne(request => request.url === '/api/v1/students'
      && request.params.get('query') === '' && request.params.get('size') === '10');
    http.expectOne('/api/v1/students/filter-courses').flush([{ id: 7, name: 'Curso', code: 'CRS' }]);
    http.expectOne('/api/v1/catalog/courses').flush([]); fixture.detectChanges();
  });

  afterEach(() => { http.verify(); sessionStorage.clear(); });

  it('seleciona o curso único e permite pesquisar entre cursos cadastrados', async () => {
    initialLoad.flush({ content: [], number: 0, totalElements: 0, totalPages: 0 });
    const component = fixture.componentInstance;
    const course = { id: 7, name: 'Sistemas para Internet', code: 'SI', campus: 'Rio Branco', campusId: 1 };
    component.courses.set([course]);
    component.showForm.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.form.controls.courseId.value).toBe('7');

    component.courses.set([course, { ...course, id: 8, name: 'Administração', code: 'ADM' }]);
    fixture.detectChanges();
    const picker = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLElement>('app-searchable-select[formControlName="courseId"]')!;
    picker.querySelector('button')!.click(); fixture.detectChanges();
    const search = picker.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'administracao adm';
    search.dispatchEvent(new Event('input')); fixture.detectChanges();
    const options = picker.querySelectorAll<HTMLElement>('[role="option"]');
    expect(options).toHaveSize(1);
    expect(component.form.controls.courseId.value).toBe('7');
    options[0].click(); fixture.detectChanges();
    expect(component.form.controls.courseId.value).toBe('8');
  });

  it('navega por número de página sem aplicar o termo ainda não enviado', () => {
    initialLoad.flush({ content: [student], number: 0, size: 10, totalElements: 32, totalPages: 4 });
    fixture.detectChanges();
    const dom = fixture.nativeElement as HTMLElement;
    const search = dom.querySelector<HTMLInputElement>('#search')!;
    search.value = 'Termo ainda em edição';
    search.dispatchEvent(new Event('input'));

    dom.querySelector<HTMLButtonElement>('button[aria-label="Página 3"]')!.click();
    const page = http.expectOne(request => request.url === '/api/v1/students'
      && request.params.get('page') === '2' && request.params.get('query') === '');
    page.flush({ content: [student], number: 2, size: 10, totalElements: 32, totalPages: 4 });
    fixture.detectChanges();
    expect(dom.querySelector('[aria-current="page"]')?.textContent?.trim()).toBe('3');
  });

  it('combina situação acadêmica e motivo e permite remover cada filtro separadamente', () => {
    initialLoad.flush({ content: [student], number: 0, totalElements: 1, totalPages: 1 });
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const dom = fixture.nativeElement as HTMLElement;
    component.statusFilter.setValue('COMPLETED');
    component.reasonFilter.setValue('COURSE_COMPLETION');
    component.searchStudents();

    const filtered = http.expectOne(request => request.url === '/api/v1/students'
      && request.params.get('status') === 'COMPLETED' && request.params.get('reason') === 'COURSE_COMPLETION'
      && request.params.get('page') === '0');
    filtered.flush({ content: [], number: 0, totalElements: 0, totalPages: 0 });
    fixture.detectChanges();

    dom.querySelector<HTMLButtonElement>('button[aria-label="Remover filtro Motivo: Conclusão do curso"]')!.click();
    const stillFiltered = http.expectOne(request => request.url === '/api/v1/students'
      && request.params.get('status') === 'COMPLETED' && request.params.get('reason') === null);
    stillFiltered.flush({ content: [], number: 0, totalElements: 0, totalPages: 0 });
  });

  for (const origin of ['botão', 'Enter'] as const) {
    it(`cancela navegação nativa por ${origin} e busca texto digitado a partir da página zero`, () => {
      initialLoad.flush({ content: [student], number: 0, size: 20, totalElements: 40, totalPages: 2 });
      fixture.detectChanges();
      const dom = fixture.nativeElement as HTMLElement;
      const next = Array.from(dom.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Próxima')!;
      next.click();
      const secondPage = http.expectOne(request => request.url === '/api/v1/students' && request.params.get('page') === '1');
      secondPage.flush({ content: [student], number: 1, size: 20, totalElements: 40, totalPages: 2 });
      fixture.detectChanges();

      const input = dom.querySelector<HTMLInputElement>('#search')!;
      input.value = '  Pessoa localizada  '; input.dispatchEvent(new Event('input'));
      const form = input.closest('form')!;
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
      const event = new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: origin === 'botão' ? button : null });
      form.dispatchEvent(event);

      expect(event.defaultPrevented).toBeTrue();
      const search = http.expectOne(request => request.url === '/api/v1/students'
        && request.params.get('query') === 'Pessoa localizada' && request.params.get('page') === '0');
      expect(search.request.method).toBe('GET');
      search.flush({ content: [{ ...student, id: 99, displayName: 'Pessoa localizada' }],
        number: 0, size: 20, totalElements: 1, totalPages: 1 });
      fixture.detectChanges();
      expect(dom.querySelector('tbody')?.textContent).toContain('Pessoa localizada');
      expect(dom.querySelector('.pagination-info')?.textContent).toContain('Página 1 de 1');
      expect(input.value).toBe('  Pessoa localizada  ');
    });
  }

  for (const outcome of ['resultado', 'erro'] as const) {
    it(`preserva a busca quando a requisição inicial termina depois com ${outcome}`, () => {
      const dom = fixture.nativeElement as HTMLElement;
      const input = dom.querySelector<HTMLInputElement>('#search')!;
      input.value = 'Pessoa localizada';
      input.dispatchEvent(new Event('input'));
      input.closest('form')!.dispatchEvent(new SubmitEvent('submit', {
        bubbles: true, cancelable: true
      }));

      const search = http.expectOne(request => request.url === '/api/v1/students'
        && request.params.get('query') === 'Pessoa localizada');
      search.flush({ content: [{ ...student, id: 99, displayName: 'Pessoa localizada' }],
        number: 0, size: 20, totalElements: 1, totalPages: 1 });
      fixture.detectChanges();
      expect(dom.querySelector('tbody')?.textContent).toContain('Pessoa localizada');

      if (outcome === 'resultado') {
        initialLoad.flush({ content: [student], number: 0, size: 20, totalElements: 40, totalPages: 2 });
      } else {
        initialLoad.flush(null, { status: 500, statusText: 'Internal Server Error' });
      }
      fixture.detectChanges();
      expect(dom.querySelector('tbody')?.textContent).toContain('Pessoa localizada');
      expect(dom.querySelector('.pagination-info')?.textContent).toContain('Página 1 de 1');
      expect(dom.querySelector('[role="alert"]')).toBeNull();
    });
  }
});
