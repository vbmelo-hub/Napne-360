import { ChangeDetectionStrategy, Component, computed, input, signal, viewChild, ElementRef } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ListFilters } from '../core/list-view';

@Component({
  selector: 'app-list-filters',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  template: `
    <div class="list-toolbar" role="group" [attr.aria-label]="label()">
      <label class="toolbar-search">{{label()}}
        <input #search type="search" [value]="list().query()" [placeholder]="placeholder()"
          (input)="list().setQuery(search.value)">
      </label>
      @if (advanced()) {
        <button type="button" class="secondary compact filters-toggle" [attr.aria-expanded]="expanded()"
          (click)="expanded.set(!expanded())">Filtros{{chips().length ? ' (' + chips().length + ')' : ''}}</button>
      } @else {
        <ng-container [ngTemplateOutlet]="fields" />
      }
      <div class="toolbar-summary">
        @if (showCount()) {
          <span class="meta" aria-live="polite">{{list().totalElements()}} {{list().totalElements() === 1 ? 'resultado' : 'resultados'}}</span>
        }
        @if (active()) {
          <button type="button" class="secondary compact" (click)="clear(search)">Limpar filtros</button>
        }
      </div>
      @if (advanced() && expanded()) {
        <div class="toolbar-fields"><ng-container [ngTemplateOutlet]="fields" /></div>
      }
      @if (advanced() && chips().length) {
        <div class="toolbar-chips" aria-label="Filtros ativos">
          @for (chip of chips(); track chip.key) {
            <button type="button" class="secondary compact" [attr.aria-label]="'Remover filtro ' + chip.label"
              (click)="remove(chip.key)">{{chip.label}} <span aria-hidden="true">×</span></button>
          }
        </div>
      }
    </div>
    <ng-template #fields>
      @for (field of list().fields(); track field.key) {
        @if (field.kind === 'select') {
          <label>{{field.label}}
            <select #choice [value]="value(field.key)" (change)="list().setFilter(field.key, choice.value)">
              <option value="">Todos</option>
              @for (option of field.options; track option.value) {
                <option [value]="option.value" [selected]="list().filters()[field.key] === option.value">{{option.label}}</option>
              }
            </select>
          </label>
        } @else {
          <label>{{field.label}}
            <input #date type="date" [value]="value(field.key)"
              (change)="list().setFilter(field.key, date.value)">
          </label>
        }
      }
    </ng-template>
  `,
  styles: [`
    .list-toolbar{display:flex;align-items:end;flex-wrap:wrap;gap:.5rem .75rem;margin:.65rem 0 1rem;padding:.65rem .75rem;background:var(--surface-soft);border-radius:var(--radius-sm)}
    label{flex:1 1 8rem;min-width:0;font-size:.82rem;gap:.2rem}
    label.toolbar-search{flex:2 1 13rem}
    input,select{min-height:2.25rem;padding:.32rem .55rem;font-size:.875rem;width:100%;min-width:0}
    .toolbar-fields,.toolbar-chips{flex-basis:100%;display:flex;flex-wrap:wrap;align-items:end;gap:.5rem .75rem}
    .toolbar-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,10rem),1fr));border-top:1px solid var(--border);padding-top:.5rem}
    .filters-toggle{min-height:2.25rem}
    .toolbar-summary{display:flex;gap:.5rem;align-items:center;min-height:2.25rem;flex-wrap:wrap}
  `],
})
export class ListFiltersComponent {
  readonly list = input.required<ListFilters>();
  readonly label = input('Buscar');
  readonly placeholder = input('');
  readonly showCount = input(true);
  protected readonly expanded = signal(false);
  protected readonly advanced = computed(() => this.list().fields().length > 3);
  private readonly searchField = viewChild.required<ElementRef<HTMLInputElement>>('search');
  protected readonly chips = computed(() => this.list().fields().flatMap(field => {
    const value = this.value(field.key);
    const display = field.options.find(option => option.value === value)?.label ?? value;
    return value ? [{ key: field.key, label: `${field.label}: ${display}` }] : [];
  }));
  protected readonly active = computed(() => !!this.list().query() || this.chips().length > 0);

  focusSearch(preventScroll = false): void { this.searchField().nativeElement.focus({ preventScroll }); }

  protected value(key: string): string { return this.list().filters()[key] ?? ''; }

  protected remove(key: string): void {
    this.list().setFilter(key, '');
    this.focusSearch();
  }

  protected clear(search: HTMLInputElement): void {
    this.list().reset();
    search.focus();
  }
}
