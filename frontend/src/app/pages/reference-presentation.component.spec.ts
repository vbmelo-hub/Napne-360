import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { ApiService } from '../core/api.service';
import { ToastService } from '../core/toast.service';
import { AdminReferencesComponent } from './admin-references.component';
import { PeiEditorComponent } from './pei-editor.component';
import { Pei } from '../core/models';

describe('Apresentação de referências', () => {
  it('trava código e tipo na edição administrativa mantendo o payload original', async () => {
    const entry = { id: 11, kind: 'NEED_CATEGORY', code: 'CAT', label: 'Nome', description: '', active: true, version: 1 };
    const api = jasmine.createSpyObj<ApiService>('ApiService', ['adminReferences', 'adminTemplates', 'updateReference']);
    api.adminReferences.and.returnValue(of([entry])); api.adminTemplates.and.returnValue(of([]));
    api.updateReference.and.returnValue(of(entry));
    await TestBed.configureTestingModule({ imports: [AdminReferencesComponent], providers: [
      { provide: ApiService, useValue: api },
      { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['show']) }
    ] }).compileComponents();
    const fixture = TestBed.createComponent(AdminReferencesComponent); fixture.detectChanges();
    const dom = fixture.nativeElement as HTMLElement;
    fixture.componentInstance.editEntry(entry); fixture.detectChanges();
    const code = dom.querySelector<HTMLInputElement>('input[formControlName="code"]')!;
    const kind = dom.querySelector<HTMLSelectElement>('select[formControlName="kind"]')!;
    expect(code.matches(':disabled') || code.readOnly).toBeTrue(); expect(kind.matches(':disabled')).toBeTrue();
    const name = dom.querySelector<HTMLInputElement>('input[formControlName="label"]')!;
    name.value = 'Nome revisado'; name.dispatchEvent(new Event('input'));
    dom.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit')); fixture.detectChanges();
    expect(api.updateReference).toHaveBeenCalledWith(11, { kind: 'NEED_CATEGORY', code: 'CAT', label: 'Nome revisado', description: '' });
    fixture.componentInstance.clearEntry(); fixture.detectChanges();
    expect(code.matches(':disabled') || code.readOnly).toBeFalse(); expect(kind.matches(':disabled')).toBeFalse();
  });

  for (const [snapshot, displayed] of [[undefined, '2025.2'], ['Período histórico', 'Período histórico']] as const) {
    it(`mostra período do PEI por ${snapshot ? 'snapshot' : 'legado'} sem catálogo`, async () => {
      const pei = { id: 'pei-1', studentId: 1, subjectId: 100, teacherId: 2, academicTerm: '2025.2', academicTermLabel: snapshot,
        revision: 1, status: 'DRAFT', content: { generalObjectives: 'Objetivo' }, reviewedBy: null, reviewedAt: null,
        updatedAt: '2026-11-17T12:00:00Z' } as Pei;
      const api = jasmine.createSpyObj<ApiService>('ApiService', ['pei']); api.pei.and.returnValue(of(pei));
      const params = convertToParamMap({ studentId: '1', peiId: 'pei-1' });
      await TestBed.configureTestingModule({ imports: [PeiEditorComponent], providers: [provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: params }, paramMap: of(params) } },
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['show']) }
      ] }).compileComponents();
      const fixture = TestBed.createComponent(PeiEditorComponent); fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('.pei-header p')?.textContent).toContain(displayed);
    });
  }
});
