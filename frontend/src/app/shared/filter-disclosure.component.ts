import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';

let nextPanelId = 0;

@Component({
  selector: 'app-filter-disclosure',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="toolbar-aux filters-toggle" [attr.aria-expanded]="expanded()"
      [attr.aria-controls]="panelId" (click)="toggle()">
      Filtros{{count() ? ' (' + count() + ')' : ''}}
    </button>
    <div class="toolbar-panel" [id]="panelId" [hidden]="!expanded()">
      <ng-content />
    </div>
  `,
  styles: ':host { display: contents; }',
})
export class FilterDisclosureComponent {
  readonly count = input(0);
  readonly expandedChange = output<boolean>();
  protected readonly expanded = signal(false);
  protected readonly panelId = `filter-panel-${++nextPanelId}`;

  protected toggle(): void {
    const expanded = !this.expanded();
    this.expanded.set(expanded);
    this.expandedChange.emit(expanded);
  }
}
