import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { StudentDetailComponent } from './student-detail.component';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ToastService } from '../core/toast.service';
import { CareRecord, Dossier, NapneCase, SessionUser, StudentDetails } from '../core/models';

interface AuthServiceTestAccess {
  state: { set(user: SessionUser | null): void };
}

describe('StudentDetailComponent - Acompanhamentos (Tarefa 2)', () => {
  let component: StudentDetailComponent;
  let fixture: ComponentFixture<StudentDetailComponent>;
  let apiService: jasmine.SpyObj<ApiService>;
  let authService: AuthService;
  let toastService: jasmine.SpyObj<ToastService>;

  const mockStudent: StudentDetails = {
    id: 1,
    registration: '2026001',
    displayName: 'Estudante Teste',
    course: 'Sistemas para Internet',
    campus: 'Rio Branco',
    status: 'ACTIVE',
    civilName: 'Estudante Civil',
    socialName: null,
    birthDate: '2001-01-01',
    institutionalEmail: 'estudante@ifac.edu.br',
    phone: null,
    campusId: 1,
    courseId: 10,
    version: 1
  };

  const mockDossier: Dossier = {
    studentId: 1,
    identification: {},
    educationalNeeds: {},
    healthAndSupport: {},
    familyContext: {},
    schoolHistory: {},
    strengths: {},
    difficulties: {},
    initialInterventions: {},
    version: 1,
    redacted: false
  };

  const mockRecord: CareRecord = {
    id: 'rec-1',
    studentId: 1,
    caseId: 50,
    subjectId: 100,
    type: 'PEDAGOGICAL_GUIDANCE',
    status: 'DRAFT',
    title: 'Orientações Iniciais',
    content: {
      teachingNeeds: 'Material adaptado',
      adaptations: 'Tempo estendido',
      napneSupport: 'Acompanhamento quinzenal',
      notes: 'Rascunho inicial do professor/napne',
      extraFieldPreserved: 'valor_adicional_que_deve_ser_mantido'
    },
    createdBy: 'napne@test.local',
    updatedAt: '2026-11-17T10:00:00Z',
    version: 1,
    history: [
      {
        version: 0,
        title: 'Orientações v0',
        status: 'DRAFT',
        content: {
          teachingNeeds: 'Material adaptado inicial',
          adaptations: 'Tempo padrão',
          notes: 'Primeiro rascunho v0'
        },
        author: 'napne@test.local',
        occurredAt: '2026-11-17T09:00:00Z'
      }
    ]
  };

  beforeEach(async () => {
    sessionStorage.clear();
    sessionStorage.setItem('napne360.session', JSON.stringify({
      token: 'jwt-napne',
      id: 2,
      name: 'NAPNE Member',
      email: 'napne@test.local',
      campusId: 1,
      roles: ['NAPNE']
    }));

    const apiSpy = jasmine.createSpyObj<ApiService>('ApiService', [
      'student', 'dossier', 'cases', 'records', 'peis', 'timeline',
      'attachments', 'studentSubjects', 'studentTeachers', 'courses',
      'createRecord', 'updateRecord', 'references', 'uploadAttachment'
    ]);
    const toastSpy = jasmine.createSpyObj<ToastService>('ToastService', ['show']);

    apiSpy.references.and.returnValue(of([]));
    apiSpy.student.and.returnValue(of(mockStudent));
    apiSpy.dossier.and.returnValue(of(mockDossier));
    apiSpy.cases.and.returnValue(of([]));
    apiSpy.records.and.returnValue(of([mockRecord]));
    apiSpy.peis.and.returnValue(of([]));
    apiSpy.timeline.and.returnValue(of({ content: [], totalElements: 0, totalPages: 0, number: 0, size: 10 }));
    apiSpy.attachments.and.returnValue(of([]));
    apiSpy.studentSubjects.and.returnValue(of([{ id: 100, name: 'Matemática', code: 'MAT', workloadHours: 60, courseId: 10 }]));
    apiSpy.studentTeachers.and.returnValue(of([]));
    apiSpy.courses.and.returnValue(of([]));

    await TestBed.configureTestingModule({
      imports: [StudentDetailComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: {
                get: (k: string) => (k === 'id' ? '1' : null)
              }
            }
          }
        },
        { provide: ApiService, useValue: apiSpy },
        { provide: ToastService, useValue: toastSpy }
      ]
    }).compileComponents();

    apiService = TestBed.inject(ApiService) as jasmine.SpyObj<ApiService>;
    authService = TestBed.inject(AuthService);
    toastService = TestBed.inject(ToastService) as jasmine.SpyObj<ToastService>;

    fixture = TestBed.createComponent(StudentDetailComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('abre a seção do dossiê sem navegar e preserva o texto digitado', () => {
    const root: HTMLElement = fixture.nativeElement;
    const section = root.querySelector<HTMLDetailsElement>('#dossier-educationalNeeds')!;
    const notes = root.querySelector<HTMLTextAreaElement>('#dossier-identification .details-content > label > textarea')!;
    notes.value = 'Alteração em andamento';
    notes.dispatchEvent(new Event('input'));
    spyOn(section, 'scrollIntoView');
    const link = root.querySelectorAll<HTMLAnchorElement>('.section-index a')[1];
    const click = new MouseEvent('click', { button: 0, bubbles: true, cancelable: true });
    expect(link.dispatchEvent(click)).toBeFalse();
    expect(section.open).toBeTrue();
    expect(section.scrollIntoView).toHaveBeenCalled();
    expect(notes.value).toBe('Alteração em andamento');
  });

  it('só habilita o salvamento do dossiê enquanto houver mudança real', () => {
    const root: HTMLElement = fixture.nativeElement;
    const save = root.querySelector<HTMLButtonElement>('.sticky-actions button')!;
    const notes = root.querySelector<HTMLTextAreaElement>('#dossier-identification .details-content > label > textarea')!;
    expect(save.disabled).toBeTrue();
    notes.value = 'Alteração em andamento';
    notes.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(save.disabled).toBeFalse();
    notes.value = '';
    notes.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(save.disabled).toBeTrue();
  });

  it('intercepta o submit dos documentos e inicia somente um envio', () => {
    const file = new File(['imagem fictícia'], 'teste.png', { type: 'image/png' });
    apiService.uploadAttachment.and.returnValue(new Subject());
    component.tab.set('documents');
    component.selectedFile.set(file);
    fixture.detectChanges();
    const form = fixture.nativeElement.querySelector('.upload-card') as HTMLFormElement;
    const submit = () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(submit()).toBeFalse();
    expect(submit()).toBeFalse();
    expect(apiService.uploadAttachment).toHaveBeenCalledOnceWith(1, 'Laudo ou documento', file, '', jasmine.any(String));
    expect(component.tab()).toBe('documents');
  });

  it('reutiliza a chave do anexo após uma falha e exibe a revisão uma única vez', () => {
    const file = new File(['%PDF-1.7'], 'ficticio.pdf', { type: 'application/pdf' });
    const attachment = {
      id: 'revisao-2', studentId: 1, previousVersionId: 'revisao-1', category: 'Fictício',
      revision: 2, archived: false, originalName: 'ficticio.pdf', contentType: 'application/pdf',
      size: file.size, uploadedBy: 'napne@test.local', uploadedAt: '2026-11-25T15:00:00Z'
    };
    apiService.uploadAttachment.and.returnValues(throwError(() => ({ status: 503 })), of(attachment));
    component.attachmentCategory.setValue('Fictício');
    component.previousAttachment.setValue('revisao-1');
    component.selectedFile.set(file);

    component.upload();
    expect(component.selectedFile()).toBe(file);
    const key = apiService.uploadAttachment.calls.first().args[4];
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    component.attachments.set([attachment]);
    component.upload();

    expect(apiService.uploadAttachment.calls.mostRecent().args).toEqual([1, 'Fictício', file, 'revisao-1', key]);
    expect(component.attachments()).toEqual([attachment]);
    expect(component.selectedFile()).toBeNull();
  });

  function setSessionUser(user: SessionUser) {
    sessionStorage.setItem('napne360.session', JSON.stringify(user));
    (authService as unknown as AuthServiceTestAccess).state.set(user);
    fixture.detectChanges();
  }

  function careCase(id: number, overrides: Partial<NapneCase> = {}): NapneCase {
    return {
      id, studentId: 1, source: 'Coordenação', stage: 'RECEIVED', stageLabel: 'Recebido',
      allowedNextStages: [], openedAt: '2026-11-23T12:00:00Z', closedAt: null,
      responsible: 'NAPNE Member', responsibleId: 2, summary: null, version: 0, ...overrides
    };
  }

  function caseSelect(): HTMLSelectElement | null {
    return fixture.nativeElement.querySelector('select[formControlName="caseId"]');
  }

  it('busca em todos os acompanhamentos e volta à primeira página ao filtrar', () => {
    component.records.set(Array.from({ length: 11 }, (_, index) => ({
      ...mockRecord,
      id: `registro-${index}`,
      title: index ? `Registro ${index}` : 'Orientação individual'
    })));
    component.tab.set('records');
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;

    expect(root.querySelectorAll('.record-card').length).toBe(10);
    const second = Array.from(root.querySelectorAll<HTMLButtonElement>('.records-list > app-pagination button'))
      .find(button => button.textContent?.trim() === '2');
    expect(second).toBeDefined();
    second?.click();
    fixture.detectChanges();
    expect(Array.from(root.querySelectorAll('.record-card h3'), row => row.textContent)).toEqual(['Registro 10']);

    const filter = root.querySelector<HTMLInputElement>('.records-list app-list-filters input[type="search"]');
    expect(filter).not.toBeNull();
    if (!filter) return;
    filter.value = 'orientacao individual';
    filter.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(Array.from(root.querySelectorAll('.record-card h3'), row => row.textContent)).toEqual(['Orientação individual']);
  });

  it('consulta novamente a linha do tempo quando a aba é aberta', () => {
    apiService.timeline.calls.reset();
    apiService.timeline.and.returnValue(of({
      content: [{
        id: 'pei-revisao-evento', eventType: 'PEI_REVISED', title: 'Nova versão do PEI',
        actor: 'Docente fictício', visibility: 'PEDAGOGICAL', createdAt: '2026-11-25T21:00:00Z'
      }],
      totalElements: 1, totalPages: 1, number: 0, size: 10
    }));
    const tabs = Array.from(fixture.nativeElement.querySelectorAll('.student-tabs button')) as HTMLButtonElement[];
    const timelineTab = tabs.find(button => button.textContent?.trim() === 'Linha do tempo');
    expect(timelineTab).toBeDefined();
    timelineTab?.click();
    fixture.detectChanges();
    expect(apiService.timeline).toHaveBeenCalledOnceWith(1, '', 0, { actor: '', from: undefined, to: undefined });
    expect(fixture.nativeElement.querySelector('.timeline')?.textContent).toContain('Nova versão do PEI');
  });

  it('mantém o vínculo opcional mesmo com um caso ativo e envia somente a escolha explícita', () => {
    const active = careCase(50);
    const custom = careCase(51, { source: 'Solicitação do estudante', stage: 'CUSTOM_123', stageLabel: 'Visita inicial' });
    component.cases.set([active]);
    component.tab.set('records');
    fixture.detectChanges();

    const select = caseSelect();
    expect(select).not.toBeNull();
    expect(select?.value).toBe('');
    apiService.createRecord.and.returnValue(of({ ...mockRecord, id: 'new-unlinked', caseId: null }));
    component.recordForm.controls.type.setValue('INITIAL_SCREENING');
    component.recordForm.controls.title.setValue('Registro geral');
    component.saveRecord();
    expect(apiService.createRecord).toHaveBeenCalledWith(1, jasmine.objectContaining({ caseId: null }));

    component.cases.set([
      active, custom, careCase(52, { stage: 'CLOSED' }), careCase(53, { stage: 'ARCHIVED' }),
      careCase(54, { studentId: 2 })
    ]);
    fixture.detectChanges();
    expect(Array.from(select?.options ?? []).map(option => option.value)).toEqual(['', '50', '51']);
    expect(select?.options[2].textContent).toContain('Caso #51 · Solicitação do estudante · Visita inicial · 23/11/2026');
    if (!select) return;
    select.value = '51';
    select.dispatchEvent(new Event('change'));
    apiService.createRecord.and.returnValue(of({ ...mockRecord, id: 'new-linked', caseId: 51, title: 'Visita' }));
    component.recordForm.controls.type.setValue('INITIAL_SCREENING');
    component.recordForm.controls.title.setValue('Visita');
    component.saveRecord();
    expect(apiService.createRecord).toHaveBeenCalledWith(1, jasmine.objectContaining({ caseId: 51 }));
    fixture.detectChanges();
    expect(select.value).toBe('');
  });

  it('exibe o vínculo arquivado no cartão e na edição para NAPNE e oculta o vínculo dos demais perfis', () => {
    component.cases.set([careCase(50, { stage: 'ARCHIVED', stageLabel: 'Arquivado' })]);
    component.editRecord(mockRecord);
    fixture.detectChanges();

    expect(caseSelect()).toBeNull();
    expect(fixture.nativeElement.querySelector('select[formControlName="status"]').closest('form').textContent).toContain('Caso #50 · Coordenação · Arquivado');
    expect(fixture.nativeElement.querySelector('[data-record-id="rec-1"]').textContent).toContain('Caso #50 · Coordenação · Arquivado');

    component.cancelRecordEdit();
    setSessionUser({ token: 'jwt-docente', id: 7, name: 'Docente', email: 'docente@example.test', campusId: 1, roles: ['TEACHER'] });
    expect(caseSelect()).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-record-id="rec-1"]').textContent).not.toContain('Caso #50');
  });

  it('atualiza as opções ao recusar um caso encerrado durante o preenchimento e mantém o texto', () => {
    component.cases.set([careCase(50)]);
    component.tab.set('records');
    fixture.detectChanges();

    const select = caseSelect();
    expect(select).not.toBeNull();
    if (!select) return;
    select.value = '50';
    select.dispatchEvent(new Event('change'));
    component.recordForm.controls.type.setValue('INITIAL_SCREENING');
    component.recordForm.controls.title.setValue('Texto a preservar');
    apiService.createRecord.and.returnValue(throwError(() => ({ status: 400 })));
    apiService.cases.and.returnValue(of([careCase(50, { stage: 'CLOSED' })]));
    component.saveRecord();
    fixture.detectChanges();

    expect(apiService.createRecord).toHaveBeenCalledTimes(1);
    expect(component.recordForm.controls.title.value).toBe('Texto a preservar');
    expect(select.value).toBe('');
    expect(Array.from(select.options).map(option => option.value)).toEqual(['']);
    expect(toastService.show).toHaveBeenCalledWith('O caso escolhido já não está ativo. Confira o vínculo antes de salvar.', 'error');
  });

  it('permite iniciar edição de acompanhamento, preenchendo campos e preservando vínculos', () => {
    expect(component.editingRecord()).toBeNull();

    // Inicia edição do registro existente
    component.editRecord(mockRecord);
    fixture.detectChanges();

    expect(component.editingRecord()).toBe(mockRecord);
    expect(component.recordForm.controls.title.value).toBe('Orientações Iniciais');
    expect(component.recordForm.controls.type.value).toBe('PEDAGOGICAL_GUIDANCE');
    expect(component.recordForm.controls.status.value).toBe('DRAFT');
    expect(component.recordForm.controls.subjectId.value).toBe('100');
    expect(component.recordForm.controls.notes.value).toBe('Rascunho inicial do professor/napne');
    expect(component.structuredRecord.controls['teachingNeeds'].value).toBe('Material adaptado');
    expect(component.structuredRecord.controls['adaptations'].value).toBe('Tempo estendido');
  });

  it('cancela a edição limpando o registro em edição e restaurando o formulário', () => {
    component.editRecord(mockRecord);
    component.recordForm.controls.title.setValue('Título alterado');

    component.cancelRecordEdit();
    fixture.detectChanges();

    expect(component.editingRecord()).toBeNull();
    expect(component.recordForm.controls.title.value).toBe('');
    expect(component.recordForm.controls.notes.value).toBe('');
    expect(apiService.updateRecord).not.toHaveBeenCalled();
  });

  it('finaliza acompanhamento (DRAFT -> ACTIVE) enviando version, vínculos imutáveis e preservando chaves extras', () => {
    component.editRecord(mockRecord);

    component.recordForm.controls.status.setValue('ACTIVE');
    component.recordForm.controls.notes.setValue('Finalizado após reunião');
    component.structuredRecord.controls['teachingNeeds'].setValue('Material adaptado revisado');

    const updatedRecord: CareRecord = {
      ...mockRecord,
      version: 2,
      status: 'ACTIVE',
      content: {
        ...mockRecord.content,
        notes: 'Finalizado após reunião',
        teachingNeeds: 'Material adaptado revisado'
      }
    };
    apiService.updateRecord.and.returnValue(of(updatedRecord));

    component.saveRecord();

    expect(apiService.updateRecord).toHaveBeenCalledWith(
      1,
      'rec-1',
      jasmine.objectContaining({
        caseId: 50,
        subjectId: 100,
        type: 'PEDAGOGICAL_GUIDANCE',
        title: 'Orientações Iniciais',
        status: 'ACTIVE',
        version: 1,
        content: jasmine.objectContaining({
          extraFieldPreserved: 'valor_adicional_que_deve_ser_mantido',
          notes: 'Finalizado após reunião',
          teachingNeeds: 'Material adaptado revisado'
        })
      })
    );

    expect(component.editingRecord()).toBeNull();
    expect(component.records().find(r => r.id === 'rec-1')?.status).toBe('ACTIVE');
    expect(toastService.show).toHaveBeenCalledWith(jasmine.stringMatching(/atualizado/i), 'success');
  });

  it('reabre acompanhamento (ACTIVE -> DRAFT) mantendo version e campos existentes', () => {
    const activeRecord: CareRecord = {
      ...mockRecord,
      id: 'rec-active',
      status: 'ACTIVE',
      version: 2
    };

    component.editRecord(activeRecord);
    expect(component.recordForm.controls.status.value).toBe('ACTIVE');

    component.recordForm.controls.status.setValue('DRAFT');
    component.recordForm.controls.notes.setValue('Reaberto para novos ajustes');

    const reopenedRecord: CareRecord = {
      ...activeRecord,
      status: 'DRAFT',
      version: 3
    };
    apiService.updateRecord.and.returnValue(of(reopenedRecord));

    component.saveRecord();

    expect(apiService.updateRecord).toHaveBeenCalledWith(
      1,
      'rec-active',
      jasmine.objectContaining({
        status: 'DRAFT',
        version: 2
      })
    );
  });

  it('mantém os dados digitados e o estado de edição se a API devolver conflito (HTTP 409), 403 ou 500', () => {
    component.editRecord(mockRecord);
    component.recordForm.controls.title.setValue('Título novo durante conflito');
    component.recordForm.controls.notes.setValue('Anotação que não pode ser perdida');
    component.structuredRecord.controls['teachingNeeds'].setValue('Necessidade alterada preservada');

    // Teste 1: HTTP 409 Conflito
    apiService.updateRecord.and.returnValue(throwError(() => ({ status: 409 })));
    component.saveRecord();

    expect(component.editingRecord()).toBe(mockRecord);
    expect(component.recordForm.controls.title.value).toBe('Título novo durante conflito');
    expect(component.recordForm.controls.notes.value).toBe('Anotação que não pode ser perdida');
    expect(component.structuredRecord.controls['teachingNeeds'].value).toBe('Necessidade alterada preservada');
    expect(toastService.show).toHaveBeenCalledWith(
      jasmine.stringMatching(/alterado por outra pessoa|Não foi possível/i),
      'error'
    );

    // Teste 2: HTTP 403 Acesso negado
    apiService.updateRecord.and.returnValue(throwError(() => ({ status: 403 })));
    component.saveRecord();

    expect(component.editingRecord()).toBe(mockRecord);
    expect(component.recordForm.controls.title.value).toBe('Título novo durante conflito');

    // Teste 3: HTTP 500 Erro no servidor
    apiService.updateRecord.and.returnValue(throwError(() => ({ status: 500 })));
    component.saveRecord();

    expect(component.editingRecord()).toBe(mockRecord);
    expect(component.recordForm.controls.notes.value).toBe('Anotação que não pode ser perdida');
  });

  it('F1: autorização com múltiplos perfis respeita regras do backend e não bloqueia autores válidos', () => {
    // 1. NAPNE pode editar qualquer registro
    expect(component.canEditRecord(mockRecord)).toBeTrue();

    // 2. Usuário com perfis múltiplos TEACHER + TUTOR criando TUTOR_OBSERVATION
    const tutorRecord: CareRecord = {
      ...mockRecord,
      id: 'rec-tutor',
      type: 'TUTOR_OBSERVATION',
      createdBy: 'docente_tutor@test.local'
    };
    const teacherRecord: CareRecord = {
      ...mockRecord,
      id: 'rec-docente',
      type: 'TEACHER_FEEDBACK',
      createdBy: 'docente_tutor@test.local'
    };

    setSessionUser({
      token: 'jwt-combo',
      id: 10,
      name: 'Docente e Tutor',
      email: 'docente_tutor@test.local',
      campusId: 1,
      roles: ['TEACHER', 'TUTOR']
    });

    // Deve autorizar ambos os tipos pelo conjunto de papéis
    expect(component.canEditRecord(tutorRecord)).toBeTrue();
    expect(component.canEditRecord(teacherRecord)).toBeTrue();

    // 3. Usuário com MANAGEMENT + TEACHER
    setSessionUser({
      token: 'jwt-mgmt-teacher',
      id: 11,
      name: 'Gestor Professor',
      email: 'gestor_prof@test.local',
      campusId: 1,
      roles: ['MANAGEMENT', 'TEACHER']
    });
    const mgmtTeacherRecord: CareRecord = {
      ...mockRecord,
      type: 'TEACHER_FEEDBACK',
      createdBy: 'gestor_prof@test.local'
    };
    expect(component.canEditRecord(mgmtTeacherRecord)).toBeTrue();

    // 4. Somente MANAGEMENT (sem papéis pedagógicos autorizados)
    setSessionUser({
      token: 'jwt-mgmt-pure',
      id: 12,
      name: 'Gestor Puro',
      email: 'gestor_puro@test.local',
      campusId: 1,
      roles: ['MANAGEMENT']
    });
    expect(component.canEditRecord(mockRecord)).toBeFalse();
    expect(component.canEditRecord(tutorRecord)).toBeFalse();

    // 5. Outro autor do mesmo tipo de registro
    setSessionUser({
      token: 'jwt-outro',
      id: 13,
      name: 'Outro Professor',
      email: 'outro_prof@test.local',
      campusId: 1,
      roles: ['TEACHER']
    });
    expect(component.canEditRecord(teacherRecord)).toBeFalse();
  });

  it('F2: histórico de versões renderiza campos estruturados anteriores além de notas', () => {
    component.tab.set('records');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const historySummary = compiled.querySelector('.record-history summary');
    expect(historySummary).not.toBeNull();
    expect(historySummary?.textContent).toContain('Histórico de versões (1)');

    const revisionContent = compiled.querySelector('.revision-content');
    expect(revisionContent).not.toBeNull();
    const contentText = revisionContent?.textContent || '';

    // Deve renderizar os campos estruturados da revisão:
    expect(contentText).toContain('Material adaptado inicial');
    expect(contentText).toContain('Tempo padrão');
    // Deve renderizar as notas da revisão:
    expect(contentText).toContain('Primeiro rascunho v0');
  });

  it('F3: impede troca de edição durante envio pendente e protege formulário contra respostas atrasadas', fakeAsync(() => {
    component.tab.set('records');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const updateSubject = new Subject<CareRecord>();
    apiService.updateRecord.and.returnValue(updateSubject.asObservable());

    component.editRecord(mockRecord);
    component.recordForm.controls.title.setValue('Ajuste em A');
    fixture.detectChanges();

    // Dispara save (requisição fica pendente)
    component.saveRecord();
    fixture.detectChanges();

    expect(component.actionBusy()).toBeTrue();

    // Controles editáveis do formulário DEVEM estar desabilitados no DOM durante actionBusy via fieldset (:disabled)
    const fieldSet = compiled.querySelector('fieldset.record-form-fields') as HTMLFieldSetElement;
    const titleInput = compiled.querySelector('input[formControlName="title"]') as HTMLInputElement;
    const notesTextarea = compiled.querySelector('textarea[formControlName="notes"]') as HTMLTextAreaElement;
    const statusSelect = compiled.querySelector('select[formControlName="status"]') as HTMLSelectElement;
    const allTextareas = compiled.querySelectorAll('.record-form-fields textarea');

    expect(fieldSet).not.toBeNull();
    expect(fieldSet.disabled).toBeTrue();
    expect(titleInput).not.toBeNull();
    expect(titleInput.matches(':disabled')).toBeTrue();
    expect(notesTextarea).not.toBeNull();
    expect(notesTextarea.matches(':disabled')).toBeTrue();
    expect(statusSelect).not.toBeNull();
    expect(statusSelect.matches(':disabled')).toBeTrue();
    expect(allTextareas.length).toBeGreaterThan(1);
    allTextareas.forEach(t => expect((t as HTMLElement).matches(':disabled')).toBeTrue());

    // Botão de editar deve estar desabilitado no DOM
    const editBtn = compiled.querySelector('.record-card button.secondary') as HTMLButtonElement;
    expect(editBtn).not.toBeNull();
    expect(editBtn.disabled).toBeTrue();

    // Tentar chamar editRecord de outro registro durante actionBusy deve ser ignorado
    const otherRecord: CareRecord = { ...mockRecord, id: 'rec-2', title: 'Registro B' };
    component.editRecord(otherRecord);
    expect(component.editingRecord()?.id).toBe('rec-1');

    // Emite sucesso da requisição de A
    const updatedA: CareRecord = { ...mockRecord, title: 'Ajuste em A concluído', version: 2 };
    updateSubject.next(updatedA);
    tick();
    fixture.detectChanges();

    expect(component.actionBusy()).toBeFalse();
    expect(component.editingRecord()).toBeNull();
  }));

  it('F3: no erro da requisição pendente, reabilita fieldset e controles preservando dados digitados', fakeAsync(() => {
    component.tab.set('records');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    const updateSubject = new Subject<CareRecord>();
    apiService.updateRecord.and.returnValue(updateSubject.asObservable());

    component.editRecord(mockRecord);
    component.recordForm.controls.title.setValue('Título em edição antes do erro');
    component.recordForm.controls.notes.setValue('Nota mantida no erro');
    fixture.detectChanges();

    component.saveRecord();
    fixture.detectChanges();

    const fieldSet = compiled.querySelector('fieldset.record-form-fields') as HTMLFieldSetElement;
    const titleInput = compiled.querySelector('input[formControlName="title"]') as HTMLInputElement;
    expect(fieldSet.disabled).toBeTrue();
    expect(titleInput.matches(':disabled')).toBeTrue();

    // Emite erro na requisição
    updateSubject.error({ status: 409 });
    tick();
    fixture.detectChanges();

    // Fieldset e controles voltam a ficar habilitados e mantêm o conteúdo
    expect(component.actionBusy()).toBeFalse();
    expect(fieldSet.disabled).toBeFalse();
    expect(titleInput.matches(':disabled')).toBeFalse();
    expect(titleInput.value).toBe('Título em edição antes do erro');
    expect(component.recordForm.controls.notes.value).toBe('Nota mantida no erro');
    expect(component.editingRecord()?.id).toBe('rec-1');
  }));

  it('F4: jornada completa no DOM (criar rascunho -> recarregar -> editar -> finalizar) com controles reais', () => {
    component.tab.set('records');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;

    // 1. Criar novo rascunho usando elementos do DOM
    const typeSelect = compiled.querySelector('select[formControlName="type"]') as HTMLSelectElement;
    typeSelect.value = 'PEDAGOGICAL_GUIDANCE';
    typeSelect.dispatchEvent(new Event('change'));

    const titleInput = compiled.querySelector('input[formControlName="title"]') as HTMLInputElement;
    titleInput.value = 'Plano de Apoio em Cálculo';
    titleInput.dispatchEvent(new Event('input'));

    const notesTextarea = compiled.querySelector('textarea[formControlName="notes"]') as HTMLTextAreaElement;
    notesTextarea.value = 'Observações da primeira sessão';
    notesTextarea.dispatchEvent(new Event('input'));

    fixture.detectChanges();

    const newCreatedRecord: CareRecord = {
      id: 'rec-jornada-1',
      studentId: 1,
      caseId: null,
      subjectId: 100,
      type: 'PEDAGOGICAL_GUIDANCE',
      status: 'DRAFT',
      title: 'Plano de Apoio em Cálculo',
      content: { notes: 'Observações da primeira sessão' },
      createdBy: 'napne@test.local',
      updatedAt: '2026-11-17T11:00:00Z',
      version: 1,
      history: []
    };
    apiService.createRecord.and.returnValue(of(newCreatedRecord));

    const submitBtn = compiled.querySelector('.create-panel button[type="submit"]') as HTMLButtonElement;
    submitBtn.click();
    fixture.detectChanges();

    expect(apiService.createRecord).toHaveBeenCalled();
    expect(component.records().some(r => r.id === 'rec-jornada-1')).toBeTrue();

    // 2. Simular recarregamento da página (loadAll)
    apiService.records.and.returnValue(of([newCreatedRecord]));
    component.loadAll();
    fixture.detectChanges();

    expect(component.records().length).toBe(1);
    expect(component.records()[0].id).toBe('rec-jornada-1');

    // 3. Clicar em "Editar" no card do registro no DOM
    const cardEditBtn = compiled.querySelector('article[data-record-id="rec-jornada-1"] button.secondary') as HTMLButtonElement;
    expect(cardEditBtn).not.toBeNull();
    cardEditBtn.click();
    fixture.detectChanges();

    // Cabeçalho deve refletir modo de edição
    const formHeading = compiled.querySelector('#record-form-heading');
    expect(formHeading?.textContent).toContain('Editar registro');

    // 4. Finalizar o registro (mudar status para ACTIVE no DOM)
    const statusSelect = compiled.querySelector('select[formControlName="status"]') as HTMLSelectElement;
    statusSelect.value = 'ACTIVE';
    statusSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const finalizedRecord: CareRecord = {
      ...newCreatedRecord,
      status: 'ACTIVE',
      version: 2
    };
    apiService.updateRecord.and.returnValue(of(finalizedRecord));

    const saveChangesBtn = compiled.querySelector('.create-panel button[type="submit"]') as HTMLButtonElement;
    saveChangesBtn.click();
    fixture.detectChanges();

    expect(apiService.updateRecord).toHaveBeenCalledWith(
      1,
      'rec-jornada-1',
      jasmine.objectContaining({
        status: 'ACTIVE',
        version: 1
      })
    );

    // Lista atualizada com status Ativo
    expect(component.records().find(r => r.id === 'rec-jornada-1')?.status).toBe('ACTIVE');
    expect(component.editingRecord()).toBeNull();
  });
});

describe('ApiService - CareRecord updateRecord', () => {
  let service: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('faz requisição PUT para /api/v1/students/:studentId/records/:id', () => {
    const payload = {
      caseId: 50,
      subjectId: 100,
      type: 'PEDAGOGICAL_GUIDANCE',
      status: 'ACTIVE',
      title: 'Título atualizado',
      content: { notes: 'Notas atualizadas' },
      version: 1
    };

    service.updateRecord(1, 'rec-1', payload).subscribe();

    const req = http.expectOne('/api/v1/students/1/records/rec-1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual(payload);
    req.flush({ id: 'rec-1', ...payload });
  });
});
