import { Component, OnInit, signal, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { Campus, Course, Subject, UserView } from '../core/models';
import { labelFor } from '../core/presentation';

@Component({selector:'app-admin-academic',standalone:true,imports:[ReactiveFormsModule],template:`
  <header class="module-head"><span class="eyebrow">Organização acadêmica</span><h2>Estrutura acadêmica e vínculos</h2><p>Cadastre cursos e componentes e defina quem acompanha cada estudante.</p></header>
  @if(message()){<p role="status">{{message()}}</p>}
  <div class="grid two">
    <form class="card stack" [formGroup]="courseForm" (ngSubmit)="createCourse()"><h3>Novo curso</h3><label>Campus<select formControlName="campusId"><option value="">Selecione</option>@for(c of campuses();track c.id){<option [value]="c.id">{{c.name}}</option>}</select></label><label>Nome do curso<input formControlName="name"></label><label>Código do curso<input formControlName="code"></label><button [disabled]="courseForm.invalid">Criar curso</button></form>
    <form class="card stack" [formGroup]="subjectForm" (ngSubmit)="createSubject()"><h3>Novo componente</h3><label>Curso<select formControlName="courseId"><option value="">Selecione</option>@for(c of courses();track c.id){<option [value]="c.id">{{c.name}} · {{c.campus}}</option>}</select></label><label>Nome do componente<input formControlName="name"></label><label>Código do componente<input formControlName="code"></label><label>Carga horária<input type="number" min="1" formControlName="workloadHours"></label><label>Ementa<textarea formControlName="syllabus"></textarea></label><button [disabled]="subjectForm.invalid">Criar componente</button></form>
    <form class="card stack" [formGroup]="assignmentForm" (ngSubmit)="createAssignment()"><h3>Conceder vínculo</h3>
      <label>Estudante (matrícula)<select formControlName="studentId"><option value="">Selecione</option>@for(s of registrations();track s.id){<option [value]="s.id">{{s.registration}}</option>}</select></label>
      <label>Usuário<select formControlName="userId"><option value="">Selecione</option>@for(u of users();track u.id){@if(u.active){<option [value]="u.id">{{u.name}}</option>}}</select></label>
      <label>Tipo de vínculo<select formControlName="assignmentType"><option value="TEACHER">Professor</option><option value="TUTOR">Monitor/tutor</option><option value="COORDINATOR">Coordenação/supervisão</option><option value="NAPNE">NAPNE</option></select></label>
      <label>Componente do vínculo<select formControlName="subjectId"><option value="">Sem componente específico</option>@for(s of assignmentSubjects();track s.id){<option [value]="s.id">{{s.name}}</option>}</select></label><button [disabled]="assignmentForm.invalid">Conceder vínculo</button>
    </form>
    <section class="card"><h3>Estrutura cadastrada</h3>@for(c of courses();track c.id){<h4>{{c.name}} · {{c.campus}}</h4><ul>@for(s of subjects();track s.id){@if(s.courseId===c.id){<li>{{s.name}} · {{s.workloadHours}} horas</li>}}</ul>}</section>
  </div>
  <section class="card assignments"><div class="section-header"><div><h3>Vínculos registrados</h3><p>O histórico permanece disponível após a revogação.</p></div></div><div class="table-wrap"><table class="mobile-cards"><thead><tr><th>Matrícula</th><th>Usuário</th><th>Tipo</th><th>Situação</th><th>Ação</th></tr></thead><tbody>@for(a of assignments();track a.id){<tr><td data-label="Matrícula">{{registrationLabel(a.studentId)}}</td><td data-label="Usuário">{{userLabel(a.userId)}}</td><td data-label="Tipo">{{label(a.assignmentType)}}</td><td data-label="Situação"><span [class]="a.active?'badge badge--success':'badge'">{{a.active?'Ativo':'Revogado'}}</span></td><td>@if(a.active){<button class="secondary compact" (click)="revoke(a.id)">Revogar</button>}</td></tr>}</tbody></table></div></section>
`,styles:[`.module-head{margin-bottom:1rem}.module-head h2{margin:.15rem 0}.module-head p,.section-header p{color:var(--ink-600);margin:0}.grid{align-items:start}.card{margin-block:1rem}.card h3{margin-bottom:.8rem}.assignments{padding:0;overflow:hidden}.assignments .section-header{padding:1.25rem 1.5rem;margin:0}.assignments .table-wrap{border-radius:0;border:0;border-top:1px solid var(--border)}`]})
export class AdminAcademicComponent implements OnInit {
  private api = inject(ApiService);
  private fb = inject(FormBuilder);

  readonly message=signal('');readonly users=signal<UserView[]>([]);readonly campuses=signal<Campus[]>([]);readonly courses=signal<Course[]>([]);readonly subjects=signal<Subject[]>([]);
  readonly registrations=signal<{id:number,registration:string,campusId:number,courseId:number}[]>([]);
  readonly assignments=signal<{id:number,studentId:number,userId:number,subjectId:number|null,assignmentType:string,active:boolean}[]>([]);
  readonly label=labelFor;
  readonly courseForm=this.fb.nonNullable.group({name:['',Validators.required],code:['',Validators.required],campusId:['',Validators.required]});
  readonly subjectForm=this.fb.nonNullable.group({name:['',Validators.required],code:['',Validators.required],courseId:['',Validators.required],workloadHours:[60,[Validators.required,Validators.min(1)]],syllabus:['']});
  readonly assignmentForm=this.fb.nonNullable.group({studentId:['',Validators.required],userId:['',Validators.required],subjectId:[''],assignmentType:['TEACHER',Validators.required]});
  ngOnInit():void{this.load();}
  load():void{forkJoin({users:this.api.users(),campuses:this.api.campuses(),courses:this.api.adminCourses(),subjects:this.api.adminSubjects(),registrations:this.api.registrations(),assignments:this.api.assignments()}).subscribe({next:v=>{this.users.set(v.users);this.campuses.set(v.campuses);this.courses.set(v.courses);this.subjects.set(v.subjects);this.registrations.set(v.registrations);this.assignments.set(v.assignments);},error:()=>this.fail()});}
  createCourse():void{if(this.courseForm.invalid)return;const v=this.courseForm.getRawValue();this.api.createCourse({...v,campusId:Number(v.campusId)}).subscribe({next:()=>{this.courseForm.reset();this.done('Curso criado.');},error:()=>this.fail()});}
  createSubject():void{if(this.subjectForm.invalid)return;const v=this.subjectForm.getRawValue();this.api.createSubject({...v,courseId:Number(v.courseId)}).subscribe({next:()=>{this.subjectForm.reset({workloadHours:60});this.done('Componente criado.');},error:()=>this.fail()});}
  createAssignment():void{if(this.assignmentForm.invalid)return;const v=this.assignmentForm.getRawValue();this.api.createAssignment({...v,userId:Number(v.userId),studentId:Number(v.studentId),subjectId:v.subjectId?Number(v.subjectId):null}).subscribe({next:()=>{this.assignmentForm.reset({assignmentType:'TEACHER'});this.done('Vínculo concedido.');},error:()=>this.fail()});}
  revoke(id:number):void{this.api.revokeAssignment(id).subscribe({next:()=>this.done('Vínculo revogado; histórico preservado.'),error:()=>this.fail()});}
  assignmentSubjects(){const courseId=this.registrations().find(s=>s.id===Number(this.assignmentForm.controls.studentId.value))?.courseId;return this.subjects().filter(s=>s.courseId===courseId);}
  registrationLabel(id:number){return this.registrations().find(s=>s.id===id)?.registration??'Matrícula indisponível';}
  userLabel(id:number){return this.users().find(u=>u.id===id)?.name??'Usuário indisponível';}
  private done(value:string):void{this.message.set(value);this.load();}
  private fail():void{this.message.set('Não foi possível concluir. Confira o campus, o perfil e os vínculos informados.');}
}
