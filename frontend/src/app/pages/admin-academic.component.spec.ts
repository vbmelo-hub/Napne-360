import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AdminCourse } from '../core/models';
import { AdminAcademicComponent } from './admin-academic.component';

describe('Cursos na administração acadêmica', () => {
  const studentUrl = '/api/v1/admin/student-registrations/candidates';
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
      id: index + 1, name: `Disciplina ${index + 1}`, code: `D${index + 1}`, workloadHours: 60, courseId: 1, active: true, syllabus: `Ementa da disciplina ${index + 1}`, version: 0
    })),
    { id: 12, name: 'Disciplina de outro curso', code: 'OUTRA', workloadHours: 30, courseId: 2, active: true },
    { id: 13, name: 'Projeto aplicado', code: 'PROJ', workloadHours: 60, courseId: 11, active: true }
  ];
  const assignments = Array.from({ length: 11 }, (_, index) => ({
    id: index + 1,
    studentId: index + 1,
    registration: `M${index + 1}`,
    userId: 5,
    userName: 'Coordenação do campus',
    subjectId: index === 10 ? 13 : null,
    assignmentType: 'COORDINATOR',
    active: index !== 10
  }));
  let fixture: ComponentFixture<AdminAcademicComponent>;
  let http: HttpTestingController;
  let root: HTMLElement;

  function load(rows = courses, components = subjects) {
    http.expectNone('/api/v1/admin/users');
    http.expectOne('/api/v1/admin/campuses').flush([
      { id: 1, name: 'Rio Branco', code: 'RB', active: true },
      { id: 2, name: 'Xapuri', code: 'XAP', active: true },
      { id: 3, name: 'Campus anterior', code: 'ANT', active: false }
    ]);
    http.expectOne(courseUrl).flush(rows);
    http.expectOne('/api/v1/admin/subjects').flush(components);
    fixture.detectChanges();
    http.expectNone('/api/v1/admin/student-registrations');
    const content = Array.from({ length: 30 }, (_, index) => ({
      id: index + 1, registration: `M${index + 1}`, campusId: 1, courseId: 1, status: 'ACTIVE',
    }));
    http.expectOne(studentUrl).flush({ content, totalElements: 41, selected: null });
    http.match('/api/v1/admin/assignments/page?page=0&size=10').forEach(request =>
      request.flush({ content: assignments.slice(0, 10), number: 0, size: 10, totalPages: 2, totalElements: 11 }));
    fixture.detectChanges();
  }

  function validateStudent(id: number) {
    const student = { id, registration: `M${id}`, campusId: id === 11 ? 2 : 1,
      courseId: id === 11 ? 11 : 1, status: 'ACTIVE' };
    const request = http.expectOne(studentUrl);
    expect(request.request.method).toBe('POST');
    expect(request.request.body.selectedId).toBe(id);
    request.flush({ content: [], totalElements: 11, selected: student });
    fixture.detectChanges();
  }

  it('consulta a próxima página sem consultar a lista integral de matrículas', () => {
    const picker = requiredScope('app-searchable-select[formControlName="studentId"]');
    picker.querySelector('button')!.click();
    fixture.detectChanges();
    expect(picker.querySelector('input')?.placeholder).toBe('Pesquisar matrícula');
    click(picker, 'Próxima');
    const page = http.expectOne(studentUrl);
    expect(page.request.body.page).toBe(1);
    page.flush({ content: [{ id: 31, registration: 'M31', campusId: 1, courseId: 1, status: 'ACTIVE', displayName: 'Nome protegido' }],
      totalElements: 41, selected: null });
    fixture.detectChanges();
    expect(picker.querySelector('[role="option"]')?.textContent?.trim()).toBe('M31');
  });

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

  it('seleciona o único profissional elegível e revalida a seleção ao mudar de campus', async () => {
    const form = fixture.componentInstance.assignmentForm;
    const candidate = { id: 5, name: 'Coordenação do campus', email: 'coordenacao@ifac.edu.br',
      active: true, campusId: 1, roles: ['COURSE_COORDINATOR'] };
    const url = '/api/v1/admin/users/candidates';
    form.patchValue({ studentId: '1', assignmentType: 'COORDINATOR' });
    fixture.detectChanges();
    validateStudent(1);
    const initial = http.expectOne(url);
    expect(initial.request.method).toBe('POST');
    expect(initial.request.serializeBody()).toBe(JSON.stringify({
      campusId: 1, roles: ['COTEP', 'COURSE_COORDINATOR', 'MANAGEMENT'], query: '',
    }));
    initial.flush({ content: [candidate], totalElements: 1, selected: null });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(form.controls.userId.value).toBe('5');
    http.expectOne(url).flush({ content: [candidate], totalElements: 1, selected: candidate });
    fixture.detectChanges();

    form.controls.studentId.setValue('2');
    fixture.detectChanges();
    validateStudent(2);
    http.expectNone(url);
    expect(form.controls.userId.value).toBe('5');
    form.controls.studentId.setValue('11');
    fixture.detectChanges();
    expect(form.controls.userId.value).toBe('5');
    fixture.componentInstance.createAssignment();
    http.expectNone(request => request.method === 'POST' && request.url === '/api/v1/admin/assignments');
    validateStudent(11);
    const changed = http.expectOne(url);
    expect(changed.request.body).toEqual(jasmine.objectContaining({ campusId: 2, selectedId: 5 }));
    fixture.componentInstance.createAssignment();
    http.expectNone(request => request.method === 'POST' && request.url === '/api/v1/admin/assignments');
    changed.flush({ content: [], totalElements: 0, selected: null });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(form.controls.userId.value).toBe('');
    http.expectOne(url).flush({ content: [], totalElements: 0, selected: null });
  });

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

  it('edita um componente com a ementa atual e mantém a página do modal', () => {
    click(coursesSection(), 'Ver componentes');
    const dialog = requiredScope('[role="dialog"]');
    click(dialog, 'Próxima');
    click(dialog, 'Editar');
    const syllabus = dialog.querySelector<HTMLTextAreaElement>('textarea[formControlName="syllabus"]')!;
    expect(syllabus.value).toBe('Ementa da disciplina 11');
    expect(dialog.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBeTrue();
    syllabus.value = 'Ementa revisada';
    syllabus.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    click(dialog, 'Salvar alterações');
    const request = http.expectOne('/api/v1/admin/subjects/11');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ courseId: 1, name: 'Disciplina 11', code: 'D11', workloadHours: 60, syllabus: 'Ementa revisada', version: 0 });
    request.flush({ ...subjects[10], syllabus: 'Ementa revisada' });
    fixture.detectChanges();
    expect(dialog.querySelectorAll('tbody tr')).toHaveSize(1);
    expect(dialog.textContent).toContain('Página 2 de 2');
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
    expect(document.activeElement?.textContent?.trim()).toBe('Limpar filtros');

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
    http.expectOne(studentUrl).flush({ content: [], totalElements: 0, selected: null });
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

  it('mantém o histórico visível e retira das novas seleções o curso arquivado, seu componente e sua matrícula', async () => {
    const picker = requiredScope('app-searchable-select[formControlName="courseId"]');
    const { assignmentForm: assignment, subjectForm } = fixture.componentInstance;
    picker.querySelector('button')!.click();
    fixture.detectChanges();
    search(picker, 'computacao c11');
    picker.querySelector<HTMLElement>('[role="option"]')!.click();
    assignment.controls.studentId.setValue('11');
    fixture.detectChanges();
    validateStudent(11);
    http.expectOne('/api/v1/admin/users/candidates').flush({ content: [], totalElements: 0, selected: null });
    assignment.controls.subjectId.setValue('13');
    fixture.detectChanges();
    expect(subjectForm.controls.courseId.value).toBe('11');
    expect(requiredScope('app-searchable-select[formControlName="subjectId"]').textContent).toContain('Projeto aplicado');

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
    http.expectOne(studentUrl).flush({ content: [], totalElements: 10, selected: null });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(root.querySelector('[role="alertdialog"]')).toBeNull();
    expect(coursesSection().querySelectorAll('article')).toHaveSize(1);
    expect(coursesSection().textContent).toContain('Computação Aplicada');
    expect(coursesSection().textContent).toContain('Arquivado');
    expect(subjectForm.controls.courseId.value).toBe('');
    picker.querySelector('button')!.click();
    fixture.detectChanges();
    search(picker, 'C11');
    expect(picker.querySelector('[role="option"]')).toBeNull();
    picker.querySelector('button')!.click();
    fixture.detectChanges();
    expect(assignment.controls.studentId.value).toBe('');
    fixture.detectChanges();
    http.expectOne(studentUrl).flush({ content: [], totalElements: 10, selected: null });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(assignment.controls.subjectId.value).toBe('');
    const studentPicker = requiredScope('app-searchable-select[formControlName="studentId"]');
    studentPicker.querySelector('button')!.click();
    fixture.detectChanges();
    expect(Array.from(studentPicker.querySelectorAll('[role="option"]')).some(item => item.textContent?.trim() === 'M11')).toBeFalse();
    studentPicker.querySelector('button')!.click();
    fixture.detectChanges();

    click(coursesSection(), 'Ver componentes');
    const dialog = requiredScope('[role="dialog"]');
    expect(dialog.textContent).toContain('Projeto aplicado');
    expect(dialog.textContent).toContain('Arquivado');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    const links = requiredScope('.assignments');
    search(links, 'Projeto aplicado');
    click(links, 'Filtrar vínculos');
    http.expectOne('/api/v1/admin/assignments/page?page=0&size=10&query=Projeto%20aplicado')
      .flush({ content: [assignments[10]], number: 0, size: 10, totalPages: 1, totalElements: 1 });
    fixture.detectChanges();
    expect(links.querySelector('tbody tr')?.textContent).toContain('M11');
  });

  it('identifica o vínculo e a revogação pela matrícula, mesmo se a resposta exceder o contrato', () => {
    fixture.componentInstance.refreshAssignments();
    const link = { ...assignments[0], studentName: 'Nome protegido' };
    http.expectOne('/api/v1/admin/assignments/page?page=0&size=10')
      .flush({ content: [link], number: 0, size: 10, totalPages: 1, totalElements: 1 });
    fixture.detectChanges();

    const section = requiredScope('.assignments');
    expect(section.querySelector('th')?.textContent).toBe('Matrícula');
    expect(section.querySelector('td[data-label="Matrícula"]')?.textContent).toBe('M1');
    expect(section.textContent).not.toContain('Nome protegido');
    click(section, 'Revogar');
    expect(requiredScope('[role="alertdialog"]').textContent).toContain('matrícula M1');
  });

  it('mostra campus arquivado somente no filtro histórico de vínculos', () => {
    const scope = requiredScope('.assignments');
    const history = scope.querySelector<HTMLSelectElement>('select[formControlName="campus"]')!;
    expect(history.querySelector('option[value="3"]')?.textContent).toContain('Campus anterior (arquivado)');
    expect(root.querySelector('.admin-academic-grid select[formControlName="campusId"] option[value="3"]')).toBeNull();
    click(coursesSection(), 'Editar');
    expect(requiredScope('[role="dialog"]').querySelector('option[value="3"]')).toBeNull();
    fixture.componentInstance.assignmentFilters.controls.campus.setValue('3');
    fixture.componentInstance.applyAssignmentFilters();
    const request = http.expectOne(req => req.url.endsWith('/assignments/page') && req.params.get('campus') === '3');
    request.flush({ content: [], number: 0, size: 10, totalPages: 0, totalElements: 0 });
  });

  it('seleciona o único curso ativo no cadastro e mantém Todos no filtro com uma opção', () => {
    fixture.componentInstance.load();
    fixture.detectChanges();
    load([courses[0]]);
    const { subjectForm, assignmentFilters } = fixture.componentInstance;
    expect(subjectForm.controls.courseId.value).toBe('1');
    expect(assignmentFilters.controls.course.value).toBe('');
    const course = requiredScope('.assignments app-searchable-select[formControlName="course"]');
    expect(course.querySelector('button')?.textContent).toContain('Todos');
    const subject = requiredScope('.assignments app-searchable-select[formControlName="subject"]');
    subject.querySelector('button')!.click();
    fixture.detectChanges();
    search(subject, 'sem componente');
    subject.querySelector<HTMLElement>('[role="option"]')!.click();
    expect(assignmentFilters.controls.subject.value).toBe('general');
  });

  it('pagina os vínculos e combina situação e matrícula no servidor a partir da primeira página', () => {
    const section = requiredScope('.assignments');
    expect(section.querySelectorAll('tbody tr')).toHaveSize(10);
    click(section, 'Próxima');
    http.expectOne('/api/v1/admin/assignments/page?page=1&size=10')
      .flush({ content: [assignments[10]], number: 1, size: 10, totalPages: 2, totalElements: 11 });
    fixture.detectChanges();
    expect(section.querySelectorAll('tbody tr')).toHaveSize(1);
    fixture.componentInstance.assignmentFilters.patchValue({ active: 'false', registration: 'M11' });
    click(section, 'Filtrar vínculos');
    const request = http.expectOne(r => r.url === '/api/v1/admin/assignments/page' && r.params.get('active') === 'false');
    expect(request.request.params.get('page')).toBe('0');
    expect(request.request.params.get('registration')).toBe('M11');
    request.flush({ content: [assignments[10]], number: 0, size: 10, totalPages: 1, totalElements: 1 });
    fixture.detectChanges();
    expect(section.querySelectorAll('tbody tr')).toHaveSize(1);
    expect(section.textContent).toContain('M11');
  });
});
