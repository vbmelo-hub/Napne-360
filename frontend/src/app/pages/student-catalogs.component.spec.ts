import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { StudentDetailComponent } from './student-detail.component';
import { ApiService } from '../core/api.service';
import { Dossier, Pei, StudentDetails } from '../core/models';
import { ToastService } from '../core/toast.service';

describe('StudentDetailComponent — catálogos e referências históricas', () => {
  let fixture: ComponentFixture<StudentDetailComponent>;
  let api: jasmine.SpyObj<ApiService>;
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
      'student', 'dossier', 'cases', 'records', 'peis', 'timeline', 'attachments',
      'studentSubjects', 'studentTeachers', 'courses', 'references', 'saveDossier', 'createPei'
    ]);
    api.student.and.returnValue(of(student));
    api.dossier.and.returnValue(of(baseDossier));
    api.cases.and.returnValue(of([])); api.records.and.returnValue(of([])); api.peis.and.returnValue(of([]));
    api.timeline.and.returnValue(of([])); api.attachments.and.returnValue(of([])); api.courses.and.returnValue(of([]));
    api.studentSubjects.and.returnValue(of([{ id: 100, name: 'Componente', code: 'COMP', workloadHours: 60, courseId: 10 }]));
    api.studentTeachers.and.returnValue(of([{ id: 2, name: 'Docente fictício', subjectId: 100 }]));
    api.references.and.callFake(kind => of(kind === 'NEED_CATEGORY'
      ? [{ id: 11, code: 'CAT', label: 'Categoria ativa' }]
      : [{ id: 21, code: '2026.1', label: 'Primeiro semestre de 2026' }]));
    api.saveDossier.and.returnValue(of(baseDossier)); api.createPei.and.returnValue(of(pei));
    await TestBed.configureTestingModule({
      imports: [StudentDetailComponent], providers: [provideHttpClient(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => '1' } } } },
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['show']) }]
    }).compileComponents();
  });

  afterEach(() => sessionStorage.clear());

  function start(dossier = baseDossier) {
    api.dossier.and.returnValue(of(dossier));
    fixture = TestBed.createComponent(StudentDetailComponent);
    fixture.detectChanges();
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
    const dossier = { ...baseDossier, educationalNeeds: { categoryId: 91, category: 'Categoria histórica', notes: 'Conservar' } };
    api.saveDossier.and.returnValue(of(dossier));
    start(dossier);
    const dom = view('dossier');
    const select = dom.querySelector<HTMLSelectElement>('[data-testid="need-category"]');
    expect(select?.value).toBe('91'); expect(select?.textContent).toContain('Categoria histórica');
    saveDossier();
    expect(api.saveDossier).toHaveBeenCalledWith(1, jasmine.objectContaining({ educationalNeeds:
      jasmine.objectContaining({ categoryId: 91, category: 'Categoria histórica', notes: 'Conservar' }) }));
    const periods = view('pei').querySelector<HTMLSelectElement>('select[formControlName="academicTermId"]');
    expect(periods).not.toBeNull(); expect(periods?.textContent).not.toContain('Categoria histórica');
    expect(periods?.querySelector('option[value="91"]')).toBeNull();
  });

  it('mostra o snapshot anterior mesmo se o mesmo ID ativo foi renomeado', () => {
    start({ ...baseDossier, educationalNeeds: { categoryId: 11, category: 'Nome registrado antes' } });
    const select = view('dossier').querySelector<HTMLSelectElement>('[data-testid="need-category"]');
    expect(select?.selectedOptions[0]?.textContent).toContain('Nome registrado antes');
    saveDossier();
    expect(api.saveDossier).toHaveBeenCalledWith(1, jasmine.objectContaining({ educationalNeeds:
      jasmine.objectContaining({ categoryId: 11, category: 'Nome registrado antes' }) }));
  });

  it('preserva texto legado sem ID e não o converte por semelhança com rótulo ativo', () => {
    start({ ...baseDossier, educationalNeeds: { category: 'Categoria ativa', extra: 'preservado' } });
    const dom = view('dossier');
    expect(dom.textContent).toContain('Categoria ativa');
    expect(dom.querySelector<HTMLSelectElement>('[data-testid="need-category"]')?.value).not.toBe('11');
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
    view('dossier'); saveDossier();
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
    expect(dom.querySelector('[data-testid="term-catalog-empty"]')).not.toBeNull();
    expect(dom.querySelector<HTMLButtonElement>('.create-panel button[type="submit"]')?.disabled).toBeTrue();
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

  it('cria PEI com ID numérico e mostra nome snapshot com fallback dos antigos', () => {
    api.createPei.and.returnValue(of({ ...pei, id: 'novo-pei' }));
    api.peis.and.returnValue(of([{ ...pei, academicTermLabel: 'Período registrado' }, { ...pei, id: 'legado', academicTerm: '2025.2' }]));
    start(); const dom = view('pei');
    changeSelect('select[formControlName="subjectId"]', '100');
    const term = changeSelect('select[formControlName="academicTermId"]', '21');
    changeSelect('select[formControlName="teacherId"]', '2');
    expect(term?.textContent).toContain('Primeiro semestre de 2026');
    dom.querySelector<HTMLButtonElement>('.create-panel button[type="submit"]')?.click(); fixture.detectChanges();
    expect(api.createPei).toHaveBeenCalledWith(1, { subjectId: 100, teacherId: 2, academicTermId: 21 });
    expect(dom.textContent).toContain('Período registrado'); expect(dom.textContent).toContain('2025.2');
  });

  it('bloqueia campos do novo PEI durante envio e conserva seleção após erro', () => {
    const pending = new Subject<Pei>(); api.createPei.and.returnValue(pending);
    start(); const dom = view('pei');
    changeSelect('select[formControlName="subjectId"]', '100');
    changeSelect('select[formControlName="academicTermId"]', '21'); changeSelect('select[formControlName="teacherId"]', '2');
    dom.querySelector<HTMLButtonElement>('.create-panel button[type="submit"]')?.click(); fixture.detectChanges();
    const term = dom.querySelector<HTMLSelectElement>('select[formControlName="academicTermId"]');
    expect(term?.matches(':disabled')).toBeTrue();
    pending.error({ status: 400 }); fixture.detectChanges();
    expect(term?.matches(':disabled')).toBeFalse(); expect(term?.value).toBe('21');
  });

  it('falha do período bloqueia criação e mantém planos históricos acessíveis', () => {
    api.references.and.callFake(kind => kind === 'ACADEMIC_TERM' ? throwError(() => ({ status: 500 })) : of([]));
    api.peis.and.returnValue(of([pei])); start(); const dom = view('pei');
    expect(dom.querySelector('[data-testid="term-catalog-error"]')).not.toBeNull();
    expect(dom.querySelector('[data-testid="term-catalog-empty"]')).toBeNull();
    expect(dom.querySelector('.pei-row a')).not.toBeNull();
    fixture.componentInstance.peiForm.patchValue({ subjectId: '100', teacherId: '2' });
    fixture.componentInstance.createPei();
    expect(api.createPei).not.toHaveBeenCalled();
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
