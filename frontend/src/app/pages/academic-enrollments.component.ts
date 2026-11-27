import { AppliedFiltersComponent, appliedFilterItems, type AppliedFilter } from '../shared/applied-filters.component';
import { Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule } from '@angular/forms';
import { Subscription, debounceTime, distinctUntilChanged, map } from 'rxjs';
import { AcademicApi, AcademicEnrollment, AcademicFilterOptions, AcademicListFilters, AcademicOffering } from '../core/academic-api.service';
import { createFilterOptions } from '../core/filter-options';
import { sameFormValue } from '../core/form-changes';
import { Page } from '../core/models';
import { errorMessage } from '../core/presentation';
import { ToastService } from '../core/toast.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { FilterDisclosureComponent } from '../shared/filter-disclosure.component';
import { ModalShellComponent } from '../shared/modal-shell.component';
import { PaginationComponent } from '../shared/pagination.component';
import { SearchableSelectComponent } from '../shared/searchable-select.component';

@Component({
  selector: 'app-academic-enrollments',
  imports: [AppliedFiltersComponent, ReactiveFormsModule, ConfirmDialogComponent, FilterDisclosureComponent, ModalShellComponent, PaginationComponent, SearchableSelectComponent],
  template: `
    <section class="card stack" aria-labelledby="enrollments-title">
      <div class="section-header">
        <div>
          <h2 id="enrollments-title">Matrículas em componentes</h2>
          <p>As matrículas ativas vinculam os docentes da mesma turma e período ao estudante.</p>
        </div>
        @if (allowsNewEnrollments()) {
          <button type="button" (click)="openOptions()" [disabled]="busy()">Registrar matrícula</button>
        }
      </div>
      <form class="server-list-toolbar filter-toolbar" (submit)="$event.preventDefault(); applyFilters()">
        <label class="toolbar-search">Buscar matrículas <input #filterSearch type="search" [formControl]="search"
          (keydown.enter)="$event.preventDefault()" placeholder="Nome ou código"></label>
        <app-filter-disclosure [count]="filteredCount()" (expandedChange)="filterOptionsOpen.set($event)">
          <div class="toolbar-grid" [formGroup]="filters">
            <app-searchable-select label="Componente" formControlName="subjectId" [options]="subjectFilterOptions()"
              selectionPlaceholder="Todos" placeholder="Nome ou código" />
            <label>Período letivo <select formControlName="periodCode" [attr.disabled]="filterOptions.loading() ? '' : null">
              <option value="">Todos</option>
              @for (code of filterOptions.value().periodCodes; track code) { <option [value]="code">{{code}}</option> }
            </select></label>
            <app-searchable-select label="Turma" formControlName="groupCode" [options]="groupFilterOptions()"
              [readonly]="filterOptions.loading() || !!filterOptions.error()"
              selectionPlaceholder="Todas" placeholder="Buscar código da turma" />
            <label>Situação<select formControlName="active"><option value="">Todas</option>
              <option value="true">Ativa</option><option value="false">Encerrada</option>
            </select></label>
          </div>
          @if (filterOptions.loading()) { <p class="meta" role="status">Carregando componentes, períodos e turmas…</p> }
          @if (filterOptions.error(); as error) { <p class="error" role="alert">{{error}}</p> }
          <div class="toolbar-actions"><button class="toolbar-button" type="submit">Aplicar filtros</button></div>
        </app-filter-disclosure>
        @if (filteredCount() || appliedQuery()) {
          <button class="toolbar-aux" type="button" (click)="clearFilters(); filterSearch.focus()">Limpar filtros</button>
        }
      </form>
      @if (appliedItems().length) {
        <app-applied-filters [fallbackFocus]="filterSearch" [filters]="appliedItems()" (removed)="removeFilter($event)" />
      }
      @if (enrollments() && !loading() && !error()) {
        <p class="toolbar-results" role="status">{{enrollments()?.totalElements}} resultado(s)</p>
      }
      @if (error()) {<p class="error" role="alert">{{error()}}</p>}
      @if (loading()) {<p class="meta" role="status">Carregando matrículas…</p>}
      @else if (enrollments()?.content?.length) {
        <div class="table-wrap">
          <table class="mobile-cards">
            <thead><tr><th>Componente</th><th>Turma</th><th>Período</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead>
            <tbody>
              @for (row of enrollments()?.content; track row.id) {
                <tr>
                  <td data-label="Componente">{{row.offering.subjectName}}</td>
                  <td data-label="Turma">{{row.offering.groupCode}}</td>
                  <td data-label="Período">{{row.offering.periodLabel}}</td>
                  <td data-label="Situação"><span [class]="row.active ? 'badge badge--success' : 'badge'">{{row.active ? 'Ativa' : 'Encerrada'}}</span></td>
                  <td>
                    @if (row.active || allowsNewEnrollments()) {
                      <button type="button" class="secondary compact" [disabled]="busy()" (click)="pending.set(row)">
                        {{row.active ? 'Encerrar' : 'Reativar'}}
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <app-pagination label="Paginação das matrículas" [page]="enrollments()?.number ?? 0"
          [totalPages]="enrollments()?.totalPages ?? 0" (pageChange)="load($event)" />
      } @else if (!error()) {<p class="meta">Nenhuma matrícula encontrada.</p>}
    </section>

    <app-modal-shell [open]="showOptions()" title="Registrar matrícula" eyebrow="Trajetória acadêmica"
      description="Selecione uma oferta ativa do curso do estudante." (closed)="closeOptions()">
      <form class="filter-toolbar enrollment-search" (submit)="$event.preventDefault(); searchOptions()">
        <label class="toolbar-search">Buscar ofertas
          <input type="search" [formControl]="optionSearch" placeholder="Nome ou código">
        </label>
        <button class="toolbar-button" type="submit">Buscar</button>
      </form>
      @if (optionError()) {<p class="error" role="alert">{{optionError()}}</p>}
      @if (optionsLoading()) {<p class="meta" role="status">Carregando ofertas…</p>}
      @else if (options()?.content?.length) {
        <ul class="enrollment-options" aria-label="Ofertas para matrícula">
          @for (offer of options()?.content; track offer.id) {
            <li class="enrollment-option">
              <div>
                <strong>{{offer.subjectName}}</strong>
                <span class="meta">Turma {{offer.groupCode}} · {{offer.periodLabel}}</span>
              </div>
              <button type="button" class="secondary compact" [disabled]="busy()" (click)="enroll(offer)">Matricular</button>
            </li>
          }
        </ul>
        <app-pagination label="Paginação das ofertas para matrícula" [page]="options()?.number ?? 0"
          [totalPages]="options()?.totalPages ?? 0" (pageChange)="loadOptions($event)" />
      } @else if (!optionError()) {<p class="meta">Nenhuma oferta ativa encontrada para o curso.</p>}
    </app-modal-shell>

    <app-confirm-dialog [open]="pending() !== null" [title]="pending()?.active ? 'Encerrar matrícula?' : 'Reativar matrícula?'"
      [description]="confirmationText()" [confirmLabel]="pending()?.active ? 'Encerrar matrícula' : 'Reativar matrícula'"
      [danger]="pending()?.active ?? false" (confirmed)="changeStatus()" (cancelled)="pending.set(null)" />
  `,
  styles: `
    .section-header { margin-bottom: 0; }
    .section-header button { flex-shrink: 0; }
    .enrollment-search { flex-wrap: nowrap; margin-bottom: var(--space-4); }
    .enrollment-search .toolbar-search { max-width: none; flex: 1; }
    .enrollment-options { display: grid; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
    .enrollment-option {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      overflow-wrap: anywhere;
    }
    .enrollment-option strong, .enrollment-option .meta { display: block; }
    .enrollment-option button { padding-inline: .6rem; font-size: .875rem; }
    @media (max-width: 500px) {
      .section-header { flex-wrap: wrap; }
      .enrollment-option { column-gap: var(--space-2); }
    }
    @media (max-width: 360px) {
      .enrollment-option { grid-template-columns: 1fr; }
      .enrollment-option button { justify-self: end; }
    }
  `,
})
export class AcademicEnrollmentsComponent {
  private readonly api = inject(AcademicApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  readonly studentId = input.required<number>();
  readonly allowsNewEnrollments = input(true);
  readonly search = new FormControl('', { nonNullable: true });
  readonly filters = inject(FormBuilder).nonNullable.group({subjectId: '', groupCode: '', periodCode: '', active: ''});
  protected readonly filterOptionsOpen = signal(false);
  protected readonly filterOptions = createFilterOptions<AcademicFilterOptions>({ subjects: [], groupCodes: [], periodCodes: [] });
  private readonly filterScope = toSignal(this.filters.valueChanges.pipe(
    map(() => this.currentFilterScope()),
    distinctUntilChanged((previous, current) => sameFormValue(previous, current)),
  ), { initialValue: this.currentFilterScope() });
  protected readonly subjectFilterOptions = computed(() => this.filterOptions.value().subjects
    .map(subject => ({ id: String(subject.id), label: subject.name, detail: subject.code })));
  protected readonly groupFilterOptions = computed(() => this.filterOptions.value().groupCodes
    .map(code => ({ id: code, label: code })));
  protected readonly appliedItems = signal<AppliedFilter[]>([]);
  readonly filteredCount = computed(() => this.appliedItems().length);
  protected readonly appliedQuery = signal('');
  private appliedFilters: AcademicListFilters = {};
  readonly optionSearch = new FormControl('', { nonNullable: true });
  private appliedOptionQuery = '';
  readonly enrollments = signal<Page<AcademicEnrollment> | null>(null);
  readonly options = signal<Page<AcademicOffering> | null>(null);
  readonly showOptions = signal(false);
  readonly loading = signal(false);
  readonly optionsLoading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly optionError = signal('');
  readonly pending = signal<AcademicEnrollment | null>(null);
  readonly confirmationText = computed(() => this.pending()?.active
    ? 'A matrícula ficará no histórico. Docentes sem outra relação acadêmica válida perderão o vínculo correspondente.'
    : 'A oferta precisa estar ativa. As atribuições docentes válidas voltarão a vincular o estudante.');
  private listRequest?: Subscription;
  private optionRequest?: Subscription;

  constructor() {
    effect(() => {
      this.studentId();
      untracked(() => this.load(0));
    });
    effect(() => {
      if (!this.filterOptionsOpen()) {
        this.filterOptions.cancel();
        return;
      }
      this.refreshFilterOptions();
    });
    this.search.valueChanges.pipe(debounceTime(250), takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      const query = value.trim();
      if (this.appliedQuery() === query) return;
      this.appliedQuery.set(query);
      this.load(0);
    });
    const { subjectId, periodCode, groupCode } = this.filters.controls;
    subjectId.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      if (!value) return;
      periodCode.reset();
      groupCode.reset();
    });
    periodCode.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      if (value) groupCode.reset();
    });
  }

  private currentFilterScope() {
    const { subjectId, periodCode } = this.filters.getRawValue();
    return { subjectId, periodCode };
  }

  private refreshFilterOptions() {
    this.filterOptions.load(this.api.enrollmentFilters(this.studentId(), this.filterScope()));
  }

  applyFilters(): void {
    this.appliedQuery.set(this.search.value.trim());
    this.appliedFilters = this.filters.getRawValue();
    this.appliedItems.set(appliedFilterItems({ ...this.appliedFilters }, {
      subjectId: 'Componente', groupCode: 'Turma', periodCode: 'Período letivo', active: 'Situação',
    }, {
      subjectId: id => this.subjectFilterOptions().find(option => option.id === id)?.label ?? id,
      active: value => value === 'true' ? 'Ativa' : 'Encerrada',
    }));
    this.load(0);
  }

  protected removeFilter(key: string): void {
    const control = this.filters.get(key);
    if (!control) return;
    control.reset();
    this.appliedFilters = { ...this.appliedFilters, [key]: '' };
    this.appliedItems.update(items => items.filter(item => item.key !== key));
    this.load(0);
  }

  clearFilters(): void {
    this.search.reset();
    this.filters.reset();
    this.applyFilters();
  }

  load(page: number) {
    this.listRequest?.unsubscribe();
    this.loading.set(true);
    this.error.set('');
    this.listRequest = this.api.enrollments(this.studentId(), page, this.appliedQuery(), this.appliedFilters)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        const lastPage = Math.max(0, result.totalPages - 1);
        if (result.number > lastPage) {
          this.load(lastPage);
          return;
        }
        this.enrollments.set(result);
        this.loading.set(false);
      },
      error: failure => {
        this.loading.set(false);
        this.error.set(errorMessage(failure, 'carregar as matrículas'));
      },
    });
  }

  openOptions() {
    if (!this.allowsNewEnrollments()) return;
    this.optionSearch.reset();
    this.showOptions.set(true);
    this.searchOptions();
  }

  closeOptions() {
    if (this.busy()) return;
    this.optionRequest?.unsubscribe();
    this.showOptions.set(false);
  }

  protected searchOptions() {
    this.appliedOptionQuery = this.optionSearch.value.trim();
    this.loadOptions(0);
  }

  loadOptions(page: number) {
    this.optionRequest?.unsubscribe();
    this.optionsLoading.set(true);
    this.optionError.set('');
    this.optionRequest = this.api.enrollmentOptions(this.studentId(), page, this.appliedOptionQuery)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        this.options.set(result);
        this.optionsLoading.set(false);
      },
      error: failure => {
        this.optionsLoading.set(false);
        this.optionError.set(errorMessage(failure, 'carregar as ofertas'));
      },
    });
  }

  enroll(offer: AcademicOffering) {
    if (this.busy() || !this.allowsNewEnrollments()) return;
    this.busy.set(true);
    this.optionError.set('');
    this.api.createEnrollment(this.studentId(), offer.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busy.set(false);
        this.closeOptions();
        this.toast.show('Matrícula registrada.', 'success');
        this.load(this.enrollments()?.number ?? 0);
        if (this.filterOptionsOpen()) this.refreshFilterOptions();
      },
      error: failure => {
        this.busy.set(false);
        this.optionError.set(errorMessage(failure, 'registrar a matrícula'));
      },
    });
  }

  changeStatus() {
    const candidate = this.pending();
    if (!candidate || this.busy() || !candidate.active && !this.allowsNewEnrollments()) return;
    this.pending.set(null);
    this.error.set('');
    this.busy.set(true);
    this.api.setEnrollmentActive(this.studentId(), candidate.id, !candidate.active).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.show(candidate.active ? 'Matrícula encerrada.' : 'Matrícula reativada.', 'success');
        this.load(this.enrollments()?.number ?? 0);
      },
      error: failure => {
        this.busy.set(false);
        this.error.set(errorMessage(failure, 'alterar a matrícula'));
      },
    });
  }
}
