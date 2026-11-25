import { DOCUMENT } from '@angular/common';
import { Component, DestroyRef, ElementRef, Injector, OnInit, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, Subscription, catchError, finalize, switchMap } from 'rxjs';
import { ApiService } from '../core/api.service';
import { PEI_ANNEX_I_VERSION, Pei, PeiAction, PeiAnnexI, PeiTransferCandidate } from '../core/models';
import { errorMessage, labelFor, toneFor } from '../core/presentation';
import { ToastService } from '../core/toast.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { buildPeiAnnexIForm, peiAnnexIContent, PeiAnnexIForm } from './pei-annex-i-form';
import { PeiAnnexIComponent } from './pei-annex-i.component';

type ConfirmedPeiAction = Extract<PeiAction, 'RETURN' | 'APPROVE' | 'ARCHIVE'>;
type RequestedPeiAction = Exclude<PeiAction, 'EDIT' | 'TRANSFER'>;

const TRANSFER_CONFLICT = 'O PEI mudou desde que foi carregado. Atualize a página para consultar a revisão mais recente.';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, ConfirmDialogComponent, PeiAnnexIComponent],
  template: `
    <a [routerLink]="['/estudantes', studentId()]" class="back-link">← Voltar ao acompanhamento</a>
    @if (loading()) {
      <div class="loading-grid" aria-label="Carregando PEI">
        <span class="skeleton skeleton-card"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-card"></span>
      </div>
    }
    @if (loadError()) {
      <div class="error" role="alert"><strong>Não foi possível carregar o PEI.</strong><p>{{ loadError() }}</p></div>
    }
    @if (pei(); as value) {
      <header class="pei-header">
        <div>
          <span class="eyebrow">Plano de Ensino Individualizado</span>
          <h1 #editorTitle tabindex="-1">Editor do PEI</h1>
          <p>Período {{ value.academicTermLabel ?? value.academicTerm }} · revisão {{ value.revision }}</p>
          @if (value.status === 'APPROVED') { <p class="pei-lifecycle">Versão vigente</p> }
          @if (value.status === 'SUPERSEDED' || value.status === 'ARCHIVED') {
            <p class="pei-lifecycle">Versão histórica · consulta</p>
          }
        </div>
        <span [class]="'badge badge--' + tone(value.status)">{{ peiStatusLabel(value.status) }}</span>
      </header>
      <div class="notice review-note" role="note">
        <span class="review-mark" aria-hidden="true">✓</span>
        <div><strong>Revisão humana obrigatória</strong><p>Este rascunho apoia o planejamento pedagógico. Não representa diagnóstico e não substitui a análise do docente e da equipe responsável.</p></div>
      </div>
      @if (value.transfer; as transfer) {
        <div class="notice review-note" role="note">
          <div><strong>Motivo da transferência</strong><p>{{ transfer.reason }}</p></div>
        </div>
      }
      @if (conflict()) {
        <div class="error conflict-message" role="alert">O PEI mudou desde que foi carregado. Seu rascunho continua no formulário; atualize a página para consultar a versão mais recente antes de tentar novamente.</div>
      }
      @if (transferConflict() && !transferOpen()) {
        <div class="error conflict-message" role="alert">{{ transferConflictMessage }}</div>
      }
      <form class="editor-layout" [formGroup]="form" (ngSubmit)="save()">
        <aside class="editor-nav card">
          <strong>Seções do documento</strong>
          @if (officialForm()) {
            @if (annexModel(); as model) {
              @for (section of annexSections; track section.id) {
                @let id = 'annex-' + section.id;
                <a [href]="sectionHref(id)" (click)="jumpToSection($event, id)">{{ model.labels[section.key] }}</a>
              }
            }
          } @else {
            @for (section of sections; track section.id) {
              <a [href]="sectionHref(section.id)" (click)="jumpToSection($event, section.id)">{{ section.label }}</a>
            }
          }
          <div class="document-state"><span>Estado atual</span><strong>{{ peiStatusLabel(value.status) }}</strong><small>Revisão {{ value.revision }}</small></div>
        </aside>
        <div class="editor-main stack">
          @if (officialForm()) {
            @if (annexModel(); as model) {
              @if (annexForm(); as official) {
                <app-pei-annex-i [model]="model" [form]="official" [pei]="value" [editable]="canEdit()" [saving]="saving()" />
              }
            } @else if (annexError()) {
              <div class="error" role="alert">
                <p>{{ annexError() }}</p>
                <button type="button" class="secondary" (click)="loadAnnexModel()">Tentar novamente</button>
              </div>
            } @else {
              <p role="status">Carregando formulário do Anexo I…</p>
            }
          } @else {
          <fieldset class="pei-fields" [disabled]="!canEdit() || saving()">
            <section class="card form-section" id="overview">
              <div class="section-header"><div><span class="eyebrow">01 · Visão geral</span><h2>Direcionamento pedagógico</h2><p>Defina o objetivo central e as competências profissionais.</p></div></div>
              <label class="required">Objetivo geral · necessário para aprovação<textarea formControlName="generalObjectives"></textarea></label>
              <label>Habilidades e competências profissionais<textarea formControlName="professionalSkills" placeholder="Uma habilidade por linha"></textarea></label>
            </section>
            <section class="card form-section" id="objectives">
              <div class="section-header"><div><span class="eyebrow">02 · Objetivos</span><h2>Objetivos de aprendizagem</h2><p>Registre um objetivo por linha para facilitar a revisão.</p></div></div>
              <div class="grid two"><label>Objetivos específicos<textarea formControlName="specificObjectives"></textarea></label><label>Objetivos não aplicáveis e justificativas<textarea formControlName="eliminatedObjectives"></textarea></label><label>Objetivos alternativos<textarea formControlName="alternativeObjectives"></textarea></label><label>Objetivos complementares<textarea formControlName="complementaryObjectives"></textarea></label></div>
            </section>
            <section class="card form-section" id="content">
              <div class="section-header"><div><span class="eyebrow">03 · Conteúdo</span><h2>Organização curricular</h2></div></div>
              <div class="grid two"><label>Ementa<textarea formControlName="syllabus"></textarea></label><label>Pré-requisitos<textarea formControlName="prerequisites"></textarea></label><label>Conteúdos prioritários<textarea formControlName="contents" placeholder="Um conteúdo por linha"></textarea></label></div>
            </section>
            <section class="card form-section" id="strategies">
              <div class="section-header"><div><span class="eyebrow">04 · Estratégias</span><h2>Estratégias e recursos</h2></div></div>
              <div class="grid two"><label>Estratégias facilitadoras<textarea formControlName="teachingStrategies" placeholder="Uma estratégia por linha"></textarea></label><label>Recursos metodológicos e assistivos<textarea formControlName="methodologicalResources" placeholder="Um recurso por linha"></textarea></label></div>
            </section>
            <section class="card form-section" id="assessment">
              <div class="section-header"><div><span class="eyebrow">05 · Avaliação</span><h2>Avaliação e recuperação</h2></div></div>
              <div class="grid two"><label>Critérios de avaliação<textarea formControlName="assessmentCriteria" placeholder="Um critério por linha"></textarea></label><label>Instrumentos de avaliação<textarea formControlName="assessmentInstruments" placeholder="Um instrumento por linha"></textarea></label><label>Recuperação diferenciada<textarea formControlName="recoveryProposal"></textarea></label></div>
            </section>
            <section class="card form-section" id="bibliography">
              <div class="section-header"><div><span class="eyebrow">06 · Referências</span><h2>Bibliografia</h2></div></div>
              <div class="grid two"><label>Bibliografia básica<textarea formControlName="basicBibliography" placeholder="Uma referência por linha"></textarea></label><label>Bibliografia complementar<textarea formControlName="complementaryBibliography" placeholder="Uma referência por linha"></textarea></label></div>
            </section>
            <section class="card form-section" id="skills">
              <div class="section-header"><div><span class="eyebrow">07 · Inventário</span><h2>Habilidades e competências</h2><p>Registre a observação em cada dimensão. Todas as opções mantêm o significado institucional previsto.</p></div></div>
              <div class="skills-grid">@for (dimension of dimensions; track dimension.key) {
                <label>{{ dimension.label }}<select [formControlName]="dimension.key"><option value="REALIZA_COM_AJUDA">Realiza com ajuda</option><option value="REALIZA_SEM_AJUDA">Realiza sem ajuda</option><option value="NAO_REALIZA">Não realiza</option><option value="NAO_OBSERVADO">Não foi observado</option></select></label>
              }</div>
            </section>
          </fieldset>
          }
          @if (hasAction('SUBMIT') && isDirty()) {
            <p class="field-hint" role="status">Salve o rascunho antes de enviá-lo para revisão.</p>
          }
          <div class="editor-actions">
            <div><strong>{{ isDirty() ? 'Alterações ainda não salvas' : 'Revisão atual salva' }}</strong><small>{{ isDirty() ? 'Salve o rascunho antes de enviar ou iniciar outra ação.' : 'As ações disponíveis seguem o estado desta versão.' }}</small></div>
            @if (canEdit()) { <button type="submit" [disabled]="saving() || !documentReady()">@if (saving()) { <span class="spinner"></span> }Salvar rascunho</button> }
            @if (hasAction('SUBMIT')) { <button type="button" (click)="performAction('SUBMIT')" [disabled]="saving() || isDirty() || !documentReady()">Enviar para revisão</button> }
            @if (hasAction('START_REVISION')) { <button type="button" (click)="performAction('START_REVISION')" [disabled]="saving() || isDirty()">Iniciar nova revisão</button> }
            @if (hasAction('RETURN')) { <button type="button" class="secondary" (click)="requestConfirmation('RETURN')" [disabled]="saving() || isDirty()">Devolver para ajustes</button> }
            @if (hasAction('APPROVE')) { <button type="button" class="approve" (click)="requestConfirmation('APPROVE')" [disabled]="saving() || isDirty() || !documentReady()">Aprovar PEI</button> }
            @if (hasAction('ARCHIVE')) { <button type="button" class="secondary" (click)="requestConfirmation('ARCHIVE')" [disabled]="saving() || isDirty()">Arquivar PEI</button> }
            @if (hasAction('TRANSFER')) { <button type="button" class="secondary" (click)="openTransfer()" [disabled]="!canOpenTransfer()">Transferir rascunho</button> }
            @if (officialForm()) {
              <button type="button" class="secondary" (click)="requestPdf()" [disabled]="saving() || downloadingPdf()">
                {{ downloadingPdf() ? 'Baixando PDF…' : 'Baixar PDF' }}
              </button>
            }
          </div>
        </div>
      </form>
    }
    <app-confirm-dialog [open]="pendingAction() !== null" [title]="confirmationTitle()" [description]="confirmationDescription()" [confirmLabel]="confirmationLabel()" [danger]="pendingAction() === 'ARCHIVE'" (confirmed)="confirmAction()" (cancelled)="cancelConfirmation()" />
    <app-confirm-dialog [open]="confirmPdfOpen()" title="Baixar PDF da revisão salva?"
      description="Há alterações locais no formulário. O PDF contém somente os dados da última gravação desta revisão."
      confirmLabel="Baixar revisão salva" (confirmed)="downloadPdf()" (cancelled)="confirmPdfOpen.set(false)" />
    <app-confirm-dialog [open]="transferOpen()" title="Transferir rascunho do PEI?"
      description="O conteúdo e a autoria serão mantidos. O docente escolhido poderá editar e enviar a nova revisão."
      confirmLabel="Confirmar transferência" [busy]="saving()" [confirmDisabled]="!canConfirmTransfer()"
      (confirmed)="confirmTransfer()" (cancelled)="resetTransfer()">
      @if (loadingTransferCandidates()) {
        <p role="status">Carregando docentes elegíveis…</p>
      }
      @if (transferCandidateOptions(); as candidates) {
        @if (candidates.length) {
          <fieldset class="stack" [formGroup]="transferForm" [disabled]="saving()">
            <label>Novo docente
              <select formControlName="teacherId" required>
                <option value="">Selecione um docente</option>
                @for (candidate of candidates; track candidate.id) {
                  <option [value]="candidate.id">{{ candidate.label }}</option>
                }
              </select>
            </label>
            <label>Motivo
              <textarea formControlName="reason" required maxlength="500" rows="3" aria-describedby="pei-transfer-reason-hint"></textarea>
            </label>
            <small id="pei-transfer-reason-hint" class="field-hint">Obrigatório. Até 500 caracteres.</small>
          </fieldset>
        } @else {
          <p role="status">Nenhum docente elegível para receber este rascunho.</p>
        }
      }
      @if (saving()) {
        <p role="status">Transferindo rascunho…</p>
      }
      @if (transferError()) {
        <p class="error" role="alert">{{ transferError() }}</p>
        @if (!transferCandidates() && !transferConflict()) {
          <button type="button" class="secondary" (click)="loadTransferCandidates()">Tentar novamente</button>
        }
      }
    </app-confirm-dialog>
  `,
  styles: [`
    .back-link{display:inline-flex;margin-bottom:1rem;font-weight:700;text-decoration:none}
    .pei-header{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;margin-bottom:1rem}
    .pei-header p{color:var(--ink-600);margin:0}.pei-lifecycle{font-weight:700}
    .review-note{display:flex;gap:1rem;margin-bottom:1rem}.review-note p{margin:.2rem 0 0}
    .review-mark{width:2.4rem;height:2.4rem;display:grid;place-items:center;border-radius:50%;background:#fff;color:var(--info);font-weight:900;flex:none}
    .editor-layout{display:grid;grid-template-columns:14.5rem minmax(0,1fr);gap:1rem;align-items:start}
    .editor-nav{position:sticky;top:5.75rem;display:grid;gap:.2rem;padding:1rem}
    .editor-nav>a{padding:.45rem .55rem;border-radius:.4rem;text-decoration:none;font-size:.86rem}.editor-nav>a:hover{background:var(--primary-50)}
    .document-state{border-top:1px solid var(--border);margin-top:.75rem;padding:.8rem .55rem 0}
    .document-state span,.document-state strong,.document-state small{display:block}.document-state span,.document-state small{color:var(--ink-600);font-size:.75rem}
    .pei-fields{display:grid;gap:1rem;border:0;padding:0;margin:0;min-width:0}.form-section{scroll-margin-top:6rem}
    .skills-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}
    .editor-actions{position:sticky;bottom:1rem;z-index:10;display:flex;flex-wrap:wrap;align-items:center;gap:.75rem;background:var(--primary-950);color:#fff;border-radius:var(--radius-lg);padding:1rem;box-shadow:var(--shadow-md)}
    .editor-actions>div{flex:1 1 18rem}.editor-actions strong,.editor-actions small{display:block}.editor-actions small{color:#c7ddd6}
    .editor-actions .approve{background:#fff;color:var(--primary-900)}.conflict-message{margin-bottom:1rem}
    @media(max-width:950px){.editor-layout{grid-template-columns:1fr}.editor-nav{position:static;display:flex;overflow:auto}.editor-nav>strong,.document-state{display:none}.editor-actions>div{flex-basis:100%}}
    @media(max-width:700px){.pei-header{align-items:flex-start;flex-direction:column}.skills-grid{grid-template-columns:1fr}.editor-actions{position:static;align-items:stretch;flex-direction:column}.editor-actions>div{flex:auto}.editor-actions button{width:100%}}
  `]
})
export class PeiEditorComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly editorTitle = viewChild<ElementRef<HTMLHeadingElement>>('editorTitle');

  readonly sections = [
    {id: 'overview', label: 'Visão geral'}, {id: 'objectives', label: 'Objetivos'},
    {id: 'content', label: 'Conteúdo'}, {id: 'strategies', label: 'Estratégias e recursos'},
    {id: 'assessment', label: 'Avaliação'}, {id: 'bibliography', label: 'Bibliografia'},
    {id: 'skills', label: 'Inventário de habilidades'}
  ];
  protected readonly annexSections = [
    { id: 'identification', key: 'annex' }, { id: 'objectives', key: 'objectives' }, { id: 'contents', key: 'contents' },
    { id: 'assessment', key: 'assessment' }, { id: 'basicBibliography', key: 'basicBibliography' },
    { id: 'inventory', key: 'skillsInventory' }, { id: 'observations', key: 'observations' }
  ];
  readonly dimensions = [
    {key: 'oralCommunication', label: 'Comunicação oral'}, {key: 'readingAndWriting', label: 'Leitura e produção textual'},
    {key: 'logicalMathematicalReasoning', label: 'Raciocínio lógico-matemático'},
    {key: 'socioemotionalSkills', label: 'Habilidades socioemocionais'},
    {key: 'functionalAutonomy', label: 'Autonomia funcional'}, {key: 'digitalTechnologies', label: 'Tecnologias digitais'}
  ];
  private readonly routeContext = signal({
    studentId: Number(this.route.snapshot.paramMap.get('studentId')),
    peiId: String(this.route.snapshot.paramMap.get('peiId'))
  });
  readonly studentId = computed(() => this.routeContext().studentId);
  readonly pei = signal<Pei | null>(null);
  private readonly currentPei = computed(() => {
    const { studentId, peiId } = this.routeContext();
    const value = this.pei();
    return value?.id === peiId && value.studentId === studentId ? value : null;
  });
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly saving = signal(false);
  readonly conflict = signal(false);
  protected readonly officialForm = computed(() => this.pei()?.formVersion === PEI_ANNEX_I_VERSION);
  protected readonly annexModel = signal<PeiAnnexI | null>(null);
  protected readonly annexForm = signal<PeiAnnexIForm | null>(null);
  protected readonly documentReady = computed(() => !this.officialForm() || this.annexForm() !== null);
  protected readonly annexError = signal('');
  protected readonly confirmPdfOpen = signal(false);
  protected readonly downloadingPdf = signal(false);
  readonly pendingAction = signal<ConfirmedPeiAction | null>(null);
  readonly transferOpen = signal(false);
  readonly transferCandidates = signal<PeiTransferCandidate[] | null>(null);
  readonly transferCandidateOptions = computed(() => {
    const candidates = this.transferCandidates();
    if (!candidates) return null;
    const countByName = new Map<string, number>();
    for (const { name } of candidates) countByName.set(name, (countByName.get(name) ?? 0) + 1);
    return candidates.map(({ id, name }) => ({
      id, label: countByName.get(name) === 1 ? name : `${name} (#${id})`
    }));
  });
  readonly loadingTransferCandidates = signal(false);
  readonly transferConflict = signal(false);
  readonly transferError = signal('');
  readonly transferConflictMessage = TRANSFER_CONFLICT;
  readonly transferForm = this.fb.nonNullable.group({ teacherId: '', reason: '' });
  readonly label = labelFor;
  readonly tone = toneFor;
  readonly canEdit = computed(() => this.hasAction('EDIT'));
  private rawContent: Record<string, unknown> = {};
  private transferCandidatesRequest?: Subscription;
  private annexLoading = false;
  private pdfRequest?: Subscription;

  readonly form = this.fb.nonNullable.group({
    generalObjectives: ['', Validators.required], specificObjectives: [''], eliminatedObjectives: [''],
    alternativeObjectives: [''], complementaryObjectives: [''], professionalSkills: [''], syllabus: [''],
    prerequisites: [''], contents: [''], teachingStrategies: [''], methodologicalResources: [''],
    assessmentCriteria: [''], assessmentInstruments: [''], recoveryProposal: [''], basicBibliography: [''],
    complementaryBibliography: [''], oralCommunication: [''], readingAndWriting: [''],
    logicalMathematicalReasoning: [''], socioemotionalSkills: [''], functionalAutonomy: [''], digitalTechnologies: ['']
  });

  ngOnInit() {
    this.route.paramMap.pipe(
      switchMap(params => {
        const studentId = Number(params.get('studentId'));
        const peiId = String(params.get('peiId'));
        this.routeContext.set({ studentId, peiId });
        if (this.currentPei()) return EMPTY;

        this.pei.set(null);
        this.rawContent = {};
        this.form.reset();
        this.annexForm.set(null);
        this.resetPdf();
        this.resetTransfer();
        this.cancelConfirmation();
        this.saving.set(false);
        this.conflict.set(false);
        this.transferConflict.set(false);
        this.loading.set(true);
        this.loadError.set('');
        return this.api.pei(studentId, peiId).pipe(catchError(error => {
          this.failLoading(error.status);
          return EMPTY;
        }));
      }),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(value => {
      const { studentId, peiId } = this.routeContext();
      if (value.studentId === studentId && value.id === peiId) {
        this.accept(value);
      } else {
        this.failLoading();
      }
    });
  }

  private failLoading(status?: number) {
    this.loading.set(false);
    this.loadError.set(errorMessage(status, 'carregar o PEI'));
  }

  private acceptMutation(previous: Pei, value: Pei) {
    this.accept(value);
    if (value.id !== previous.id) {
      void this.router.navigate(['/estudantes', previous.studentId, 'pei', value.id]);
    }
  }

  peiStatusLabel(status: string): string {
    if (status === 'APPROVED') return 'Vigente';
    if (status === 'SUPERSEDED') return 'Histórico · substituído';
    if (status === 'ARCHIVED') return 'Histórico · arquivado';
    return this.label(status);
  }

  hasAction(action: PeiAction): boolean {
    const value = this.currentPei();
    return value?.allowedActions?.includes(action) === true && Number.isInteger(value.storageVersion);
  }

  protected sectionHref(id: string) {
    const { pathname, search } = this.document.location;
    return `${pathname}${search}#${id}`;
  }

  protected jumpToSection(event: MouseEvent, id: string) {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    const section = this.host.nativeElement.querySelector<HTMLElement>(`#${id}`);
    if (!section) return;
    const heading = section.querySelector<HTMLElement>('h2, h3, th[id], label[for]') ?? section;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    section.scrollIntoView({ block: 'start' });
  }

  save() {
    const value = this.currentPei();
    const annex = this.annexForm();
    const form = this.officialForm() ? annex : this.form;
    form?.markAllAsTouched();
    if (!value || !form || !this.canEdit() || this.saving()) return;
    this.saving.set(true);
    this.conflict.set(false);
    this.api.revisePei(value.studentId, value.id, {
      content: annex ? peiAnnexIContent(annex) : this.content(), version: value.storageVersion!
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        if (this.currentPei() !== value) return;
        this.acceptMutation(value, result);
        this.toast.show('Rascunho do PEI salvo. Envie-o para revisão quando estiver pronto.', 'success');
      },
      error: error => {
        if (this.currentPei() === value) this.fail(error.status, 'salvar o rascunho');
      }
    });
  }

  protected isDirty() {
    return this.officialForm() ? this.annexForm()?.dirty === true : this.form.dirty;
  }

  protected loadAnnexModel() {
    if (this.annexLoading || this.annexModel()) return;
    this.annexLoading = true;
    this.annexError.set('');
    this.api.peiAnnexI().pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => { this.annexLoading = false; })
    ).subscribe({
      next: model => {
        if (model.version !== PEI_ANNEX_I_VERSION) {
          this.annexError.set('A definição recebida não corresponde ao Anexo I desta revisão.');
          return;
        }
        this.annexModel.set(model);
        const value = this.pei();
        if (value?.formVersion === PEI_ANNEX_I_VERSION) {
          this.annexForm.set(buildPeiAnnexIForm(this.fb, model, value.content));
        }
      },
      error: error => this.annexError.set(errorMessage(error.status, 'carregar o formulário do Anexo I'))
    });
  }

  protected requestPdf() {
    if (!this.currentPei() || !this.officialForm() || this.saving() || this.downloadingPdf()) return;
    if (this.isDirty()) this.confirmPdfOpen.set(true);
    else this.downloadPdf();
  }

  protected downloadPdf() {
    this.confirmPdfOpen.set(false);
    const value = this.currentPei();
    if (!value || !this.officialForm() || this.saving() || this.downloadingPdf()) return;

    this.downloadingPdf.set(true);
    this.pdfRequest = this.api.downloadPeiPdf(value.studentId, value.id).pipe(
      takeUntilDestroyed(this.destroyRef),
      finalize(() => this.downloadingPdf.set(false))
    ).subscribe({
      next: response => {
        const pdf = response.body;
        if (!pdf?.size || pdf.type !== 'application/pdf') {
          this.toast.show('O servidor não retornou um arquivo PDF.', 'error');
          return;
        }
        const attachment = response.headers.get('Content-Disposition');
        const filename = attachment?.match(/(?:^|;)\s*filename\s*=\s*"?([\w.-]+\.pdf)"?(?:;|$)/i)?.[1];
        const fallback = `pei-revisao-${value.revision}${value.status === 'DRAFT' ? '-rascunho' : ''}.pdf`;
        const url = URL.createObjectURL(pdf);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename ?? fallback;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: error => this.toast.show(errorMessage(error.status, 'baixar o PDF'), 'error')
    });
  }

  private resetPdf() {
    this.confirmPdfOpen.set(false);
    this.pdfRequest?.unsubscribe();
    this.pdfRequest = undefined;
  }

  performAction(action: RequestedPeiAction) {
    const value = this.currentPei();
    if (!value || !this.hasAction(action) || this.saving()) return;
    if ((action === 'SUBMIT' || action === 'APPROVE') && !this.documentReady()) return;
    if (this.isDirty()) {
      this.toast.show('Salve as alterações locais antes de continuar com esta ação.', 'error');
      return;
    }
    this.saving.set(true);
    this.conflict.set(false);
    this.api.peiAction(value.studentId, value.id, action, value.storageVersion!)
    .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        if (this.currentPei() !== value) return;
        this.acceptMutation(value, result);
        const messages: Record<RequestedPeiAction, string> = {
          START_REVISION: 'Nova revisão iniciada como rascunho.', SUBMIT: 'PEI enviado para revisão do NAPNE.',
          RETURN: 'PEI devolvido para ajustes.', APPROVE: 'PEI aprovado e vigente.', ARCHIVE: 'PEI arquivado e mantido no histórico.'
        };
        this.toast.show(messages[action], 'success');
      },
      error: error => {
        if (this.currentPei() === value) this.fail(error.status, this.actionVerb(action));
      }
    });
  }

  requestConfirmation(action: ConfirmedPeiAction) {
    if (action === 'APPROVE' && !this.documentReady()) return;
    if (this.hasAction(action) && !this.isDirty() && !this.saving()) this.pendingAction.set(action);
  }

  confirmAction() {
    const action = this.pendingAction();
    this.pendingAction.set(null);
    if (action) this.performAction(action);
  }

  cancelConfirmation() { this.pendingAction.set(null); }

  canOpenTransfer() {
    return this.hasAction('TRANSFER') && !this.isDirty() && !this.loading() && !this.saving() && !this.transferConflict();
  }

  openTransfer() {
    if (this.transferOpen() || !this.canOpenTransfer()) return;
    this.transferOpen.set(true);
    this.loadTransferCandidates();
  }

  loadTransferCandidates() {
    const value = this.currentPei();
    if (!value || !this.transferOpen() || !this.canOpenTransfer() || this.loadingTransferCandidates()) return;
    this.transferError.set('');
    this.loadingTransferCandidates.set(true);
    this.transferCandidatesRequest = this.api.peiTransferCandidates(value.studentId, value.id)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: candidates => {
          this.transferCandidates.set(candidates);
          this.loadingTransferCandidates.set(false);
        },
        error: error => {
          this.loadingTransferCandidates.set(false);
          this.transferConflict.set(error.status === 409);
          this.transferError.set(error.status === 409
            ? TRANSFER_CONFLICT
            : errorMessage(error.status, 'carregar docentes elegíveis'));
        }
      });
  }

  canConfirmTransfer() {
    const { teacherId, reason } = this.transferForm.getRawValue();
    const normalizedReason = reason.trim();
    return this.transferOpen() && this.hasAction('TRANSFER') && !this.transferConflict() && !this.isDirty()
      && !!normalizedReason && normalizedReason.length <= 500
      && this.transferCandidates()?.some(candidate => String(candidate.id) === teacherId) === true;
  }

  confirmTransfer() {
    const value = this.currentPei();
    if (!value || this.saving() || !this.canConfirmTransfer()) return;
    const { teacherId, reason } = this.transferForm.getRawValue();
    this.saving.set(true);
    this.transferError.set('');
    this.api.transferPei(value.studentId, value.id, {
      teacherId: Number(teacherId), reason: reason.trim(), version: value.storageVersion!
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        if (!this.isCurrentTransfer(value)) return;
        this.resetTransfer();
        this.acceptMutation(value, result);
        afterNextRender(() => this.editorTitle()?.nativeElement.focus(), { injector: this.injector });
        this.toast.show('Rascunho do PEI transferido.', 'success');
      },
      error: error => {
        if (!this.isCurrentTransfer(value)) return;
        this.saving.set(false);
        this.transferConflict.set(error.status === 409);
        this.transferError.set(error.status === 409
          ? `${TRANSFER_CONFLICT} Seleção e motivo preservados.`
          : errorMessage(error.status, 'transferir o rascunho do PEI'));
      }
    });
  }

  resetTransfer() {
    this.transferCandidatesRequest?.unsubscribe();
    this.transferCandidatesRequest = undefined;
    this.transferOpen.set(false);
    this.loadingTransferCandidates.set(false);
    this.transferCandidates.set(null);
    this.transferError.set('');
    this.transferForm.reset();
  }

  private isCurrentTransfer(value: Pei) {
    return this.transferOpen() && this.currentPei() === value;
  }

  confirmationTitle(): string {
    const titles: Record<ConfirmedPeiAction, string> = {
      RETURN: 'Devolver o PEI para ajustes?', APPROVE: 'Aprovar esta revisão do PEI?', ARCHIVE: 'Arquivar o PEI vigente?'
    };
    return this.pendingAction() ? titles[this.pendingAction()!] : 'Confirmar ação';
  }

  confirmationDescription(): string {
    const descriptions: Record<ConfirmedPeiAction, string> = {
      RETURN: 'O docente poderá editar o rascunho devolvido e enviá-lo novamente.',
      APPROVE: 'A aprovação registra a revisão humana e torna esta versão vigente.',
      ARCHIVE: 'A versão deixará de ser vigente e continuará disponível no histórico.'
    };
    return this.pendingAction() ? descriptions[this.pendingAction()!] : '';
  }

  confirmationLabel(): string {
    const labels: Record<ConfirmedPeiAction, string> = {
      RETURN: 'Devolver PEI', APPROVE: 'Aprovar PEI', ARCHIVE: 'Arquivar PEI'
    };
    return this.pendingAction() ? labels[this.pendingAction()!] : 'Confirmar';
  }

  private actionVerb(action: RequestedPeiAction): string {
    const verbs: Record<RequestedPeiAction, string> = {
      START_REVISION: 'iniciar a revisão', SUBMIT: 'enviar o PEI para revisão', RETURN: 'devolver o PEI',
      APPROVE: 'aprovar o PEI', ARCHIVE: 'arquivar o PEI'
    };
    return verbs[action];
  }

  private accept(value: Pei) {
    this.resetPdf();
    this.pei.set(value);
    if (this.officialForm()) {
      const model = this.annexModel();
      if (model) this.annexForm.set(buildPeiAnnexIForm(this.fb, model, value.content));
      else this.loadAnnexModel();
    } else {
      this.annexForm.set(null);
      this.rawContent = value.content ?? {};
      this.fill(this.rawContent);
      this.form.markAsPristine();
    }
    this.saving.set(false);
    this.conflict.set(false);
    this.loading.set(false);
  }

  private fail(status: number, action: string) {
    this.saving.set(false);
    this.conflict.set(status === 409);
    if (status === 409) {
      this.toast.show('O PEI foi alterado por outra pessoa. Seu rascunho local foi preservado.', 'error');
      return;
    }
    this.toast.show(errorMessage(status, action), 'error');
  }

  private content(): Record<string, unknown> {
    const value = this.form.getRawValue();
    const lines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean);
    return {
      ...this.rawContent,
      generalObjectives: value.generalObjectives,
      specificObjectives: lines(value.specificObjectives),
      eliminatedObjectives: lines(value.eliminatedObjectives),
      alternativeObjectives: lines(value.alternativeObjectives),
      complementaryObjectives: lines(value.complementaryObjectives),
      professionalSkills: lines(value.professionalSkills),
      syllabus: value.syllabus,
      prerequisites: value.prerequisites,
      contents: lines(value.contents),
      teachingStrategies: lines(value.teachingStrategies),
      methodologicalResources: lines(value.methodologicalResources),
      assessmentCriteria: lines(value.assessmentCriteria),
      assessmentInstruments: lines(value.assessmentInstruments),
      recoveryProposal: value.recoveryProposal,
      basicBibliography: lines(value.basicBibliography),
      complementaryBibliography: lines(value.complementaryBibliography),
      skillsInventory: {
        oralCommunication: value.oralCommunication,
        readingAndWriting: value.readingAndWriting,
        logicalMathematicalReasoning: value.logicalMathematicalReasoning,
        socioemotionalSkills: value.socioemotionalSkills,
        functionalAutonomy: value.functionalAutonomy,
        digitalTechnologies: value.digitalTechnologies
      }
    };
  }

  private fill(content: Record<string, unknown>) {
    const text = (key: string) => Array.isArray(content[key])
      ? (content[key] as unknown[]).join('\n')
      : typeof content[key] === 'object' ? JSON.stringify(content[key], null, 2) : String(content[key] ?? '');
    const inventory = (content['skillsInventory'] ?? {}) as Record<string, unknown>;
    this.form.patchValue({
      generalObjectives: text('generalObjectives'), specificObjectives: text('specificObjectives'),
      eliminatedObjectives: text('eliminatedObjectives'), alternativeObjectives: text('alternativeObjectives'),
      complementaryObjectives: text('complementaryObjectives'), professionalSkills: text('professionalSkills'),
      syllabus: text('syllabus'), prerequisites: text('prerequisites'), contents: text('contents'),
      teachingStrategies: text('teachingStrategies'), methodologicalResources: text('methodologicalResources'),
      assessmentCriteria: text('assessmentCriteria'), assessmentInstruments: text('assessmentInstruments'),
      recoveryProposal: text('recoveryProposal'), basicBibliography: text('basicBibliography'),
      complementaryBibliography: text('complementaryBibliography'),
      oralCommunication: this.join(inventory['oralCommunication']),
      readingAndWriting: this.join(inventory['readingAndWriting']),
      logicalMathematicalReasoning: this.join(inventory['logicalMathematicalReasoning']),
      socioemotionalSkills: this.join(inventory['socioemotionalSkills']),
      functionalAutonomy: this.join(inventory['functionalAutonomy']),
      digitalTechnologies: this.join(inventory['digitalTechnologies'])
    });
  }

  private join(value: unknown) { return typeof value === 'string' ? value : 'NAO_OBSERVADO'; }
}
