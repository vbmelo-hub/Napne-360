import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { StudentDetailComponent } from './student-detail.component';

describe('Casos no acompanhamento do estudante', () => {
  const studentUrl = '/api/v1/students/1';
  const caseUrl = '/api/v1/cases/50';
  const currentCase = {
    id: 50, studentId: 1, stage: 'RECEIVED', source: 'Encaminhamento fictício',
    openedAt: '2026-11-17T12:00:00Z', closedAt: null, responsible: 'Pessoa inicial',
    responsibleId: 2, summary: 'Resumo fictício', version: 0
  };
  const otherCase = {
    ...currentCase, id: 51, source: 'Segundo caso fictício', responsible: 'Outro responsável',
    stage: 'ARCHIVED', closedAt: '2026-11-18T12:00:00Z'
  };
  let fixture: ComponentFixture<StudentDetailComponent>;
  let http: HttpTestingController;

  function setup(role = 'NAPNE') {
    sessionStorage.setItem('napne360.session', JSON.stringify({
      token: 'token', id: 2, name: 'Pessoa inicial', email: 'napne@example.test',
      campusId: 1, roles: [role]
    }));
    fixture = TestBed.createComponent(StudentDetailComponent);
    fixture.detectChanges();
    http.expectOne(studentUrl).flush({
      id: 1, registration: '2026001', displayName: 'Estudante fictício',
      course: 'Curso fictício', campus: 'Campus fictício', status: 'ACTIVE',
      civilName: null, socialName: null, birthDate: null, institutionalEmail: null,
      phone: null, campusId: 1, courseId: 5, version: 0
    });
    http.expectOne(studentUrl + '/dossier').flush({
      studentId: 1, identification: {}, educationalNeeds: {}, healthAndSupport: {},
      familyContext: {}, schoolHistory: {}, strengths: {}, difficulties: {},
      initialInterventions: {}, version: 0, redacted: role !== 'NAPNE'
    });
    http.expectOne(studentUrl + '/cases').flush(role === 'NAPNE' ? [currentCase, otherCase] : []);
    for (const resource of ['records', 'peis', 'attachments']) {
      http.expectOne(studentUrl + '/' + resource).flush([]);
    }
    http.expectOne(studentUrl + '/timeline?limit=100').flush([]);
    http.expectOne('/api/v1/catalog/student-subjects?studentId=1').flush([]);
    http.expectOne('/api/v1/catalog/student-teachers?studentId=1').flush([]);
    if (role === 'NAPNE') {
      http.expectOne('/api/v1/catalog/references?kind=NEED_CATEGORY').flush([]);
      http.expectOne('/api/v1/catalog/references?kind=ACADEMIC_TERM').flush([]);
      http.expectOne('/api/v1/catalog/courses').flush([]);
    }
    fixture.detectChanges();
  }

  function button(scope: HTMLElement, name: string) {
    const match = Array.from(scope.querySelectorAll('button')).find(item => item.textContent?.trim() === name);
    if (!match) throw new Error(`A interface não disponibilizou o botão «${name}».`);
    return match;
  }

  function click(scope: HTMLElement, name: string) {
    button(scope, name).click();
    fixture.detectChanges();
  }

  function field<T extends HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    scope: HTMLElement, selector: string, value: string
  ) {
    const control = scope.querySelector<T>(selector);
    if (!control) throw new Error(`A interface não disponibilizou o campo ${selector}.`);
    control.value = value;
    control.dispatchEvent(new Event(control.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    fixture.detectChanges();
    return control;
  }

  function openCases() {
    click(fixture.nativeElement, 'Casos');
    return [...fixture.nativeElement.querySelectorAll('.case-card')] as HTMLElement[];
  }

  function openTransfer(card: HTMLElement) {
    click(card, 'Transferir responsabilidade');
    const candidates = http.expectOne(caseUrl + '/responsible-candidates');
    expect(candidates.request.method).toBe('GET');
    candidates.flush([{ id: 2, name: 'Pessoa inicial' }, { id: 7, name: 'Pessoa elegível' }]);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [StudentDetailComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: '1' }) } } }
      ]
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
  });

  it('envia a versão zero ao mudar de etapa e bloqueia novos envios durante a requisição', () => {
    setup();
    const [card] = openCases();
    const stage = field<HTMLSelectElement>(card, 'select', 'SCREENING');
    click(card, 'Registrar etapa');
    const confirmation = fixture.nativeElement.querySelector('[role="alertdialog"]') as HTMLElement;
    click(confirmation, 'Registrar etapa');
    const patch = http.expectOne(caseUrl + '/stage');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ stage: 'SCREENING', summary: 'Resumo fictício', version: 0 });
    expect(stage.matches(':disabled')).toBeTrue();
    expect(button(card, 'Registrar etapa').matches(':disabled')).toBeTrue();
    patch.flush({ ...currentCase, stage: 'SCREENING', version: 1 });
    http.expectOne(studentUrl + '/timeline?limit=100').flush([]);
    fixture.detectChanges();
    expect(card.textContent).toContain('Versão 1');
  });

  it('transfere com candidatos sob demanda e aplica resposta atrasada apenas ao caso de origem', () => {
    setup();
    const [card, sibling] = openCases();
    openTransfer(card);
    const candidate = field<HTMLSelectElement>(card, 'select[name="responsibleId"]', '7');
    const reason = field<HTMLTextAreaElement>(card, 'textarea', 'Redistribuição de trabalho');
    click(card, 'Confirmar transferência');
    const patch = http.expectOne(caseUrl + '/responsible');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ responsibleId: 7, version: 0, reason: 'Redistribuição de trabalho' });
    expect(candidate.matches(':disabled')).toBeTrue();
    expect(reason.matches(':disabled')).toBeTrue();
    click(card, 'Confirmar transferência');
    http.expectNone(caseUrl + '/responsible');
    click(fixture.nativeElement, 'Acompanhamento');
    const title = field<HTMLInputElement>(fixture.nativeElement, 'input[formControlName="title"]', 'Rascunho independente');
    patch.flush({ ...currentCase, responsible: 'Pessoa elegível', responsibleId: 7, version: 1 });
    http.expectOne(studentUrl + '/timeline?limit=100').flush([]);
    fixture.detectChanges();
    expect(title.value).toBe('Rascunho independente');
    openCases();
    expect(card.textContent).toContain('Pessoa elegível');
    expect(card.textContent).toContain('Versão 1');
    expect(sibling.textContent).toContain('Outro responsável');
  });

  it('preserva o rascunho após erro e conflito, sincronizando só o caso mediante ação explícita', () => {
    setup();
    const [card] = openCases();
    openTransfer(card);
    const candidate = field<HTMLSelectElement>(card, 'select[name="responsibleId"]', '7');
    const reason = field<HTMLTextAreaElement>(card, 'textarea', 'Motivo preservado');
    click(card, 'Confirmar transferência');
    http.expectOne(caseUrl + '/responsible').flush(null, { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    expect(candidate.value).toBe('7');
    expect(reason.value).toBe('Motivo preservado');
    expect(candidate.matches(':disabled')).toBeFalse();

    click(card, 'Confirmar transferência');
    http.expectOne(caseUrl + '/responsible').flush(null, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(card.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(candidate.value).toBe('7');
    expect(reason.value).toBe('Motivo preservado');
    expect(button(card, 'Confirmar transferência').matches(':disabled')).toBeTrue();
    http.expectNone(caseUrl);
    click(card, 'Sincronizar caso');
    const sync = http.expectOne(caseUrl);
    expect(sync.request.method).toBe('GET');
    sync.flush({ ...currentCase, stage: 'SCREENING', version: 2 });
    fixture.detectChanges();
    expect(candidate.value).toBe('7');
    expect(reason.value).toBe('Motivo preservado');
    expect(card.textContent).toContain('Versão 2');
    http.expectNone(caseUrl + '/responsible');
    http.expectNone(studentUrl + '/cases');
    click(card, 'Confirmar transferência');
    const retry = http.expectOne(caseUrl + '/responsible');
    expect(retry.request.body).toEqual({ responsibleId: 7, version: 2, reason: 'Motivo preservado' });
    retry.flush({ ...currentCase, stage: 'SCREENING', version: 3, responsibleId: 7, responsible: 'Pessoa elegível' });
    http.expectOne(studentUrl + '/timeline?limit=100').flush([]);
  });

  it('mantém o filtro da linha do tempo quando uma atualização de caso chega atrasada', () => {
    setup();
    const [card] = openCases();
    field<HTMLSelectElement>(card, 'select', 'SCREENING');
    click(card, 'Registrar etapa');
    click(fixture.nativeElement.querySelector('[role="alertdialog"]'), 'Registrar etapa');
    http.expectOne(caseUrl + '/stage').flush({ ...currentCase, stage: 'SCREENING', version: 1 });
    const refresh = http.expectOne(studentUrl + '/timeline?limit=100');

    click(fixture.nativeElement, 'Linha do tempo');
    field<HTMLSelectElement>(fixture.nativeElement, '.section-header select', 'DOSSIER');
    const event = { id: '1', actor: 'Pessoa inicial', createdAt: '2026-11-17T12:00:00Z' };
    http.expectOne(studentUrl + '/timeline?limit=100&type=DOSSIER').flush([
      { ...event, eventType: 'DOSSIER_UPDATED', title: 'Edição do dossiê' }
    ]);
    refresh.flush([{ ...event, eventType: 'CASE_STAGE_CHANGED', title: 'Mudança de caso' }]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.timeline').textContent).toContain('Edição do dossiê');
    expect(fixture.nativeElement.querySelector('.timeline').textContent).not.toContain('Mudança de caso');
  });

  it('permite repetir a consulta de candidatos e impede escolher o próprio responsável', () => {
    setup();
    const [card] = openCases();
    click(card, 'Transferir responsabilidade');
    http.expectOne(caseUrl + '/responsible-candidates').flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(card.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    click(card, 'Tentar novamente');
    http.expectOne(caseUrl + '/responsible-candidates').flush([{ id: 2, name: 'Pessoa inicial' }]);
    fixture.detectChanges();
    expect(card.textContent).toContain('Nenhum outro responsável elegível');
    expect(card.querySelector<HTMLOptionElement>('option[value="2"]')?.disabled).toBeTrue();
    expect(button(card, 'Confirmar transferência').disabled).toBeTrue();
  });

  for (const role of ['ADMIN', 'TUTOR']) {
    it(`mantém ações de caso fora do acesso de ${role}`, () => {
      setup(role);
      const root = fixture.nativeElement as HTMLElement;
      expect(Array.from(root.querySelectorAll('nav button')).some(item => item.textContent?.trim() === 'Casos')).toBeFalse();
      expect(root.querySelector('app-case-card')).toBeNull();
      http.expectNone(request => request.url.startsWith('/api/v1/cases/'));
    });
  }

  it('pagina o histórico de um caso arquivado sem oferecer transferência', () => {
    setup();
    const [, card] = openCases();
    expect(card.textContent).not.toContain('Transferir responsabilidade');
    const path = '/api/v1/cases/51/history';
    click(card, 'Consultar histórico');
    const first = http.expectOne(path + '?page=0&size=20');
    first.flush(null, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(card.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    click(card, 'Tentar novamente');
    const row = {
      id: 21, caseId: 51, version: 20, type: 'RESPONSIBLE_CHANGED',
      fromStage: 'RECEIVED', toStage: 'RECEIVED', fromResponsibleId: 2,
      fromResponsible: 'Nome anterior registrado', toResponsibleId: 5,
      toResponsible: 'Nome novo registrado', actorId: 2, actor: 'Autor registrado',
      occurredAt: '2026-11-17T12:00:00Z', reason: 'Motivo registrado'
    };
    http.expectOne(path + '?page=0&size=20').flush({
      content: [row], totalElements: 21, totalPages: 2, number: 0, size: 20
    });
    fixture.detectChanges();
    expect(card.textContent).toContain('Nome anterior registrado');
    expect(card.textContent).toContain('Nome novo registrado');
    expect(card.textContent).toContain('Autor registrado');
    expect(card.textContent).toContain('Motivo registrado');
    click(card, 'Próxima');
    http.expectOne(path + '?page=1&size=20').flush({
      content: [{
        ...row, id: 1, version: 0, type: 'OPENED', fromStage: null,
        fromResponsibleId: null, fromResponsible: null, toResponsibleId: 2,
        toResponsible: 'Pessoa que abriu', reason: null
      }],
      totalElements: 21, totalPages: 2, number: 1, size: 20
    });
    fixture.detectChanges();
    expect(card.textContent).toContain('Pessoa que abriu');
    expect(button(card, 'Próxima').disabled).toBeTrue();
    expect(button(card, 'Anterior').disabled).toBeFalse();
  });
});
