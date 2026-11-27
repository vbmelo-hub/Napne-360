import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, inject, input, output, viewChildren } from '@angular/core';

export interface AppliedFilter {
  key: string;
  label: string;
  value: string;
}

export function appliedFilterItems(
  values: Readonly<Record<string, string | undefined>>,
  labels: Readonly<Record<string, string>>,
  display: Readonly<Record<string, (value: string) => string>> = {},
): AppliedFilter[] {
  return Object.entries(labels).flatMap(([key, label]) => {
    const value = values[key]?.trim();
    return value ? [{ key, label, value: display[key]?.(value) ?? value }] : [];
  });
}

@Component({
  selector: 'app-applied-filters',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (filters().length) {
      <ul aria-label="Filtros ativos">
        @for (filter of filters(); track filter.key; let index = $index) {
          <li>
            <button #filterControl type="button" class="secondary compact" (click)="remove(filter.key, index)"
              [attr.aria-label]="'Remover filtro ' + filter.label + ': ' + filter.value">
              {{filter.label}}: {{filter.value}} <span aria-hidden="true">×</span>
            </button>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    ul { list-style: none; display: flex; flex-wrap: wrap; gap: .4rem; padding: 0; margin: .5rem 0; }
    li { min-width: 0; }
    button { text-align: left; overflow-wrap: anywhere; }
  `,
})
export class AppliedFiltersComponent {
  readonly filters = input.required<readonly AppliedFilter[]>();
  readonly fallbackFocus = input.required<HTMLElement>();
  readonly removed = output<string>();
  private readonly injector = inject(Injector);
  private readonly controls = viewChildren<ElementRef<HTMLButtonElement>>('filterControl');

  protected remove(key: string, index: number): void {
    this.removed.emit(key);
    afterNextRender(() => {
      const controls = this.controls();
      const next = controls[Math.min(index, controls.length - 1)]?.nativeElement;
      (next ?? this.fallbackFocus()).focus();
    }, { injector: this.injector });
  }
}
