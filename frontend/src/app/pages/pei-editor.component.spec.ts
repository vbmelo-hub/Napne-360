import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
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
