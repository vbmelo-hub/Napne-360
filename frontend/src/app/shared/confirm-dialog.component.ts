import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-confirm-dialog', standalone: true,
  template: `@if (open) {<div class="dialog-backdrop"><section class="dialog" role="alertdialog" aria-modal="true" [attr.aria-labelledby]="dialogId"><span class="dialog-mark" aria-hidden="true">!</span><h2 [id]="dialogId">{{ title }}</h2><p>{{ description }}</p><div class="dialog-actions"><button type="button" class="secondary" (click)="cancelled.emit()">Cancelar</button><button type="button" [class.danger]="danger" (click)="confirmed.emit()">{{ confirmLabel }}</button></div></section></div>}`
})
export class ConfirmDialogComponent {
  @Input() open = false;
  @Input() title = 'Confirmar ação';
  @Input() description = '';
  @Input() confirmLabel = 'Confirmar';
  @Input() danger = false;
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();
  readonly dialogId = `confirm-${Math.random().toString(36).slice(2)}`;
}
