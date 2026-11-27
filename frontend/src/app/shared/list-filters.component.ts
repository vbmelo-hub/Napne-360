import { ChangeDetectionStrategy, Component, computed, input, viewChild, ElementRef } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ListFilters } from '../core/list-view';
import { AppliedFiltersComponent } from './applied-filters.component';
import { FilterDisclosureComponent } from './filter-disclosure.component';

@Component({
  selector: 'app-list-filters',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, AppliedFiltersComponent, FilterDisclosureComponent],
  template: `
    <div class="filter-toolbar" role="group" [attr.aria-label]="label()">
      <label class="toolbar-search">{{label()}}
        <input #search type="search" [value]="list().query()" [placeholder]="placeholder()"
          (input)="list().setQuery(search.value)">
      </label>
      @if (advanced()) {
        <app-filter-disclosure [count]="chips().length">
          <div class="toolbar-grid"><ng-container [ngTemplateOutlet]="fields" /></div>
        </app-filter-disclosure>
      } @else {
        <ng-container [ngTemplateOutlet]="fields" />
      }
      @if (active()) {
        <button type="button" class="toolbar-aux" (click)="clear()">Limpar filtros</button>
      }
    </div>
    <app-applied-filters [filters]="chips()" [fallbackFocus]="search" (removed)="remove($event)" />
    @if (showCount()) {
      <p class="toolbar-results" role="status">{{list().totalElements()}} {{list().totalElements() === 1 ? 'resultado' : 'resultados'}}</p>
    }
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
  styles: `
    :host { display: block; margin-block: var(--space-2) var(--space-3); }
    .toolbar-results { margin-top: var(--space-2); }
  `,
})
export class ListFiltersComponent {
  readonly list = input.required<ListFilters>();
  readonly label = input('Buscar');
  readonly placeholder = input('');
  readonly showCount = input(true);
  protected readonly advanced = computed(() => this.list().fields().length > 3);
  private readonly searchField = viewChild.required<ElementRef<HTMLInputElement>>('search');
  protected readonly chips = computed(() => this.list().fields().flatMap(field => {
    const value = this.value(field.key);
    const display = field.options.find(option => option.value === value)?.label ?? value;
    return value ? [{ key: field.key, label: field.label, value: display }] : [];
  }));
  protected readonly active = computed(() => !!this.list().query() || this.chips().length > 0);

  focusSearch(preventScroll = false): void { this.searchField().nativeElement.focus({ preventScroll }); }

  protected value(key: string): string { return this.list().filters()[key] ?? ''; }

  protected remove(key: string): void {
    this.list().setFilter(key, '');
  }

  protected clear(): void {
    this.list().reset();
    this.focusSearch();
  }
}
