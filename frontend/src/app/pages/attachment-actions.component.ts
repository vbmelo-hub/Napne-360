import { DatePipe } from '@angular/common';
import { Component, DestroyRef, ElementRef, inject, input, output, signal, viewChild } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subscription, finalize } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Attachment } from '../core/models';
import { createListView } from '../core/list-view';
import { PaginationComponent } from '../shared/pagination.component';
import { errorMessage } from '../core/presentation';
import { ToastService } from '../core/toast.service';

const PREVIEW_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

@Component({
  selector: 'app-attachment-actions',
  imports: [DatePipe, PaginationComponent],
  template: `
    <div class="actions">
      @if (canPreview(attachment())) {
        <button type="button" class="secondary compact" (click)="showPreview(attachment())">Visualizar</button>
      }
      <button type="button" class="secondary compact" (click)="showVersions()">Versões</button>
      @if (!attachment().archived) {
        <button type="button" class="secondary compact" [disabled]="archiveDisabled()"
          (click)="showArchive()">Arquivar</button>
      }
    </div>

    <dialog #dialog [attr.aria-label]="dialogTitle()" (cancel)="cancel($event)">
      <header class="actions modal-heading">
        <h2>{{ dialogTitle() }}</h2>
        <button type="button" class="secondary compact"
          [disabled]="mode() === 'archive' && busy()" (click)="close()">
          {{ mode() === 'archive' ? 'Cancelar' : 'Fechar' }}
        </button>
      </header>
      @if (error()) { <p role="alert">{{ error() }}</p> }
      @switch (mode()) {
        @case ('archive') {
          <p>Arquivar <strong>{{ attachment().originalName }}</strong>?
            O arquivo sairá da lista de documentos disponíveis e a revisão continuará no histórico da série.</p>
          <button type="button" class="danger" [disabled]="busy() || archiveDisabled()" (click)="confirmArchive()">
            {{ busy() ? 'Arquivando…' : 'Confirmar arquivamento' }}
          </button>
        }
        @case ('versions') {
          @if (busy()) { <p role="status">Carregando versões…</p> }
          @if (versions().length > 0) {
            <label>Buscar versões por arquivo, categoria ou autoria
              <input type="search" [value]="versionList.query()" (input)="versionList.setQuery($any($event.target).value)">
            </label>
          }
          <ul class="versions">
            @for (version of versionList.items(); track version.id) {
              <li>
                <strong>{{ version.originalName }} · revisão {{ version.revision }}</strong>
                <span>{{ version.category }} · {{ version.archived ? 'Arquivado' : 'Disponível' }}</span>
                <span>{{ version.uploadedBy }} · {{ version.uploadedAt | date:'dd/MM/yyyy, HH:mm' }}</span>
                @if (canPreview(version)) {
                  <button type="button" class="secondary compact" (click)="showPreview(version, true)">
                    Visualizar revisão {{ version.revision }}
                  </button>
                }
              </li>
            }
          </ul>
          @if (versions().length && !versionList.totalElements()) {
            <p role="status">Nenhuma versão corresponde à busca.</p>
          }
          <app-pagination [page]="versionList.page()" [totalPages]="versionList.totalPages()"
            label="Páginas das versões do documento" (pageChange)="versionList.setPage($event)" />
        }
        @case ('preview') {
          @if (fromVersions()) {
            <button type="button" class="secondary compact" (click)="backToVersions()">Voltar às versões</button>
          }
          @if (busy()) { <p role="status">Carregando visualização…</p> }
          @if (pdfUrl(); as pdf) {
            <iframe [src]="pdf" [title]="'Visualização de ' + previewName()" referrerpolicy="no-referrer"></iframe>
          } @else if (imageUrl(); as image) {
            <img [src]="image" [alt]="previewName()" (error)="previewFailed()">
          }
        }
      }
    </dialog>
  `,
  styles: [`
    .actions { display: flex; gap: .5rem; flex-wrap: wrap; }
    .modal-heading { align-items: center; justify-content: space-between; margin-bottom: 1rem; }
    h2 { margin: 0; }
    dialog { width: min(52rem, calc(100% - 2rem)); max-height: calc(100dvh - 2rem);
      border: 1px solid var(--border); border-radius: var(--radius-xl); padding: 1.25rem; color: var(--ink-950); }
    dialog::backdrop { background: rgb(7 31 25 / 58%); }
    .versions { display: grid; gap: .75rem; padding: 0; list-style: none; }
    .versions li { display: grid; justify-items: start; gap: .25rem; padding-top: .75rem;
      border-top: 1px solid var(--border); overflow-wrap: anywhere; }
    iframe, img { display: block; margin: .75rem auto 0; max-width: 100%; }
    iframe { width: 100%; height: 65vh; border: 1px solid var(--border); }
    img { max-height: 65vh; object-fit: contain; }
  `]
})
export class AttachmentActionsComponent {
  readonly attachment = input.required<Attachment>();
  readonly archiveDisabled = input(false);
  readonly archived = output<string>();

  private readonly api = inject(ApiService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly toast = inject(ToastService);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private request?: Subscription;
  private objectUrl?: string;

  readonly mode = signal<'archive' | 'versions' | 'preview'>('versions');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly versions = signal<Attachment[]>([]);
  readonly versionList = createListView(this.versions, item => [
    item.originalName, item.category, item.uploadedBy, item.revision,
  ]);
  readonly fromVersions = signal(false);
  readonly imageUrl = signal('');
  readonly pdfUrl = signal<SafeResourceUrl | null>(null);
  readonly previewName = signal('');

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearRequest());
  }

  canPreview(item: Attachment) {
    return !item.archived && PREVIEW_TYPES.has(item.contentType);
  }

  dialogTitle() {
    switch (this.mode()) {
      case 'archive': return 'Arquivar documento';
      case 'versions': return 'Versões do documento';
      case 'preview': return 'Visualização do documento';
    }
  }

  showArchive() {
    this.open('archive');
  }

  confirmArchive() {
    if (this.busy() || this.archiveDisabled()) return;
    const item = this.attachment();
    this.error.set('');
    this.busy.set(true);
    this.request = this.api.archiveAttachment(item.studentId, item.id).pipe(
      finalize(() => this.busy.set(false))
    ).subscribe({
      next: () => {
        this.dialog().nativeElement.close();
        this.toast.show('Documento arquivado.', 'success');
        this.archived.emit(item.id);
      },
      error: failure => this.error.set(failure.status === 503
        ? 'O arquivamento ainda não pôde ser confirmado. Tente novamente.'
        : errorMessage(failure, 'arquivar o documento'))
    });
  }

  showVersions() {
    this.open('versions');
    this.versionList.reset();
    this.versions.set([]);
    this.busy.set(true);
    const item = this.attachment();
    this.request = this.api.attachmentVersions(item.studentId, item.id).pipe(
      finalize(() => this.busy.set(false))
    ).subscribe({
      next: versions => this.versions.set(versions),
      error: failure => this.error.set(errorMessage(failure, 'consultar as versões'))
    });
  }

  showPreview(item: Attachment, fromVersions = false) {
    if (!this.canPreview(item)) return;
    this.open('preview');
    this.fromVersions.set(fromVersions);
    this.previewName.set(item.originalName);
    this.busy.set(true);
    this.request = this.api.downloadAttachment(item.studentId, item.id).pipe(
      finalize(() => this.busy.set(false))
    ).subscribe({
      next: blob => {
        if (blob.type !== item.contentType || !blob.size) {
          this.previewFailed();
          return;
        }
        const url = URL.createObjectURL(blob);
        this.objectUrl = url;
        if (blob.type === 'application/pdf') {
          // The resource URL comes only from the authenticated, MIME-checked Blob above.
          this.pdfUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
        } else {
          this.imageUrl.set(url);
        }
      },
      error: failure => this.error.set(errorMessage(failure, 'visualizar o documento'))
    });
  }

  previewFailed() {
    this.error.set('Não foi possível visualizar este arquivo. Use a opção Baixar.');
  }

  backToVersions() {
    this.open('versions');
  }

  cancel(event: Event) {
    event.preventDefault();
    this.close();
  }

  close() {
    if (this.mode() === 'archive' && this.busy()) return;
    this.clearRequest();
    this.versions.set([]);
    this.dialog().nativeElement.close();
  }

  private open(mode: 'archive' | 'versions' | 'preview') {
    this.clearRequest();
    this.error.set('');
    this.mode.set(mode);
    const dialog = this.dialog().nativeElement;
    if (!dialog.open) dialog.showModal();
  }

  private clearRequest() {
    this.request?.unsubscribe();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = undefined;
    this.imageUrl.set('');
    this.pdfUrl.set(null);
  }
}
