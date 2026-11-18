import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { ApiService } from '../core/api.service';
import { CaseHistoryView, CaseResponsibleCandidate, NapneCase, Page } from '../core/models';
import { errorMessage, labelFor, toneFor } from '../core/presentation';
import { ToastService } from '../core/toast.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';

@Component({
  selector: 'app-case-card',
  imports: [DatePipe, ReactiveFormsModule, ConfirmDialogComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="case-card" [attr.aria-labelledby]="'case-' + item().id">
      <div class="case-main">
        <span [class]="'badge badge--' + tone(item().stage)">{{label(item().stage)}}</span>
        <h3 [id]="'case-' + item().id">{{item().source}}</h3>
        <p>{{item().summary || 'Sem resumo informado.'}}</p>
        <small>
          Aberto em {{item().openedAt | date:'dd/MM/yyyy'}}
          @if (item().closedAt) { · Encerrado em {{item().closedAt | date:'dd/MM/yyyy'}} }
          · Responsável: {{item().responsible}} · Versão {{item().version}}
        </small>
      </div>

      <div class="case-action">
        @if (item().allowedNextStages.length) {
          <label>
            Próxima etapa
            <select #stageSelect [disabled]="changesBlocked()" (change)="selectStage(stageSelect.value)">
              <option value="" [selected]="!selectedStage()">Selecione</option>
              @for (stage of item().allowedNextStages; track stage) {
                <option [value]="stage" [selected]="stage === selectedStage()">{{label(stage)}}</option>
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
        <button type="button" class="secondary" [disabled]="busy()" [attr.aria-expanded]="historyOpen()"
          [attr.aria-controls]="historyId()" (click)="toggleHistory()">
          {{historyOpen() ? 'Ocultar histórico' : 'Consultar histórico'}}
        </button>
      </div>

      @if (pending() === 'stage' || pending() === 'transfer') {
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
            <p>Nenhum outro responsável elegível neste campus.</p>
          }
          @if (candidates()) {
            <fieldset class="stack" [disabled]="busy() || !canTransfer()">
              <label>
                Novo responsável
                <select name="responsibleId" [formControl]="responsibleId">
                  <option value="">Selecione</option>
                  @for (candidate of candidates(); track candidate.id) {
                    <option [value]="candidate.id" [disabled]="candidate.id === item().responsibleId">{{candidate.name}}</option>
                  }
                </select>
              </label>
              <label>Motivo (opcional)<textarea [formControl]="reason" maxlength="500"></textarea></label>
            </fieldset>
          }
          <div class="case-buttons">
            <button type="button" class="secondary" [disabled]="busy()" (click)="closeTransfer()">Cancelar transferência</button>
            @if (candidates() && canTransfer()) {
              <button type="submit" [disabled]="changesBlocked() || !validTransfer()">
                Confirmar transferência
              </button>
            }
          </div>
        </form>
      }

      <div class="case-panel" [id]="historyId()" [hidden]="!historyOpen()">
        <h4>Histórico do caso</h4>
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
            <p>Nenhum evento no histórico deste caso.</p>
          } @else {
            <ol class="revisions">
              @for (entry of page.content; track entry.id) {
                <li>
                  <strong>{{historyLabels[entry.type]}} · Versão {{entry.version}}</strong>
                  <small>{{entry.actor}} · {{entry.occurredAt | date:'dd/MM/yyyy, HH:mm'}}</small>
                  @switch (entry.type) {
                    @case ('OPENED') {
                      <p>{{label(entry.toStage)}} · Responsável: {{entry.toResponsible}}</p>
                    }
                    @case ('STAGE_CHANGED') {
                      <p>{{label(entry.fromStage)}} → {{label(entry.toStage)}}</p>
                    }
                    @case ('RESPONSIBLE_CHANGED') {
                      <p>{{entry.fromResponsible}} → {{entry.toResponsible}}</p>
                    }
                  }
                  @if (entry.reason) { <p class="history-reason">Motivo: {{entry.reason}}</p> }
                </li>
              }
            </ol>
            @if (page.totalPages > 1) {
              <div class="case-buttons" aria-label="Páginas do histórico">
                <button type="button" class="secondary compact" [disabled]="busy() || page.number === 0"
                  (click)="loadHistory(page.number - 1)">Anterior</button>
                <span aria-live="polite">Página {{page.number + 1}} de {{page.totalPages}}</span>
                <button type="button" class="secondary compact" [disabled]="busy() || page.number + 1 >= page.totalPages"
                  (click)="loadHistory(page.number + 1)">Próxima</button>
              </div>
            }
          }
        }
      </div>
    </article>

    <app-confirm-dialog [open]="confirmStageOpen()" title="Registrar mudança de etapa?"
      [description]="stageDescription()" confirmLabel="Registrar etapa"
      (confirmed)="changeStage()" (cancelled)="confirmStageOpen.set(false)" />
  `,
  styles: [`
    :host { display: block; }
    :host + :host { border-top: 1px solid var(--border); }
    .case-card { display: grid; grid-template-columns: 1fr minmax(13rem,18rem); gap: 1rem 1.5rem; padding: 1.25rem 0; }
    .case-main { min-width: 0; overflow-wrap: anywhere; }
    .case-main h3 { margin: .65rem 0 .25rem; }
    .case-main p { margin-bottom: .6rem; }
    .case-main p, small { color: var(--ink-600); }
    .case-action { display: grid; align-content: start; gap: .6rem; }
    .case-panel { grid-column: 1 / -1; min-width: 0; }
    .case-panel h4 { margin: 0 0 .6rem; }
    .case-panel fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
    .case-buttons { display: flex; flex-wrap: wrap; gap: .6rem; align-items: center; }
    .revisions { margin: .75rem 0; padding: 0; list-style: none; overflow-wrap: anywhere; }
    .revisions li { padding: .5rem 0; border-top: 1px solid var(--border); }
    .revisions small { display: block; }
    .revisions p { margin: .25rem 0 0; }
    .history-reason { white-space: pre-wrap; }
    @media (max-width: 700px) { .case-card { grid-template-columns: 1fr; } }
  `]
})
export class CaseCardComponent {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  readonly item = input.required<NapneCase>();
  readonly caseUpdated = output<{value: NapneCase; mutated: boolean}>();

  readonly label = labelFor;
  readonly tone = toneFor;
  readonly historyLabels: Record<CaseHistoryView['type'], string> = {
    OPENED: 'Abertura',
    STAGE_CHANGED: 'Mudança de etapa',
    RESPONSIBLE_CHANGED: 'Transferência de responsabilidade'
  };

  readonly pending = signal<'candidates' | 'history' | 'stage' | 'transfer' | 'sync' | null>(null);
  readonly busy = computed(() => this.pending() !== null);
  readonly operationError = signal('');
  readonly conflict = signal(false);
  readonly changesBlocked = computed(() => this.busy() || this.conflict());

  readonly confirmStageOpen = signal(false);
  private readonly nextStage = signal('');
  readonly selectedStage = computed(() => {
    const stage = this.nextStage();
    return this.item().allowedNextStages.includes(stage) ? stage : '';
  });
  readonly reopening = computed(() => this.item().stage === 'CLOSED' && this.selectedStage() === 'SCREENING');
  readonly reopenReason = signal('');
  private readonly normalizedReopenReason = computed(() => this.reopenReason().trim());
  readonly reopenReasonTooLong = computed(() => this.normalizedReopenReason().length > 500);
  readonly validStage = computed(() =>
    !!this.selectedStage() && (!this.reopening() || (!!this.normalizedReopenReason() && !this.reopenReasonTooLong()))
  );
  readonly stageDescription = computed(() =>
    `O caso será alterado de ${labelFor(this.item().stage)} para ${labelFor(this.selectedStage())}. A mudança ficará registrada no histórico.`
  );

  readonly transferOpen = signal(false);
  readonly candidates = signal<CaseResponsibleCandidate[] | null>(null);
  readonly candidateError = signal('');
  readonly canTransfer = computed(() => !['CLOSED', 'ARCHIVED'].includes(this.item().stage));
  readonly eligibleCandidates = computed(() =>
    this.candidates()?.filter(candidate => candidate.id !== this.item().responsibleId) ?? []
  );
  readonly responsibleId = new FormControl('', {nonNullable: true});
  readonly reason = new FormControl('', {nonNullable: true, validators: Validators.maxLength(500)});

  readonly historyId = computed(() => `case-history-${this.item().id}`);
  readonly historyOpen = signal(false);
  readonly history = signal<Page<CaseHistoryView> | null>(null);
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
        this.pending.set(null);
      },
      error: error => {
        this.candidateError.set(errorMessage(error.status, 'carregar os responsáveis'));
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
        if (!value.allowedNextStages.includes(this.selectedStage()) ||
            (this.reopening() && value.stage !== 'CLOSED')) this.selectStage('');
        this.clearUnavailableTransfer(value);
        this.caseUpdated.emit({value, mutated: false});
        if (this.historyOpen()) this.loadHistory(0);
      },
      error: error => {
        this.pending.set(null);
        this.operationError.set(errorMessage(error.status, 'sincronizar o caso'));
      }
    });
  }

  toggleHistory() {
    if (this.busy()) return;
    this.historyOpen.update(open => !open);
    if (this.historyOpen()) this.loadHistory(0);
  }

  loadHistory(page: number) {
    if (this.busy()) return;
    this.pending.set('history');
    this.requestedPage.set(page);
    this.historyError.set('');
    this.api.caseHistory(this.item().id, page).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: response => {
        this.history.set(response);
        this.pending.set(null);
      },
      error: error => {
        this.historyError.set(errorMessage(error.status, 'carregar o histórico do caso'));
        this.pending.set(null);
      }
    });
  }

  private clearUnavailableTransfer(value: NapneCase) {
    if (this.transferOpen() && ['CLOSED', 'ARCHIVED'].includes(value.stage)) this.closeTransfer();
  }

  private mutate(request: Observable<NapneCase>, action: string, success: string) {
    this.operationError.set('');
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: value => {
        const operation = this.pending();
        this.pending.set(null);
        if (operation === 'transfer') this.closeTransfer();
        if (operation === 'stage') this.selectStage('');
        this.clearUnavailableTransfer(value);
        this.caseUpdated.emit({value, mutated: true});
        this.toast.show(success, 'success');
        if (this.historyOpen()) this.loadHistory(0);
      },
      error: error => {
        this.pending.set(null);
        this.conflict.set(error.status === 409);
        this.operationError.set(error.status === 409
          ? 'O caso mudou desde a última leitura. Sincronize este caso antes de tentar novamente.'
          : errorMessage(error.status, action));
      }
    });
  }
}
