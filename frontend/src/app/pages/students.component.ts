import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Course, Page, StudentSummary } from '../core/models';
import { errorMessage, toneFor } from '../core/presentation';
import {
  ACADEMIC_STATUS_OPTIONS, STUDENT_STATUS_REASON_OPTIONS, academicStatusLabel, academicStudentStatus,
  studentStatusReasonLabel,
} from '../core/student-status';
import { ToastService } from '../core/toast.service';
import { AppliedFiltersComponent, appliedFilterItems } from '../shared/applied-filters.component';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { ModalShellComponent } from '../shared/modal-shell.component';
import { PaginationComponent } from '../shared/pagination.component';
import { SearchableSelectComponent } from '../shared/searchable-select.component';
import { StudentStatusDialogComponent } from './student-status-dialog.component';

import { reconcileRequiredSelection } from '../core/required-selection';

@Component({standalone:true,imports:[ReactiveFormsModule,RouterLink,ModalShellComponent,PaginationComponent,ConfirmDialogComponent,SearchableSelectComponent,StudentStatusDialogComponent,AppliedFiltersComponent],template:`
  <header class="page-header"><div><span class="eyebrow">Área de trabalho</span><h1>Estudantes</h1><p>A lista respeita seu campus e os vínculos atribuídos ao seu perfil.</p></div>@if(auth.hasRole('NAPNE')){<button type="button" (click)="showForm.set(true)">Novo estudante</button>}</header>
  <section class="card students-list" aria-labelledby="students-title">
  <div class="students-toolbar">
    <h2 id="students-title">{{showArchived() ? 'Estudantes arquivados' : 'Estudantes acompanhados'}}</h2>
    <form class="filter-toolbar" (submit)="$event.preventDefault(); searchStudents()">
    <label class="toolbar-search" for="search">Buscar estudante
      <input #studentSearch id="search" type="search" [formControl]="search" placeholder="Nome ou matrícula">
    </label>
    @if(auth.hasRole('TEACHER') && !auth.hasRole('NAPNE')) {
      <label class="toolbar-search" for="academic-search">Buscar por componente, turma ou período
        <input id="academic-search" type="search" [formControl]="academicSearch" placeholder="Componente, turma ou período">
      </label>
    }
    @if (filterCourses().length) {
      <label>Curso
        <select [formControl]="courseFilter" (change)="searchStudents()">
          <option value="">Todos</option>
          @for (course of filterCourses(); track course.id) {
            <option [value]="course.id">{{course.name}} · {{course.code}}</option>
          }
        </select>
      </label>
    }
    <label>Situação acadêmica
      <select [formControl]="statusFilter" (change)="searchStudents()">
        <option value="">Todas</option>
        @for (status of studentStatuses; track status.id) {<option [value]="status.id">{{status.label}}</option>}
      </select>
    </label>
    @if (auth.hasRole('NAPNE')) {
      <label>Motivo da situação
        <select [formControl]="reasonFilter" (change)="searchStudents()">
          <option value="">Todos</option>
          @for (reason of studentReasons; track reason.id) {<option [value]="reason.id">{{reason.label}}</option>}
        </select>
      </label>
    }
    <button type="submit" class="toolbar-button">Buscar</button>
    @if (hasFilters()) {
      <button type="button" class="toolbar-aux" (click)="clearSearch(); studentSearch.focus()">Limpar filtros</button>
    }
    @if(auth.hasRole('NAPNE')) {
      <button type="button" class="secondary compact" [attr.aria-pressed]="showArchived()" (click)="toggleArchived()">
        {{showArchived() ? 'Ver acompanhados' : 'Ver arquivados'}}
      </button>
    }
    </form>
    <app-applied-filters [filters]="appliedItems()" [fallbackFocus]="studentSearch" (removed)="removeFilter($event)" />
    @if (!loading() && !error()) {
      <p class="toolbar-results" role="status">{{totalElements()}} {{totalElements() === 1 ? 'resultado' : 'resultados'}}</p>
    }
  </div>
    @if(error()){<div class="error-state" role="alert"><strong>Não foi possível carregar os estudantes.</strong><p>{{error()}}</p><button class="secondary" (click)="retry()">Tentar novamente</button></div>}
    @if(loading()){<div class="loading-grid" aria-label="Carregando estudantes"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-card"></span><span class="skeleton skeleton-card"></span></div>}
    @if(!loading()&&!error()&&students().length===0){<div class="empty-state"><span class="empty-state-mark" aria-hidden="true">0</span><h3>Nenhum estudante disponível</h3><p>{{(hasFilters()) ? 'Nenhum estudante corresponde à busca informada.' : showArchived() ? 'Não há estudantes arquivados neste campus.' : 'Não há estudantes vinculados ao seu perfil neste momento.'}}</p></div>}
    @if(!loading()&&!error()&&students().length>0){<div class="table-wrap table-borderless"><table class="mobile-cards"><thead><tr><th>Estudante</th><th>Matrícula</th><th>Curso e campus</th><th>Situação acadêmica</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>@for(student of students();track student.id){<tr><td data-label="Estudante"><div class="student-cell"><span class="avatar avatar--small" aria-hidden="true">{{initials(student.displayName)}}</span><strong>{{student.displayName}}</strong></div></td><td data-label="Matrícula">{{student.registration}}</td><td data-label="Curso e campus"><strong>{{student.course}}</strong><small>{{student.campus}}</small></td><td data-label="Situação acadêmica">
      <span [class]="'badge badge--'+tone(academicStatus(student))">{{statusLabel(academicStatus(student))}}</span>
      @if (student.status === 'ARCHIVED') { <small>Cadastro arquivado</small> }
      @if (student.statusReason) { <small>{{reasonLabel(student.statusReason)}}</small> }
    </td><td><a class="button secondary compact" [routerLink]="['/estudantes',student.id]">Abrir acompanhamento</a>
    @if(auth.hasRole('NAPNE')) {
      @if (student.status === 'ARCHIVED') {
        <button type="button" class="secondary compact" (click)="restoreStudent.set(student)">Desarquivar</button>
      } @else {
        <button type="button" class="secondary compact" [disabled]="busy()" (click)="pending.set(student)">Arquivar cadastro</button>
      }
    }</td></tr>}</tbody></table></div>}
    @if (result() && !error() && totalElements() > 0) {
      <app-pagination class="students-pagination" [page]="pageNumber()" [totalPages]="totalPages()"
        [showSinglePage]="true" label="Paginação dos estudantes" (pageChange)="load($event)" />
    }
  </section>
  <app-confirm-dialog [open]="pending() !== null" title="Arquivar cadastro?"
    description="A situação acadêmica e o histórico serão preservados. Resolva as matrículas, os vínculos, os casos e os PEIs em andamento antes de arquivar."
    [danger]="true" confirmLabel="Arquivar cadastro" (confirmed)="confirmArchive()" (cancelled)="pending.set(null)" />
  @if (restoreStudent(); as student) {
    <app-student-status-dialog [student]="student" mode="restore" (saved)="onRestored()" (cancelled)="restoreStudent.set(null)" />
  }
  <app-modal-shell [open]="showForm()" eyebrow="Novo cadastro" title="Cadastrar estudante" description="Informe os dados usados para identificação e vínculo acadêmico." (closed)="closeForm()"><form class="stack" [formGroup]="form" (ngSubmit)="create()" novalidate><fieldset><legend>Identificação</legend><div class="grid two"><label><span>Nome civil&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input formControlName="civilName" aria-required="true" autocomplete="off"></label><label>Nome social<input formControlName="socialName" autocomplete="off"></label><label><span>Matrícula&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input formControlName="registration" aria-required="true"></label><label>Data de nascimento<input type="date" formControlName="birthDate"></label></div></fieldset><fieldset><legend>Vínculo acadêmico</legend><app-searchable-select label="Curso" formControlName="courseId" [required]="true"
      [options]="courseOptions()" [readonly]="saving()" placeholder="Nome, código ou campus" /></fieldset><fieldset><legend>Contato</legend><div class="grid two"><label>E-mail institucional<input type="email" formControlName="institutionalEmail"></label><label>Telefone<input formControlName="phone"></label></div></fieldset><div class="dialog-actions"><button class="secondary" type="button" (click)="closeForm()">Cancelar</button><button type="submit" [disabled]="form.invalid||saving()">@if(saving()){<span class="spinner"></span>}Salvar estudante</button></div></form></app-modal-shell>
`,styles:[`.students-list{padding:0;overflow:hidden}.students-toolbar{display:grid;gap:var(--space-3);padding:var(--space-5) var(--space-6)}.students-toolbar h2{margin:0}.table-borderless{border-left:0;border-right:0;border-radius:0}.student-cell{display:flex;align-items:center;gap:.7rem}.table-wrap td small,.table-wrap td strong{display:block}.table-wrap td small{color:var(--ink-600)}.students-pagination{display:block;padding:0 1.5rem 1.25rem}.loading-grid,.empty-state,.error-state{margin:0 1.5rem 1.5rem}.error-state{padding:1.2rem;background:var(--danger-soft);border-radius:var(--radius-md);color:var(--danger)}.error-state p{margin:.25rem 0 1rem}@media(max-width:700px){.students-toolbar{padding:var(--space-4)}.table-wrap{overflow:visible;border:0;padding:0 1rem}.students-pagination{padding:0 1rem 1rem}.loading-grid,.empty-state,.error-state{margin:0 1rem 1rem}}` ]})
export class StudentsComponent implements OnInit{
  private readonly api=inject(ApiService);private readonly fb=inject(FormBuilder);private readonly toast=inject(ToastService);readonly auth=inject(AuthService);
  readonly result=signal<Page<StudentSummary>|null>(null);readonly students=computed(()=>this.result()?.content??[]);readonly totalElements=computed(()=>this.result()?.totalElements??0);readonly totalPages=computed(()=>Math.max(this.result()?.totalPages??1,1));readonly pageNumber=computed(()=>this.result()?.number??0);readonly courses=signal<Course[]>([]);readonly loading=signal(false);readonly saving=signal(false);readonly showForm=signal(false);readonly error=signal('');readonly search=this.fb.nonNullable.control('');readonly tone=toneFor;
  readonly academicStatus = academicStudentStatus;
  readonly statusLabel = academicStatusLabel;
  readonly reasonLabel = studentStatusReasonLabel;
  readonly form=this.fb.nonNullable.group({registration:['',Validators.required],courseId:['',Validators.required],civilName:['',Validators.required],socialName:[''],birthDate:[''],institutionalEmail:['',Validators.email],phone:['']});
  readonly courseOptions = computed(() => this.courses().map(course => ({
    id: String(course.id), label: course.name, detail: `${course.code} · ${course.campus}`,
  })));
  ngOnInit() {
    this.load(0);
    this.api.studentFilterCourses().subscribe({
      next: courses => this.filterCourses.set(courses),
      error: () => this.toast.show('Não foi possível carregar os cursos para filtragem.', 'error'),
    });
    if (this.auth.hasRole('NAPNE')) this.api.courses().subscribe({
      next: courses => {
        this.courses.set(courses);
        this.selectRequiredCourse();
      },
      error: () => this.toast.show('Não foi possível carregar os cursos.', 'error'),
    });
  }

  private selectRequiredCourse(): void {
    reconcileRequiredSelection(this.form.controls.courseId, this.courses().map(course => String(course.id)));
  }
  readonly appliedSearch = signal('');
  readonly academicSearch = this.fb.nonNullable.control('');
  readonly appliedAcademicSearch = signal('');
  readonly filterCourses = signal<Pick<Course, 'id' | 'name' | 'code'>[]>([]);
  readonly courseFilter = this.fb.nonNullable.control('');
  readonly statusFilter = this.fb.nonNullable.control('');
  readonly reasonFilter = this.fb.nonNullable.control('');
  readonly studentStatuses = ACADEMIC_STATUS_OPTIONS;
  readonly studentReasons = STUDENT_STATUS_REASON_OPTIONS;
  private readonly appliedCourse = signal('');
  private readonly appliedStatus = signal('');
  private readonly appliedReason = signal('');
  readonly appliedItems = computed(() => appliedFilterItems({
    query: this.appliedSearch(), academic: this.appliedAcademicSearch(),
    course: this.appliedCourse(), status: this.appliedStatus(), reason: this.appliedReason(),
  }, {
    query: 'Busca', academic: 'Busca acadêmica', course: 'Curso', status: 'Situação acadêmica', reason: 'Motivo',
  }, {
    course: id => this.filterCourses().find(option => String(option.id) === id)?.name ?? id,
    status: id => this.studentStatuses.find(option => option.id === id)?.label ?? id,
    reason: id => this.studentReasons.find(option => option.id === id)?.label ?? id,
  }));
  readonly hasFilters = computed(() => this.appliedItems().length > 0);
  readonly showArchived = signal(false);
  readonly busy = signal(false);
  readonly pending = signal<StudentSummary | null>(null);
  readonly restoreStudent = signal<StudentSummary | null>(null);
  private studentsRequest = 0;
  private requestedPage = 0;

  load(page = 0) {
    const request = ++this.studentsRequest;
    this.requestedPage = page;
    this.loading.set(true);
    this.error.set('');
    this.api.students(this.appliedSearch(), page, this.appliedAcademicSearch(), this.showArchived(), this.appliedCourse(), this.appliedStatus(), this.appliedReason()).subscribe({
      next: result => {
        if (request !== this.studentsRequest) return;
        this.result.set(result);
        this.loading.set(false);
      },
      error: error => {
        if (request !== this.studentsRequest) return;
        this.loading.set(false);
        this.error.set(errorMessage(error, 'carregar os estudantes'));
      }
    });
  }
  searchStudents() {
    this.appliedSearch.set(this.search.value.trim());
    this.appliedAcademicSearch.set(this.academicSearch.value.trim());
    this.appliedCourse.set(this.courseFilter.value);
    this.appliedStatus.set(this.statusFilter.value);
    this.appliedReason.set(this.reasonFilter.value);
    this.load(0);
  }

  removeFilter(key: string) {
    const filters = {
      query: [this.search, this.appliedSearch], academic: [this.academicSearch, this.appliedAcademicSearch],
      course: [this.courseFilter, this.appliedCourse], status: [this.statusFilter, this.appliedStatus],
      reason: [this.reasonFilter, this.appliedReason],
    } as const;
    if (!Object.hasOwn(filters, key)) return;
    const [control, applied] = filters[key as keyof typeof filters];
    control.reset();
    applied.set('');
    this.load(0);
  }

  clearSearch() {
    this.search.setValue('');
    this.academicSearch.reset();
    this.courseFilter.reset();
    this.statusFilter.reset();
    this.reasonFilter.reset();
    this.searchStudents();
  }

  toggleArchived() {
    this.showArchived.set(!this.showArchived());
    this.load(0);
  }

  confirmArchive() {
    const student = this.pending();
    if (!student || this.busy()) return;
    this.pending.set(null);
    this.busy.set(true);
    this.api.archiveStudent(student.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.show('Cadastro arquivado.', 'success');
        this.load(0);
      },
      error: failure => {
        this.busy.set(false);
        this.toast.show(errorMessage(failure, 'arquivar o cadastro'), 'error');
      },
    });
  }

  onRestored() {
    this.restoreStudent.set(null);
    this.toast.show('Cadastro desarquivado.', 'success');
    this.load(0);
  }

  retry() { this.load(this.requestedPage); }
  closeForm(){if(!this.saving())this.showForm.set(false)}
  create(){this.form.markAllAsTouched();if(this.form.invalid)return;this.saving.set(true);const raw=this.form.getRawValue();this.api.createStudent({...raw,courseId:Number(raw.courseId),birthDate:raw.birthDate||null}).subscribe({next:()=>{this.form.reset();this.selectRequiredCourse();this.saving.set(false);this.showForm.set(false);this.toast.show('Estudante cadastrado com sucesso.','success');this.load(0);},error:e=>{this.saving.set(false);this.toast.show(errorMessage(e,'salvar o estudante'),'error');}})}
  initials(name:string){return name.split(' ').filter(Boolean).slice(0,2).map(v=>v[0]).join('').toUpperCase()}
}
