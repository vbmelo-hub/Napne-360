import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Pei } from '../core/models';
import { ToastService } from '../core/toast.service';
import { PeiEditorComponent } from './pei-editor.component';

describe('PeiEditorComponent — ações D04', () => {
  let fixture: ComponentFixture<PeiEditorComponent>;
  let api: jasmine.SpyObj<ApiService>;
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
    await TestBed.configureTestingModule({
      imports: [PeiEditorComponent],
      providers: [provideHttpClient(), provideRouter([]),
        { provide: ActivatedRoute, useValue: {
          snapshot: { paramMap: { get: (key: string) => key === 'studentId' ? '1' : 'pei-1' } },
          paramMap: of({ get: (key: string) => key === 'studentId' ? '1' : 'pei-1' })
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

  it('deixa estados sem EDIT somente para consulta e exibe as ações permitidas ao NAPNE', () => {
    const review = { ...draft, status: 'IN_REVIEW', allowedActions: ['RETURN', 'APPROVE'] } as Pei;
    const dom = open(review);
    expect(dom.querySelector('[formControlName="generalObjectives"]')?.matches(':disabled')).toBeTrue();
    expect(dom.textContent).not.toContain('Salvar rascunho');
    expect(dom.textContent).toContain('Devolver para ajustes');
    expect(dom.textContent).toContain('Aprovar PEI');
    expect(dom.textContent).not.toContain('Arquivar PEI');
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
});
