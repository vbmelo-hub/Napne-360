import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { StudentDetailComponent } from './student-detail.component';
import { AcademicApi, AcademicOffering } from '../core/academic-api.service';
import { ApiService } from '../core/api.service';
import { Dossier, Pei, StudentDetails } from '../core/models';
import { ToastService } from '../core/toast.service';

describe('StudentDetailComponent — catálogos e referências históricas', () => {
  let fixture: ComponentFixture<StudentDetailComponent>;
  let api: jasmine.SpyObj<ApiService>;
  let academic: jasmine.SpyObj<AcademicApi>;
  const offer: AcademicOffering = {
    id: 22, subjectId: 100, subjectName: 'Componente', groupCode: 'Turma A',
    courseId: 10, courseName: 'Curso', campusId: 1, campusName: 'Campus',
    periodId: 21, periodCode: '2026.1', periodLabel: 'Primeiro semestre de 2026', active: true
  };
  const student: StudentDetails = {
    id: 1, registration: 'TEST-1', displayName: 'Pessoa fictícia', course: 'Curso', campus: 'Campus',
    status: 'ACTIVE', civilName: 'Pessoa fictícia', socialName: null, birthDate: null,
    institutionalEmail: null, phone: null, campusId: 1, courseId: 10, version: 1
  };
  const baseDossier: Dossier = {
    studentId: 1, identification: {}, educationalNeeds: {}, healthAndSupport: {}, familyContext: {},
    schoolHistory: {}, strengths: {}, difficulties: {}, initialInterventions: {}, version: 4, redacted: false
  };
  const pei: Pei = {
    id: 'pei-1', studentId: 1, subjectId: 100, teacherId: 2, academicTerm: '2026.1',
    revision: 1, status: 'DRAFT', content: {}, reviewedBy: null, reviewedAt: null, updatedAt: '2026-11-17T12:00:00Z'
  };

  beforeEach(async () => {
    sessionStorage.setItem('napne360.session', JSON.stringify({ token: 'test', id: 2,
      name: 'NAPNE fictício', email: 'napne@test.local', roles: ['NAPNE'], campusId: 1 }));
    api = jasmine.createSpyObj<ApiService>('ApiService', [
      'student', 'dossier', 'cases', 'records', 'peis', 'attachments',
      'studentSubjects', 'studentTeachers', 'courses', 'references', 'saveDossier', 'createPei'
    ]);
    api.student.and.returnValue(of(student));
    api.dossier.and.returnValue(of(baseDossier));
    api.cases.and.returnValue(of([])); api.records.and.returnValue(of([])); api.peis.and.returnValue(of([]));
    api.attachments.and.returnValue(of([])); api.courses.and.returnValue(of([]));
    api.studentSubjects.and.returnValue(of([{ id: 100, name: 'Componente', code: 'COMP', workloadHours: 60, courseId: 10 }]));
    api.studentTeachers.and.returnValue(of([{ id: 2, name: 'Docente fictício', subjectId: 100 }]));
    api.references.and.callFake(kind => of(kind === 'NEED_CATEGORY'
      ? [{ id: 11, code: 'CAT', label: 'Categoria ativa' }]
      : [{ id: 21, code: '2026.1', label: 'Primeiro semestre de 2026' }]));
    api.saveDossier.and.returnValue(of(baseDossier)); api.createPei.and.returnValue(of(pei));
    academic = jasmine.createSpyObj<AcademicApi>('AcademicApi', ['peiOffers']);
    academic.peiOffers.and.returnValue(of([offer]));
    await TestBed.configureTestingModule({
      imports: [StudentDetailComponent], providers: [provideHttpClient(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '1' } } } },
        { provide: ApiService, useValue: api },
        { provide: AcademicApi, useValue: academic },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['show']) }]
    }).compileComponents();
  });

  afterEach(() => sessionStorage.clear());

  function start(dossier = baseDossier) {
    api.dossier.and.returnValue(of(dossier));
    fixture = TestBed.createComponent(StudentDetailComponent);
    fixture.detectChanges();
  }
  function setSession(roles: string[]) {
    sessionStorage.setItem('napne360.session', JSON.stringify({ token: 'test', id: 2,
      name: roles.includes('TEACHER') ? 'Docente fictício' : 'NAPNE fictício',
      email: 'user@test.local', roles, campusId: 1 }));
  }
  function view(tab: string) {
    fixture.componentInstance.tab.set(tab); fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  function changeSelect(selector: string, value: string) {
    const select = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(selector);
    expect(select).withContext(selector).not.toBeNull();
    if (select) { select.value = value; select.dispatchEvent(new Event('change')); fixture.detectChanges(); }
    return select;
  }
  function saveDossier() {
    const form = (fixture.nativeElement as HTMLElement).querySelector<HTMLFormElement>('.dossier-layout');
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); fixture.detectChanges();
  }

  it('localiza PEI histórico pelo nome registrado do componente arquivado', () => {
    api.studentSubjects.and.returnValue(of([]));
    api.peis.and.returnValue(of([{ ...pei, status: 'ARCHIVED', content: { subject: 'Introdução à Programação' } }]));
    start();
    const dom = view('pei');
    expect(dom.querySelector('.pei-row strong')?.textContent).toBe('Introdução à Programação');
    const search = dom.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'introducao programacao';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(dom.querySelector('.pei-row strong')?.textContent).toBe('Introdução à Programação');
  });

  it('mantém selecionado o curso arquivado no cadastro histórico do estudante', () => {
    api.student.and.returnValue(of({ ...student, status: 'ARCHIVED' }));
    start();
    fixture.componentInstance.openStudentEdit();
    fixture.detectChanges();
    const dom: HTMLElement = fixture.nativeElement;
    const course = dom.querySelector('app-searchable-select[formControlName="courseId"] button');
    expect(fixture.componentInstance.studentEditForm.controls.courseId.value).toBe('10');
    expect(course?.textContent).toContain('Curso');
    expect(course?.textContent).toContain('vínculo atual');
  });

  it('mostra rótulos ativos e envia categoria numérica sem perder notas, extras e versão', () => {
    start({ ...baseDossier, educationalNeeds: { category: 'Texto legado', notes: 'Nota inicial', custom: { keep: true }, specificNeeds: 'Apoio' } });
    const dom = view('dossier');
    const select = changeSelect('[data-testid="need-category"]', '11');
    expect(select?.textContent).toContain('Categoria ativa');
    expect(select?.textContent).not.toContain('>CAT<');
    const notes = dom.querySelector<HTMLTextAreaElement>('#dossier-educationalNeeds .details-content > label > textarea')!;
    notes.value = 'Nota revisada'; notes.dispatchEvent(new Event('input'));
    saveDossier();
    expect(api.saveDossier).toHaveBeenCalledWith(1, jasmine.objectContaining({ version: 4,
      educationalNeeds: jasmine.objectContaining({ categoryId: 11, notes: 'Nota revisada', custom: { keep: true }, specificNeeds: 'Apoio' }) }));
  });

  it('conserva associação histórica inativa e seu nome sem disponibilizá-la no novo PEI', () => {
    setSession(['NAPNE', 'TEACHER']);
    const dossier = { ...baseDossier, educationalNeeds: { categoryId: 91, category: 'Categoria histórica', notes: 'Conservar' } };
    api.saveDossier.and.returnValue(of(dossier));
    start(dossier);
    const dom = view('dossier');
    const select = dom.querySelector<HTMLSelectElement>('[data-testid="need-category"]');
    expect(select?.value).toBe('91'); expect(select?.textContent).toContain('Categoria histórica');
    const notes = (fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>(
      '#dossier-identification .details-content > label > textarea'
    )!;
    notes.value = 'Nota pedagógica revisada';
    notes.dispatchEvent(new Event('input'));
    saveDossier();
    expect(api.saveDossier).toHaveBeenCalledWith(1, jasmine.objectContaining({ educationalNeeds:
      jasmine.objectContaining({ categoryId: 91, category: 'Categoria histórica', notes: 'Conservar' }) }));
    const periods = view('pei').querySelector('app-searchable-select[formControlName="offeringId"]');
    expect(periods).not.toBeNull(); expect(periods?.textContent).not.toContain('Categoria histórica');
    expect(fixture.componentInstance.peiForm.controls.offeringId.value).toBe('22');
  });

  it('mostra o snapshot anterior mesmo se o mesmo ID ativo foi renomeado', () => {
    start({ ...baseDossier, educationalNeeds: { categoryId: 11, category: 'Nome registrado antes' } });
    const select = view('dossier').querySelector<HTMLSelectElement>('[data-testid="need-category"]');
    expect(select?.selectedOptions[0]?.textContent).toContain('Nome registrado antes');
    const notes = (fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>(
      '#dossier-identification .details-content > label > textarea'
    )!;
    notes.value = 'Nota pedagógica revisada';
    notes.dispatchEvent(new Event('input'));
    saveDossier();
    expect(api.saveDossier).toHaveBeenCalledWith(1, jasmine.objectContaining({ educationalNeeds:
      jasmine.objectContaining({ categoryId: 11, category: 'Nome registrado antes' }) }));
  });

  it('preserva texto legado sem ID e não o converte por semelhança com rótulo ativo', () => {
    start({ ...baseDossier, educationalNeeds: { category: 'Categoria ativa', extra: 'preservado' } });
    const dom = view('dossier');
    expect(dom.textContent).toContain('Categoria ativa');
    expect(dom.querySelector<HTMLSelectElement>('[data-testid="need-category"]')?.value).not.toBe('11');
    const notes = (fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>(
      '#dossier-identification .details-content > label > textarea'
    )!;
    notes.value = 'Nota pedagógica revisada';
    notes.dispatchEvent(new Event('input'));
    saveDossier();
    const sent = api.saveDossier.calls.mostRecent().args[1] as { educationalNeeds: Record<string, unknown> };
    expect(sent.educationalNeeds['category']).toBe('Categoria ativa');
    expect(sent.educationalNeeds['extra']).toBe('preservado');
    expect(Object.hasOwn(sent.educationalNeeds, 'categoryId')).toBeFalse();
  });

  it('envia null somente após remoção intencional e limpa texto de categoria', () => {
    start({ ...baseDossier, educationalNeeds: { categoryId: 91, category: 'Histórica', extra: 'manter' } });
    view('dossier'); changeSelect('[data-testid="need-category"]', ''); saveDossier();
    expect(api.saveDossier).toHaveBeenCalledWith(1, jasmine.objectContaining({ educationalNeeds:
      jasmine.objectContaining({ categoryId: null, category: '', extra: 'manter' }) }));
  });

  it('omite ID nulo já presente no legado para não remover seu texto ao salvar notas', () => {
    start({ ...baseDossier, educationalNeeds: { categoryId: null, category: 'Legado sem associação', extra: 'conservar' } });
    const dom = view('dossier');
    const notes = dom.querySelector<HTMLTextAreaElement>('#dossier-identification .details-content > label > textarea')!;
    notes.value = 'Nota pedagógica revisada';
    notes.dispatchEvent(new Event('input'));
    saveDossier();
    const sent = api.saveDossier.calls.mostRecent().args[1] as { educationalNeeds: Record<string, unknown> };
    expect(sent.educationalNeeds['category']).toBe('Legado sem associação');
    expect(sent.educationalNeeds['extra']).toBe('conservar');
    expect(Object.hasOwn(sent.educationalNeeds, 'categoryId')).toBeFalse();
  });

  it('separa catálogo vazio de falha e preserva dossiê e PEIs já carregados', () => {
    api.references.and.returnValue(of([])); api.peis.and.returnValue(of([pei]));
    start({ ...baseDossier, educationalNeeds: { category: 'Legado legível' } });
    const dossier = view('dossier');
    expect(dossier.querySelector('[data-testid="category-catalog-empty"]')).not.toBeNull();
    expect(dossier.textContent).toContain('Legado legível');
    expect(dossier.querySelector('[data-testid="category-catalog-error"]')).toBeNull();
    const dom = view('pei');
    expect(dom.querySelector('app-searchable-select[formControlName="offeringId"]')).toBeNull();
    expect(dom.querySelector('.pei-row')?.textContent).toContain('2026.1');
    expect(fixture.componentInstance.loadError()).toBe('');
  });

  it('falha do catálogo não apaga campos e nova tentativa conserva a digitação', () => {
    api.references.and.returnValue(throwError(() => ({ status: 500 })));
    start({ ...baseDossier, educationalNeeds: { categoryId: 91, category: 'Histórica' } });
    const dom = view('dossier');
    expect(dom.querySelector('[data-testid="category-catalog-error"]')).not.toBeNull();
    const select = dom.querySelector<HTMLSelectElement>('[data-testid="need-category"]');
    expect(select?.matches(':disabled')).toBeTrue();
    const notes = dom.querySelector<HTMLTextAreaElement>('#dossier-educationalNeeds .details-content > label > textarea')!;
    notes.value = 'Não perder na nova tentativa'; notes.dispatchEvent(new Event('input'));
    api.references.and.returnValue(of([{ id: 11, code: 'CAT', label: 'Categoria ativa' }]));
    dom.querySelector<HTMLButtonElement>('[data-testid="category-catalog-retry"]')?.click(); fixture.detectChanges();
    expect(dom.querySelector('[data-testid="category-catalog-error"]')).toBeNull();
    expect(notes.value).toBe('Não perder na nova tentativa'); expect(select?.value).toBe('91');
    expect(fixture.componentInstance.loadError()).toBe('');
  });

  it('bloqueia campos do dossiê durante envio e preserva mudanças ao falhar', () => {
    const pending = new Subject<Dossier>(); api.saveDossier.and.returnValue(pending);
    start(); const dom = view('dossier');
    changeSelect('[data-testid="need-category"]', '11');
    const notes = dom.querySelector<HTMLTextAreaElement>('#dossier-educationalNeeds .details-content > label > textarea')!;
    notes.value = 'Texto protegido'; notes.dispatchEvent(new Event('input')); saveDossier();
    expect(notes.matches(':disabled')).toBeTrue();
    expect(dom.querySelector<HTMLSelectElement>('[data-testid="need-category"]')?.matches(':disabled')).toBeTrue();
    pending.error({ status: 409 }); fixture.detectChanges();
    expect(notes.matches(':disabled')).toBeFalse(); expect(notes.value).toBe('Texto protegido');
    expect(dom.querySelector<HTMLSelectElement>('[data-testid="need-category"]')?.value).toBe('11');
  });

  it('cria PEI pela oferta selecionada e mostra o período registrado dos planos antigos', () => {
    setSession(['TEACHER']);
    academic.peiOffers.and.returnValue(of([{ ...offer, groupCode: 'A-01' }, { ...offer, id: 23, groupCode: 'Turma B' }]));
    api.createPei.and.returnValue(of({ ...pei, id: 'novo-pei' }));
    api.peis.and.returnValue(of([{ ...pei, academicTermLabel: 'Período registrado' }, { ...pei, id: 'legado', academicTerm: '2025.2' }]));
    start(); const dom = view('pei');
    const term = dom.querySelector<HTMLElement>('app-searchable-select[formControlName="offeringId"]')!;
    term.querySelector('button')!.click(); fixture.detectChanges();
    const search = term.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = '2026.1 a-01';
    search.dispatchEvent(new Event('input')); fixture.detectChanges();
    const options = term.querySelectorAll<HTMLElement>('[role="option"]');
    expect(options).toHaveSize(1);
    expect(fixture.componentInstance.peiForm.controls.offeringId.value).toBe('');
    options[0].click(); fixture.detectChanges();
    expect(dom.querySelector<HTMLInputElement>('.create-panel input[readonly]')?.value).toBe('Docente fictício');
    expect(dom.querySelector('select[formControlName="teacherId"]')).toBeNull();
    expect(term?.textContent).toContain('Primeiro semestre de 2026');
    dom.querySelector<HTMLButtonElement>('.create-panel button[type="submit"]')?.click(); fixture.detectChanges();
    expect(api.createPei.calls.mostRecent().args[0]).toBe(1);
    expect(api.createPei.calls.mostRecent().args[1] as unknown).toEqual({ offeringId: 22 });
    expect(dom.textContent).toContain('Período registrado'); expect(dom.textContent).toContain('2025.2');
  });

  it('abre o editor do rascunho criado com o ID da resposta e impede criação concorrente', async () => {
    setSession(['TEACHER']);
    const pending = new Subject<Pei>();
    api.createPei.and.returnValue(pending);
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    start();
    const page = fixture.componentInstance;
    page.createPei();
    page.createPei();
    expect(api.createPei).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    pending.next({ ...pei, id: 'rascunho-novo' });
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledOnceWith(['/estudantes', 1, 'pei', 'rascunho-novo']);
    expect(page.peis().some(item => item.id === 'rascunho-novo')).toBeTrue();
  });

  it('mantém o rascunho acessível se a navegação for recusada', async () => {
    setSession(['TEACHER']);
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(false);
    api.createPei.and.returnValue(of({ ...pei, id: 'rascunho-recuperavel' }));
    start();
    fixture.componentInstance.createPei();
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledOnceWith(['/estudantes', 1, 'pei', 'rascunho-recuperavel']);
    expect(fixture.componentInstance.actionBusy()).toBeFalse();
    expect(fixture.componentInstance.peis()[0].id).toBe('rascunho-recuperavel');
    expect(fixture.componentInstance.peiOffers()).toEqual([]);
    expect(fixture.componentInstance.peiForm.controls.offeringId.value).toBe('');
  });

  it('preserva o acompanhamento em elaboração quando cria o rascunho do PEI', () => {
    setSession(['TEACHER']);
    const navigate = spyOn(TestBed.inject(Router), 'navigate');
    api.createPei.and.returnValue(of({ ...pei, id: 'rascunho-sem-redirecionamento' }));
    start();
    const component = fixture.componentInstance;
    component.recordForm.controls.title.setValue('Texto não salvo');
    component.recordForm.controls.title.markAsDirty();
    component.createPei();
    expect(navigate).not.toHaveBeenCalled();
    expect(component.recordForm.controls.title.value).toBe('Texto não salvo');
    expect(component.peis()[0].id).toBe('rascunho-sem-redirecionamento');
  });

  it('seleciona o tipo único de acompanhamento e apresenta PEIs como consulta para tutoria', () => {
    setSession(['TUTOR']);
    start();
    expect(fixture.componentInstance.recordForm.controls.type.value).toBe('TUTOR_OBSERVATION');
    expect(view('records').querySelector('select[formControlName="type"] option[value=""]')).toBeNull();
    expect(view('pei').textContent).toContain('A disponibilidade de PEIs segue as permissões');
    expect(view('pei').textContent).not.toContain('Crie um rascunho');
  });

  it('bloqueia campos do novo PEI durante envio e conserva seleção após erro', () => {
    setSession(['TEACHER']);
    const pending = new Subject<Pei>(); api.createPei.and.returnValue(pending);
    start(); const dom = view('pei');
    expect(fixture.componentInstance.peiForm.controls.offeringId.value).toBe('22');
    dom.querySelector<HTMLButtonElement>('.create-panel button[type="submit"]')?.click(); fixture.detectChanges();
    const term = dom.querySelector<HTMLButtonElement>('app-searchable-select[formControlName="offeringId"] button');
    expect(term?.matches(':disabled')).toBeTrue();
    pending.error({ status: 400 }); fixture.detectChanges();
    expect(term?.matches(':disabled')).toBeFalse();
    expect(fixture.componentInstance.peiForm.controls.offeringId.value).toBe('22');
  });

  it('falha das ofertas bloqueia criação e mantém planos históricos acessíveis', () => {
    setSession(['TEACHER']);
    academic.peiOffers.and.returnValue(throwError(() => ({ status: 500 })));
    api.peis.and.returnValue(of([pei])); start(); const dom = view('pei');
    expect(dom.querySelector('[data-testid="offer-error"]')).not.toBeNull();
    expect(dom.querySelector('.pei-row a')).not.toBeNull();
    fixture.componentInstance.peiForm.patchValue({ offeringId: '22' });
    fixture.componentInstance.createPei();
    expect(api.createPei).not.toHaveBeenCalled();
  });

  it('não oferece criação de PEI ao NAPNE, mas mantém a consulta aos existentes', () => {
    api.peis.and.returnValue(of([pei])); start(); const dom = view('pei');
    expect(dom.querySelector('app-searchable-select[formControlName="offeringId"]')).toBeNull();
    expect(dom.querySelector('.pei-row a')).not.toBeNull();
  });

  it('não oferece criação ao docente sem vínculo ativo no componente', () => {
    setSession(['TEACHER']);
    academic.peiOffers.and.returnValue(of([]));
    start(); const dom = view('pei');
    expect(dom.querySelector('app-searchable-select[formControlName="offeringId"]')).toBeNull();
    expect(dom.textContent).toContain('Nenhuma oferta com matrícula e atribuição docente válidas');
  });

  it('não busca categorias nem recompõe dados restritos para perfil pedagógico', () => {
    sessionStorage.setItem('napne360.session', JSON.stringify({ token: 'test', id: 2,
      name: 'Docente', email: 'teacher@test.local', roles: ['TEACHER'], campusId: 1 }));
    start({ ...baseDossier, redacted: true });
    const dom = view('dossier');
    expect(api.references).not.toHaveBeenCalledWith('NEED_CATEGORY');
    expect(dom.querySelector('[data-testid="need-category"]')).toBeNull();
    saveDossier(); expect(api.saveDossier).not.toHaveBeenCalled();
  });
});
