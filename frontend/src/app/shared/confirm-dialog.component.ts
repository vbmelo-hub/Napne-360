import { AfterViewChecked, Component, ElementRef, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges, ViewChild } from '@angular/core';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  template: `
    @if (open) {
      <div class="dialog-backdrop">
        <section #dialog class="dialog" role="alertdialog" aria-modal="true" [attr.aria-labelledby]="dialogId" [attr.aria-describedby]="descriptionId" (keydown)="trapFocus($event)">
          <span class="dialog-mark" aria-hidden="true">!</span>
          <h2 [id]="dialogId">{{ title }}</h2>
          <p [id]="descriptionId">{{ description }}</p>
          <div class="dialog-actions">
            <button #cancelButton type="button" class="secondary" (click)="cancel()">Cancelar</button>
            <button type="button" [class.danger]="danger" (click)="confirmed.emit()">{{ confirmLabel }}</button>
          </div>
        </section>
      </div>
    }
  `
})
export class ConfirmDialogComponent implements OnChanges, AfterViewChecked {
  @Input() open = false;
  @Input() title = 'Confirmar ação';
  @Input() description = '';
  @Input() confirmLabel = 'Confirmar';
  @Input() danger = false;
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  @ViewChild('dialog') private dialog?: ElementRef<HTMLElement>;
  @ViewChild('cancelButton') private cancelButton?: ElementRef<HTMLButtonElement>;

  readonly dialogId = `confirm-${Math.random().toString(36).slice(2)}`;
  readonly descriptionId = `${this.dialogId}-description`;
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
    if (!this.focusWhenRendered || !this.cancelButton) return;
    this.focusWhenRendered = false;
    this.cancelButton.nativeElement.focus();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) this.cancel();
  }

  cancel(): void {
    if (this.open) this.cancelled.emit();
  }

  trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !this.dialog) return;
    const elements = Array.from(this.dialog.nativeElement.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
    if (elements.length === 0) return;
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
