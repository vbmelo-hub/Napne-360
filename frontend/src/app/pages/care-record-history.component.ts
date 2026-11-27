import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RECORD_FIELDS } from '../core/care-forms';
import { createListView } from '../core/list-view';
import { CareRecord } from '../core/models';
import { labelFor, toneFor } from '../core/presentation';
import { PaginationComponent } from '../shared/pagination.component';

@Component({
  selector: 'app-care-record-history',
  imports: [DatePipe, PaginationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <details class="record-history">
      <summary>Histórico de versões ({{record().history?.length}})</summary>
      <label class="list-filter">
        Buscar versões por título, autoria ou situação
        <input type="search" [value]="revisions.query()" (input)="revisions.setQuery($any($event.target).value)">
      </label>
      <div class="history-revisions">
        @for (revision of revisions.items(); track revision.version ?? revision) {
          <article class="revision-card">
            <header class="revision-header">
              <strong>Versão {{revision.version ?? 'anterior'}}: {{revision.title}}</strong>
              <span [class]="'badge badge--' + tone(revision.status)">{{label(revision.status)}}</span>
            </header>
            <small>{{revision.author}} · {{revision.occurredAt | date:'dd/MM/yyyy, HH:mm'}}</small>
            <div class="revision-content">
              @for (field of recordFields[record().type]; track field.key) {
                @if (revision.content[field.key]) {
                  <p><strong>{{field.label}}:</strong> <span>{{revision.content[field.key]}}</span></p>
                }
              }
              @if (revision.content['notes']) {
                <p><strong>Comentários adicionais:</strong> <span>{{revision.content['notes']}}</span></p>
              }
            </div>
          </article>
        } @empty {
          <p>Nenhuma versão corresponde à busca.</p>
        }
      </div>
      <app-pagination [page]="revisions.page()" [totalPages]="revisions.totalPages()"
        [label]="'Páginas de versões de ' + record().title" (pageChange)="revisions.setPage($event)" />
    </details>
  `,
  styles: [`
    .record-history { margin-top: .75rem; padding-top: .75rem; border-top: 1px dashed var(--border); }
    .record-history summary { display: flex; cursor: pointer; font-size: .85rem; font-weight: 600; color: var(--ink-700); }
    .history-revisions { margin-top: .5rem; display: grid; gap: .5rem; }
    .revision-card { background: var(--surface-soft); border: 1px solid var(--border); border-radius: .4rem; padding: .5rem; font-size: .8rem; }
    .revision-header { display: flex; justify-content: space-between; align-items: center; gap: .5rem; }
    .revision-card p { margin: .25rem 0 0; color: var(--ink-700); }
  `],
})
export class CareRecordHistoryComponent {
  readonly record = input.required<CareRecord>();
  protected readonly recordFields = RECORD_FIELDS;
  protected readonly label = labelFor;
  protected readonly tone = toneFor;
  protected readonly revisions = createListView(() => this.record().history ?? [], revision => [
    revision.title, revision.author, labelFor(revision.status), `Versão ${revision.version ?? 'anterior'}`,
  ]);
}
