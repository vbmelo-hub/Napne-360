import { Injectable, signal } from '@angular/core';

export interface ToastMessage { id: number; text: string; tone: 'success' | 'error' | 'info'; }

@Injectable({ providedIn: 'root' })
export class ToastService {
  private sequence = 0;
  readonly messages = signal<ToastMessage[]>([]);

  show(text: string, tone: ToastMessage['tone'] = 'info'): void {
    const id = ++this.sequence;
    this.messages.update(items => [...items, { id, text, tone }]);
    window.setTimeout(() => this.dismiss(id), 6500);
  }

  dismiss(id: number): void { this.messages.update(items => items.filter(item => item.id !== id)); }
}
