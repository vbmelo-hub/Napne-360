import { DOCUMENT } from '@angular/common';
import { Directive, inject, input } from '@angular/core';

@Directive({
  selector: 'a[appPageFragment]',
  host: {
    '[attr.href]': 'href',
    '(click)': 'navigate($event)',
  },
})
export class PageFragmentDirective {
  readonly appPageFragment = input.required<string>();
  private readonly document = inject(DOCUMENT);

  protected get href(): string {
    const { pathname, search } = this.document.location;
    return `${pathname}${search}#${this.appPageFragment()}`;
  }

  protected navigate(event: MouseEvent): void {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = this.document.getElementById(this.appPageFragment());
    if (!target) return;
    event.preventDefault();
    if (target instanceof HTMLDetailsElement) target.open = true;
    const focusTarget = target.querySelector<HTMLElement>(':scope > summary') ?? target;
    if (focusTarget.tabIndex < 0) focusTarget.tabIndex = -1;
    focusTarget.focus({ preventScroll: true });
    target.scrollIntoView({ block: 'start' });
  }
}
