import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router, type ParamMap } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Pei } from '../core/models';
import { ToastService } from '../core/toast.service';
import { PeiEditorComponent } from './pei-editor.component';

describe('PeiEditorComponent — ações D04', () => {
  let fixture: ComponentFixture<PeiEditorComponent>;
  let api: jasmine.SpyObj<ApiService>;
  let routeParams: BehaviorSubject<ParamMap>;
  const draft = {
    id: 'pei-1', studentId: 1, subjectId: 100, teacherId: 2, academicTerm: '2026.1',
    revision: 2, status: 'DRAFT', content: { generalObjectives: 'Objetivo atual' },
    reviewedBy: null, reviewedAt: null, updatedAt: '2026-11-24T12:00:00Z',
    storageVersion: 7, allowedActions: ['EDIT', 'SUBMIT']
  } as Pei;

  beforeEach(async () => {
    sessionStorage.setItem('napne360.session', JSON.stringify({ token: 'test', id: 2,
      name: 'Docente fictício', email: 'docente@test.local', roles: ['TEACHER'], campusId: 1 }));
    api = jasmine.createSpyObj<ApiService>('ApiService', ['pei', 'revisePei', 'peiAction']);
    api.pei.and.returnValue(of(draft));
    api.revisePei.and.returnValue(of({ ...draft, id: 'pei-2', revision: 3 }));
    api.peiAction.and.returnValue(of({ ...draft, status: 'IN_REVIEW' }));
    routeParams = new BehaviorSubject(convertToParamMap({ studentId: '1', peiId: 'pei-1' }));
    await TestBed.configureTestingModule({
      imports: [PeiEditorComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: {
          snapshot: { paramMap: routeParams.value },
          paramMap: routeParams
        } },
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['show']) }]
    }).compileComponents();
  });

  afterEach(() => sessionStorage.clear());

  function open(value: Pei = draft) {
    api.pei.and.returnValue(of(value));
    fixture = TestBed.createComponent(PeiEditorComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function jumpToSection(dom: HTMLElement, sectionId: string) {
    const link = Array.from(dom.querySelectorAll<HTMLAnchorElement>('.editor-nav a')).find(item => item.hash === `#${sectionId}`)!;
    const section = dom.querySelector<HTMLElement>(`#${sectionId}`)!;
    const scroll = spyOn(section, 'scrollIntoView');
    let navigationPrevented = false;
    dom.addEventListener('click', event => {
      navigationPrevented = event.defaultPrevented;
      event.preventDefault();
    }, { once: true });
    const before = window.location.href;
    link.click();
    expect(navigationPrevented).toBeTrue();
    expect(new URL(link.href).pathname).toBe(window.location.pathname);
    expect(window.location.href).toBe(before);
    expect(scroll).toHaveBeenCalled();
    expect(document.activeElement).toBe(section.querySelector('h2, h3'));
  }

  it('salva DRAFT por ação EDIT com content e storageVersion, e exige envio explícito', () => {
    const dom = open();
    const objective = dom.querySelector<HTMLTextAreaElement>('[formControlName="generalObjectives"]')!;
    expect(objective.disabled).toBeFalse();
    expect(dom.textContent).toContain('Salvar rascunho');
    expect(dom.textContent).toContain('Enviar para revisão');

    fixture.componentInstance.form.controls.generalObjectives.setValue('Objetivo revisado');
    fixture.componentInstance.save();
    expect(api.revisePei).toHaveBeenCalledWith(1, 'pei-1', jasmine.objectContaining({
      version: 7, content: jasmine.objectContaining({ generalObjectives: 'Objetivo revisado' })
    }));
    expect(api.revisePei.calls.mostRecent().args[2]).not.toEqual(jasmine.objectContaining({ status: 'IN_REVIEW' }));
  });

  it('permite salvar edição parcial sem objetivo geral e mantém o requisito visual de aprovação', () => {
    const dom = open();
    fixture.componentInstance.form.controls.generalObjectives.setValue('');
    fixture.componentInstance.save();
    expect(api.revisePei).toHaveBeenCalledWith(1, 'pei-1', jasmine.objectContaining({
      version: 7, content: jasmine.objectContaining({ generalObjectives: '' })
    }));
    expect(dom.querySelector('label.required')?.textContent).toContain('necessário para aprovação');
  });

  it('preserva a edição iniciada durante a navegação para a revisão recém-salva', () => {
    spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    open();
    const component = fixture.componentInstance;
    const saved = { ...draft, id: 'pei-2', revision: 3 };
    const laterResponse = new Subject<Pei>();
    api.revisePei.and.returnValue(of(saved));
    api.pei.and.returnValue(laterResponse);

    component.save();
    routeParams.next(convertToParamMap({ studentId: '1', peiId: 'pei-2' }));
    const objective = component.form.controls.generalObjectives;
    objective.setValue('Objetivo digitado após salvar');
    objective.markAsDirty();
    laterResponse.next(saved);

    expect(objective.value).toBe('Objetivo digitado após salvar');
    expect(objective.dirty).toBeTrue();
    expect(api.pei.calls.count()).toBe(1);
  });

  it('deixa estados sem EDIT somente para consulta e exibe as ações permitidas ao NAPNE', () => {
    const review = { ...draft, status: 'IN_REVIEW', allowedActions: ['RETURN', 'APPROVE'] } as Pei;
    const dom = open(review);
    expect(dom.querySelector('[formControlName="generalObjectives"]')?.matches(':disabled')).toBeTrue();
    expect(dom.textContent).not.toContain('Salvar rascunho');
    expect(dom.textContent).toContain('Devolver para ajustes');
    expect(dom.textContent).toContain('Aprovar PEI');
    expect(dom.textContent).not.toContain('Arquivar PEI');
    expect(dom.textContent).not.toContain('Transferir rascunho');
    expect(dom.querySelector('.pei-header')?.textContent).toContain('Em revisão');
  });

  it('preserva rascunho editado e o informa quando a gravação conflita', () => {
    api.revisePei.and.returnValue(throwError(() => ({ status: 409 })));
    const dom = open();
    const objective = dom.querySelector<HTMLTextAreaElement>('[formControlName="generalObjectives"]')!;
    objective.value = 'Rascunho local após conflito';
    objective.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.componentInstance.save();
    fixture.detectChanges();
    expect(fixture.componentInstance.form.controls.generalObjectives.value).toBe('Rascunho local após conflito');
    expect(fixture.componentInstance.form.dirty).toBeTrue();
    expect(dom.querySelector('[role="alert"]')?.textContent).toContain('rascunho continua no formulário');
  });

  it('navega pelo índice legado sem sair do editor ou perder o rascunho', () => {
    const dom = open();
    const objective = dom.querySelector<HTMLTextAreaElement>('[formControlName="generalObjectives"]')!;
    objective.value = 'Alteração local legada';
    objective.dispatchEvent(new Event('input', { bubbles: true }));
    jumpToSection(dom, 'objectives');
    expect(objective.value).toBe('Alteração local legada');
    expect(fixture.componentInstance.form.dirty).toBeTrue();
  });

  describe('formulário oficial do Anexo I', () => {
    const peiUrl = '/api/v1/students/1/peis/pei-1';
    const modelUrl = '/api/v1/pei/anexo-i';
    const official = {
      ...draft, formVersion: 'IFAC_76_2025', content: {
        student: 'Estudante fictício', course: 'Curso fictício', subject: 'Componente fictício', workloadHours: 40,
        teacherName: 'Docente fictício', generalObjectives: 'Objetivo atual', specificObjectives: ['Primeiro'],
        contents: [{ description: 'Conteúdo mantido', workloadHours: 12, priority: true }],
        assessmentInstruments: [{ description: 'Atividade oral', justification: 'Expressão oral' }],
        basicBibliography: [{ title: 'Obra A', author: 'Autora A', edition: '1', location: 'Rio Branco', publisher: 'Editora A', year: '2020', lt: 'Sim' }],
        complementaryBibliography: [], skillsInventory: { oralCommunication1: 'REALIZA_COM_AJUDA', digitalTechnologies4: 'NAO_OBSERVADO' },
        observations: '', location: '', documentDate: ''
      }
    };
    const model = {
      version: 'IFAC_76_2025', title: 'Plano de Ensino Individualizado - PEI',
      labels: {
        annex: 'ANEXO I', course: 'CURSO:', subject: 'COMPONENTE CURRICULAR:', teacherName: 'PROFESSOR(ES):',
        student: 'ALUNO(A):', academicTerm: 'PERÍODO LETIVO:', workloadHours: 'CARGA HORÁRIA:', objectives: 'OBJETIVOS',
        generalObjectives: 'Objetivos Gerais:', specificObjectives: 'Objetivos Específicos:', eliminatedObjectives: 'Objetivos Gerais Eliminados:',
        alternativeObjectives: 'Objetivos Específicos Alternativos:', complementaryObjectives: 'Objetivos Específicos Complementares:',
        professionalSkills: 'HABILIDADES E COMPETÊNCIAS PROFISSIONAIS A SEREM DESENVOLVIDAS', syllabus: 'EMENTA',
        prerequisites: 'PRÉ-REQUISITO (SE HOUVER)', contents: 'CONTEÚDOS', contentHours: 'CARGA HORÁRIA',
        teachingStrategies: 'ESTRATÉGIA DE ENSINO FACILITADORAS DA APRENDIZAGEM', methodologicalResources: 'RECURSOS METODOLÓGICOS',
        assessment: 'AVALIAÇÃO DA APRENDIZAGEM', assessmentCriteria: 'CRITÉRIOS', assessmentInstruments: 'INSTRUMENTOS',
        recoveryProposal: 'PROPOSTA DE RECUPERAÇÃO DIFERENCIADA', basicBibliography: 'Bibliografia Básica (títulos, periódicos, etc.)',
        complementaryBibliography: 'Bibliografia Complementar (títulos, periódicos, etc.)', bibliographyTitle: 'Título/Periódico',
        bibliographyAuthor: 'Autor', bibliographyEdition: 'Ed.', bibliographyLocation: 'Local', bibliographyPublisher: 'Editora',
        bibliographyYear: 'Ano', bibliographyLt: 'LT', skillsInventory: 'INVENTÁRIO DE HABILIDADES E COMPETÊNCIAS – IFAC',
        observations: 'Observações:', signature: 'Assinatura do Docente Responsável:', location: 'Local:', documentDate: 'Data:'
      },
      instructions: { specificObjectives: 'Elencar de 2 a 4 objetivos específicos originais da disciplina.' },
      inventoryGroups: [
        { id: 'oralCommunication', label: 'COMUNICAÇÃO ORAL', indicators: [
          { id: 'oralCommunication1', label: 'Expressa ideias com clareza e coerência em diferentes contextos', hasOptions: true }
        ] },
        { id: 'digitalTechnologies', label: 'DOMÍNIO DE TECNOLOGIAS DIGITAIS', indicators: [
          { id: 'digitalTechnologies4', label: 'Aplica noções de segurança e ética no uso de tecnologias digitais', hasOptions: true },
          { id: 'digitalTechnologies5', label: 'Demonstra autonomia no uso de softwares aplicados ao curso técnico', hasOptions: false }
        ] }
      ],
      ratings: [
        { value: 'REALIZA_COM_AJUDA', label: 'Realiza com ajuda' }, { value: 'REALIZA_SEM_AJUDA', label: 'Realiza sem ajuda' },
        { value: 'NAO_REALIZA', label: 'Não realiza' }, { value: 'NAO_OBSERVADO', label: 'Não foi observado' }
      ]
    };
    let http: HttpTestingController;

    beforeEach(() => {
      TestBed.overrideProvider(ApiService, { useFactory: () => new ApiService() });
      http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    function openOfficial(value = official) {
      fixture = TestBed.createComponent(PeiEditorComponent);
      fixture.detectChanges();
      http.expectOne(peiUrl).flush(value);
      http.expectOne({ url: modelUrl, method: 'GET' }).flush(model);
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    }

    function button(dom: HTMLElement, name: string) {
      return Array.from(dom.querySelectorAll('button')).find(item => item.textContent?.trim() === name)!;
    }

    function type(dom: HTMLElement, selector: string, value: string) {
      const field = dom.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
    }

    it('apresenta a identificação e as instruções do catálogo, com opções só para indicadores avaliáveis', () => {
      const dom = openOfficial();
      const sheet = dom.querySelector('app-pei-annex-i')!;
      expect(sheet.textContent).toContain('Plano de Ensino Individualizado - PEI');
      expect(sheet.textContent).toContain('Estudante fictício');
      expect(sheet.textContent).toContain('Elencar de 2 a 4 objetivos específicos originais da disciplina.');
      expect(sheet.querySelectorAll('input[type="radio"]').length).toBe(8);
      expect(sheet.querySelectorAll('input[type="radio"][name="oralCommunication1"]').length).toBe(4);
      expect(sheet.querySelectorAll('input[type="radio"][name="digitalTechnologies4"]').length).toBe(4);
      expect(sheet.querySelector('[data-indicator="oralCommunication1"] input[value="REALIZA_COM_AJUDA"]:checked')).not.toBeNull();
      expect(sheet.querySelector('[data-indicator="digitalTechnologies5"]')?.textContent).toContain('Demonstra autonomia');
      expect(sheet.querySelector('[data-indicator="digitalTechnologies5"] input')).toBeNull();
    });

    it('edita quadros e indicadores sem reenviar os campos de identificação', () => {
      const dom = openOfficial();
      expect(dom.querySelector<HTMLTextAreaElement>('#generalObjectives')?.value).toBe('Objetivo atual');
      type(dom, '#annex-contents input[type="number"]', '15');
      type(dom, '#annex-assessment [aria-label="Justificativa 1"]', 'Alternativa textual');
      type(dom, '#observations', 'Observação fictícia');
      dom.querySelector<HTMLInputElement>('[data-indicator="oralCommunication1"] input[value="REALIZA_SEM_AJUDA"]')!.click();
      button(dom, 'Salvar rascunho').click();

      const save = http.expectOne({ url: peiUrl, method: 'PUT' });
      expect(save.request.body.version).toBe(7);
      expect(save.request.body.content).toEqual(jasmine.objectContaining({
        specificObjectives: ['Primeiro'], contents: [{ description: 'Conteúdo mantido', workloadHours: 15, priority: true }],
        assessmentInstruments: [{ description: 'Atividade oral', justification: 'Alternativa textual' }],
        basicBibliography: official.content.basicBibliography,
        skillsInventory: { oralCommunication1: 'REALIZA_SEM_AJUDA', digitalTechnologies4: 'NAO_OBSERVADO' },
        observations: 'Observação fictícia'
      }));
      expect(save.request.body.content.teacherName).toBeUndefined();
      expect(save.request.body.content.student).toBeUndefined();
      save.flush(official);
    });

    it('avisa sobre alterações locais e baixa a revisão persistida com o nome enviado pela API', () => {
      const dom = openOfficial();
      const click = spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) {
        expect(this.download).toBe('pei-revisao-2-rascunho.pdf');
        expect(this.href).toMatch(/^blob:/);
      });
      type(dom, '#generalObjectives', 'Alteração não salva');
      button(dom, 'Baixar PDF').click();
      fixture.detectChanges();
      const dialog = dom.querySelector<HTMLElement>('[role="alertdialog"]')!;
      expect(dialog.textContent).toContain('alterações locais');
      http.expectNone(`${peiUrl}/pdf`);

      button(dialog, 'Baixar revisão salva').click();
      const pdf = http.expectOne({ url: `${peiUrl}/pdf`, method: 'GET' });
      expect(pdf.request.responseType).toBe('blob');
      pdf.flush(new Blob(['%PDF-1.4'], { type: 'application/pdf' }), {
        headers: new HttpHeaders({ 'Content-Disposition': 'attachment; filename="pei-revisao-2-rascunho.pdf"' })
      });
      expect(click).toHaveBeenCalledTimes(1);
      expect(dom.querySelector<HTMLTextAreaElement>('#generalObjectives')?.value).toBe('Alteração não salva');
    });

    it('mantém o formato anterior em revisões legadas e não requisita o catálogo oficial', () => {
      fixture = TestBed.createComponent(PeiEditorComponent);
      fixture.detectChanges();
      http.expectOne(peiUrl).flush(draft);
      fixture.detectChanges();
      const dom = fixture.nativeElement as HTMLElement;
      http.expectNone(modelUrl);
      expect(dom.querySelector<HTMLTextAreaElement>('[formControlName="generalObjectives"]')?.value).toBe('Objetivo atual');
      expect(dom.querySelector('app-pei-annex-i')).toBeNull();
      expect(dom.textContent).not.toContain('Baixar PDF');
    });

    it('navega pelo índice do Anexo I sem descartar edições locais', () => {
      const dom = openOfficial();
      type(dom, '#generalObjectives', 'Alteração local do Anexo I');
      jumpToSection(dom, 'annex-assessment');
      expect(dom.querySelector<HTMLTextAreaElement>('#generalObjectives')?.value).toBe('Alteração local do Anexo I');
      expect(button(dom, 'Enviar para revisão').disabled).toBeTrue();
    });

    it('aguarda o catálogo antes de permitir enviar a revisão oficial', () => {
      fixture = TestBed.createComponent(PeiEditorComponent);
      fixture.detectChanges();
      http.expectOne(peiUrl).flush(official);
      const catalog = http.expectOne(modelUrl);
      fixture.detectChanges();
      const dom = fixture.nativeElement as HTMLElement;
      const send = button(dom, 'Enviar para revisão');
      expect(send.disabled).toBeTrue();
      fixture.componentInstance.performAction('SUBMIT');
      http.expectNone(`${peiUrl}/submit`);
      expect(button(dom, 'Baixar PDF').disabled).toBeFalse();

      catalog.flush(model);
      fixture.detectChanges();
      expect(send.disabled).toBeFalse();
    });

    it('permite aprovar a revisão oficial somente após carregar a definição, inclusive após erro', () => {
      fixture = TestBed.createComponent(PeiEditorComponent);
      fixture.detectChanges();
      http.expectOne(peiUrl).flush({ ...official, status: 'IN_REVIEW', allowedActions: ['APPROVE'] });
      http.expectOne(modelUrl).flush({}, { status: 503, statusText: 'Service Unavailable' });
      fixture.detectChanges();
      const dom = fixture.nativeElement as HTMLElement;
      const approve = button(dom, 'Aprovar PEI');
      expect(approve.disabled).toBeTrue();
      fixture.componentInstance.requestConfirmation('APPROVE');
      fixture.componentInstance.confirmAction();
      fixture.componentInstance.performAction('APPROVE');
      http.expectNone(`${peiUrl}/approve`);

      button(dom, 'Tentar novamente').click();
      http.expectOne(modelUrl).flush(model);
      fixture.detectChanges();
      expect(approve.disabled).toBeFalse();
    });
  });

  describe('transferência de rascunho', () => {
    const peiUrl = '/api/v1/students/1/peis/pei-1';
    let http: HttpTestingController;

    beforeEach(() => {
      TestBed.overrideProvider(ApiService, { useFactory: () => new ApiService() });
      http = TestBed.inject(HttpTestingController);
    });

    afterEach(() => http.verify());

    function button(container: HTMLElement, label: string) {
      return Array.from(container.querySelectorAll('button')).find(value => value.textContent?.trim() === label);
    }

    function openTransfer() {
      fixture = TestBed.createComponent(PeiEditorComponent);
      fixture.detectChanges();
      http.expectOne({ url: peiUrl, method: 'GET' }).flush({ ...draft, allowedActions: ['TRANSFER'] });
      fixture.detectChanges();
      const dom = fixture.nativeElement as HTMLElement;
      http.expectNone(`${peiUrl}/transfer-candidates`);
      const trigger = button(dom, 'Transferir rascunho');
      expect(trigger).toBeDefined();
      if (!trigger) return;
      trigger.click();
      fixture.detectChanges();
      const dialog = dom.querySelector<HTMLElement>('[role="alertdialog"]')!;
      expect(dialog.querySelector('[role="status"]')?.textContent).toContain('Carregando docentes');
      return { dom, dialog };
    }

    function fillReason(reason: HTMLTextAreaElement, value: string) {
      reason.value = value;
      reason.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
    }

    it('exige seleção manual e motivo para transferir a versão carregada e abre a revisão recebida', () => {
      const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
      const opened = openTransfer();
      if (!opened) return;
      const { dom, dialog } = opened;
      http.expectOne({ url: `${peiUrl}/transfer-candidates`, method: 'GET' }).flush([
        { id: 3, name: 'Docente fictício A' }, { id: 4, name: 'Docente fictício A' },
        { id: 5, name: 'Docente fictício B' }
      ]);
      fixture.detectChanges();

      const teacher = dialog.querySelector('select')!;
      expect(Array.from(teacher.options).map(option => option.text)).toEqual([
        'Selecione um docente', 'Docente fictício A (#3)', 'Docente fictício A (#4)', 'Docente fictício B'
      ]);
      const reason = dialog.querySelector('textarea')!;
      const confirm = button(dialog, 'Confirmar transferência')!;
      expect(teacher.value).toBe('');
      fillReason(reason, 'Mudança de vínculo');
      expect(confirm.disabled).toBeTrue();

      teacher.value = '4';
      teacher.dispatchEvent(new Event('change', { bubbles: true }));
      fillReason(reason, '   ');
      expect(confirm.disabled).toBeTrue();
      http.expectNone(`${peiUrl}/transfer`);
      fillReason(reason, '   Mudança de vínculo   ');
      expect(confirm.disabled).toBeFalse();
      confirm.click();
      fixture.detectChanges();
      expect(dialog.querySelector('[role="status"]')?.textContent).toContain('Transferindo');
      const request = http.expectOne({ url: `${peiUrl}/transfer`, method: 'POST' });
      expect(request.request.body).toEqual({ teacherId: 4, reason: 'Mudança de vínculo', version: 7 });
      request.flush({
        ...draft, id: 'pei-3', revision: 3, storageVersion: 8, teacherId: 4, allowedActions: [],
        transfer: {
          fromTeacherId: 2, toTeacherId: 4, transferredBy: 'Equipe NAPNE',
          transferredAt: '2026-11-25T12:00:00Z', reason: 'Mudança de vínculo'
        }
      });
      fixture.detectChanges();

      expect(navigate).toHaveBeenCalledWith(['/estudantes', 1, 'pei', 'pei-3']);
      expect(dom.querySelector('.pei-header')?.textContent).toContain('revisão 3');
      expect(dom.textContent).toContain('Motivo da transferência');
      expect(dom.textContent).toContain('Mudança de vínculo');
      expect(dom.querySelector('[role="alertdialog"]')).toBeNull();
      expect(button(dom, 'Transferir rascunho')).toBeUndefined();
    });

    it('preserva docente e motivo em um conflito de transferência', () => {
      const opened = openTransfer();
      if (!opened) return;
      const { dialog } = opened;
      http.expectOne(`${peiUrl}/transfer-candidates`).flush([{ id: 3, name: 'Docente fictício A' }]);
      fixture.detectChanges();

      const teacher = dialog.querySelector('select')!;
      teacher.value = '3';
      teacher.dispatchEvent(new Event('change', { bubbles: true }));
      const reason = dialog.querySelector('textarea')!;
      fillReason(reason, 'Motivo digitado');
      const confirm = button(dialog, 'Confirmar transferência')!;
      confirm.click();
      http.expectOne(`${peiUrl}/transfer`).flush({}, { status: 409, statusText: 'Conflict' });
      fixture.detectChanges();

      expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('Seleção e motivo preservados');
      expect(teacher.value).toBe('3');
      expect(reason.value).toBe('Motivo digitado');
      expect(confirm.disabled).toBeTrue();
    });

    it('invalida uma transferência quando muda o estudante, inclusive se a nova consulta falhar', () => {
      const opened = openTransfer();
      if (!opened) return;
      const { dom, dialog } = opened;
      http.expectOne(`${peiUrl}/transfer-candidates`).flush([{ id: 3, name: 'Docente fictício A' }]);
      fixture.detectChanges();

      const teacher = dialog.querySelector('select')!;
      teacher.value = '3';
      teacher.dispatchEvent(new Event('change', { bubbles: true }));
      fillReason(dialog.querySelector('textarea')!, 'Motivo digitado');
      const confirm = button(dialog, 'Confirmar transferência')!;
      expect(confirm.disabled).toBeFalse();

      routeParams.next(convertToParamMap({ studentId: '2', peiId: 'pei-1' }));
      confirm.click();
      expect(http.match(request => request.method === 'POST')).toEqual([]);
      fixture.detectChanges();
      expect(dom.querySelector('[role="alertdialog"]')).toBeNull();
      expect(button(dom, 'Transferir rascunho')).toBeUndefined();
      expect(dom.querySelector('a.back-link')?.getAttribute('href')).toBe('/estudantes/2');

      const newPeiUrl = '/api/v1/students/2/peis/pei-1';
      http.expectOne(newPeiUrl).flush({}, { status: 403, statusText: 'Forbidden' });
      fixture.detectChanges();
      expect(dom.querySelector('[role="alert"]')?.textContent).toContain('Não foi possível carregar o PEI.');
      expect(button(dom, 'Transferir rascunho')).toBeUndefined();
      fixture.componentInstance.openTransfer();
      fixture.componentInstance.confirmTransfer();
      http.expectNone(request => request.url.endsWith('/transfer-candidates') || request.method === 'POST');
    });

    it('cancela consultas superadas quando navega rapidamente entre revisões', () => {
      const opened = openTransfer();
      if (!opened) return;
      const { dom } = opened;
      const candidates = http.expectOne(`${peiUrl}/transfer-candidates`);

      routeParams.next(convertToParamMap({ studentId: '1', peiId: 'pei-2' }));
      const discardedPei = http.expectOne('/api/v1/students/1/peis/pei-2');
      routeParams.next(convertToParamMap({ studentId: '1', peiId: 'pei-3' }));
      http.expectOne('/api/v1/students/1/peis/pei-3').flush({
        ...draft, id: 'pei-3', revision: 3, allowedActions: ['TRANSFER']
      });
      expect(candidates.cancelled).toBeTrue();
      expect(discardedPei.cancelled).toBeTrue();
      if (!discardedPei.cancelled) discardedPei.flush({ ...draft, id: 'pei-2', allowedActions: [] });
      fixture.detectChanges();

      expect(dom.querySelector('.pei-header')?.textContent).toContain('revisão 3');
      button(dom, 'Transferir rascunho')?.click();
      http.expectOne('/api/v1/students/1/peis/pei-3/transfer-candidates').flush([]);
    });
  });
});
