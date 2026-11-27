import { AppliedFiltersComponent, appliedFilterItems } from '../shared/applied-filters.component';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, Injector, OnInit, afterNextRender, computed, effect, inject, linkedSignal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription, debounceTime, forkJoin, map } from 'rxjs';
import { ApiService } from '../core/api.service';
import { createFilterOptions } from '../core/filter-options';
import { createListView } from '../core/list-view';
import { AdminCourse, AdminSubject, AssignmentView, Campus, Page, StudentRegistrationCandidate } from '../core/models';
import { createProfessionalCandidates } from '../core/professional-search';
import { AdminAcademicOfferingsComponent } from './admin-academic-offerings.component';
import { errorMessage, labelFor } from '../core/presentation';
import { ToastService } from '../core/toast.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { FilterDisclosureComponent } from '../shared/filter-disclosure.component';
import { ModalShellComponent } from '../shared/modal-shell.component';
import { PaginationComponent } from '../shared/pagination.component';
import { SearchableLookup, SearchableOption, SearchableSelectComponent } from '../shared/searchable-select.component';

import { ListFiltersComponent } from '../shared/list-filters.component';
import { sameFormValue } from '../core/form-changes';
import { reconcileRequiredSelection } from '../core/required-selection';

function coursePickerOption(course: AdminCourse): SearchableOption {
  return { id: String(course.id), label: course.name, detail: `${course.code} · ${course.campus}` };
}

type RegistrationOption = SearchableOption & { student: StudentRegistrationCandidate };

function registrationOption(student: StudentRegistrationCandidate): RegistrationOption {
  return { id: String(student.id), label: student.registration, student };
}

@Component({selector:'app-admin-academic',standalone:true,imports:[AppliedFiltersComponent,ReactiveFormsModule,ConfirmDialogComponent,FilterDisclosureComponent,ModalShellComponent,PaginationComponent,ListFiltersComponent,AdminAcademicOfferingsComponent,SearchableSelectComponent],template:`
  <header class="module-head"><span class="eyebrow">Organização acadêmica</span><h2>Estrutura acadêmica e vínculos</h2><p>Cadastre cursos e componentes e defina quem acompanha cada estudante.</p></header>

  @if(loading()){
    <div class="loading-grid" aria-label="Carregando estrutura acadêmica"><span class="skeleton skeleton-card"></span><span class="skeleton skeleton-card"></span></div>
  } @else {
    <div class="admin-academic-grid">
      <form class="card stack" [formGroup]="courseForm" (ngSubmit)="createCourse()">
        <div class="section-header"><div><h3>Novo curso</h3><p>Associe o curso a um campus ativo.</p></div></div>
        <label><span>Campus&nbsp;<span class="field-required" aria-hidden="true">*</span></span><select formControlName="campusId">@if (campuses().length !== 1) {<option value="">Selecione</option>}@for(c of campuses();track c.id){<option [value]="c.id">{{c.name}}</option>}</select></label>
        <label><span>Nome do curso&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input formControlName="name"></label>
        <label><span>Código do curso&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input formControlName="code"></label>
        <button [disabled]="courseForm.invalid||busy()">@if(busy()){<span class="spinner"></span>}Criar curso</button>
      </form>

      <form class="card stack" [formGroup]="subjectForm" (ngSubmit)="createSubject()">
        <div class="section-header"><div><h3>Novo componente curricular</h3><p>Cadastre a disciplina dentro de um curso existente.</p></div></div>
        <app-searchable-select label="Curso" formControlName="courseId" [options]="subjectCourseOptions()" [required]="true"
          placeholder="Nome, código ou campus" [readonly]="busy()" />
        <div class="grid two"><label><span>Nome do componente&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input formControlName="name"></label><label><span>Código&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input formControlName="code"></label></div>
        <label><span>Carga horária&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input type="number" min="1" formControlName="workloadHours"></label>
        <label>Ementa<textarea formControlName="syllabus"></textarea></label>
        <button [disabled]="subjectForm.invalid||busy()">@if(busy()){<span class="spinner"></span>}Criar componente</button>
      </form>
    </div>

    <section class="card structure-card">
      <div class="section-header"><h3>Cursos cadastrados</h3><span class="badge badge--info">{{courseList.totalElements()}} curso(s)</span></div>
      <app-list-filters #courseSearch [list]="courseList" label="Buscar cursos" placeholder="Nome ou código" />
      @if (courses().length === 0) {
        <div class="empty-state"><h3>Nenhum curso cadastrado</h3><p>Cadastre o primeiro curso para organizar os componentes curriculares.</p></div>
      } @else if (courseList.totalElements() === 0) {
        <p class="meta">Nenhum curso encontrado.</p>
      }
      <div class="course-grid">
        @for (c of courseList.items(); track c.id) {
          <article class="course-panel">
            <div class="course-heading">
              <span class="eyebrow">{{c.code}}</span>
              <span [class]="c.active ? 'badge badge--success' : 'badge'">{{c.active ? 'Ativo' : 'Arquivado'}}</span>
            </div>
            <h4>{{c.name}}</h4><p>{{c.campus}}</p>
            <div class="row">
              <button type="button" class="secondary compact" [attr.aria-label]="'Ver componentes de ' + c.name + ' (' + c.code + ')'"
                (click)="openComponents(c)">Ver componentes</button>
              <button type="button" class="secondary compact" [disabled]="busy()" [attr.aria-label]="'Editar curso ' + c.name + ' (' + c.code + ')'"
                (click)="openCourseEditor(c)">Editar</button>
              @if (c.active) {
                <button type="button" class="danger compact" [disabled]="busy()" [attr.aria-label]="'Arquivar curso ' + c.name + ' (' + c.code + ')'"
                  (click)="requestCourseArchive(c)">Arquivar</button>
              }
            </div>
          </article>
        }
      </div>
      <app-pagination label="Paginação de cursos" [page]="courseList.page()" [totalPages]="courseList.totalPages()"
        (pageChange)="courseList.setPage($event)" />
    </section>

    <section class="card structure-card">
      <div class="section-header">
        <div><h3>Períodos, ofertas e atribuições docentes</h3><p>Organize turmas e defina os docentes de cada oferta.</p></div>
        <button type="button" class="secondary" [attr.aria-expanded]="showAcademicOffers()" (click)="showAcademicOffers.set(!showAcademicOffers())">
          {{showAcademicOffers() ? 'Recolher' : 'Gerenciar'}}
        </button>
      </div>
      @if (showAcademicOffers()) {
        <app-admin-academic-offerings [courses]="activeCourses()" [allCourses]="courses()" [subjects]="subjects()" (changed)="refreshAssignments()" />
      }
    </section>

    <form class="card stack assignment-form" [formGroup]="assignmentForm" (ngSubmit)="createAssignment()">
      <div class="section-header"><div><h3>Conceder vínculo de acompanhamento</h3><p>Conceda designações de tutoria, coordenação ou NAPNE. Os vínculos docentes são gerados pelas ofertas curriculares.</p></div></div>
      <div class="grid two">
        <app-searchable-select #studentPicker label="Estudante (matrícula)" formControlName="studentId" [required]="true"
          [remote]="studentLookup" [readonly]="busy()" placeholder="Pesquisar matrícula"
          emptyMessage="Nenhuma matrícula elegível para vínculo." />
        <label><span>Tipo de vínculo&nbsp;<span class="field-required" aria-hidden="true">*</span></span><select formControlName="assignmentType"><option value="TUTOR">Monitor/tutor</option><option value="COORDINATOR">Coordenação/supervisão</option><option value="NAPNE">NAPNE</option></select></label>
        <app-searchable-select #professionalPicker label="Profissional" formControlName="userId" [required]="true"
          [remote]="professionalLookup()" [readonly]="busy() || (!!studentPicker.value() && !studentPicker.selectionValidated())" placeholder="Nome, matrícula ou CPF"
          [emptyMessage]="selectedStudent() ? 'Nenhum profissional elegível para este vínculo.' : 'Selecione um estudante primeiro.'" />
        <app-searchable-select label="Componente do vínculo (opcional)" formControlName="subjectId"
          [options]="assignmentSubjectOptions()" [readonly]="busy() || (!!studentPicker.value() && !studentPicker.selectionValidated())" selectionPlaceholder="Sem componente específico" placeholder="Nome ou código do componente"
          [emptyMessage]="selectedStudent() ? 'Nenhum componente ativo no curso do estudante.' : 'Selecione um estudante primeiro.'" />
      </div>
      <div><button [disabled]="assignmentForm.invalid || busy() || (!!studentPicker.value() && !studentPicker.selectionValidated()) || !professionalPicker.selectionValidated()">@if(busy()){<span class="spinner"></span>}Conceder vínculo</button></div>
    </form>

    <section class="card assignments">
      <div class="section-header"><div><h3>Vínculos registrados</h3><p>O histórico permanece disponível mesmo após a revogação.</p></div></div>
      <form class="server-list-toolbar filter-toolbar" [formGroup]="assignmentFilters" (ngSubmit)="applyAssignmentFilters()">
        <label class="toolbar-search">Buscar vínculos
          <input #filterSearch type="search" formControlName="query" (keydown.enter)="$event.preventDefault()"
            placeholder="Matrícula ou nome">
        </label>
        <app-filter-disclosure [count]="assignmentFilterCount()" (expandedChange)="assignmentFilterOptionsOpen.set($event)">
          <div class="toolbar-grid">
            <label>Matrícula do estudante <input formControlName="registration"></label>
            <label>Profissional vinculado <input formControlName="actor" placeholder="Nome"></label>
            <label>Tipo de vínculo<select formControlName="type"><option value="">Todos</option>
              @for (type of assignmentTypes; track type) {<option [value]="type">{{label(type)}}</option>}
            </select></label>
            <app-searchable-select label="Componente" formControlName="subject" [options]="assignmentSubjectFilterOptions()"
              selectionPlaceholder="Todos" placeholder="Nome ou código" />
            <label>Campus<select formControlName="campus"><option value="">Todos</option>
              @for (campus of allCampuses(); track campus.id) {
                <option [value]="campus.id">{{campus.name}}{{campus.active ? '' : ' (arquivado)'}}</option>
              }
            </select></label>
            <app-searchable-select label="Curso" formControlName="course" [options]="assignmentCourseFilterOptions()"
              selectionPlaceholder="Todos" placeholder="Nome, código ou campus" />
            <label>Origem<select formControlName="origin"><option value="">Todas</option>
              <option value="AUTOMATIC">Automática</option><option value="MANUAL">Manual</option>
            </select></label>
            <label>Período letivo <select formControlName="period" [attr.disabled]="assignmentPeriodOptions.loading() ? '' : null">
              <option value="">Todos</option>
              @for (code of assignmentPeriodOptions.value(); track code) { <option [value]="code">{{code}}</option> }
            </select></label>
            <label>Situação<select formControlName="active"><option value="">Todas</option>
              <option value="true">Ativo</option><option value="false">Revogado</option>
            </select></label>
          </div>
          @if (assignmentPeriodOptions.loading()) { <p class="meta" role="status">Carregando períodos letivos…</p> }
          @if (assignmentPeriodOptions.error(); as error) { <p class="error" role="alert">{{error}}</p> }
          <div class="toolbar-actions"><button class="toolbar-button" type="submit">Aplicar filtros</button></div>
        </app-filter-disclosure>
        @if (assignmentFilterCount() || appliedAssignmentFilters()['query']) {
          <button class="toolbar-aux" type="button" (click)="clearAssignmentFilters(); filterSearch.focus()">Limpar filtros</button>
        }
      </form>
      @if (appliedAssignmentItems().length) {
        <app-applied-filters [fallbackFocus]="filterSearch" [filters]="appliedAssignmentItems()" (removed)="removeAssignmentFilter($event)" />
      }
      @if (assignmentPage() && !assignmentLoading() && !assignmentError()) {
        <p class="toolbar-results" role="status">{{assignmentPage()?.totalElements}} resultado(s)</p>
      }
      @if (assignmentLoading()) {<p class="meta" role="status">Carregando vínculos…</p>}
      @else if (assignmentError()) {
        <p class="error" role="alert">{{assignmentError()}}</p>
        <button type="button" class="secondary compact" (click)="refreshAssignments()">Tentar novamente</button>
      } @else if (!assignments().length) {
        <p class="meta assignment-empty">Nenhum vínculo encontrado.</p>
      } @else {
        <div class="table-wrap">
          <table class="mobile-cards">
            <thead><tr><th>Matrícula do estudante</th><th>Profissional vinculado</th><th>Tipo</th><th>Componente</th><th>Origem</th><th>Período</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead>
            <tbody>
              @for (a of assignments(); track a.id) {
                <tr>
                  <td data-label="Matrícula do estudante">{{a.registration ?? 'Matrícula indisponível'}}</td>
                  <td data-label="Profissional vinculado">{{a.userName ?? 'Profissional indisponível'}}</td>
                  <td data-label="Tipo">{{label(a.assignmentType)}}</td>
                  <td data-label="Componente">{{a.subjectName ?? subjectLabel(a.subjectId)}}</td>
                  <td data-label="Origem">{{originLabel(a)}}</td>
                  <td data-label="Período">{{a.periodCode ?? '—'}}</td>
                  <td data-label="Situação"><span [class]="a.active ? 'badge badge--success' : 'badge'">{{a.active ? 'Ativo' : 'Revogado'}}</span></td>
                  <td><div class="row">
                    @if (a.active && a.origin !== 'AUTOMATIC') {
                      <button type="button" class="secondary compact" [disabled]="busy()" (click)="pendingRevocation.set(a)">Revogar</button>
                      @if (a.assignmentType === 'TEACHER' && a.subjectId !== null) {
                        <button type="button" class="secondary compact" [disabled]="busy()" (click)="pendingRegularization.set(a)">Regularizar</button>
                      }
                    }
                  </div></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      @if (!assignmentLoading() && !assignmentError() && assignmentPage(); as page) {
        <app-pagination label="Paginação de vínculos" [page]="page.number" [totalPages]="page.totalPages"
          (pageChange)="loadAssignmentPage($event)" />
      }
    </section>
  }

  <app-modal-shell #componentsModal [open]="componentCourse() !== null" eyebrow="Estrutura acadêmica"
    [title]="componentCourse()?.name ?? ''" description="Componentes curriculares do curso" (closed)="closeComponents()">
    @if (editingSubject(); as subject) {
      <form class="stack course-editor" [formGroup]="editSubjectForm" (ngSubmit)="saveSubject()">
        <h3>{{subject.active ? 'Editar componente' : 'Consultar componente arquivado'}}</h3>
        <fieldset class="stack" [disabled]="busy()">
          <label>Nome do componente <span class="field-required" aria-hidden="true">*</span>
            <input formControlName="name" maxlength="180" [readonly]="!subject.active" required>
          </label>
          <div class="grid two">
            <label>Código <span class="field-required" aria-hidden="true">*</span>
              <input formControlName="code" maxlength="60" [readonly]="!subject.active" required>
            </label>
            <label>Carga horária <span class="field-required" aria-hidden="true">*</span>
              <input type="number" min="1" step="1" formControlName="workloadHours" [readonly]="!subject.active" required>
            </label>
          </div>
          <label>Ementa<textarea formControlName="syllabus" rows="5" [readonly]="!subject.active"></textarea></label>
        </fieldset>
        @if (subjectError()) {<p class="error" role="alert">{{subjectError()}}</p>}
        <div class="row">
          @if (subject.active) {
            <button type="submit" [disabled]="editSubjectForm.invalid || !subjectChanged() || busy()">Salvar alterações</button>
          }
          <button type="button" class="secondary" [disabled]="busy()" (click)="leaveSubjectAction()">
            {{subject.active ? 'Cancelar' : 'Voltar aos componentes'}}
          </button>
        </div>
      </form>
    } @else if (pendingSubjectStatus(); as subject) {
      <section class="stack">
        <h3>{{subject.active ? 'Arquivar' : 'Reativar'}} componente?</h3>
        <p>{{subject.name}} ({{subject.code}}). O histórico e os relacionamentos serão preservados.</p>
        @if (subjectError()) {<p class="error" role="alert">{{subjectError()}}</p>}
        <div class="row">
          <button type="button" class="secondary" [disabled]="busy()" (click)="leaveSubjectAction()">Cancelar</button>
          <button type="button" [class.danger]="subject.active" [disabled]="busy()" (click)="changeSubjectStatus()">
            {{subject.active ? 'Confirmar arquivamento' : 'Confirmar reativação'}}
          </button>
        </div>
      </section>
    } @else {
    <app-list-filters #subjectSearch [list]="subjectList" label="Buscar componentes" placeholder="Nome ou código" />
    @if (selectedCourseSubjects().length === 0) {
      <p class="meta">Nenhum componente curricular cadastrado neste curso.</p>
    } @else if (subjectList.totalElements() === 0) {
      <p class="meta">Nenhum componente encontrado.</p>
    } @else {
      <div class="table-wrap">
        <table class="mobile-cards">
          <thead><tr><th>Componente</th><th>Código</th><th>Carga horária</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead>
          <tbody>
            @for (s of subjectList.items(); track s.id) {
              <tr [attr.data-subject-id]="s.id">
                <td data-label="Componente">{{s.name}}</td><td data-label="Código">{{s.code}}</td><td data-label="Carga horária">{{s.workloadHours}} h</td>
                <td data-label="Situação"><span [class]="s.active ? 'badge badge--success' : 'badge'">{{s.active ? 'Ativo' : 'Arquivado'}}</span></td>
                <td><div class="row">
                  <button type="button" class="secondary compact" (click)="openSubject(s)">{{s.active ? 'Editar' : 'Consultar'}}</button>
                  @if (s.active || canReactivateSubject()) {
                    <button type="button" class="secondary compact" (click)="requestSubjectStatus(s)">{{s.active ? 'Arquivar' : 'Reativar'}}</button>
                  }
                </div></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <app-pagination label="Paginação de componentes" [page]="subjectList.page()" [totalPages]="subjectList.totalPages()"
        (pageChange)="subjectList.setPage($event)" />
    }
    }
  </app-modal-shell>

  <app-modal-shell [open]="editingCourse() !== null" eyebrow="Estrutura acadêmica" title="Editar curso"
    [description]="editingCourse()?.name ?? ''" (closed)="closeCourseEditor()">
    <form class="stack course-editor" [formGroup]="editCourseForm" (ngSubmit)="saveCourse()">
      <fieldset class="stack" [disabled]="busy()">
        <legend class="sr-only">Dados do curso</legend>
        <label><span>Campus&nbsp;<span class="field-required" aria-hidden="true">*</span></span><select formControlName="campusId" required>
            <option value="">Selecione</option>
            @if (missingEditCampus(); as campus) {<option [value]="campus.campusId">{{campus.campus}}</option>}
            @for (c of campuses(); track c.id) {<option [value]="c.id">{{c.name}}</option>}
          </select>
        </label>
        <label><span>Nome do curso&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input formControlName="name" maxlength="180" required></label>
        <label><span>Código do curso&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input formControlName="code" maxlength="60" required></label>
      </fieldset>
      @if (editCourseError()) {<p class="error" role="alert">{{editCourseError()}}</p>}
      <div class="row">
        <button type="submit" [disabled]="editCourseForm.invalid || busy()">Salvar alterações</button>
        <button type="button" class="secondary" [disabled]="busy()" (click)="closeCourseEditor()">Cancelar</button>
      </div>
    </form>
  </app-modal-shell>

  <app-confirm-dialog [open]="pendingCourseArchive() !== null" title="Arquivar curso?" [description]="archiveDescription()"
    confirmLabel="Arquivar curso" [danger]="true" [busy]="busy()" (confirmed)="confirmCourseArchive()" (cancelled)="pendingCourseArchive.set(null)">
    @if (archiveCourseError()) {<p class="error" role="alert">{{archiveCourseError()}}</p>}
  </app-confirm-dialog>
  <app-confirm-dialog [open]="pendingRegularization() !== null" title="Regularizar vínculo docente?"
    description="O vínculo manual ficará no histórico e o acesso passará a seguir as ofertas acadêmicas válidas."
    confirmLabel="Regularizar vínculo" (confirmed)="confirmRegularization()" (cancelled)="pendingRegularization.set(null)" />
  <app-confirm-dialog [open]="pendingRevocation()!==null" title="Revogar este vínculo?" [description]="revocationDescription()" confirmLabel="Revogar vínculo" [danger]="true" (confirmed)="confirmRevocation()" (cancelled)="pendingRevocation.set(null)" />
`,styles:[`
  .module-head { margin-bottom: 1rem; }
  .module-head h2, .course-panel h4 { margin: .15rem 0; }
  .module-head p, .section-header p { color: var(--ink-600); margin: 0; }
  .admin-academic-grid, .course-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .admin-academic-grid { gap: 1rem; align-items: start; }
  .course-grid { gap: .75rem; }
  .structure-card, .assignment-form, .assignments { margin-top: 1rem; }
  .course-panel { border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem; background: var(--surface-soft); }
  .course-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .35rem 1rem; }
  .course-panel p { color: var(--ink-600); margin: 0 0 .75rem; }
  .course-editor fieldset { min-width: 0; border: 0; padding: 0; margin: 0; }
  .assignments { --list-inset: var(--space-6); padding: 0; }
  .assignments .section-header { padding: var(--space-5) var(--list-inset); margin: 0; }
  .assignments > :is(.server-list-toolbar, app-applied-filters, p, button, app-pagination) {
    margin-inline: var(--list-inset);
  }
  .assignments > :is(.server-list-toolbar, .toolbar-results, button) { margin-bottom: var(--space-3); }
  .assignments > app-applied-filters { display: block; }
  .assignments .table-wrap { border-radius: 0; border: 0; border-top: 1px solid var(--border); }
  .assignments app-pagination { display: block; }
  .assignments app-pagination:has(nav) { margin-bottom: 1.25rem; }
  @media (max-width: 850px) { .admin-academic-grid, .course-grid { grid-template-columns: 1fr; } }
  @media (max-width: 700px) { .assignments { --list-inset: var(--space-4); } .assignments .table-wrap { padding-inline: var(--list-inset); } }
`]})
export class AdminAcademicComponent implements OnInit {
  private readonly api=inject(ApiService);
  private readonly fb=inject(FormBuilder);
  private readonly toast=inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly courseSearch = viewChild<ListFiltersComponent>('courseSearch');
  private readonly subjectSearch = viewChild<ListFiltersComponent>('subjectSearch');
  private readonly componentsModal = viewChild<unknown, ElementRef<HTMLElement>>('componentsModal', { read: ElementRef });
  private subjectListScroll = 0;
  private subjectActionId = 0;

  readonly showAcademicOffers = signal(false);
  private readonly createCandidates = createProfessionalCandidates();
  private readonly professionalPicker = viewChild<SearchableSelectComponent>('professionalPicker');
  protected readonly allCampuses = signal<Campus[]>([]);
  readonly campuses = computed(() => this.allCampuses().filter(campus => campus.active));
  readonly courses=signal<AdminCourse[]>([]);
  readonly subjects=signal<AdminSubject[]>([]);
  readonly assignmentPage = signal<Page<AssignmentView> | null>(null);
  readonly assignments = computed(() => this.assignmentPage()?.content ?? []);
  readonly assignmentError = signal('');
  readonly assignmentLoading = signal(false);
  private assignmentRequest?: Subscription;
  readonly loading=signal(true);
  readonly busy=signal(false);
  readonly pendingRevocation=signal<AssignmentView|null>(null);
  readonly pendingRegularization = signal<AssignmentView | null>(null);
  readonly componentCourse = signal<AdminCourse | null>(null);
  readonly editingSubject = signal<AdminSubject | null>(null);
  readonly pendingSubjectStatus = signal<AdminSubject | null>(null);
  readonly subjectError = signal('');
  readonly editingCourse = signal<AdminCourse | null>(null);
  readonly pendingCourseArchive = signal<AdminCourse | null>(null);
  readonly editCourseError = signal('');
  readonly archiveCourseError = signal('');
  readonly activeCourses = computed(() => this.courses().filter(course => course.active));
  protected readonly subjectCourseOptions = computed(() => this.activeCourses().map(coursePickerOption));
  protected readonly assignmentCourseFilterOptions = computed(() => this.courses()
    .filter(course => !this.selectedFilterCampus() || String(course.campusId) === this.selectedFilterCampus())
    .map(coursePickerOption));
  protected readonly assignmentSubjectFilterOptions = computed(() => [
    { id: 'general', label: 'Sem componente específico' },
    ...this.subjects().filter(subject => {
      const course = this.selectedFilterCourse();
      if (course) return String(subject.courseId) === course;
      return !this.selectedFilterCampus() || this.assignmentCourseFilterOptions().some(item => item.id === String(subject.courseId));
    }).map(subject => ({ id: String(subject.id), label: subject.name, detail: subject.code })),
  ]);
  readonly missingEditCampus = computed(() => {
    const course = this.editingCourse();
    return course && !this.campuses().some(campus => campus.id === course.campusId) ? course : null;
  });
  readonly canReactivateSubject = computed(() => {
    const course = this.componentCourse();
    return !!course?.active && this.campuses().some(campus => campus.id === course.campusId && campus.active);
  });
  readonly selectedCourseSubjects = computed(() => {
    const courseId = this.componentCourse()?.id;
    return this.subjects().filter(subject => subject.courseId === courseId)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }) || a.code.localeCompare(b.code, 'pt-BR'));
  });
  readonly courseList = createListView(this.courses, course => [course.name, course.code, course.campus], {
    campus: { label: 'Campus', value: course => course.campusId,
      display: id => this.campuses().find(campus => campus.id === Number(id))?.name
        ?? this.courses().find(course => course.campusId === Number(id))?.campus ?? id },
    status: { label: 'Situação', value: course => course.active ? 'Ativo' : 'Arquivado' },
  });
  readonly subjectList = createListView(this.selectedCourseSubjects, subject => [subject.name, subject.code], {
    status: { label: 'Situação', value: subject => subject.active ? 'Ativo' : 'Arquivado' },
    hours: { label: 'Carga horária', value: subject => subject.workloadHours, display: value => value + ' h' },
  });
  readonly assignmentTypes = ['TEACHER', 'TUTOR', 'COORDINATOR', 'NAPNE'];
  readonly assignmentFilters = this.fb.nonNullable.group({
    query: '', registration: '', actor: '', type: '', subject: '', campus: '', course: '', origin: '', period: '', active: '',
  });
  private readonly selectedFilterCampus = toSignal(this.assignmentFilters.controls.campus.valueChanges, { initialValue: '' });
  private readonly selectedFilterCourse = toSignal(this.assignmentFilters.controls.course.valueChanges, { initialValue: '' });
  protected readonly assignmentFilterOptionsOpen = signal(false);
  protected readonly assignmentPeriodOptions = createFilterOptions<string[]>([]);
  readonly appliedAssignmentFilters = signal<Readonly<Record<string, string>>>({});
  protected readonly appliedAssignmentItems = computed(() => appliedFilterItems(this.appliedAssignmentFilters(), {
    registration: 'Matrícula do estudante', actor: 'Profissional vinculado', type: 'Tipo de vínculo', subject: 'Componente',
    campus: 'Campus', course: 'Curso', origin: 'Origem', period: 'Período letivo', active: 'Situação',
  }, {
    type: labelFor,
    subject: id => id === 'general' ? 'Sem componente específico' : this.subjectLabel(Number(id)),
    campus: id => this.allCampuses().find(campus => String(campus.id) === id)?.name ?? id,
    course: id => this.courses().find(course => String(course.id) === id)?.name ?? id,
    origin: value => value === 'AUTOMATIC' ? 'Automática' : 'Manual',
    active: value => value === 'true' ? 'Ativo' : 'Revogado',
  }));
  readonly assignmentFilterCount = computed(() => this.appliedAssignmentItems().length);
  readonly archiveDescription = computed(() => {
    const course = this.pendingCourseArchive();
    if (!course) return '';
    const count = this.subjects().filter(subject => subject.courseId === course.id).length;
    const linkedSubjects = count === 1 ? '1 disciplina vinculada' : `${count} disciplinas vinculadas`;
    return `O curso “${course.name}” (${course.code}) será arquivado. Todas as disciplinas vinculadas também serão arquivadas (${linkedSubjects}). O histórico será preservado. Deseja prosseguir?`;
  });
  readonly revocationDescription=computed(()=>{const item=this.pendingRevocation();return item?`O vínculo de ${item.userName ?? 'Usuário indisponível'} com a matrícula ${item.registration ?? 'indisponível'} será revogado. O histórico continuará preservado.`:'';});
  readonly label=labelFor;
  private readonly subjectsById = computed(() => new Map(this.subjects().map(subject => [subject.id, subject])));

  readonly courseForm=this.fb.nonNullable.group({name:['',Validators.required],code:['',Validators.required],campusId:['',Validators.required]});
  readonly editCourseForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(180)]],
    code: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(60)]],
    campusId: ['', Validators.required]
  });
  readonly subjectForm=this.fb.nonNullable.group({name:['',Validators.required],code:['',Validators.required],courseId:['',Validators.required],workloadHours:[60,[Validators.required,Validators.min(1)]],syllabus:['']});
  readonly editSubjectForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(180)]],
    code: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(60)]],
    workloadHours: [60, [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]],
    syllabus: [''],
  });
  private readonly currentSubject = toSignal(this.editSubjectForm.valueChanges.pipe(map(() => this.subjectFields())), {
    initialValue: this.subjectFields(),
  });
  readonly subjectChanged = computed(() => {
    const subject = this.editingSubject();
    return !!subject && !sameFormValue(this.currentSubject(), {
      name: subject.name.trim(), code: subject.code.trim().toUpperCase(),
      workloadHours: subject.workloadHours, syllabus: subject.syllabus ?? '',
    });
  });
  readonly assignmentForm=this.fb.nonNullable.group({studentId:['',Validators.required],userId:['',Validators.required],subjectId:[''],assignmentType:['TUTOR',Validators.required]});

  private readonly assignmentStudentId = toSignal(this.assignmentForm.controls.studentId.valueChanges, { initialValue: '' });
  private readonly assignmentType = toSignal(this.assignmentForm.controls.assignmentType.valueChanges, { initialValue: 'TUTOR' });
  private readonly studentPicker = viewChild<SearchableSelectComponent<RegistrationOption>>('studentPicker');
  readonly studentLookup: SearchableLookup<RegistrationOption> = (query, selectedId, page) =>
    this.api.studentRegistrationCandidates({
      query: query || undefined, selectedId: selectedId ? Number(selectedId) : undefined, page: page || undefined,
    }).pipe(map(result => ({
      content: result.content.map(registrationOption),
      totalElements: result.totalElements,
      selected: result.selected ? registrationOption(result.selected) : null,
    })));
  readonly selectedStudent = computed(() => {
    const option = this.studentPicker()?.validatedOption();
    return option && option.id === this.assignmentStudentId() ? option.student : null;
  });
  // Keep dependent choices while the new matrícula is being validated.
  private readonly studentScope = linkedSignal({
    source: () => ({ id: this.assignmentStudentId(), student: this.selectedStudent() }),
    computation: ({ id, student }, previous): StudentRegistrationCandidate | null =>
      student ?? (id ? previous?.value ?? null : null),
  });
  private readonly assignmentCampus = computed(() => this.studentScope()?.campusId);
  readonly professionalLookup = computed(() => {
    const campusId = this.assignmentCampus();
    const type = this.assignmentType();
    if (campusId == null || !['TUTOR', 'COORDINATOR', 'NAPNE'].includes(type)) return null;
    const roles = type === 'COORDINATOR' ? ['COTEP', 'COURSE_COORDINATOR', 'MANAGEMENT'] : [type];
    return this.createCandidates({ campusId, roles });
  });
  readonly assignmentSubjectOptions = computed(() => this.subjects()
    .filter(subject => subject.courseId === this.studentScope()?.courseId && subject.active)
    .map(subject => ({ id: String(subject.id), label: subject.name, detail: subject.code })));

  constructor() {
    effect(() => {
      if (!this.assignmentFilterOptionsOpen()) {
        this.assignmentPeriodOptions.cancel();
        return;
      }
      this.refreshAssignmentPeriods();
    });
  }

  ngOnInit(): void {
    const { query, campus, course, subject, period } = this.assignmentFilters.controls;
    query.valueChanges.pipe(debounceTime(250), takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      const search = value.trim();
      if ((this.appliedAssignmentFilters()['query'] ?? '') === search) return;
      this.appliedAssignmentFilters.update(filters => ({ ...filters, query: search }));
      this.loadAssignmentPage(0);
    });
    campus.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      if (!value) return;
      if (course.value && !this.assignmentCourseFilterOptions().some(item => item.id === course.value)) course.reset();
      if (subject.value && !this.assignmentSubjectFilterOptions().some(item => item.id === subject.value)) subject.reset();
      period.reset();
    });
    course.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(value => {
      if (!value) return;
      if (subject.value && !this.assignmentSubjectFilterOptions().some(item => item.id === subject.value)) subject.reset();
      period.reset();
    });
    this.load();
    this.loadAssignmentPage(0);
  }
  load():void{
    this.loading.set(true);
    forkJoin({campuses:this.api.adminCampuses(),courses:this.api.adminCourses(),subjects:this.api.adminSubjects()}).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next:v=>{this.allCampuses.set(v.campuses);this.courses.set(v.courses);this.subjects.set(v.subjects);this.selectRequiredCatalogValues();this.loading.set(false);},
      error:e=>{this.loading.set(false);this.toast.show(errorMessage(e.status,'carregar a estrutura acadêmica'),'error');}
    });
  }
  createCourse(): void {
    this.courseForm.markAllAsTouched();
    if (this.courseForm.invalid || this.busy()) return;
    const value = this.courseForm.getRawValue();
    this.busy.set(true);
    this.api.createCourse({ ...value, campusId: Number(value.campusId) }).subscribe({
      next: () => {
        this.courseForm.reset();
        this.selectRequiredCatalogValues();
        this.done('Curso criado com sucesso.');
      },
      error: response => this.fail(response.status, 'criar o curso')
    });
  }

  createSubject(): void {
    this.subjectForm.markAllAsTouched();
    if (this.subjectForm.invalid || this.busy()) return;
    const value = this.subjectForm.getRawValue();
    this.busy.set(true);
    this.api.createSubject({ ...value, courseId: Number(value.courseId) }).subscribe({
      next: () => {
        this.subjectForm.reset({ workloadHours: 60 });
        this.selectRequiredCatalogValues();
        this.done('Componente curricular criado.');
      },
      error: response => this.fail(response.status, 'criar o componente')
    });
  }

  createAssignment(): void {
    this.assignmentForm.markAllAsTouched();
    if (this.assignmentForm.invalid || this.busy()) return;
    const { userId, studentId, subjectId, assignmentType } = this.assignmentForm.getRawValue();
    const picker = this.professionalPicker();
    if (this.selectedStudent()?.id !== Number(studentId)
      || !picker || picker.validatedOption()?.id !== userId || picker.remote() !== this.professionalLookup()
      || (subjectId && !this.assignmentSubjectOptions().some(option => option.id === subjectId))) return;
    this.busy.set(true);
    this.api.createAssignment({
      assignmentType, userId: Number(userId), studentId: Number(studentId), subjectId: subjectId ? Number(subjectId) : null
    }).subscribe({
      next: () => {
        this.assignmentForm.reset({ assignmentType: 'TUTOR' });
        this.done('Vínculo concedido com sucesso.');
        this.refreshAssignments();
      },
      error: response => this.failAssignment(response, 'conceder o vínculo')
    });
  }

  confirmRegularization(): void {
    const item = this.pendingRegularization();
    if (!item || this.busy()) return;
    this.pendingRegularization.set(null);
    this.busy.set(true);
    this.api.regularizeAssignment(item.id).subscribe({
      next: () => { this.done('Vínculo docente regularizado.'); this.refreshAssignments(); },
      error: response => this.failAssignment(response, 'regularizar o vínculo'),
    });
  }

  confirmRevocation(): void {
    const item = this.pendingRevocation();
    if (!item || this.busy()) return;
    this.pendingRevocation.set(null);
    this.busy.set(true);
    this.api.revokeAssignment(item.id).subscribe({
      next: () => { this.done('Vínculo revogado. O histórico foi preservado.'); this.refreshAssignments(); },
      error: response => this.failAssignment(response, 'revogar o vínculo')
    });
  }

  openComponents(course: AdminCourse): void {
    this.componentCourse.set(course);
    this.subjectList.reset();
  }

  closeComponents(): void {
    if (this.busy()) return;
    if (this.editingSubject() || this.pendingSubjectStatus()) {
      this.leaveSubjectAction();
      return;
    }
    this.componentCourse.set(null);
  }

  openSubject(subject: AdminSubject): void {
    if (this.busy()) return;
    this.rememberSubjectPosition(subject.id);
    const { name, code, workloadHours, syllabus } = subject;
    this.subjectError.set('');
    this.editSubjectForm.reset({ name, code, workloadHours, syllabus: syllabus ?? '' });
    this.editingSubject.set(subject);
    this.focusSubjectAction('input');
  }

  requestSubjectStatus(subject: AdminSubject): void {
    if (this.busy()) return;
    this.rememberSubjectPosition(subject.id);
    this.subjectError.set('');
    this.pendingSubjectStatus.set(subject);
    this.focusSubjectAction('section.stack button');
  }

  leaveSubjectAction(): void {
    if (this.busy()) return;
    this.editingSubject.set(null);
    this.pendingSubjectStatus.set(null);
    afterNextRender(() => {
      const dialog = this.subjectDialog();
      if (!dialog) return;
      dialog.scrollTop = this.subjectListScroll;
      const action = dialog.querySelector<HTMLElement>(`[data-subject-id="${this.subjectActionId}"] button`);
      if (action) action.focus({ preventScroll: true });
      else this.subjectSearch()?.focusSearch(true);
    }, { injector: this.injector });
  }

  private subjectDialog(): HTMLElement | null {
    return this.componentsModal()?.nativeElement.querySelector<HTMLElement>('[role="dialog"]') ?? null;
  }

  private rememberSubjectPosition(id: number): void {
    this.subjectActionId = id;
    this.subjectListScroll = this.subjectDialog()?.scrollTop ?? 0;
  }

  saveSubject(): void {
    const subject = this.editingSubject();
    if (!subject?.active || this.busy() || this.editSubjectForm.invalid || !this.subjectChanged()) return;
    this.busy.set(true);
    this.subjectError.set('');
    this.api.updateSubject(subject.id, { ...this.subjectFields(), courseId: subject.courseId, version: subject.version })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: updated => this.applySubject(updated, 'Componente curricular atualizado.'),
        error: error => this.subjectFailed(error, 'atualizar o componente'),
      });
  }

  changeSubjectStatus(): void {
    const subject = this.pendingSubjectStatus();
    if (!subject || this.busy()) return;
    const active = !subject.active;
    this.busy.set(true);
    this.subjectError.set('');
    this.api.setSubjectActive(subject.id, active).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: updated => this.applySubject(updated, active ? 'Componente reativado.' : 'Componente arquivado.'),
      error: error => this.subjectFailed(error, active ? 'reativar o componente' : 'arquivar o componente'),
    });
  }

  private subjectFields() {
    const values = this.editSubjectForm.getRawValue();
    return { ...values, name: values.name.trim(), code: values.code.trim().toUpperCase(),
      syllabus: values.syllabus.trim() ? values.syllabus : '' };
  }

  private applySubject(subject: AdminSubject, message: string): void {
    this.subjects.update(items => items.map(item => item.id === subject.id ? subject : item));
    this.clearUnavailableSelections();
    this.busy.set(false);
    this.leaveSubjectAction();
    this.toast.show(message, 'success');
  }

  private subjectFailed(error: HttpErrorResponse, action: string): void {
    this.busy.set(false);
    this.subjectError.set(this.courseError(error, action));
  }

  private focusSubjectAction(selector: string): void {
    afterNextRender(() => this.subjectDialog()?.querySelector<HTMLElement>(selector)?.focus(),
      { injector: this.injector });
  }

  openCourseEditor(course: AdminCourse): void {
    this.editCourseForm.reset({ name: course.name, code: course.code, campusId: String(course.campusId) });
    this.editCourseError.set('');
    this.editingCourse.set(course);
  }

  closeCourseEditor(): void {
    if (!this.busy()) this.editingCourse.set(null);
  }

  saveCourse(): void {
    const course = this.editingCourse();
    if (!course || this.editCourseForm.invalid || this.busy()) return;

    const { campusId, name, code } = this.editCourseForm.getRawValue();
    this.busy.set(true);
    this.editCourseError.set('');
    this.api.updateCourse(course.id, { campusId: Number(campusId), name: name.trim(), code: code.trim() })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: updated => {
          this.courses.update(courses => courses.map(item => item.id === updated.id ? updated : item));
          if (course.campusId !== updated.campusId) this.studentPicker()?.refresh();
          this.busy.set(false);
          this.editingCourse.set(null);
          if (!this.courseList.items().some(item => item.id === updated.id)) this.focusCourseSearch();
          this.toast.show('Curso atualizado com sucesso.', 'success');
        },
        error: (response: HttpErrorResponse) => {
          this.busy.set(false);
          this.editCourseError.set(this.courseError(response, 'salvar o curso'));
        }
      });
  }

  requestCourseArchive(course: AdminCourse): void {
    this.archiveCourseError.set('');
    this.pendingCourseArchive.set(course);
  }

  confirmCourseArchive(): void {
    const course = this.pendingCourseArchive();
    if (!course || this.busy()) return;

    this.busy.set(true);
    this.archiveCourseError.set('');
    this.api.archiveCourse(course.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: archived => {
        this.courses.update(courses => courses.map(item => item.id === archived.id ? archived : item));
        this.subjects.update(subjects => subjects.map(subject => subject.courseId === archived.id ? { ...subject, active: false } : subject));
        this.clearUnavailableSelections();
        this.studentPicker()?.refresh();
        this.pendingCourseArchive.set(null);
        this.focusCourseSearch();
        this.toast.show('Curso e componentes vinculados arquivados.', 'success');
        this.reloadAcademicCatalog();
      },
      error: (response: HttpErrorResponse) => {
        this.busy.set(false);
        this.archiveCourseError.set(this.courseError(response, 'arquivar o curso'));
      }
    });
  }

  refreshAssignments(): void {
    this.loadAssignmentPage(this.assignmentPage()?.number ?? 0);
    if (this.assignmentFilterOptionsOpen()) this.refreshAssignmentPeriods();
  }

  private refreshAssignmentPeriods(): void {
    this.assignmentPeriodOptions.load(this.api.assignmentPeriods(this.selectedFilterCampus(), this.selectedFilterCourse()));
  }

  applyAssignmentFilters(): void {
    const filters = this.assignmentFilters.getRawValue();
    this.appliedAssignmentFilters.set({ ...filters, query: filters.query.trim() });
    this.loadAssignmentPage(0);
  }

  protected removeAssignmentFilter(key: string): void {
    const control = this.assignmentFilters.get(key);
    if (!control) return;
    control.reset();
    this.appliedAssignmentFilters.update(filters => ({ ...filters, [key]: '' }));
    this.loadAssignmentPage(0);
  }

  clearAssignmentFilters(): void {
    this.assignmentFilters.reset();
    this.applyAssignmentFilters();
  }

  loadAssignmentPage(page: number): void {
    this.assignmentRequest?.unsubscribe();
    this.assignmentLoading.set(true);
    this.assignmentError.set('');
    this.assignmentRequest = this.api.assignmentPage(page, this.appliedAssignmentFilters()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: result => {
        const lastPage = Math.max(0, result.totalPages - 1);
        if (result.number > lastPage) {
          this.loadAssignmentPage(lastPage);
          return;
        }
        this.assignmentPage.set(result);
        this.assignmentLoading.set(false);
      },
      error: failure => {
        this.assignmentLoading.set(false);
        this.assignmentError.set(errorMessage(failure, 'carregar os vínculos'));
      },
    });
  }

  originLabel(assignment: AssignmentView) { return assignment.origin === 'AUTOMATIC' ? 'Automática' : 'Manual'; }

  private failAssignment(response: HttpErrorResponse, action: string) {
    this.busy.set(false);
    this.toast.show(errorMessage(response, action), 'error');
  }

  subjectLabel(id: number | null) { return id === null ? 'Geral' : this.subjectsById().get(id)?.name ?? 'Componente indisponível'; }

  private courseError(response: HttpErrorResponse, action: string): string {
    if (response.status === 409) {
      const detail: unknown = response.error?.detail;
      return typeof detail === 'string' && detail.trim() ? detail : `Não foi possível ${action} porque há um conflito com os dados cadastrados.`;
    }
    return errorMessage(response.status, action);
  }

  private focusCourseSearch(): void {
    afterNextRender(() => this.courseSearch()?.focusSearch(), { injector: this.injector });
  }

  private selectRequiredCatalogValues(): void {
    reconcileRequiredSelection(this.courseForm.controls.campusId, this.campuses().map(campus => String(campus.id)));
    reconcileRequiredSelection(this.subjectForm.controls.courseId, this.activeCourses().map(course => String(course.id)));
  }

  private clearUnavailableSelections(): void {
    this.selectRequiredCatalogValues();
  }

  private reloadAcademicCatalog(): void {
    forkJoin({ courses: this.api.adminCourses(), subjects: this.api.adminSubjects() })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: catalog => {
          this.courses.set(catalog.courses);
          this.subjects.set(catalog.subjects);
          this.clearUnavailableSelections();
          this.busy.set(false);
        },
        error: response => this.fail(response.status, 'recarregar os cursos e componentes')
      });
  }

  private done(message:string):void{this.busy.set(false);this.toast.show(message,'success');this.load();}
  private fail(status:number,action:string):void{this.busy.set(false);this.toast.show(errorMessage(status,action),'error');}
}
