import { AppliedFiltersComponent, appliedFilterItems, type AppliedFilter } from '../shared/applied-filters.component';
import { Component, DestroyRef, OnInit, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, Subscription, debounceTime, distinctUntilChanged, map } from 'rxjs';
import { AcademicApi, AcademicFilterOptions, AcademicListFilters, AcademicOffering, AcademicPeriod, TeachingAssignment } from '../core/academic-api.service';
import { createFilterOptions } from '../core/filter-options';
import { sameFormValue } from '../core/form-changes';
import { AdminCourse, AdminSubject, Page } from '../core/models';
import { createProfessionalCandidates } from '../core/professional-search';
import { errorMessage } from '../core/presentation';
import { ToastService } from '../core/toast.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { FilterDisclosureComponent } from '../shared/filter-disclosure.component';
import { ModalShellComponent } from '../shared/modal-shell.component';
import { PaginationComponent } from '../shared/pagination.component';
import { SearchableSelectComponent } from '../shared/searchable-select.component';

type Section = 'periods' | 'offerings' | 'teaching';
type StatusAction =
  | { section: 'periods'; item: AcademicPeriod }
  | { section: 'offerings'; item: AcademicOffering }
  | { section: 'teaching'; item: TeachingAssignment };

@Component({
  selector: 'app-admin-academic-offerings',
  imports: [AppliedFiltersComponent, ReactiveFormsModule, ConfirmDialogComponent, FilterDisclosureComponent, ModalShellComponent, PaginationComponent, SearchableSelectComponent],
  template: `
    <div class="stack academic-panel">
      <div class="row" aria-label="Seções acadêmicas">
        @for (item of sections; track item.key) {
          <button type="button" [class.secondary]="section() !== item.key" [attr.aria-pressed]="section() === item.key"
            (click)="selectSection(item.key)">{{item.label}}</button>
        }
      </div>
      <div class="section-header">
        <div>
          <h3>{{title()}}</h3>
          @if (section() === 'periods') {<p>O sistema gera dois períodos por ano e mantém os anteriores no histórico.</p>}
        </div>
        @if (section() === 'offerings') {
          <button type="button" (click)="openOffering()">Nova oferta curricular</button>
        }
      </div>
      <form class="server-list-toolbar filter-toolbar" (submit)="$event.preventDefault(); applyFilters()">
        <label class="toolbar-search">Buscar {{title().toLocaleLowerCase('pt-BR')}}
          <input #filterSearch type="search" [formControl]="search" (keydown.enter)="$event.preventDefault()"
            placeholder="Nome ou código">
        </label>
        @if (section() !== 'periods') {
          <app-filter-disclosure [count]="filteredCount()" (expandedChange)="filterOptionsOpen.set($event)">
            <div class="toolbar-grid" [formGroup]="filters">
              <app-searchable-select label="Curso" formControlName="courseId" [options]="courseFilterOptions()"
                selectionPlaceholder="Todos" placeholder="Nome, código ou campus" />
              <app-searchable-select label="Componente" formControlName="subjectId" [options]="subjectFilterOptions()"
                selectionPlaceholder="Todos" placeholder="Nome ou código" />
              <app-searchable-select #teacherFilter label="Professor" formControlName="teacherId" [remote]="filterTeacherLookup"
                selectionPlaceholder="Todos" placeholder="Nome, matrícula ou CPF" />
              <label>Período letivo <select formControlName="periodCode" [attr.disabled]="filterOptions.loading() ? '' : null">
                <option value="">Todos</option>
                @for (code of filterOptions.value().periodCodes; track code) { <option [value]="code">{{code}}</option> }
              </select></label>
              <app-searchable-select label="Turma" formControlName="groupCode" [options]="groupFilterOptions()"
                [readonly]="filterOptions.loading() || !!filterOptions.error()"
                selectionPlaceholder="Todas" placeholder="Buscar código da turma" />
              <label>Situação<select formControlName="active"><option value="">Todas</option><option value="true">Ativa</option>
                <option value="false">{{section() === 'teaching' ? 'Encerrada' : 'Arquivada'}}</option>
              </select></label>
            </div>
            @if (filterOptions.loading()) { <p class="meta" role="status">Carregando períodos e turmas…</p> }
            @if (filterOptions.error(); as error) { <p class="error" role="alert">{{error}}</p> }
            <div class="toolbar-actions"><button class="toolbar-button" type="submit">Aplicar filtros</button></div>
          </app-filter-disclosure>
        }
        @if (filteredCount() || appliedQuery()) {
          <button class="toolbar-aux" type="button" (click)="clearFilters(); filterSearch.focus()">Limpar filtros</button>
        }
      </form>
      @if (appliedItems().length) {
        <app-applied-filters [fallbackFocus]="filterSearch" [filters]="appliedItems()" (removed)="removeFilter($event)" />
      }
      @if (result() && !loading() && !loadError()) {
        <p class="toolbar-results" role="status">{{result()?.totalElements}} resultado(s)</p>
      }
      @if (loadError()) {<p class="error" role="alert">{{loadError()}}</p>}
      @if (loading()) {<p role="status">Carregando…</p>}
      @else if (!result()?.content?.length && !loadError()) {<p class="meta">Nenhum registro encontrado.</p>}
      @else if (result()?.content?.length) {
        <div class="table-wrap">
          <table class="mobile-cards">
            <thead>
              <tr>
                @if (section() === 'periods') {<th>Período</th><th>Código</th>}
                @else {
                  @if (section() === 'teaching') {<th>Professor</th>}
                  <th>Componente</th><th>Turma</th><th>Período</th><th>Curso e campus</th>
                }
                <th>Situação</th><th><span class="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              @switch (section()) {
                @case ('periods') {
                  @for (row of periods()?.content; track row.id) {
                    <tr>
                      <td data-label="Período">{{row.label}}</td><td data-label="Código">{{row.code}}</td>
                      <td data-label="Situação"><span [class]="row.active ? 'badge badge--success' : 'badge'">{{row.active ? 'Ativo' : 'Arquivado'}}</span></td>
                      <td><button class="secondary compact" type="button" [disabled]="busy()" (click)="pending.set({section:'periods', item:row})">
                        {{row.active ? 'Arquivar' : 'Reativar'}}
                      </button></td>
                    </tr>
                  }
                }
                @case ('offerings') {
                  @for (row of offerings()?.content; track row.id) {
                    <tr>
                      <td data-label="Componente">{{row.subjectName}}</td><td data-label="Turma">{{row.groupCode}}</td>
                      <td data-label="Período">{{row.periodLabel}}</td><td data-label="Curso e campus">{{row.courseName}} · {{row.campusName}}</td>
                      <td data-label="Situação"><span [class]="row.active ? 'badge badge--success' : 'badge'">{{row.active ? 'Ativa' : 'Arquivada'}}</span></td>
                      <td><div class="row">
                        @if (row.active) {
                          <button class="secondary compact" type="button" [disabled]="busy()" (click)="openTeaching(row)">Atribuir professor</button>
                        }
                        <button class="secondary compact" type="button" [disabled]="busy()" (click)="pending.set({section:'offerings', item:row})">
                          {{row.active ? 'Arquivar' : 'Reativar'}}
                        </button>
                      </div></td>
                    </tr>
                  }
                }
                @case ('teaching') {
                  @for (row of teaching()?.content; track row.id) {
                    <tr>
                      <td data-label="Professor">{{row.teacherName}}</td>
                      <td data-label="Componente">{{row.offering.subjectName}}</td><td data-label="Turma">{{row.offering.groupCode}}</td>
                      <td data-label="Período">{{row.offering.periodLabel}}</td>
                      <td data-label="Curso e campus">{{row.offering.courseName}} · {{row.offering.campusName}}</td>
                      <td data-label="Situação"><span [class]="row.active ? 'badge badge--success' : 'badge'">{{row.active ? 'Ativa' : 'Encerrada'}}</span></td>
                      <td><div class="row">
                        @if (row.active) {
                          <button class="secondary compact" type="button" [disabled]="busy()" (click)="openTeaching(row.offering, row)">Substituir professor</button>
                        }
                        <button class="secondary compact" type="button" [disabled]="busy()" (click)="pending.set({section:'teaching', item:row})">
                          {{row.active ? 'Encerrar' : 'Reativar'}}
                        </button>
                      </div></td>
                    </tr>
                  }
                }
              }
            </tbody>
          </table>
        </div>
        <app-pagination label="Paginação da estrutura acadêmica" [page]="result()?.number ?? 0"
          [totalPages]="result()?.totalPages ?? 0" (pageChange)="load($event)" />
      }
    </div>

    <app-modal-shell [open]="showOffering()" title="Nova oferta curricular"
      description="Identifique o componente, a turma e o período letivo." (closed)="closeOffering()">
      <form class="stack" [formGroup]="offeringForm" (ngSubmit)="createOffering()">
        <app-searchable-select label="Curso" formControlName="courseId" [required]="true" [options]="offeringCourseOptions()" />
        <app-searchable-select label="Componente" formControlName="subjectId" [required]="true" [options]="offeringSubjectOptions()" />
        <app-searchable-select label="Período letivo" formControlName="periodId" [required]="true"
          [options]="periodOptions()" [loading]="periodsLoading()" [error]="periodsError()" />
        <label><span>Código de turma&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input formControlName="groupCode" maxlength="60" required></label>
        @if (actionError()) {<p class="error" role="alert">{{actionError()}}</p>}
        <div class="dialog-actions">
          <button type="button" class="secondary" [disabled]="busy()" (click)="closeOffering()">Cancelar</button>
          <button type="submit" [disabled]="busy() || offeringForm.invalid">Registrar oferta</button>
        </div>
      </form>
    </app-modal-shell>

    <app-modal-shell [open]="selectedOffer() !== null" [title]="replacement() ? 'Substituir professor' : 'Atribuir professor'"
      [description]="teachingDescription()" (closed)="closeTeaching()">
      <form class="stack" [formGroup]="teacherForm" (ngSubmit)="saveTeaching()">
        @if (replacement()) {<p>A atribuição anterior será encerrada e ficará no histórico. A autoria dos PEIs será preservada.</p>}
        <app-searchable-select #teacherPicker label="Professor" formControlName="teacherId" [required]="true"
          [remote]="teacherLookup()" [readonly]="busy()" placeholder="Nome, matrícula ou CPF"
          emptyMessage="Nenhum professor elegível neste campus." />
        @if (actionError()) {<p class="error" role="alert">{{actionError()}}</p>}
        <div class="dialog-actions">
          <button type="button" class="secondary" [disabled]="busy()" (click)="closeTeaching()">Cancelar</button>
          <button type="submit" [disabled]="busy() || teacherForm.invalid || !teacherPicker.selectionValidated()">
            {{replacement() ? 'Confirmar substituição' : 'Registrar atribuição'}}
          </button>
        </div>
      </form>
    </app-modal-shell>

    <app-confirm-dialog [open]="pending() !== null" [title]="statusTitle()" [description]="statusDescription()"
      [danger]="pending()?.item?.active ?? false" (confirmed)="changeStatus()" (cancelled)="pending.set(null)" />
  `,
  styles: [`.academic-panel { margin-top: 1rem; }`],
})
export class AdminAcademicOfferingsComponent implements OnInit {
  private readonly api = inject(AcademicApi);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  readonly courses = input.required<readonly AdminCourse[]>();
  readonly subjects = input.required<readonly AdminSubject[]>();
  readonly changed = output<void>();
  private readonly createCandidates = createProfessionalCandidates();
  private readonly teacherPicker = viewChild<SearchableSelectComponent>('teacherPicker');
  private readonly teacherFilter = viewChild<SearchableSelectComponent>('teacherFilter');
  readonly filterTeacherLookup = this.createCandidates({ roles: ['TEACHER'], includeInactive: true });
  readonly sections: readonly {key: Section; label: string}[] = [
    { key: 'periods', label: 'Períodos letivos' },
    { key: 'offerings', label: 'Ofertas curriculares' },
    { key: 'teaching', label: 'Atribuições docentes' },
  ];
  readonly section = signal<Section>('periods');
  readonly title = computed(() => this.sections.find(item => item.key === this.section())!.label);
  readonly periods = signal<Page<AcademicPeriod> | null>(null);
  readonly offerings = signal<Page<AcademicOffering> | null>(null);
  readonly teaching = signal<Page<TeachingAssignment> | null>(null);
  readonly result = computed(() => {
    if (this.section() === 'periods') return this.periods();
    if (this.section() === 'offerings') return this.offerings();
    return this.teaching();
  });
  readonly search = this.fb.nonNullable.control('');
  readonly filters = this.fb.nonNullable.group({courseId: '', subjectId: '', teacherId: '', groupCode: '', periodCode: '', active: ''});
  protected readonly filterOptionsOpen = signal(false);
  protected readonly filterOptions = createFilterOptions<AcademicFilterOptions>({ subjects: [], groupCodes: [], periodCodes: [] });
  private readonly filterScope = toSignal(this.filters.valueChanges.pipe(
    map(() => this.currentFilterScope()),
    distinctUntilChanged((previous, current) => sameFormValue(previous, current)),
  ), { initialValue: this.currentFilterScope() });
  protected readonly groupFilterOptions = computed(() => this.filterOptions.value().groupCodes
    .map(code => ({ id: code, label: code })));
  protected readonly appliedItems = signal<AppliedFilter[]>([]);
  readonly filteredCount = computed(() => this.appliedItems().length);
  protected readonly courseFilterOptions = computed(() => (this.allCourses() ?? this.courses())
    .map(course => ({ id: String(course.id), label: course.name, detail: `${course.code} · ${course.campus}` })));
  protected readonly subjectFilterOptions = computed(() => this.subjects()
    .filter(subject => !this.filterScope().courseId || String(subject.courseId) === this.filterScope().courseId)
    .map(subject => ({ id: String(subject.id), label: subject.name, detail: subject.code })));
  readonly allCourses = input<readonly AdminCourse[]>();
  protected readonly appliedQuery = signal('');
  private appliedFilters: AcademicListFilters = {};
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly loadError = signal('');
  readonly actionError = signal('');
  readonly showOffering = signal(false);
  readonly activePeriods = signal<AcademicPeriod[]>([]);
  readonly periodsLoading = signal(false);
  readonly periodsError = signal('');
  readonly periodOptions = computed(() => this.activePeriods().map(period => ({
    id: String(period.id), label: period.label, detail: period.code,
  })));
  readonly selectedOffer = signal<AcademicOffering | null>(null);
  readonly replacement = signal<TeachingAssignment | null>(null);
  readonly pending = signal<StatusAction | null>(null);
  readonly offeringForm = this.fb.nonNullable.group({
    courseId: ['', Validators.required],
    subjectId: ['', Validators.required],
    periodId: ['', Validators.required],
    groupCode: ['', [Validators.required, Validators.maxLength(60)]],
  });
  private readonly offeringCourseId = toSignal(this.offeringForm.controls.courseId.valueChanges, { initialValue: '' });
  readonly offeringCourseOptions = computed(() => this.courses().filter(course => course.active)
    .map(course => ({ id: String(course.id), label: course.name, detail: `${course.code} · ${course.campus}` })));
  readonly offeringSubjectOptions = computed(() => this.subjects()
    .filter(subject => subject.active && subject.courseId === Number(this.offeringCourseId()))
    .map(subject => ({ id: String(subject.id), label: subject.name, detail: subject.code })));
  readonly teacherForm = this.fb.nonNullable.group({ teacherId: ['', Validators.required] });
  readonly teacherLookup = computed(() => {
    const offer = this.selectedOffer();
    return offer ? this.createCandidates({
      campusId: offer.campusId, roles: ['TEACHER'], excludedId: this.replacement()?.teacherId,
    }) : null;
  });
  readonly teachingDescription = computed(() => {
    const offer = this.selectedOffer();
    return offer ? `${offer.subjectName} · Turma ${offer.groupCode} · ${offer.periodLabel}` : '';
  });
  readonly statusTitle = computed(() => {
    const item = this.pending();
    if (!item) return '';
    if (!item.item.active) return 'Reativar registro?';
    return item.section === 'teaching' ? 'Encerrar atribuição docente?' : 'Arquivar registro?';
  });
  readonly statusDescription = computed(() => {
    const record = this.pending();
    if (!record) return '';
    if (!record.item.active) return 'O registro voltará a ficar disponível para relações acadêmicas válidas.';
    return record.section === 'teaching'
      ? 'A atribuição ficará no histórico. Os vínculos docentes sem outra relação válida serão revogados.'
      : 'O registro ficará disponível no histórico e sairá das novas seleções. Encerre as dependências ativas antes de arquivar.';
  });
  private listRequest?: Subscription;
  private periodsRequest?: Subscription;

  constructor() {
    effect(() => {
      const section = this.section();
      if (!this.filterOptionsOpen() || section === 'periods') {
        this.filterOptions.cancel();
        return;
      }
      this.filterOptions.load(this.api.offeringFilters(section, this.filterScope()));
    });
  }

  ngOnInit() {
    this.search.valueChanges.pipe(debounceTime(250), takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      const query = value.trim();
      if (this.appliedQuery() === query) return;
      this.appliedQuery.set(query);
      this.load(0);
    });
    const { courseId, subjectId, periodCode, groupCode } = this.filters.controls;
    courseId.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      if (!value) return;
      if (subjectId.value && !this.subjects().some(subject => String(subject.id) === subjectId.value
          && String(subject.courseId) === value)) subjectId.reset();
      periodCode.reset();
      groupCode.reset();
    });
    subjectId.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      if (!value) return;
      periodCode.reset();
      groupCode.reset();
    });
    periodCode.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      if (value) groupCode.reset();
    });
    this.load(0);
  }

  selectSection(section: Section) {
    if (section === this.section()) return;
    this.section.set(section);
    if (section === 'periods') this.filterOptionsOpen.set(false);
    this.clearFilters();
  }

  applyFilters(): void {
    this.appliedQuery.set(this.search.value.trim());
    this.appliedFilters = this.section() !== 'periods' ? this.filters.getRawValue() : {};
    this.appliedItems.set(appliedFilterItems({ ...this.appliedFilters }, {
      courseId: 'Curso', subjectId: 'Componente', teacherId: 'Professor', groupCode: 'Turma',
      periodCode: 'Período letivo', active: 'Situação',
    }, {
      courseId: id => this.courseFilterOptions().find(course => course.id === id)?.label ?? id,
      subjectId: id => this.subjects().find(subject => String(subject.id) === id)?.name ?? id,
      teacherId: id => this.teacherFilter()?.selected()?.label ?? 'Professor #' + id,
      active: value => value === 'true' ? 'Ativa' : this.section() === 'teaching' ? 'Encerrada' : 'Arquivada',
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
    this.loadError.set('');
    this.loading.set(true);
    const query = this.appliedQuery();
    if (this.section() === 'periods') {
      this.loadPage(this.api.periods(page, query), this.periods.set);
    } else if (this.section() === 'offerings') {
      this.loadPage(this.api.offerings(page, query, false, this.appliedFilters), this.offerings.set);
    } else {
      this.loadPage(this.api.teaching(page, query, this.appliedFilters), this.teaching.set);
    }
  }

  private currentFilterScope() {
    const { courseId, subjectId, periodCode } = this.filters.getRawValue();
    return { courseId, subjectId, periodCode };
  }

  openOffering() {
    this.offeringForm.reset();
    this.actionError.set('');
    this.activePeriods.set([]);
    this.periodsError.set('');
    this.periodsLoading.set(true);
    this.showOffering.set(true);
    this.periodsRequest?.unsubscribe();
    this.periodsRequest = this.api.activePeriods().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: periods => {
        this.activePeriods.set(periods);
        this.periodsLoading.set(false);
      },
      error: failure => {
        this.periodsError.set(errorMessage(failure, 'carregar os períodos letivos'));
        this.periodsLoading.set(false);
      },
    });
  }

  closeOffering() {
    if (this.busy()) return;
    this.periodsRequest?.unsubscribe();
    this.showOffering.set(false);
  }

  createOffering() {
    if (this.offeringForm.invalid || this.busy()) return;
    const value = this.offeringForm.getRawValue();
    if (!this.offeringSubjectOptions().some(option => option.id === value.subjectId)
      || !this.periodOptions().some(option => option.id === value.periodId) || this.periodsLoading()) return;
    const groupCode = value.groupCode.trim();
    if (!groupCode) {
      this.actionError.set('Informe um código de turma.');
      return;
    }
    this.mutate(this.api.createOffering(Number(value.subjectId), Number(value.periodId), groupCode), 'Oferta curricular registrada.', () => {
      this.closeOffering();
      this.load(this.result()?.number ?? 0);
    });
  }

  openTeaching(offer: AcademicOffering, replacement: TeachingAssignment | null = null) {
    this.teacherForm.reset();
    this.actionError.set('');
    this.replacement.set(replacement);
    this.selectedOffer.set(offer);
  }

  closeTeaching() {
    if (!this.busy()) this.selectedOffer.set(null);
  }

  saveTeaching() {
    const offer = this.selectedOffer();
    if (!offer || this.teacherForm.invalid || this.busy()) return;
    const { value } = this.teacherForm.controls.teacherId;
    const picker = this.teacherPicker();
    if (!picker || picker.validatedOption()?.id !== value || picker.remote() !== this.teacherLookup()) return;
    const teacherId = Number(value);
    const previous = this.replacement();
    const action = previous ? this.api.replaceTeacher(previous.id, teacherId, previous.version) : this.api.createTeaching(offer.id, teacherId);
    this.mutate(action, previous ? 'Professor substituído.' : 'Atribuição docente registrada.', () => {
      this.closeTeaching();
      this.load(this.result()?.number ?? 0);
    });
  }

  changeStatus() {
    const record = this.pending();
    if (!record || this.busy()) return;
    this.pending.set(null);
    const { id, active } = record.item;
    const action = !active;
    const call = record.section === 'periods' ? this.api.setPeriodActive(id, action)
      : record.section === 'offerings' ? this.api.setOfferingActive(id, action)
      : this.api.setTeachingActive(id, action);
    this.mutate(call, 'Situação atualizada.', () => this.load(this.result()?.number ?? 0), true);
  }

  private loadPage<T>(request$: Observable<Page<T>>, set: (page: Page<T>) => void) {
    this.listRequest?.unsubscribe();
    this.listRequest = request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: page => {
        const lastPage = Math.max(0, page.totalPages - 1);
        if (page.number > lastPage) {
          this.load(lastPage);
          return;
        }
        set(page);
        this.loading.set(false);
      },
      error: failure => {
        this.loading.set(false);
        this.loadError.set(errorMessage(failure, 'carregar os registros acadêmicos'));
      },
    });
  }

  private mutate(request$: Observable<unknown>, success: string, next: () => void, showWithList = false) {
    this.busy.set(true);
    this.actionError.set('');
    this.loadError.set('');
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.show(success, 'success');
        next();
        const section = this.section();
        if (this.filterOptionsOpen() && section !== 'periods') {
          this.filterOptions.load(this.api.offeringFilters(section, this.filterScope()));
        }
        this.changed.emit();
      },
      error: failure => {
        this.busy.set(false);
        const message = errorMessage(failure, 'salvar o registro acadêmico');
        if (showWithList) this.loadError.set(message);
        else this.actionError.set(message);
      },
    });
  }
}
