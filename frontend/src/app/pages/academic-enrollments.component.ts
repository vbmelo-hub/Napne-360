import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { AcademicApi, AcademicEnrollment, AcademicOffering } from '../core/academic-api.service';
import { Page } from '../core/models';
import { errorMessage } from '../core/presentation';
import { ToastService } from '../core/toast.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { ModalShellComponent } from '../shared/modal-shell.component';
import { PaginationComponent } from '../shared/pagination.component';

@Component({
  selector: 'app-academic-enrollments',
  imports: [ReactiveFormsModule, ConfirmDialogComponent, ModalShellComponent, PaginationComponent],
  template: `
    <section class="card stack" aria-labelledby="enrollments-title">
      <div class="section-header">
        <div>
          <h2 id="enrollments-title">Matrículas em componentes</h2>
          <p>As matrículas ativas vinculam os docentes da mesma turma e período ao estudante.</p>
        </div>
        <button type="button" (click)="openOptions()" [disabled]="busy()">Registrar matrícula</button>
      </div>
      <form class="row" (submit)="$event.preventDefault(); load(0)">
        <label>Buscar matrículas <input type="search" [formControl]="search" placeholder="Componente, turma ou período"></label>
        <button class="secondary" type="submit">Buscar</button>
      </form>
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
                  <td><button type="button" class="secondary compact" [disabled]="busy()" (click)="pending.set(row)">
                    {{row.active ? 'Encerrar' : 'Reativar'}}
                  </button></td>
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
      <form class="row" (submit)="$event.preventDefault(); loadOptions(0)">
        <label>Buscar ofertas <input type="search" [formControl]="optionSearch" placeholder="Componente, turma ou período"></label>
        <button class="secondary" type="submit">Buscar</button>
      </form>
      @if (optionError()) {<p class="error" role="alert">{{optionError()}}</p>}
      @if (optionsLoading()) {<p class="meta" role="status">Carregando ofertas…</p>}
      @else if (options()?.content?.length) {
        <div class="stack">
          @for (offer of options()?.content; track offer.id) {
            <div class="row">
              <span>{{offer.subjectName}} · Turma {{offer.groupCode}} · {{offer.periodLabel}}</span>
              <button type="button" class="secondary compact" [disabled]="busy()" (click)="enroll(offer)">Matricular</button>
            </div>
          }
        </div>
        <app-pagination label="Paginação das ofertas para matrícula" [page]="options()?.number ?? 0"
          [totalPages]="options()?.totalPages ?? 0" (pageChange)="loadOptions($event)" />
      } @else if (!optionError()) {<p class="meta">Nenhuma oferta ativa encontrada para o curso.</p>}
    </app-modal-shell>

    <app-confirm-dialog [open]="pending() !== null" [title]="pending()?.active ? 'Encerrar matrícula?' : 'Reativar matrícula?'"
      [description]="confirmationText()" [confirmLabel]="pending()?.active ? 'Encerrar matrícula' : 'Reativar matrícula'"
      [danger]="pending()?.active ?? false" (confirmed)="changeStatus()" (cancelled)="pending.set(null)" />
  `,
})
export class AcademicEnrollmentsComponent {
  private readonly api = inject(AcademicApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  readonly studentId = input.required<number>();
  readonly search = new FormControl('', { nonNullable: true });
  readonly optionSearch = new FormControl('', { nonNullable: true });
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
  private request = 0;
  private optionRequest = 0;

  constructor() {
    effect(() => this.load(0));
  }

  load(page: number) {
    const request = ++this.request;
    this.loading.set(true);
    this.error.set('');
    this.api.enrollments(this.studentId(), page, this.search.value).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        if (request !== this.request) return;
        this.enrollments.set(result);
        this.loading.set(false);
      },
      error: failure => {
        if (request !== this.request) return;
        this.loading.set(false);
        this.error.set(errorMessage(failure, 'carregar as matrículas'));
      },
    });
  }

  openOptions() {
    this.optionSearch.reset();
    this.showOptions.set(true);
    this.loadOptions(0);
  }

  closeOptions() {
    if (!this.busy()) this.showOptions.set(false);
  }

  loadOptions(page: number) {
    const request = ++this.optionRequest;
    this.optionsLoading.set(true);
    this.optionError.set('');
    this.api.enrollmentOptions(this.studentId(), page, this.optionSearch.value).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        if (request !== this.optionRequest) return;
        this.options.set(result);
        this.optionsLoading.set(false);
      },
      error: failure => {
        if (request !== this.optionRequest) return;
        this.optionsLoading.set(false);
        this.optionError.set(errorMessage(failure, 'carregar as ofertas'));
      },
    });
  }

  enroll(offer: AcademicOffering) {
    if (this.busy()) return;
    this.busy.set(true);
    this.optionError.set('');
    this.api.createEnrollment(this.studentId(), offer.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busy.set(false);
        this.closeOptions();
        this.toast.show('Matrícula registrada.', 'success');
        this.load(0);
      },
      error: failure => {
        this.busy.set(false);
        this.optionError.set(errorMessage(failure, 'registrar a matrícula'));
      },
    });
  }

  changeStatus() {
    const candidate = this.pending();
    if (!candidate || this.busy()) return;
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
