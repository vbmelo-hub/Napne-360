import { AfterViewChecked, Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';

@Component({
  selector: 'app-modal-shell',
  standalone: true,
  template: `
    @if (open) {
      <div class="modal-backdrop">
        <section #dialog class="modal" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" [attr.aria-describedby]="description ? descriptionId : null" (keydown)="trapFocus($event)">
          <header class="modal-header">
            <div><span class="eyebrow">{{ eyebrow }}</span><h2 [id]="titleId">{{ title }}</h2>@if(description){<p [id]="descriptionId">{{ description }}</p>}</div>
            <button #closeButton type="button" class="icon-button" (click)="close()" aria-label="Fechar janela">×</button>
          </header>
          <ng-content />
        </section>
      </div>
    }
  `,
  styles: [`.modal-header{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;margin-bottom:var(--space-5)}.modal-header h2{margin:.15rem 0}.modal-header p{margin:0;color:var(--ink-600);max-width:42rem}.modal-header .icon-button{flex:0 0 auto;margin-top:-.35rem;margin-right:-.35rem}`]
})
export class ModalShellComponent implements OnChanges, AfterViewChecked {
  @Input() open = false;
  @Input() eyebrow = 'Ação';
  @Input() title = '';
  @Input() description = '';
  @Output() closed = new EventEmitter<void>();

  @ViewChild('dialog') private dialog?: ElementRef<HTMLElement>;
  @ViewChild('closeButton') private closeButton?: ElementRef<HTMLButtonElement>;

  readonly titleId = `modal-${Math.random().toString(36).slice(2)}`;
  readonly descriptionId = `${this.titleId}-description`;
  private focusWhenRendered = false;
  private previousFocus: HTMLElement | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    const openChange = changes['open'];
    if (!openChange) return;
    if (openChange.currentValue === true) {
      this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.focusWhenRendered = true;
    } else if (openChange.previousValue === true) {
      const previous = this.previousFocus;
      this.previousFocus = null;
      queueMicrotask(() => previous?.focus());
    }
  }

  ngAfterViewChecked(): void {
    if (!this.focusWhenRendered || !this.closeButton) return;
    this.focusWhenRendered = false;
    this.closeButton.nativeElement.focus();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void { if (this.open) this.close(); }

  close(): void { if (this.open) this.closed.emit(); }

  trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !this.dialog) return;
    const elements = Array.from(this.dialog.nativeElement.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
    if (elements.length === 0) return;
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
}
