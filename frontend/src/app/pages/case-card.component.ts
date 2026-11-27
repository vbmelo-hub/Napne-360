import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { ApiService } from '../core/api.service';
import { createFilterOptions } from '../core/filter-options';
import { reconcileRequiredSelection } from '../core/required-selection';
import { trackFormChanges } from '../core/form-changes';
import { CaseHistoryView, CaseResponsibleCandidate, NapneCase, Page } from '../core/models';
import { errorMessage, labelFor, toneFor } from '../core/presentation';
import { ToastService } from '../core/toast.service';
import { AppliedFiltersComponent, appliedFilterItems } from '../shared/applied-filters.component';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { FilterDisclosureComponent } from '../shared/filter-disclosure.component';
import { ModalShellComponent } from '../shared/modal-shell.component';
import { PaginationComponent } from '../shared/pagination.component';
import { SearchableSelectComponent } from '../shared/searchable-select.component';

function availableStages(item: NapneCase) {
  return item.stageOptions ?? item.allowedNextStages.map(code => ({ code, label: labelFor(code) }));
}

@Component({
  selector: 'app-case-card',
  imports: [DatePipe, ReactiveFormsModule, AppliedFiltersComponent, ConfirmDialogComponent, FilterDisclosureComponent, ModalShellComponent, PaginationComponent, SearchableSelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="case-card" [attr.aria-labelledby]="'case-' + item().id">
      <div class="case-main">
        <span [class]="'badge badge--' + tone(item().stage)">{{currentStageLabel()}}</span>
        <h3 [id]="'case-' + item().id">Caso nº {{item().id}} · {{item().source}}</h3>
        <p>{{item().summary || 'Sem resumo informado.'}}</p>
        <small>
          Aberto em {{item().openedAt | date:'dd/MM/yyyy'}}
          @if (item().closedAt) { · Encerrado em {{item().closedAt | date:'dd/MM/yyyy'}} }
          · Responsável: {{item().responsible}} · Versão {{item().version}}
        </small>
      </div>

      <div class="case-action">
        @if (canTransfer()) {
          <button type="button" class="secondary" [disabled]="changesBlocked()" (click)="openEdit()">Editar caso</button>
        }
        @if (stageOptions().length) {
          <label>
            Próxima etapa
            <select #stageSelect [disabled]="changesBlocked()" (change)="selectStage(stageSelect.value)">
              <option value="" [selected]="!selectedStage()">Selecione</option>
              @for (stage of stageOptions(); track stage.code) {
                <option [value]="stage.code" [selected]="stage.code === selectedStage()">{{stage.label}}</option>
              }
            </select>
          </label>
          @if (reopening()) {
            <label>
              Motivo da reabertura
              <textarea #reasonInput required [disabled]="changesBlocked()" [attr.aria-invalid]="reopenReasonTooLong()"
                [value]="reopenReason()" (input)="reopenReason.set(reasonInput.value)"></textarea>
            </label>
            @if (reopenReasonTooLong()) {
              <small role="status">O motivo deve ter até 500 caracteres.</small>
            }
          }
          <button type="button" class="secondary" [disabled]="changesBlocked() || !validStage()"
            (click)="confirmStageOpen.set(true)">Registrar etapa</button>
        }
        @if (canTransfer() && !transferOpen()) {
          <button type="button" class="secondary" [disabled]="changesBlocked()"
            (click)="openTransfer()">Transferir responsabilidade</button>
        }
        <button type="button" class="secondary" [disabled]="busy()" (click)="studyRequested.emit(item().id)">Ver registros do estudo</button>
        <button type="button" class="secondary" [disabled]="busy()" (click)="recordsRequested.emit(item().id)">Ver acompanhamentos</button>
        <button type="button" class="secondary" [disabled]="busy()" (click)="toggleHistory()">
          Consultar histórico
        </button>
      </div>

      @if (pending() === 'stage') {
        <p class="case-panel" role="status">Salvando alterações do caso…</p>
      }
      @if (operationError()) {
        <div class="error case-panel" role="alert">{{operationError()}}</div>
      }
      @if (conflict()) {
        <div class="case-panel">
          <button type="button" class="secondary compact" [disabled]="busy()" (click)="synchronize()">
            {{pending() === 'sync' ? 'Sincronizando…' : 'Sincronizar caso'}}
          </button>
        </div>
      }

    <app-modal-shell [open]="editOpen()" title="Editar caso nº {{item().id}}" (closed)="closeEdit()">
      <form class="stack" [formGroup]="editForm" (ngSubmit)="saveDetails()">
        <fieldset class="stack" [disabled]="busy()">
          <label><span>Origem do encaminhamento&nbsp;<span class="field-required" aria-hidden="true">*</span></span>
            <input formControlName="source" maxlength="80" required>
          </label>
          <label>Resumo<textarea formControlName="summary" maxlength="500"></textarea></label>
        </fieldset>
        @if (operationError()) { <p class="error" role="alert">{{operationError()}}</p> }
        @if (conflict()) {
          <button type="button" class="secondary compact" [disabled]="busy()" (click)="synchronize()">Sincronizar caso</button>
        }
        <div class="case-buttons">
          <button type="button" class="secondary" [disabled]="busy()" (click)="closeEdit()">Cancelar</button>
          <button type="submit" [disabled]="!validEdit() || changesBlocked()">
            {{pending() === 'edit' ? 'Salvando…' : 'Salvar alterações'}}
          </button>
        </div>
      </form>
    </app-modal-shell>

    <app-modal-shell [open]="transferOpen()" title="Transferir responsabilidade" (closed)="closeTransfer()">
      @if (transferOpen()) {
        <form class="case-panel stack" (submit)="$event.preventDefault(); transfer()">
          @if (pending() === 'candidates') {
            <span role="status">Carregando responsáveis…</span>
          } @else if (candidateError()) {
            <div class="error" role="alert">{{candidateError()}}</div>
            <div><button type="button" class="secondary compact" [disabled]="busy()" (click)="loadCandidates()">Tentar novamente</button></div>
          } @else if (!canTransfer()) {
            <p>O caso atual não permite transferência de responsabilidade.</p>
          } @else if (eligibleCandidates().length === 0) {
            <p role="status">Não é possível transferir este caso porque não existem outros profissionais ativos da equipe NAPNE neste campus.</p>
          }
          @if (eligibleCandidates().length && canTransfer()) {
            <p class="field-hint">O novo responsável assumirá a gestão do caso. A transferência ficará registrada no histórico.</p>
            <fieldset class="stack" [disabled]="busy() || !canTransfer()">
              <app-searchable-select label="Novo responsável" [formControl]="responsibleId" [required]="true"
                [options]="responsibleOptions()" [readonly]="busy()" placeholder="Pesquisar nome" />
              <label>Motivo (opcional)<textarea [formControl]="reason" maxlength="500"></textarea></label>
            </fieldset>
          }
          @if (operationError()) { <p class="error" role="alert">{{operationError()}}</p> }
          @if (conflict()) {
            <button type="button" class="secondary compact" [disabled]="busy()" (click)="synchronize()">Sincronizar caso</button>
          }
          <div class="case-buttons">
            <button type="button" class="secondary" [disabled]="busy()" (click)="closeTransfer()">Cancelar transferência</button>
            @if (eligibleCandidates().length && canTransfer()) {
              <button type="submit" [disabled]="changesBlocked() || !validTransfer()">
                Confirmar transferência
              </button>
            }
          </div>
        </form>
      }
    </app-modal-shell>

    <app-modal-shell [open]="historyOpen()" title="Histórico do caso" (closed)="toggleHistory()">
      <div class="case-panel">
        @if (historyOpen()) {
          <form #historyToolbar tabindex="-1" class="server-list-toolbar filter-toolbar"
            [formGroup]="historyForm" (ngSubmit)="filterHistory()">
            <label>Tipo de evento
              <select formControlName="type" (change)="filterHistory()" [attr.disabled]="busy() ? '' : null">
                <option value="">Todos os eventos</option>
                <option value="OPENED">{{historyLabels.OPENED}}</option>
                <option value="STAGE_CHANGED">{{historyLabels.STAGE_CHANGED}}</option>
                <option value="RESPONSIBLE_CHANGED">{{historyLabels.RESPONSIBLE_CHANGED}}</option>
                <option value="DETAILS_UPDATED">{{historyLabels.DETAILS_UPDATED}}</option>
              </select>
            </label>
            <app-filter-disclosure [count]="historyFilters().length" (expandedChange)="loadHistoryAuthors($event)">
              <div class="toolbar-grid">
                <app-searchable-select label="Autoria" formControlName="actorId" [options]="historyAuthorOptions()"
                  [readonly]="historyAuthors.loading() || !!historyAuthors.error()" selectionPlaceholder="Todos"
                  placeholder="Buscar nome registrado" />
                <label>Versão <input type="number" min="1" formControlName="version"></label>
                <label>A partir de <input type="date" formControlName="from"></label>
                <label>Até <input type="date" formControlName="to"></label>
              </div>
              @if (historyAuthors.loading()) { <p class="meta" role="status">Carregando autores…</p> }
              @if (historyAuthors.error(); as error) { <p class="error" role="alert">{{error}}</p> }
              <div class="toolbar-actions">
                <button type="submit" class="toolbar-button" [disabled]="busy() || historyForm.invalid">Aplicar filtros</button>
              </div>
            </app-filter-disclosure>
            @if (historyFiltered()) {
              <button type="button" class="toolbar-aux" [disabled]="busy()"
                (click)="clearHistoryFilters(); historyToolbar.focus()">Limpar filtros</button>
            }
          </form>
          <app-applied-filters [filters]="historyFilters()" [fallbackFocus]="historyToolbar"
            (removed)="removeHistoryFilter($event)" />
          @if (history(); as page) {<p class="toolbar-results" role="status">{{page.totalElements}} resultado(s)</p>}
        }
        @if (pending() === 'history') {
          <p role="status">Carregando histórico…</p>
        }
        @if (historyError()) {
          <div class="error" role="alert">{{historyError()}}</div>
          <button type="button" class="secondary compact" [disabled]="busy()" (click)="loadHistory(requestedPage())">
            Tentar novamente
          </button>
        }
        @if (history(); as page) {
          @if (page.content.length === 0) {
            <p>{{historyFiltered() ? 'Nenhum evento corresponde aos filtros.' : 'Nenhum evento no histórico deste caso.'}}</p>
          } @else {
            <ol class="revisions">
              @for (entry of page.content; track entry.id) {
                <li>
                  <strong>{{historyLabels[entry.type]}} · Versão {{entry.version}}</strong>
                  <small>{{entry.actor}} · {{entry.occurredAt | date:'dd/MM/yyyy, HH:mm'}}</small>
                  @switch (entry.type) {
                    @case ('OPENED') {
                      <p>{{entry.toStageLabel ?? label(entry.toStage)}} · Responsável: {{entry.toResponsible}}</p>
                    }
                    @case ('STAGE_CHANGED') {
                      <p>{{entry.fromStageLabel ?? label(entry.fromStage)}} → {{entry.toStageLabel ?? label(entry.toStage)}}</p>
                    }
                    @case ('RESPONSIBLE_CHANGED') {
                      <p>{{entry.fromResponsible}} → {{entry.toResponsible}}</p>
                    }
                    @case ('DETAILS_UPDATED') {
                      @if (entry.fromSource !== entry.toSource) {
                        <p>Origem: {{entry.fromSource}} → {{entry.toSource}}</p>
                      }
                      @if (entry.fromSummary !== entry.toSummary) {
                        <p>Resumo anterior: {{entry.fromSummary || 'Sem resumo'}}</p>
                        <p>Resumo atualizado: {{entry.toSummary || 'Sem resumo'}}</p>
                      }
                    }
                  }
                  @if (entry.reason) { <p class="history-reason">Motivo: {{entry.reason}}</p> }
                </li>
              }
            </ol>
            <fieldset [disabled]="busy()">
              <app-pagination [page]="page.number" [totalPages]="page.totalPages"
                [label]="'Páginas do histórico do caso ' + item().id" (pageChange)="loadHistory($event)" />
            </fieldset>
          }
        }
      </div>
    </app-modal-shell>

    </article>
    <app-confirm-dialog [open]="confirmStageOpen()" [title]="selectedStage() === 'ARCHIVED' ? 'Arquivar caso?' : 'Registrar mudança de etapa?'"
      [description]="stageDescription()" confirmLabel="Registrar etapa"
      (confirmed)="changeStage()" (cancelled)="confirmStageOpen.set(false)" />
  `,
  styles: [`
    :host { display: block; }
    :host + :host { border-top: 1px solid var(--border); }
    .case-card { display: grid; grid-template-columns: 1fr minmax(13rem,18rem); gap: 1rem 1.5rem; padding: 1.25rem 0; }
    .case-main { min-width: 0; overflow-wrap: anywhere; }
    .case-main .badge { max-width: 100%; white-space: normal; }
    .case-main h3 { margin: .65rem 0 .25rem; }
    .case-main p { margin-bottom: .6rem; }
    .case-main p, small { color: var(--ink-600); }
    .case-action { display: grid; align-content: start; gap: .6rem; min-width: 0; }
    .case-panel { grid-column: 1 / -1; min-width: 0; }
    .case-panel h4 { margin: 0 0 .6rem; }
    .case-panel .toolbar-results, .case-panel .error { margin-top: var(--space-3); }
    fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
    .case-buttons { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; }
    .revisions { margin: .75rem 0; padding: 0; list-style: none; overflow-wrap: anywhere; }
    .revisions li { padding: .5rem 0; border-top: 1px solid var(--border); }
    .revisions small { display: block; }
    .revisions p { margin: .25rem 0 0; }
    .history-reason { white-space: pre-wrap; }
    app-modal-shell { display: contents; }
    app-confirm-dialog { overflow-wrap: anywhere; }
    @media (max-width: 700px) { .case-card { grid-template-columns: 1fr; } }
  `]
})
export class CaseCardComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  readonly item = input.required<NapneCase>();
  readonly allowsReopening = input(true);
  readonly caseUpdated = output<{value: NapneCase; mutated: boolean}>();
  readonly recordsRequested = output<number>();
  readonly studyRequested = output<number>();

  readonly label = labelFor;
  readonly tone = toneFor;
  readonly historyLabels: Record<CaseHistoryView['type'], string> = {
    OPENED: 'Abertura',
    STAGE_CHANGED: 'Mudança de etapa',
    RESPONSIBLE_CHANGED: 'Transferência de responsabilidade',
    DETAILS_UPDATED: 'Edição do caso',
  };

  readonly pending = signal<'candidates' | 'history' | 'stage' | 'transfer' | 'edit' | 'sync' | null>(null);
  readonly busy = computed(() => this.pending() !== null);
  readonly operationError = signal('');
  readonly conflict = signal(false);
  readonly changesBlocked = computed(() => this.busy() || this.conflict());

  readonly confirmStageOpen = signal(false);
  private readonly nextStage = signal('');
  readonly currentStageLabel = computed(() => this.item().stageLabel ?? labelFor(this.item().stage));
  readonly stageOptions = computed(() => {
    const item = this.item();
    const options = availableStages(item);
    return item.stage !== 'CLOSED' || this.allowsReopening()
      ? options : options.filter(stage => stage.code === 'ARCHIVED');
  });
  private readonly selectedOption = computed(() => this.stageOptions().find(stage => stage.code === this.nextStage()));
  readonly selectedStage = computed(() => this.selectedOption()?.code ?? '');
  readonly reopening = computed(() => this.item().stage === 'CLOSED' && this.selectedStage() === 'SCREENING');
  readonly reopenReason = signal('');
  private readonly normalizedReopenReason = computed(() => this.reopenReason().trim());
  readonly reopenReasonTooLong = computed(() => this.normalizedReopenReason().length > 500);
  readonly validStage = computed(() =>
    !!this.selectedStage() && (!this.reopening() || (!!this.normalizedReopenReason() && !this.reopenReasonTooLong()))
  );
  readonly stageDescription = computed(() =>
    this.selectedStage() === 'ARCHIVED'
      ? 'O caso ficará arquivado e disponível para consulta histórica. Os registros associados serão preservados.'
      : `O caso será alterado de ${this.currentStageLabel()} para ${this.selectedOption()?.label ?? ''}. A mudança ficará registrada no histórico.`
  );

  readonly transferOpen = signal(false);
  readonly candidates = signal<CaseResponsibleCandidate[] | null>(null);
  readonly candidateError = signal('');
  readonly canTransfer = computed(() => !['CLOSED', 'ARCHIVED'].includes(this.item().stage));
  readonly eligibleCandidates = computed(() =>
    this.candidates()?.filter(candidate => candidate.id !== this.item().responsibleId) ?? []
  );
  protected readonly responsibleOptions = computed(() => this.eligibleCandidates().map(candidate =>
    ({ id: String(candidate.id), label: candidate.name })));
  readonly responsibleId = new FormControl('', {nonNullable: true});
  readonly reason = new FormControl('', {nonNullable: true, validators: Validators.maxLength(500)});

  readonly editOpen = signal(false);
  readonly editForm = new FormGroup({
    source: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(80)] }),
    summary: new FormControl('', { nonNullable: true, validators: Validators.maxLength(500) }),
  });
  private readonly editValues = toSignal(this.editForm.valueChanges, { initialValue: this.editForm.getRawValue() });
  private readonly editChanges = trackFormChanges(this.editValues);

  openEdit(): void {
    if (this.changesBlocked() || !this.canTransfer()) return;
    this.editForm.reset({ source: this.item().source, summary: this.item().summary ?? '' });
    this.editChanges.capture();
    this.editOpen.set(true);
  }

  closeEdit(): void {
    if (this.busy()) return;
    if (this.editChanges.changed() && !window.confirm('Descartar alterações ainda não salvas neste caso?')) return;
    this.editOpen.set(false);
  }

  validEdit(): boolean {
    if (this.editForm.invalid || !this.editChanges.changed()) return false;
    const { source, summary } = this.editForm.getRawValue();
    return !!source.trim() && (source.trim() !== this.item().source || summary.trim() !== (this.item().summary ?? ''));
  }

  saveDetails(): void {
    if (!this.editOpen() || !this.canTransfer() || this.changesBlocked() || !this.validEdit()) return;
    const { id, version } = this.item();
    const { source, summary } = this.editForm.getRawValue();
    this.pending.set('edit');
    this.mutate(this.api.updateCase(id, { source: source.trim(), summary: summary.trim() || null, version }),
      'editar o caso', 'Dados do caso atualizados.');
  }

  readonly historyOpen = signal(false);
  readonly history = signal<Page<CaseHistoryView> | null>(null);
  protected readonly historyAuthors = createFilterOptions<{ id: number; name: string }[]>([]);
  protected readonly historyAuthorOptions = computed(() => {
    const authors = this.historyAuthors.value();
    const counts = new Map<string, number>();
    for (const author of authors) {
      const name = author.name.toLocaleLowerCase('pt-BR');
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return authors.map(author => ({
      id: String(author.id), label: author.name,
      detail: (counts.get(author.name.toLocaleLowerCase('pt-BR')) ?? 0) > 1 ? `Conta #${author.id}` : undefined,
    }));
  });
  readonly historyForm = inject(FormBuilder).group({
    type: new FormControl('', { nonNullable: true }),
    actorId: new FormControl('', { nonNullable: true }),
    version: new FormControl<number | null>(null, [Validators.min(1), Validators.pattern(/^\d+$/)]),
    from: new FormControl('', { nonNullable: true }),
    to: new FormControl('', { nonNullable: true }),
  });
  private readonly historyCriteria = signal(this.historyForm.getRawValue());
  protected readonly historyFilters = computed(() => {
    const criteria = this.historyCriteria();
    return appliedFilterItems({ ...criteria, version: criteria.version?.toString() }, {
      type: 'Tipo de evento', actorId: 'Autoria', version: 'Versão', from: 'A partir de', to: 'Até',
    }, {
      type: value => this.historyLabels[value as CaseHistoryView['type']],
      actorId: id => this.historyAuthorOptions().find(author => author.id === id)?.label ?? id,
    });
  });
  readonly historyFiltered = computed(() => this.historyFilters().length > 0);
  readonly requestedPage = signal(0);
  readonly historyError = signal('');

  selectStage(stage: string) {
    if (stage !== this.nextStage()) this.reopenReason.set('');
    this.nextStage.set(stage);
  }

  changeStage() {
    if (!this.confirmStageOpen()) return;
    this.confirmStageOpen.set(false);
    if (this.changesBlocked() || !this.validStage()) return;
    const {id, summary, version} = this.item();
    const reason = this.reopening() ? this.normalizedReopenReason() : undefined;
    this.pending.set('stage');
    this.mutate(this.api.changeCaseStage(id, this.selectedStage(), summary, version, reason),
      'alterar a etapa', 'Etapa registrada no histórico.');
  }

  openTransfer() {
    if (this.changesBlocked() || !this.canTransfer() || this.transferOpen()) return;
    this.transferOpen.set(true);
    this.loadCandidates();
  }

  closeTransfer() {
    if (this.busy()) return;
    if ((this.reason.value.trim() || this.responsibleId.dirty)
        && !window.confirm('Descartar a transferência ainda não confirmada?')) return;
    this.resetTransfer();
  }

  private resetTransfer(): void {
    this.transferOpen.set(false);
    this.responsibleId.reset();
    this.reason.reset();
    this.candidates.set(null);
    this.candidateError.set('');
    if (!this.conflict()) this.operationError.set('');
  }

  loadCandidates() {
    if (this.busy() || !this.canTransfer()) return;
    this.pending.set('candidates');
    this.candidateError.set('');
    this.api.caseResponsibleCandidates(this.item().id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: values => {
        this.candidates.set(values);
        reconcileRequiredSelection(this.responsibleId, this.eligibleCandidates().map(candidate => String(candidate.id)));
        this.pending.set(null);
      },
      error: error => {
        this.candidateError.set(errorMessage(error, 'carregar os responsáveis'));
        this.pending.set(null);
      }
    });
  }

  validTransfer() {
    return this.canTransfer() && this.reason.valid &&
      this.eligibleCandidates().some(candidate => String(candidate.id) === this.responsibleId.value);
  }

  transfer() {
    if (this.changesBlocked() || !this.transferOpen() || !this.validTransfer()) return;
    const responsibleId = Number(this.responsibleId.value);
    const {id, version} = this.item();
    this.pending.set('transfer');
    const reason = this.reason.value.trim();
    this.mutate(this.api.changeCaseResponsible(id, {responsibleId, version, reason: reason || null}),
      'transferir a responsabilidade', 'Responsabilidade transferida.');
  }

  synchronize() {
    if (this.busy() || !this.conflict()) return;
    this.pending.set('sync');
    this.api.getCase(this.item().id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: value => {
        this.pending.set(null);
        this.conflict.set(false);
        this.operationError.set('');
        if (!availableStages(value).some(stage => stage.code === this.selectedStage()) ||
            (this.reopening() && value.stage !== 'CLOSED')) this.selectStage('');
        this.clearUnavailableTransfer(value);
        this.caseUpdated.emit({value, mutated: false});
        if (this.historyOpen()) this.loadHistory(0);
      },
      error: error => {
        this.pending.set(null);
        this.operationError.set(errorMessage(error, 'sincronizar o caso'));
      }
    });
  }

  toggleHistory() {
    if (this.busy()) return;
    this.historyOpen.update(open => !open);
    if (this.historyOpen()) this.loadHistory(0);
    else this.historyAuthors.cancel();
  }

  protected loadHistoryAuthors(open: boolean): void {
    if (open) this.historyAuthors.load(this.api.caseHistoryAuthors(this.item().id));
    else this.historyAuthors.cancel();
  }

  filterHistory(): void {
    if (this.busy() || this.historyForm.invalid) return;
    const filter = this.historyForm.getRawValue();
    if (filter.from && filter.to && filter.from > filter.to) {
      this.historyError.set('A data final deve ser igual ou posterior à data inicial.');
      return;
    }
    this.historyCriteria.set(filter);
    this.history.set(null);
    this.loadHistory(0);
  }

  clearHistoryFilters(): void {
    this.historyForm.reset();
    this.filterHistory();
  }

  protected removeHistoryFilter(key: string): void {
    const control = this.historyForm.get(key);
    if (!control || this.busy()) return;
    control.reset();
    this.historyCriteria.update(criteria => ({ ...criteria, [key]: control.value }));
    this.history.set(null);
    this.loadHistory(0);
  }

  loadHistory(page: number) {
    if (this.busy()) return;
    this.pending.set('history');
    this.requestedPage.set(page);
    this.historyError.set('');
    const { type, actorId, version, from, to } = this.historyCriteria();
    this.api.caseHistory(this.item().id, page, type, {
      actorId,
      version: version ?? undefined,
      from: from ? new Date(from + 'T00:00:00').toISOString() : undefined,
      to: to ? new Date(to + 'T23:59:59.999').toISOString() : undefined,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: response => {
        this.history.set(response);
        this.pending.set(null);
      },
      error: error => {
        this.historyError.set(errorMessage(error, 'carregar o histórico do caso'));
        this.pending.set(null);
      }
    });
  }

  private clearUnavailableTransfer(value: NapneCase) {
    if (this.transferOpen() && ['CLOSED', 'ARCHIVED'].includes(value.stage)) this.resetTransfer();
  }

  private mutate(request: Observable<NapneCase>, action: string, success: string) {
    this.operationError.set('');
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: value => {
        const operation = this.pending();
        this.pending.set(null);
        if (operation === 'transfer') this.resetTransfer();
        if (operation === 'edit') this.editOpen.set(false);
        if (operation === 'stage') this.selectStage('');
        this.clearUnavailableTransfer(value);
        this.caseUpdated.emit({value, mutated: true});
        this.toast.show(success, 'success');
        if (this.historyOpen()) this.loadHistory(0);
      },
      error: error => {
        this.pending.set(null);
        const code = error.error?.code;
        const conflict = error.status === 409 && (!code || code === 'CONFLICT');
        this.conflict.set(conflict);
        this.operationError.set(conflict
          ? 'O caso mudou desde a última leitura. Sincronize este caso antes de tentar novamente.'
          : errorMessage(error, action));
      }
    });
  }
}
