import { Component, inject } from '@angular/core';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-toast-outlet', standalone: true,
  template: `<div class="toast-region" aria-live="polite" aria-atomic="false">@for (item of toast.messages(); track item.id) {<div class="toast" [class]="'toast toast--' + item.tone"><span>{{ item.text }}</span><button type="button" class="icon-button" (click)="toast.dismiss(item.id)" aria-label="Fechar mensagem">×</button></div>}</div>`
})
export class ToastOutletComponent { readonly toast = inject(ToastService); }
