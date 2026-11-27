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
    http.expectOne('/api/v1/catalog/courses').flush([]); fixture.detectChanges();
  });

  afterEach(() => { http.verify(); sessionStorage.clear(); });

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
      const form = dom.querySelector<HTMLFormElement>('form.search')!;
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
      dom.querySelector<HTMLFormElement>('form.search')!.dispatchEvent(new SubmitEvent('submit', {
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
