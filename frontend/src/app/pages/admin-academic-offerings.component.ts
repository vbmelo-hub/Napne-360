import { Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable } from 'rxjs';
import { AcademicApi, AcademicOffering, AcademicPeriod, TeachingAssignment } from '../core/academic-api.service';
import { AdminCourse, AdminSubject, Page, UserView } from '../core/models';
import { createProfessionalSearch } from '../core/professional-search';
import { errorMessage } from '../core/presentation';
import { ToastService } from '../core/toast.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { ModalShellComponent } from '../shared/modal-shell.component';
import { PaginationComponent } from '../shared/pagination.component';

type Section = 'periods' | 'offerings' | 'teaching';
type StatusAction =
  | { section: 'periods'; item: AcademicPeriod }
  | { section: 'offerings'; item: AcademicOffering }
  | { section: 'teaching'; item: TeachingAssignment };

@Component({
  selector: 'app-admin-academic-offerings',
  imports: [ReactiveFormsModule, ConfirmDialogComponent, ModalShellComponent, PaginationComponent],
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
      <form class="row" (submit)="$event.preventDefault(); load(0)">
        <label>Buscar {{title().toLocaleLowerCase('pt-BR')}}
          <input type="search" [formControl]="search">
        </label>
        <button class="secondary" type="submit">Buscar</button>
      </form>
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
        <label>Curso
          <select formControlName="courseId" (change)="offeringForm.controls.subjectId.reset()">
            <option value="">Selecione</option>
            @for (course of courses(); track course.id) {<option [value]="course.id">{{course.name}} · {{course.campus}}</option>}
          </select>
        </label>
        <label><span>Componente&nbsp;<span class="field-required" aria-hidden="true">*</span></span><select formControlName="subjectId" required>
            <option value="">Selecione</option>
            @for (subject of offeringSubjects(); track subject.id) {<option [value]="subject.id">{{subject.name}} · {{subject.code}}</option>}
          </select>
        </label>
        <label><span>Período letivo&nbsp;<span class="field-required" aria-hidden="true">*</span></span><select formControlName="periodId" required>
            <option value="">Selecione</option>
            @for (period of activePeriods(); track period.id) {<option [value]="period.id">{{period.label}}</option>}
          </select>
        </label>
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
        @if (!teacherOptions().length) {<p class="meta">Nenhum professor elegível neste campus.</p>}
        @else {
          <label>Buscar professor <input #query type="search" [value]="professionalQuery()"
            placeholder="Nome, matrícula ou CPF" (input)="searchProfessional(query.value)"></label>
          <label><span>Professor&nbsp;<span class="field-required" aria-hidden="true">*</span></span><select formControlName="teacherId" required>
              <option value="">Selecione</option>
              @for (teacher of filteredTeachers(); track teacher.id) {<option [value]="teacher.id">{{teacher.name}}</option>}
            </select>
          </label>
        }
        @if (actionError()) {<p class="error" role="alert">{{actionError()}}</p>}
        <div class="dialog-actions">
          <button type="button" class="secondary" [disabled]="busy()" (click)="closeTeaching()">Cancelar</button>
          <button type="submit" [disabled]="busy() || teacherForm.invalid || !teacherOptions().length">
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
  readonly users = input.required<readonly UserView[]>();
  readonly changed = output<void>();
  readonly professionalQuery = signal('');
  private readonly matchesProfessional = createProfessionalSearch(this.professionalQuery);
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
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly loadError = signal('');
  readonly actionError = signal('');
  readonly showOffering = signal(false);
  readonly activePeriods = signal<AcademicPeriod[]>([]);
  readonly selectedOffer = signal<AcademicOffering | null>(null);
  readonly replacement = signal<TeachingAssignment | null>(null);
  readonly pending = signal<StatusAction | null>(null);
  readonly offeringForm = this.fb.nonNullable.group({
    courseId: ['', Validators.required],
    subjectId: ['', Validators.required],
    periodId: ['', Validators.required],
    groupCode: ['', [Validators.required, Validators.maxLength(60)]],
  });
  readonly teacherForm = this.fb.nonNullable.group({ teacherId: ['', Validators.required] });
  readonly teacherOptions = computed(() => {
    const offer = this.selectedOffer();
    return this.users().filter(user => user.active && user.campusId === offer?.campusId
      && user.roles.includes('TEACHER') && user.id !== this.replacement()?.teacherId);
  });
  readonly filteredTeachers = computed(() => this.teacherOptions().filter(this.matchesProfessional));
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
  private request = 0;

  ngOnInit() {
    this.load(0);
  }

  selectSection(section: Section) {
    if (section === this.section()) return;
    this.section.set(section);
    this.search.reset();
    this.load(0);
  }

  load(page: number) {
    const request = ++this.request;
    this.loadError.set('');
    this.loading.set(true);
    const query = this.search.value;
    if (this.section() === 'periods') {
      this.loadPage(this.api.periods(page, query), this.periods.set, request);
    } else if (this.section() === 'offerings') {
      this.loadPage(this.api.offerings(page, query), this.offerings.set, request);
    } else {
      this.loadPage(this.api.teaching(page, query), this.teaching.set, request);
    }
  }

  offeringSubjects() {
    const course = Number(this.offeringForm.controls.courseId.value);
    return this.subjects().filter(subject => subject.active && subject.courseId === course);
  }

  openOffering() {
    this.offeringForm.reset();
    this.actionError.set('');
    this.showOffering.set(true);
    this.api.activePeriods().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: periods => this.activePeriods.set(periods),
      error: failure => this.actionError.set(errorMessage(failure, 'carregar os períodos letivos')),
    });
  }

  closeOffering() {
    if (!this.busy()) this.showOffering.set(false);
  }

  createOffering() {
    if (this.offeringForm.invalid || this.busy()) return;
    const value = this.offeringForm.getRawValue();
    const groupCode = value.groupCode.trim();
    if (!groupCode) {
      this.actionError.set('Informe um código de turma.');
      return;
    }
    this.mutate(this.api.createOffering(Number(value.subjectId), Number(value.periodId), groupCode), 'Oferta curricular registrada.', () => {
      this.closeOffering();
      this.load(0);
    });
  }

  openTeaching(offer: AcademicOffering, replacement: TeachingAssignment | null = null) {
    this.teacherForm.reset();
    this.professionalQuery.set('');
    this.actionError.set('');
    this.replacement.set(replacement);
    this.selectedOffer.set(offer);
  }

  searchProfessional(value: string) {
    this.professionalQuery.set(value);
    this.teacherForm.controls.teacherId.reset();
  }

  closeTeaching() {
    if (!this.busy()) this.selectedOffer.set(null);
  }

  saveTeaching() {
    const offer = this.selectedOffer();
    if (!offer || this.teacherForm.invalid || this.busy()) return;
    const teacherId = Number(this.teacherForm.controls.teacherId.value);
    const previous = this.replacement();
    const action = previous ? this.api.replaceTeacher(previous.id, teacherId, previous.version) : this.api.createTeaching(offer.id, teacherId);
    this.mutate(action, previous ? 'Professor substituído.' : 'Atribuição docente registrada.', () => {
      this.closeTeaching();
      if (this.section() === 'teaching') this.load(0);
      else this.selectSection('teaching');
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

  private loadPage<T>(request$: Observable<Page<T>>, set: (page: Page<T>) => void, request: number) {
    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: page => {
        if (request !== this.request) return;
        set(page);
        this.loading.set(false);
      },
      error: failure => {
        if (request !== this.request) return;
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
