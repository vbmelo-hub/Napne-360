import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '../core/api.service';
import { createListView, LIST_PAGE_SIZE } from '../core/list-view';
import { CaseStageConfiguration } from '../core/models';
import { errorMessage } from '../core/presentation';
import { ToastService } from '../core/toast.service';
import { PaginationComponent } from '../shared/pagination.component';

interface DraftStage {
  id: number;
  code: string | null;
  label: string;
}

@Component({
  selector: 'app-admin-case-stages',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PaginationComponent],
  template: `
    <form class="card stack stages-form" (submit)="$event.preventDefault(); save()">
      <header class="section-header">
        <div>
          <h2>Etapas dos casos</h2>
          <p>Edite os nomes e organize a ordem das etapas disponíveis para a equipe NAPNE.</p>
        </div>
      </header>

      @if (conflict()) {
        <div class="error" role="alert">
          Outra pessoa salvou uma nova configuração. Seu rascunho está visível.
          Recarregue a configuração para descartar o rascunho e continuar.
        </div>
        <div><button type="button" class="secondary" [disabled]="busy()" (click)="load()">
          Recarregar e descartar rascunho
        </button></div>
      }
      @if (error()) {
        <div class="error" role="alert">{{error()}}</div>
        @if (version() === null) {
          <div><button type="button" class="secondary" [disabled]="busy()" (click)="load()">Tentar novamente</button></div>
        }
      }
      @if (busy()) {
        <p role="status">{{operation() === 'load' ? 'Carregando etapas…' : 'Salvando etapas…'}}</p>
      }

      @if (version() !== null) {
        <fieldset class="stack" [disabled]="busy()">
          <legend class="sr-only">Nomes e ordem das etapas dos casos</legend>
          <label class="list-filter">Filtrar etapas
            <input #stageFilter type="search" [value]="stageList.query()" (input)="filterStages(stageFilter.value)">
          </label>
          <ol class="stages-list">
            @for (stage of stageList.items(); track stage.id) {
              @let stageIndex = stageOrder().get(stage.id) ?? 0;
              @let position = stageIndex + 1;
              @let issue = nameError(stage.label);
              <li class="stage-row">
                <div>
                  <label class="required">
                    Nome da etapa {{position}}
                    <input #nameField required [value]="stage.label" (input)="rename(stage.id, nameField.value)"
                      [attr.aria-invalid]="issue ? 'true' : null"
                      [attr.aria-describedby]="issue ? 'stage-error-' + stage.id : null">
                  </label>
                  @if (issue) {
                    <small class="stage-error" [id]="'stage-error-' + stage.id">{{issue}}</small>
                  }
                </div>
                <div class="row stage-actions">
                  @if (stageIndex <= lastActiveIndex()) {
                    <button type="button" class="secondary compact" [disabled]="stageIndex === 0"
                      [attr.aria-label]="'Subir etapa ' + position" (click)="move(stageIndex, -1)">Subir</button>
                    <button type="button" class="secondary compact" [disabled]="stageIndex === lastActiveIndex()"
                      [attr.aria-label]="'Descer etapa ' + position" (click)="move(stageIndex, 1)">Descer</button>
                    @if (stage.code === null) {
                      <button type="button" class="secondary compact"
                        [attr.aria-label]="'Remover etapa ' + position + ' do rascunho'"
                        (click)="removeDraft(stage.id)">Remover</button>
                    }
                  } @else {
                    <span class="badge">{{stage.code === 'CLOSED' ? 'Encerramento' : 'Arquivamento'}}</span>
                  }
                </div>
              </li>
            }
          </ol>
          @if (!stageList.totalElements()) {
            <p class="empty-state">Nenhuma etapa corresponde ao filtro.</p>
          }
          <app-pagination [page]="stageList.page()" [totalPages]="stageList.totalPages()"
            label="Paginação das etapas" (pageChange)="stageList.setPage($event)" />

          @if (invalid() && (stageList.totalPages() > 1 || stageList.query().trim())) {
            <p role="status">Revise os nomes das etapas antes de salvar, inclusive os das outras páginas.</p>
          }
          <div class="row">
            <button type="button" class="secondary" (click)="add()">Adicionar etapa</button>
            <button type="submit" [disabled]="conflict() || invalid()">Salvar etapas</button>
          </div>
        </fieldset>
      }
    </form>
  `,
  styles: [`
    .stages-form { max-width: 50rem; }
    .stages-form .section-header { margin: 0; }
    .stages-form fieldset { margin: 0; border: 0; padding: 0; min-width: 0; }
    .stages-list { list-style: none; margin: 0; padding: 0; }
    .stage-row {
      display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start;
      gap: .6rem 1rem; padding: .8rem 0; border-bottom: 1px solid var(--border);
    }
    .stage-actions { padding-top: 1.65rem; }
    .stage-error { color: var(--danger); }
    @media (max-width: 640px) {
      .stage-row { grid-template-columns: 1fr; }
      .stage-actions { padding-top: 0; }
    }
  `]
})
export class AdminCaseStagesComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private nextId = 0;

  protected readonly stages = signal<DraftStage[]>([]);
  protected readonly version = signal<number | null>(null);
  protected readonly operation = signal<'load' | 'save' | null>(null);
  protected readonly busy = computed(() => this.operation() !== null);
  protected readonly conflict = signal(false);
  protected readonly error = signal('');
  protected readonly lastActiveIndex = computed(() => this.stages().length - 3);
  protected readonly invalid = computed(() => this.stages().some(stage => this.nameError(stage.label)));
  protected readonly stageOrder = computed(() => new Map(this.stages().map((stage, index) => [stage.id, index])));
  private readonly filterLabels = signal(new Map<number, string>());
  protected readonly stageList = createListView(this.stages, stage => [
    this.filterLabels().get(stage.id) ?? stage.label, stage.code,
  ]);

  ngOnInit() {
    this.load();
  }

  protected load() {
    if (this.busy()) return;
    this.operation.set('load');
    this.error.set('');
    this.api.adminCaseStages().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: configuration => this.apply(configuration),
      error: response => {
        this.operation.set(null);
        this.error.set(errorMessage(response.status, 'carregar a configuração de etapas'));
      }
    });
  }

  protected rename(id: number, label: string) {
    this.stages.update(stages => stages.map(stage => stage.id === id ? { ...stage, label } : stage));
  }

  protected filterStages(query: string) {
    // Keep the results steady while the operator edits an inline name.
    this.filterLabels.set(new Map(this.stages().map(stage => [stage.id, stage.label])));
    this.stageList.setQuery(query);
  }

  protected nameError(label: string) {
    const name = label.trim();
    if (!name) return 'Informe o nome da etapa.';
    if (name.length > 100) return 'O nome deve ter até 100 caracteres.';
    return '';
  }

  protected move(index: number, direction: -1 | 1) {
    const destination = index + direction;
    if (index > this.lastActiveIndex() || destination < 0 || destination > this.lastActiveIndex()) return;
    const stages = [...this.stages()];
    [stages[index], stages[destination]] = [stages[destination], stages[index]];
    this.stages.set(stages);
    if (!this.stageList.query().trim()) this.stageList.setPage(Math.floor(destination / LIST_PAGE_SIZE));
  }

  protected add() {
    const stages = [...this.stages()];
    const index = this.lastActiveIndex() + 1;
    stages.splice(index, 0, { id: this.nextId++, code: null, label: '' });
    this.stages.set(stages);
    this.stageList.reset();
    this.stageList.setPage(Math.floor(index / LIST_PAGE_SIZE));
  }

  protected removeDraft(id: number) {
    this.stages.update(stages => stages.filter(stage => stage.id !== id || stage.code !== null));
  }

  protected save() {
    const version = this.version();
    if (version === null || this.busy() || this.conflict() || this.invalid()) return;
    const stages = this.stages().map(({ code, label }) => ({ code, label: label.trim() }));
    this.operation.set('save');
    this.error.set('');
    this.api.updateCaseStages({ version, stages }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: configuration => {
        this.apply(configuration);
        this.toast.show('Etapas salvas com sucesso.', 'success');
      },
      error: response => {
        this.operation.set(null);
        if (response.status === 409) {
          this.conflict.set(true);
        } else {
          this.error.set(errorMessage(response.status, 'salvar as etapas'));
        }
      }
    });
  }

  private apply(configuration: CaseStageConfiguration) {
    this.filterLabels.set(new Map());
    this.stages.set(configuration.stages.map(stage => ({ ...stage, id: this.nextId++ })));
    this.version.set(configuration.version);
    this.conflict.set(false);
    this.operation.set(null);
  }
}
