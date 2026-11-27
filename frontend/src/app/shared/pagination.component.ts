import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

@Component({
  selector: 'app-pagination',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (totalPages() > 1 || (showSinglePage() && totalPages() === 1)) {
      <nav class="pager" [attr.aria-label]="label()">
        <span class="pagination-info" aria-live="polite">Página {{page() + 1}} de {{totalPages()}}</span>
        @if (totalPages() > 1) {
          <ul class="page-list">
            <li><button type="button" class="page-link" (click)="select(page() - 1)"
              [disabled]="page() === 0">Anterior</button></li>
            @for (item of pageLinks(); track item) {
              <li>
                @if (typeof item === 'number') {
                  <button type="button" class="page-link" (click)="select(item)"
                    [attr.aria-current]="item === page() ? 'page' : null"
                    [attr.aria-label]="'Página ' + (item + 1)">{{item + 1}}</button>
                } @else {
                  <span class="page-link page-gap" aria-hidden="true">…</span>
                }
              </li>
            }
            <li><button type="button" class="page-link" (click)="select(page() + 1)"
              [disabled]="page() >= totalPages() - 1">Próxima</button></li>
          </ul>
        }
      </nav>
    }
  `,
  styles: [`
    .pager {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: .5rem 1rem;
      margin: 1rem 0 0;
    }
    .page-list {
      display: flex;
      flex-wrap: wrap;
      gap: .2rem;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .page-link {
      display: grid;
      place-items: center;
      min-width: 2.25rem;
      min-height: 2.25rem;
      padding: .3rem .55rem;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      background: var(--surface);
      color: var(--primary-800);
      font-size: .875rem;
    }
    .page-link:hover:not(:disabled) { background: var(--primary-100); }
    .page-link[aria-current='page'], .page-link[aria-current='page']:hover {
      background: var(--primary-700);
      border-color: var(--primary-700);
      color: white;
    }
    .page-link:disabled, .page-gap { background: var(--surface-soft); color: var(--ink-600); opacity: 1; }
  `],
})
export class PaginationComponent {
  readonly page = input.required<number>();
  readonly totalPages = input.required<number>();
  readonly label = input('Paginação');
  readonly showSinglePage = input(false);
  readonly pageChange = output<number>();

  protected readonly pageLinks = computed(() => {
    const count = this.totalPages();
    if (count <= 7) return Array.from({ length: count }, (_, index) => index);

    const start = Math.max(1, Math.min(this.page() - 1, count - 4));
    const pages = [0, start, start + 1, start + 2, count - 1];
    return pages.flatMap((value, index) => {
      const gap = index ? value - pages[index - 1] : 0;
      if (gap === 2) return [value - 1, value];
      return gap > 2 ? [`gap-${value}`, value] : [value];
    });
  });

  protected select(page: number) {
    if (page >= 0 && page < this.totalPages() && page !== this.page()) this.pageChange.emit(page);
  }
}
