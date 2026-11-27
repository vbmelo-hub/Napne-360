import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, ElementRef, Injector, OnInit, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { createListView } from '../core/list-view';
import { AdminCourse, AdminSubject, Campus, UserView } from '../core/models';
import { errorMessage, labelFor } from '../core/presentation';
import { ToastService } from '../core/toast.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { ModalShellComponent } from '../shared/modal-shell.component';
import { PaginationComponent } from '../shared/pagination.component';

interface AssignmentView {
  id: number;
  studentId: number;
  userId: number;
  subjectId: number | null;
  assignmentType: string;
  active: boolean;
}

@Component({selector:'app-admin-academic',standalone:true,imports:[ReactiveFormsModule,ConfirmDialogComponent,ModalShellComponent,PaginationComponent],template:`
  <header class="module-head"><span class="eyebrow">Organização acadêmica</span><h2>Estrutura acadêmica e vínculos</h2><p>Cadastre cursos e componentes e defina quem acompanha cada estudante.</p></header>

  @if(loading()){
    <div class="loading-grid" aria-label="Carregando estrutura acadêmica"><span class="skeleton skeleton-card"></span><span class="skeleton skeleton-card"></span></div>
  } @else {
    <div class="admin-academic-grid">
      <form class="card stack" [formGroup]="courseForm" (ngSubmit)="createCourse()">
        <div class="section-header"><div><h3>Novo curso</h3><p>Associe o curso a um campus ativo.</p></div></div>
        <label class="required">Campus<select formControlName="campusId"><option value="">Selecione</option>@for(c of campuses();track c.id){<option [value]="c.id">{{c.name}}</option>}</select></label>
        <label class="required">Nome do curso<input formControlName="name"></label>
        <label class="required">Código do curso<input formControlName="code"></label>
        <button [disabled]="courseForm.invalid||busy()">@if(busy()){<span class="spinner"></span>}Criar curso</button>
      </form>

      <form class="card stack" [formGroup]="subjectForm" (ngSubmit)="createSubject()">
        <div class="section-header"><div><h3>Novo componente curricular</h3><p>Cadastre a disciplina dentro de um curso existente.</p></div></div>
        <label class="required">Curso<select formControlName="courseId"><option value="">Selecione</option>@for(c of activeCourses();track c.id){<option [value]="c.id">{{c.name}} · {{c.campus}}</option>}</select></label>
        <div class="grid two"><label class="required">Nome do componente<input formControlName="name"></label><label class="required">Código<input formControlName="code"></label></div>
        <label class="required">Carga horária<input type="number" min="1" formControlName="workloadHours"></label>
        <label>Ementa<textarea formControlName="syllabus"></textarea></label>
        <button [disabled]="subjectForm.invalid||busy()">@if(busy()){<span class="spinner"></span>}Criar componente</button>
      </form>
    </div>

    <section class="card structure-card">
      <div class="section-header"><h3>Cursos cadastrados</h3><span class="badge badge--info">{{courseList.totalElements()}} curso(s)</span></div>
      <label class="list-filter">Buscar cursos
        <input #courseSearch type="search" placeholder="Nome, código ou campus" [value]="courseList.query()"
          (input)="courseList.setQuery(courseSearch.value)">
      </label>
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

    <form class="card stack assignment-form" [formGroup]="assignmentForm" (ngSubmit)="createAssignment()">
      <div class="section-header"><div><h3>Conceder vínculo de acompanhamento</h3><p>Defina a pessoa autorizada, o papel no acompanhamento e, quando aplicável, o componente.</p></div></div>
      <div class="grid two">
        <label class="required">Estudante (matrícula)<select formControlName="studentId" (change)="assignmentForm.controls.subjectId.setValue('')"><option value="">Selecione</option>@for(s of assignableRegistrations();track s.id){<option [value]="s.id">{{s.registration}}</option>}</select></label>
        <label class="required">Usuário<select formControlName="userId"><option value="">Selecione</option>@for(u of users();track u.id){@if(u.active){<option [value]="u.id">{{u.name}} · {{u.email}}</option>}}</select></label>
        <label class="required">Tipo de vínculo<select formControlName="assignmentType"><option value="TEACHER">Professor</option><option value="TUTOR">Monitor/tutor</option><option value="COORDINATOR">Coordenação/supervisão</option><option value="NAPNE">NAPNE</option></select></label>
        <label>Componente do vínculo<select formControlName="subjectId"><option value="">Sem componente específico</option>@for(s of assignmentSubjects();track s.id){<option [value]="s.id">{{s.name}}</option>}</select><span class="field-hint">A lista considera o curso do estudante selecionado.</span></label>
      </div>
      <div><button [disabled]="assignmentForm.invalid||busy()">@if(busy()){<span class="spinner"></span>}Conceder vínculo</button></div>
    </form>

    <section class="card assignments">
      <div class="section-header"><div><h3>Vínculos registrados</h3><p>O histórico permanece disponível mesmo após a revogação.</p></div><span class="badge">{{assignmentList.totalElements()}} registro(s)</span></div>
      <label class="list-filter">Buscar vínculos
        <input #assignmentSearch type="search" placeholder="Matrícula, usuário, tipo, componente ou situação"
          [value]="assignmentList.query()" (input)="assignmentList.setQuery(assignmentSearch.value)">
      </label>
      @if (assignments().length === 0) {
        <div class="empty-state"><h3>Nenhum vínculo registrado</h3><p>Use o formulário acima para conceder acesso ao acompanhamento de um estudante.</p></div>
      } @else if (assignmentList.totalElements() === 0) {
        <p class="meta assignment-empty">Nenhum vínculo encontrado.</p>
      } @else {
        <div class="table-wrap">
          <table class="mobile-cards">
            <thead><tr><th>Matrícula</th><th>Usuário</th><th>Tipo</th><th>Componente</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead>
            <tbody>
              @for (a of assignmentList.items(); track a.id) {
                <tr>
                  <td data-label="Matrícula">{{registrationLabel(a.studentId)}}</td>
                  <td data-label="Usuário">{{userLabel(a.userId)}}</td>
                  <td data-label="Tipo">{{label(a.assignmentType)}}</td>
                  <td data-label="Componente">{{subjectLabel(a.subjectId)}}</td>
                  <td data-label="Situação"><span [class]="a.active ? 'badge badge--success' : 'badge'">{{a.active ? 'Ativo' : 'Revogado'}}</span></td>
                  <td>@if (a.active) {<button type="button" class="secondary compact" [disabled]="busy()" (click)="pendingRevocation.set(a)">Revogar</button>}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
      <app-pagination label="Paginação de vínculos" [page]="assignmentList.page()" [totalPages]="assignmentList.totalPages()"
        (pageChange)="assignmentList.setPage($event)" />
    </section>
  }

  <app-modal-shell [open]="componentCourse() !== null" eyebrow="Estrutura acadêmica"
    [title]="componentCourse()?.name ?? ''" description="Componentes curriculares do curso" (closed)="componentCourse.set(null)">
    <label class="list-filter">Buscar componentes
      <input #subjectSearch type="search" placeholder="Nome ou código" [value]="subjectList.query()"
        (input)="subjectList.setQuery(subjectSearch.value)">
    </label>
    @if (selectedCourseSubjects().length === 0) {
      <p class="meta">Nenhum componente curricular cadastrado neste curso.</p>
    } @else if (subjectList.totalElements() === 0) {
      <p class="meta">Nenhum componente encontrado.</p>
    } @else {
      <div class="table-wrap">
        <table class="mobile-cards">
          <thead><tr><th>Componente</th><th>Código</th><th>Carga horária</th><th>Situação</th></tr></thead>
          <tbody>
            @for (s of subjectList.items(); track s.id) {
              <tr>
                <td data-label="Componente">{{s.name}}</td><td data-label="Código">{{s.code}}</td><td data-label="Carga horária">{{s.workloadHours}} h</td>
                <td data-label="Situação"><span [class]="s.active ? 'badge badge--success' : 'badge'">{{s.active ? 'Ativo' : 'Arquivado'}}</span></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <app-pagination label="Paginação de componentes" [page]="subjectList.page()" [totalPages]="subjectList.totalPages()"
        (pageChange)="subjectList.setPage($event)" />
    }
  </app-modal-shell>

  <app-modal-shell [open]="editingCourse() !== null" eyebrow="Estrutura acadêmica" title="Editar curso"
    [description]="editingCourse()?.name ?? ''" (closed)="closeCourseEditor()">
    <form class="stack course-editor" [formGroup]="editCourseForm" (ngSubmit)="saveCourse()">
      <fieldset class="stack" [disabled]="busy()">
        <legend class="sr-only">Dados do curso</legend>
        <label class="required">Campus
          <select formControlName="campusId" required>
            <option value="">Selecione</option>
            @if (missingEditCampus(); as campus) {<option [value]="campus.campusId">{{campus.campus}}</option>}
            @for (c of campuses(); track c.id) {<option [value]="c.id">{{c.name}}</option>}
          </select>
        </label>
        <label class="required">Nome do curso<input formControlName="name" maxlength="180" required></label>
        <label class="required">Código do curso<input formControlName="code" maxlength="60" required></label>
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
  .assignments { padding: 0; overflow: hidden; }
  .assignments .section-header { padding: 1.25rem 1.5rem; margin: 0; }
  .assignments .list-filter, .assignments .assignment-empty { margin-inline: 1.5rem; }
  .assignments .table-wrap { border-radius: 0; border: 0; border-top: 1px solid var(--border); }
  .assignments app-pagination { display: block; margin-inline: 1.5rem; }
  .assignments app-pagination:has(nav) { margin-bottom: 1.25rem; }
  @media (max-width: 850px) { .admin-academic-grid, .course-grid { grid-template-columns: 1fr; } }
`]})
export class AdminAcademicComponent implements OnInit {
  private readonly api=inject(ApiService);
  private readonly fb=inject(FormBuilder);
  private readonly toast=inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly courseSearch = viewChild<ElementRef<HTMLInputElement>>('courseSearch');

  readonly users=signal<UserView[]>([]);
  readonly campuses=signal<Campus[]>([]);
  readonly courses=signal<AdminCourse[]>([]);
  readonly subjects=signal<AdminSubject[]>([]);
  readonly registrations=signal<{id:number,registration:string,campusId:number,courseId:number}[]>([]);
  readonly assignments=signal<AssignmentView[]>([]);
  readonly loading=signal(true);
  readonly busy=signal(false);
  readonly pendingRevocation=signal<AssignmentView|null>(null);
  readonly componentCourse = signal<AdminCourse | null>(null);
  readonly editingCourse = signal<AdminCourse | null>(null);
  readonly pendingCourseArchive = signal<AdminCourse | null>(null);
  readonly editCourseError = signal('');
  readonly archiveCourseError = signal('');
  readonly activeCourses = computed(() => this.courses().filter(course => course.active));
  readonly assignableRegistrations = computed(() => {
    const activeCourseIds = new Set(this.activeCourses().map(course => course.id));
    return this.registrations().filter(registration => activeCourseIds.has(registration.courseId));
  });
  readonly missingEditCampus = computed(() => {
    const course = this.editingCourse();
    return course && !this.campuses().some(campus => campus.id === course.campusId) ? course : null;
  });
  readonly selectedCourseSubjects = computed(() => {
    const courseId = this.componentCourse()?.id;
    return this.subjects().filter(subject => subject.courseId === courseId);
  });
  readonly courseList = createListView(this.courses, course => [course.name, course.code, course.campus]);
  readonly subjectList = createListView(this.selectedCourseSubjects, subject => [subject.name, subject.code]);
  readonly assignmentList = createListView(this.assignments, item => [
    this.registrationLabel(item.studentId), this.userLabel(item.userId), this.usersById().get(item.userId)?.email,
    labelFor(item.assignmentType), this.subjectLabel(item.subjectId), item.active ? 'Ativo' : 'Revogado'
  ]);
  readonly archiveDescription = computed(() => {
    const course = this.pendingCourseArchive();
    if (!course) return '';
    const count = this.subjects().filter(subject => subject.courseId === course.id).length;
    const linkedSubjects = count === 1 ? '1 disciplina vinculada' : `${count} disciplinas vinculadas`;
    return `O curso “${course.name}” (${course.code}) será arquivado. Todas as disciplinas vinculadas também serão arquivadas (${linkedSubjects}). O histórico será preservado. Deseja prosseguir?`;
  });
  readonly revocationDescription=computed(()=>{const item=this.pendingRevocation();return item?`O vínculo de ${this.userLabel(item.userId)} com a matrícula ${this.registrationLabel(item.studentId)} será revogado. O histórico continuará preservado.`:'';});
  readonly label=labelFor;
  private readonly usersById = computed(() => new Map(this.users().map(user => [user.id, user])));
  private readonly registrationsById = computed(() => new Map(this.registrations().map(registration => [registration.id, registration])));
  private readonly subjectsById = computed(() => new Map(this.subjects().map(subject => [subject.id, subject])));

  readonly courseForm=this.fb.nonNullable.group({name:['',Validators.required],code:['',Validators.required],campusId:['',Validators.required]});
  readonly editCourseForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(180)]],
    code: ['', [Validators.required, Validators.pattern(/\S/), Validators.maxLength(60)]],
    campusId: ['', Validators.required]
  });
  readonly subjectForm=this.fb.nonNullable.group({name:['',Validators.required],code:['',Validators.required],courseId:['',Validators.required],workloadHours:[60,[Validators.required,Validators.min(1)]],syllabus:['']});
  readonly assignmentForm=this.fb.nonNullable.group({studentId:['',Validators.required],userId:['',Validators.required],subjectId:[''],assignmentType:['TEACHER',Validators.required]});

  ngOnInit():void{this.load();}
  load():void{
    this.loading.set(true);
    forkJoin({users:this.api.users(),campuses:this.api.campuses(),courses:this.api.adminCourses(),subjects:this.api.adminSubjects(),registrations:this.api.registrations(),assignments:this.api.assignments()}).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next:v=>{this.users.set(v.users);this.campuses.set(v.campuses);this.courses.set(v.courses);this.subjects.set(v.subjects);this.registrations.set(v.registrations);this.assignments.set(v.assignments);this.loading.set(false);},
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
        this.done('Componente curricular criado.');
      },
      error: response => this.fail(response.status, 'criar o componente')
    });
  }

  createAssignment(): void {
    this.assignmentForm.markAllAsTouched();
    if (this.assignmentForm.invalid || this.busy()) return;
    const { userId, studentId, subjectId, assignmentType } = this.assignmentForm.getRawValue();
    this.busy.set(true);
    this.api.createAssignment({
      assignmentType, userId: Number(userId), studentId: Number(studentId), subjectId: subjectId ? Number(subjectId) : null
    }).subscribe({
      next: () => {
        this.assignmentForm.reset({ assignmentType: 'TEACHER' });
        this.done('Vínculo concedido com sucesso.');
      },
      error: response => this.fail(response.status, 'conceder o vínculo')
    });
  }

  confirmRevocation(): void {
    const item = this.pendingRevocation();
    if (!item || this.busy()) return;
    this.pendingRevocation.set(null);
    this.busy.set(true);
    this.api.revokeAssignment(item.id).subscribe({
      next: () => this.done('Vínculo revogado. O histórico foi preservado.'),
      error: response => this.fail(response.status, 'revogar o vínculo')
    });
  }

  openComponents(course: AdminCourse): void {
    this.componentCourse.set(course);
    this.subjectList.reset();
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

  assignmentSubjects() {
    const courseId = this.registrationsById().get(Number(this.assignmentForm.controls.studentId.value))?.courseId;
    return this.subjects().filter(subject => subject.courseId === courseId && subject.active);
  }

  registrationLabel(id: number) { return this.registrationsById().get(id)?.registration ?? 'Matrícula indisponível'; }
  userLabel(id: number) { return this.usersById().get(id)?.name ?? 'Usuário indisponível'; }
  subjectLabel(id: number | null) { return id === null ? 'Geral' : this.subjectsById().get(id)?.name ?? 'Componente indisponível'; }

  private courseError(response: HttpErrorResponse, action: string): string {
    if (response.status === 409) {
      const detail: unknown = response.error?.detail;
      return typeof detail === 'string' && detail.trim() ? detail : `Não foi possível ${action} porque há um conflito com os dados cadastrados.`;
    }
    return errorMessage(response.status, action);
  }

  private focusCourseSearch(): void {
    afterNextRender(() => this.courseSearch()?.nativeElement.focus(), { injector: this.injector });
  }

  private clearUnavailableSelections(): void {
    const course = this.subjectForm.controls.courseId;
    if (course.value && !this.activeCourses().some(item => item.id === Number(course.value))) course.reset();
    const student = this.assignmentForm.controls.studentId;
    if (student.value && !this.assignableRegistrations().some(item => item.id === Number(student.value))) student.reset();
    const subject = this.assignmentForm.controls.subjectId;
    if (subject.value && !this.assignmentSubjects().some(item => item.id === Number(subject.value))) subject.reset();
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
