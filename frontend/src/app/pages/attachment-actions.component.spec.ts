import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Attachment } from '../core/models';
import { ToastService } from '../core/toast.service';
import { AttachmentActionsComponent } from './attachment-actions.component';

describe('AttachmentActionsComponent', () => {
  const item: Attachment = {
    id: 'documento', studentId: 7, previousVersionId: null, revision: 1, archived: false,
    category: 'Relatório', originalName: 'relatorio.png', contentType: 'image/png',
    size: 10, uploadedBy: 'napne', uploadedAt: '2026-01-01T12:00:00Z'
  };
  let fixture: ComponentFixture<AttachmentActionsComponent>;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>('ApiService', [
      'archiveAttachment', 'attachmentVersions', 'downloadAttachment'
    ]);
    TestBed.configureTestingModule({
      imports: [AttachmentActionsComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['show']) }
      ]
    });
    fixture = TestBed.createComponent(AttachmentActionsComponent);
    fixture.componentRef.setInput('attachment', item);
    fixture.detectChanges();
  });

  function click(label: string) {
    const element: HTMLElement = fixture.nativeElement;
    const button = Array.from(element.querySelectorAll('button')).find(b => b.textContent?.trim() === label);
    expect(button).withContext(label).toBeDefined();
    button?.click();
    fixture.detectChanges();
  }

  it('waits for explicit confirmation and the successful DELETE response', () => {
    const response = new Subject<void>();
    api.archiveAttachment.and.returnValue(response);
    const archived = jasmine.createSpy('archived');
    fixture.componentInstance.archived.subscribe(archived);
    click('Arquivar');
    click('Cancelar');
    expect(api.archiveAttachment).not.toHaveBeenCalled();
    click('Arquivar');
    click('Confirmar arquivamento');
    expect(api.archiveAttachment).toHaveBeenCalledOnceWith(7, 'documento');
    expect(archived).not.toHaveBeenCalled();
    response.next();
    expect(archived).toHaveBeenCalledOnceWith('documento');
  });

  it('shows archived revisions in history without a preview button for them', () => {
    api.attachmentVersions.and.returnValue(of([{ ...item, archived: true }]));
    click('Versões');
    const dialog: HTMLDialogElement = fixture.nativeElement.querySelector('dialog');
    expect(dialog.textContent).toContain('Arquivado');
    expect(dialog.textContent).not.toContain('Visualizar');
  });

  it('renders an authenticated blob preview and releases the URL on close', () => {
    const blob = new Blob(['image'], { type: 'image/png' });
    api.downloadAttachment.and.returnValue(of(blob));
    spyOn(URL, 'createObjectURL').and.returnValue('blob:preview');
    spyOn(URL, 'revokeObjectURL');
    click('Visualizar');
    expect(api.downloadAttachment).toHaveBeenCalledOnceWith(7, 'documento');
    expect(URL.createObjectURL).toHaveBeenCalledOnceWith(blob);
    expect(fixture.nativeElement.querySelector('dialog img').getAttribute('src')).toBe('blob:preview');
    click('Fechar');
    expect(URL.revokeObjectURL).toHaveBeenCalledOnceWith('blob:preview');
  });

  it('refuses a response with a MIME type different from the attachment', () => {
    api.downloadAttachment.and.returnValue(of(new Blob(['<svg></svg>'], { type: 'image/svg+xml' })));
    spyOn(URL, 'createObjectURL');
    click('Visualizar');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('dialog [role="alert"]').textContent).toContain('Baixar');
  });

  it('opens PDF as a local URL in the dialog and revokes it on destruction', () => {
    fixture.componentRef.setInput('attachment', { ...item, contentType: 'application/pdf' });
    fixture.detectChanges();
    const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
    api.downloadAttachment.and.returnValue(of(blob));
    spyOn(URL, 'createObjectURL').and.returnValue('blob:pdf-preview');
    spyOn(URL, 'revokeObjectURL');
    click('Visualizar');
    expect(fixture.nativeElement.querySelector('dialog iframe').getAttribute('src')).toBe('blob:pdf-preview');
    fixture.destroy();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnceWith('blob:pdf-preview');
  });
});
