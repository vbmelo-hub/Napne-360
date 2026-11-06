import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Campus, Course, Subject, UserView } from '../core/models';
import { errorMessage, labelFor } from '../core/presentation';
import { ToastService } from '../core/toast.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';

interface AssignmentView {
  id: number;
  studentId: number;
  userId: number;
  subjectId: number | null;
  assignmentType: string;
  active: boolean;
}

@Component({selector:'app-admin-academic',standalone:true,imports:[ReactiveFormsModule,ConfirmDialogComponent],template:`
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
        <label class="required">Curso<select formControlName="courseId"><option value="">Selecione</option>@for(c of courses();track c.id){<option [value]="c.id">{{c.name}} · {{c.campus}}</option>}</select></label>
        <div class="grid two"><label class="required">Nome do componente<input formControlName="name"></label><label class="required">Código<input formControlName="code"></label></div>
        <label class="required">Carga horária<input type="number" min="1" formControlName="workloadHours"></label>
        <label>Ementa<textarea formControlName="syllabus"></textarea></label>
        <button [disabled]="subjectForm.invalid||busy()">@if(busy()){<span class="spinner"></span>}Criar componente</button>
      </form>
    </div>

    <section class="card structure-card">
      <div class="section-header"><div><h3>Estrutura cadastrada</h3><p>Cursos e componentes disponíveis para vínculos e PEIs.</p></div><span class="badge badge--info">{{courses().length}} curso(s)</span></div>
      @if(courses().length===0){<div class="empty-state"><span class="empty-state-mark">0</span><h3>Nenhum curso cadastrado</h3><p>Cadastre o primeiro curso para organizar os componentes curriculares.</p></div>}
      <div class="course-grid">@for(c of courses();track c.id){<article class="course-panel"><div><span class="eyebrow">{{c.code}}</span><h4>{{c.name}}</h4><p>{{c.campus}}</p></div>@if(courseSubjects(c.id).length===0){<span class="meta">Nenhum componente cadastrado.</span>}@else{<ul>@for(s of courseSubjects(c.id);track s.id){<li><strong>{{s.name}}</strong><span>{{s.code}} · {{s.workloadHours}} h</span></li>}</ul>}</article>}</div>
    </section>

    <form class="card stack assignment-form" [formGroup]="assignmentForm" (ngSubmit)="createAssignment()">
      <div class="section-header"><div><h3>Conceder vínculo de acompanhamento</h3><p>Defina a pessoa autorizada, o papel no acompanhamento e, quando aplicável, o componente.</p></div></div>
      <div class="grid two">
        <label class="required">Estudante (matrícula)<select formControlName="studentId" (change)="assignmentForm.controls.subjectId.setValue('')"><option value="">Selecione</option>@for(s of registrations();track s.id){<option [value]="s.id">{{s.registration}}</option>}</select></label>
        <label class="required">Usuário<select formControlName="userId"><option value="">Selecione</option>@for(u of users();track u.id){@if(u.active){<option [value]="u.id">{{u.name}} · {{u.email}}</option>}}</select></label>
        <label class="required">Tipo de vínculo<select formControlName="assignmentType"><option value="TEACHER">Professor</option><option value="TUTOR">Monitor/tutor</option><option value="COORDINATOR">Coordenação/supervisão</option><option value="NAPNE">NAPNE</option></select></label>
        <label>Componente do vínculo<select formControlName="subjectId"><option value="">Sem componente específico</option>@for(s of assignmentSubjects();track s.id){<option [value]="s.id">{{s.name}}</option>}</select><span class="field-hint">A lista considera o curso do estudante selecionado.</span></label>
      </div>
      <div><button [disabled]="assignmentForm.invalid||busy()">@if(busy()){<span class="spinner"></span>}Conceder vínculo</button></div>
    </form>

    <section class="card assignments">
      <div class="section-header"><div><h3>Vínculos registrados</h3><p>O histórico permanece disponível mesmo após a revogação.</p></div><span class="badge">{{assignments().length}} registro(s)</span></div>
      @if(assignments().length===0){<div class="empty-state"><span class="empty-state-mark">0</span><h3>Nenhum vínculo registrado</h3><p>Use o formulário acima para conceder acesso ao acompanhamento de um estudante.</p></div>}@else{
        <div class="table-wrap"><table class="mobile-cards"><thead><tr><th>Matrícula</th><th>Usuário</th><th>Tipo</th><th>Componente</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>@for(a of assignments();track a.id){<tr><td data-label="Matrícula">{{registrationLabel(a.studentId)}}</td><td data-label="Usuário">{{userLabel(a.userId)}}</td><td data-label="Tipo">{{label(a.assignmentType)}}</td><td data-label="Componente">{{subjectLabel(a.subjectId)}}</td><td data-label="Situação"><span [class]="a.active?'badge badge--success':'badge'">{{a.active?'Ativo':'Revogado'}}</span></td><td>@if(a.active){<button type="button" class="secondary compact" (click)="pendingRevocation.set(a)">Revogar</button>}</td></tr>}</tbody></table></div>
      }
    </section>
  }

  <app-confirm-dialog [open]="pendingRevocation()!==null" title="Revogar este vínculo?" [description]="revocationDescription()" confirmLabel="Revogar vínculo" [danger]="true" (confirmed)="confirmRevocation()" (cancelled)="pendingRevocation.set(null)" />
`,styles:[`
  .module-head{margin-bottom:1rem}.module-head h2{margin:.15rem 0}.module-head p,.section-header p{color:var(--ink-600);margin:0}.admin-academic-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;align-items:start}.structure-card,.assignment-form,.assignments{margin-top:1rem}.course-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.course-panel{border:1px solid var(--border);border-radius:var(--radius-md);padding:1rem;background:var(--surface-soft)}.course-panel h4{margin:.15rem 0}.course-panel p{color:var(--ink-600);margin:0 0 .75rem}.course-panel ul{list-style:none;padding:0;margin:0;display:grid;gap:.4rem}.course-panel li{display:flex;justify-content:space-between;gap:1rem;border-top:1px solid var(--border);padding-top:.5rem}.course-panel li span{color:var(--ink-600);white-space:nowrap}.assignments{padding:0;overflow:hidden}.assignments .section-header{padding:1.25rem 1.5rem;margin:0}.assignments .table-wrap{border-radius:0;border:0;border-top:1px solid var(--border)}@media(max-width:850px){.admin-academic-grid,.course-grid{grid-template-columns:1fr}}` ]})
export class AdminAcademicComponent implements OnInit {
  private readonly api=inject(ApiService);
  private readonly fb=inject(FormBuilder);
  private readonly toast=inject(ToastService);

  readonly users=signal<UserView[]>([]);
  readonly campuses=signal<Campus[]>([]);
  readonly courses=signal<Course[]>([]);
  readonly subjects=signal<Subject[]>([]);
  readonly registrations=signal<{id:number,registration:string,campusId:number,courseId:number}[]>([]);
  readonly assignments=signal<AssignmentView[]>([]);
  readonly loading=signal(true);
  readonly busy=signal(false);
  readonly pendingRevocation=signal<AssignmentView|null>(null);
  readonly revocationDescription=computed(()=>{const item=this.pendingRevocation();return item?`O vínculo de ${this.userLabel(item.userId)} com a matrícula ${this.registrationLabel(item.studentId)} será revogado. O histórico continuará preservado.`:'';});
  readonly label=labelFor;

  readonly courseForm=this.fb.nonNullable.group({name:['',Validators.required],code:['',Validators.required],campusId:['',Validators.required]});
  readonly subjectForm=this.fb.nonNullable.group({name:['',Validators.required],code:['',Validators.required],courseId:['',Validators.required],workloadHours:[60,[Validators.required,Validators.min(1)]],syllabus:['']});
  readonly assignmentForm=this.fb.nonNullable.group({studentId:['',Validators.required],userId:['',Validators.required],subjectId:[''],assignmentType:['TEACHER',Validators.required]});

  ngOnInit():void{this.load();}
  load():void{
    this.loading.set(true);
    forkJoin({users:this.api.users(),campuses:this.api.campuses(),courses:this.api.adminCourses(),subjects:this.api.adminSubjects(),registrations:this.api.registrations(),assignments:this.api.assignments()}).subscribe({
      next:v=>{this.users.set(v.users);this.campuses.set(v.campuses);this.courses.set(v.courses);this.subjects.set(v.subjects);this.registrations.set(v.registrations);this.assignments.set(v.assignments);this.loading.set(false);},
      error:e=>{this.loading.set(false);this.toast.show(errorMessage(e.status,'carregar a estrutura acadêmica'),'error');}
    });
  }
  createCourse():void{this.courseForm.markAllAsTouched();if(this.courseForm.invalid)return;const v=this.courseForm.getRawValue();this.busy.set(true);this.api.createCourse({...v,campusId:Number(v.campusId)}).subscribe({next:()=>{this.courseForm.reset();this.done('Curso criado com sucesso.');},error:e=>this.fail(e.status,'criar o curso')});}
  createSubject():void{this.subjectForm.markAllAsTouched();if(this.subjectForm.invalid)return;const v=this.subjectForm.getRawValue();this.busy.set(true);this.api.createSubject({...v,courseId:Number(v.courseId)}).subscribe({next:()=>{this.subjectForm.reset({workloadHours:60});this.done('Componente curricular criado.');},error:e=>this.fail(e.status,'criar o componente')});}
  createAssignment():void{this.assignmentForm.markAllAsTouched();if(this.assignmentForm.invalid)return;const v=this.assignmentForm.getRawValue();this.busy.set(true);this.api.createAssignment({...v,userId:Number(v.userId),studentId:Number(v.studentId),subjectId:v.subjectId?Number(v.subjectId):null}).subscribe({next:()=>{this.assignmentForm.reset({assignmentType:'TEACHER'});this.done('Vínculo concedido com sucesso.');},error:e=>this.fail(e.status,'conceder o vínculo')});}
  confirmRevocation():void{const item=this.pendingRevocation();if(!item)return;this.pendingRevocation.set(null);this.busy.set(true);this.api.revokeAssignment(item.id).subscribe({next:()=>this.done('Vínculo revogado; o histórico foi preservado.'),error:e=>this.fail(e.status,'revogar o vínculo')});}
  assignmentSubjects(){const courseId=this.registrations().find(s=>s.id===Number(this.assignmentForm.controls.studentId.value))?.courseId;return this.subjects().filter(s=>s.courseId===courseId);}
  courseSubjects(courseId:number){return this.subjects().filter(s=>s.courseId===courseId);}
  registrationLabel(id:number){return this.registrations().find(s=>s.id===id)?.registration??'Matrícula indisponível';}
  userLabel(id:number){return this.users().find(u=>u.id===id)?.name??'Usuário indisponível';}
  subjectLabel(id:number|null){return id===null?'Geral':this.subjects().find(s=>s.id===id)?.name??'Componente indisponível';}
  private done(message:string):void{this.busy.set(false);this.toast.show(message,'success');this.load();}
  private fail(status:number,action:string):void{this.busy.set(false);this.toast.show(errorMessage(status,action),'error');}
}
