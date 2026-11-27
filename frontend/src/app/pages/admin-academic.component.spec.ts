import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminCourse } from '../core/models';
import { AdminAcademicComponent } from './admin-academic.component';

describe('Cursos na administração acadêmica', () => {
  const courseUrl = '/api/v1/admin/courses';
  const courses: AdminCourse[] = Array.from({ length: 11 }, (_, index) => ({
    id: index + 1,
    name: index === 10 ? 'Computação Aplicada' : `Curso ${index + 1}`,
    code: `C${index + 1}`,
    campusId: index === 10 ? 2 : 1,
    campus: index === 10 ? 'Xapuri' : 'Rio Branco',
    active: true
  }));
  const subjects = [
    ...Array.from({ length: 11 }, (_, index) => ({
      id: index + 1, name: `Disciplina ${index + 1}`, code: `D${index + 1}`, workloadHours: 60, courseId: 1, active: true
    })),
    { id: 12, name: 'Disciplina de outro curso', code: 'OUTRA', workloadHours: 30, courseId: 2, active: true },
    { id: 13, name: 'Projeto aplicado', code: 'PROJ', workloadHours: 60, courseId: 11, active: true }
  ];
  const assignments = Array.from({ length: 11 }, (_, index) => ({
    id: index + 1,
    studentId: index + 1,
    userId: 5,
    subjectId: index === 10 ? 13 : null,
    assignmentType: 'COORDINATOR',
    active: index !== 10
  }));
  let fixture: ComponentFixture<AdminAcademicComponent>;
  let http: HttpTestingController;
  let root: HTMLElement;

  function load(rows = courses, components = subjects) {
    http.expectOne('/api/v1/admin/users').flush([{ id: 5, name: 'Coordenação do campus', email: 'coordenacao@ifac.edu.br', active: true, campusId: 1, roles: ['COURSE_COORDINATOR'] }]);
    http.expectOne('/api/v1/catalog/campuses').flush([
      { id: 1, name: 'Rio Branco', code: 'RB', active: true },
      { id: 2, name: 'Xapuri', code: 'XAP', active: true }
    ]);
    http.expectOne(courseUrl).flush(rows);
    http.expectOne('/api/v1/admin/subjects').flush(components);
    http.expectOne('/api/v1/admin/student-registrations').flush(assignments.map(a => ({
      id: a.studentId, registration: `M${a.studentId}`, campusId: a.active ? 1 : 2, courseId: a.active ? 1 : 11
    })));
    http.expectOne('/api/v1/admin/assignments').flush(assignments);
    fixture.detectChanges();
  }

  function click(scope: ParentNode, label: string) {
    const button = Array.from(scope.querySelectorAll('button')).find(element => element.textContent?.trim() === label);
    if (!button) throw new Error(`Botão ausente: ${label}`);
    button.click();
    fixture.detectChanges();
  }

  function search(scope: ParentNode, value: string) {
    const field = scope.querySelector<HTMLInputElement>('input[type="search"]');
    if (!field) throw new Error('Campo de busca ausente');
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
  }

  function coursesSection(): HTMLElement {
    return root.querySelector<HTMLElement>('.structure-card')!;
  }

  function requiredScope(selector: string): HTMLElement {
    const scope = root.querySelector<HTMLElement>(selector);
    if (!scope) throw new Error(`Área ausente: ${selector}`);
    return scope;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminAcademicComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    fixture = TestBed.createComponent(AdminAcademicComponent);
    root = fixture.nativeElement;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    load();
  });

  afterEach(() => http.verify());

  it('mostra dez cursos por página e filtra pelo nome, código ou campus', () => {
    const section = coursesSection();
    expect(section.querySelectorAll('article')).toHaveSize(10);
    expect(section.textContent).not.toContain('Disciplina 1');
    click(section, 'Próxima');
    expect(section.querySelectorAll('article')).toHaveSize(1);
    expect(section.textContent).toContain('Computação Aplicada');

    for (const value of ['computacao', 'C11', 'Xapuri']) {
      search(section, value);
      expect(section.querySelectorAll('article')).toHaveSize(1);
      expect(section.textContent).toContain('Computação Aplicada');
    }
  });

  it('abre somente os componentes do curso selecionado e os filtra com paginação', () => {
    click(coursesSection(), 'Ver componentes');
    const dialog = requiredScope('[role="dialog"]');
    expect(dialog.textContent).toContain('Curso 1');
    expect(dialog.textContent).not.toContain('Disciplina de outro curso');
    expect(dialog.querySelectorAll('tbody tr')).toHaveSize(10);
    click(dialog, 'Próxima');
    expect(dialog.querySelectorAll('tbody tr')).toHaveSize(1);
    search(dialog, 'D3');
    expect(dialog.querySelectorAll('tbody tr')).toHaveSize(1);
    expect(dialog.textContent).toContain('Disciplina 3');
    search(dialog, 'OUTRA');
    expect(dialog.querySelectorAll('tbody tr')).toHaveSize(0);
  });

  it('controla o foco pelo teclado na janela de componentes e devolve ao botão de origem', async () => {
    const trigger = requiredScope('button[aria-label^="Ver componentes de Curso 1"]');
    trigger.focus();
    trigger.click();
    fixture.detectChanges();

    const dialog = requiredScope('[role="dialog"]');
    const close = requiredScope('[aria-label="Fechar janela"]');
    expect(document.activeElement).toBe(close);
    expect(document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent).toContain('Curso 1');

    search(dialog, 'sem resultados');
    close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(dialog.querySelector('input[type="search"]'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('edita nome, código e campus e aplica o curso retornado pela API', () => {
    click(coursesSection(), 'Editar');
    const dialog = requiredScope('[role="dialog"]');
    const name = dialog.querySelector<HTMLInputElement>('input[formControlName="name"]')!;
    const code = dialog.querySelector<HTMLInputElement>('input[formControlName="code"]')!;
    const campus = dialog.querySelector<HTMLSelectElement>('select')!;
    expect([name.value, code.value, campus.value]).toEqual(['Curso 1', 'C1', '1']);
    name.value = 'Curso atualizado';
    name.dispatchEvent(new Event('input'));
    code.value = 'ATUAL';
    code.dispatchEvent(new Event('input'));
    campus.value = '2';
    campus.dispatchEvent(new Event('change'));
    click(dialog, 'Salvar alterações');
    const request = http.expectOne(`${courseUrl}/1`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ name: 'Curso atualizado', code: 'ATUAL', campusId: 2 });
    request.flush({ id: 1, name: 'Curso atualizado', code: 'ATUAL', campusId: 2, campus: 'Xapuri', active: true });
    fixture.detectChanges();
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(coursesSection().textContent).toContain('Curso atualizado');
  });

  it('mantém o curso visível e informa o detalhe do servidor quando o arquivamento é bloqueado', () => {
    click(coursesSection(), 'Arquivar');
    const dialog = requiredScope('[role="alertdialog"]');
    expect(dialog.textContent).toContain('Curso 1');
    expect(dialog.textContent).toContain('Todas as disciplinas vinculadas');
    expect(dialog.textContent).toContain('Deseja prosseguir?');
    http.expectNone(`${courseUrl}/1/archive`);
    click(dialog, 'Arquivar curso');
    const request = http.expectOne(`${courseUrl}/1/archive`);
    expect(request.request.method).toBe('PATCH');
    request.flush({ detail: 'O curso possui estudantes vinculados.' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('O curso possui estudantes vinculados.');
    expect(coursesSection().querySelector('article')?.textContent).toContain('Curso 1');
  });

  it('mantém o histórico visível e retira das novas seleções o curso arquivado, seu componente e sua matrícula', () => {
    const courseOption = root.querySelector<HTMLSelectElement>('select[formControlName="courseId"]')!;
    const studentOption = root.querySelector<HTMLSelectElement>('select[formControlName="studentId"]')!;
    const subjectOption = root.querySelector<HTMLSelectElement>('select[formControlName="subjectId"]')!;
    courseOption.value = '11';
    courseOption.dispatchEvent(new Event('change'));
    studentOption.value = '11';
    studentOption.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    subjectOption.value = '13';
    subjectOption.dispatchEvent(new Event('change'));
    expect(courseOption.value).toBe('11');
    expect(subjectOption.value).toBe('13');

    click(coursesSection(), 'Próxima');
    click(coursesSection(), 'Arquivar');
    click(requiredScope('[role="alertdialog"]'), 'Arquivar curso');
    const request = http.expectOne(`${courseUrl}/11/archive`);
    expect(request.request.method).toBe('PATCH');
    const archivedCourse = { ...courses[10], active: false };
    request.flush(archivedCourse);
    http.expectOne(courseUrl).flush([...courses.slice(0, 10), archivedCourse]);
    http.expectOne('/api/v1/admin/subjects').flush([...subjects.slice(0, 12), { ...subjects[12], active: false }]);
    fixture.detectChanges();
    expect(root.querySelector('[role="alertdialog"]')).toBeNull();
    expect(coursesSection().querySelectorAll('article')).toHaveSize(1);
    expect(coursesSection().textContent).toContain('Computação Aplicada');
    expect(coursesSection().textContent).toContain('Arquivado');
    expect(Array.from(courseOption.options).some(option => option.value === '11')).toBeFalse();
    expect(Array.from(studentOption.options).some(option => option.value === '11')).toBeFalse();
    expect(Array.from(subjectOption.options).some(option => option.value === '13')).toBeFalse();
    expect(courseOption.value).toBe('');
    expect(studentOption.value).toBe('');
    expect(subjectOption.value).toBe('');

    click(coursesSection(), 'Ver componentes');
    const dialog = requiredScope('[role="dialog"]');
    expect(dialog.textContent).toContain('Projeto aplicado');
    expect(dialog.textContent).toContain('Arquivado');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    search(requiredScope('.assignments'), 'Projeto aplicado');
    expect(requiredScope('.assignments').querySelector('tbody tr')?.textContent).toContain('M11');
  });

  it('pagina os vínculos e permite buscar pelo texto da situação', () => {
    const section = requiredScope('.assignments');
    expect(section.querySelectorAll('tbody tr')).toHaveSize(10);
    click(section, 'Próxima');
    expect(section.querySelectorAll('tbody tr')).toHaveSize(1);
    search(section, 'revogado');
    expect(section.querySelectorAll('tbody tr')).toHaveSize(1);
    expect(section.textContent).toContain('M11');
  });
});
