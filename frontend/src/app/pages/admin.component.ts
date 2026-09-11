import { Component, OnInit, signal, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { Campus, UserView } from '../core/models';
import { AdminAcademicComponent } from './admin-academic.component';
import { AdminReferencesComponent } from './admin-references.component';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, AdminAcademicComponent, AdminReferencesComponent],
  template: `
    <header><span class="eyebrow">Configuração</span><h1>Administração técnica</h1><p class="muted">Contas e estrutura institucional. Este perfil não recebe acesso automático a dossiês.</p></header>
    <div class="grid two layout">
      <form class="card stack" [formGroup]="userForm" (ngSubmit)="createUser()"><h2>Nova conta</h2>
        <label>Nome<input formControlName="name"></label><label>E-mail<input type="email" formControlName="email"></label><label>Senha temporária<input type="password" formControlName="password"></label>
        <label>Campus<select formControlName="campusId"><option value="">Sem campus (admin técnico)</option>@for(c of campuses();track c.id){<option [value]="c.id">{{c.name}}</option>}</select></label>
        <label>Perfil<select formControlName="role">@for(r of roles;track r.value){<option [value]="r.value">{{r.label}}</option>}</select></label>
        <button [disabled]="userForm.invalid">Criar conta</button>
      </form>
      <form class="card stack" [formGroup]="campusForm" (ngSubmit)="createCampus()"><h2>Novo campus</h2><label>Nome<input formControlName="name"></label><label>Código<input formControlName="code"></label><button [disabled]="campusForm.invalid">Criar campus</button></form>
    </div>
    @if(message()){<div [class]="messageClass()" role="status">{{message()}}</div>}
    <form class="card stack" [formGroup]="permissionForm" (ngSubmit)="changeRoles()"><h2>Perfis e recuperação de conta</h2><label>Conta<select formControlName="userId"><option value="">Selecione</option>@for(u of users();track u.id){<option [value]="u.id">{{u.name}} · {{u.email}}</option>}</select></label><label>Perfis autorizados<select multiple formControlName="roles">@for(r of roles;track r.value){<option [value]="r.value">{{r.label}}</option>}</select></label><button [disabled]="permissionForm.invalid">Salvar perfis e revogar sessões</button><label>Nova senha temporária<input type="password" autocomplete="new-password" [formControl]="resetSecret"></label><button type="button" class="secondary" [disabled]="!permissionForm.controls.userId.value || resetSecret.invalid" (click)="resetPassword()">Redefinir senha</button></form>
    <section class="card"><h2>Ativação de contas</h2>@for(u of users();track u.id){<p>{{u.name}} · {{u.active?'Ativa':'Inativa'}} <button class="secondary" (click)="toggleUser(u)">{{u.active?'Inativar':'Reativar'}}</button></p>}</section>
    <section class="card users"><h2>Contas cadastradas</h2><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfis</th><th>Situação</th></tr></thead><tbody>@for(u of users();track u.id){<tr><td>{{u.name}}</td><td>{{u.email}}</td><td>{{u.roles.join(', ')}}</td><td><span class="badge">{{u.active?'ATIVA':'INATIVA'}}</span></td></tr>}</tbody></table></section>
    <app-admin-academic />
    <app-admin-references />
  `,
  styles:[`header{margin-bottom:1.5rem}h1{margin:.2rem 0;font-size:2.5rem}.eyebrow{color:var(--primary);font-weight:800;text-transform:uppercase;letter-spacing:.06em}.layout{align-items:start}.users{margin-top:1rem}`]
})
export class AdminComponent implements OnInit {
  private api = inject(ApiService);
  private fb = inject(FormBuilder);

  readonly roles=[{value:'ADMIN',label:'Administrador técnico'},{value:'NAPNE',label:'Equipe NAPNE'},{value:'COTEP',label:'COTEP'},{value:'COURSE_COORDINATOR',label:'Coordenação de curso'},{value:'TEACHER',label:'Professor'},{value:'TUTOR',label:'Monitor/Tutor'},{value:'MANAGEMENT',label:'Gestão'}];
  readonly users=signal<UserView[]>([]);readonly campuses=signal<Campus[]>([]);readonly message=signal('');readonly messageClass=signal('success');
  readonly userForm=this.fb.nonNullable.group({name:['',Validators.required],email:['',[Validators.required,Validators.email]],password:['',[Validators.required,Validators.minLength(12),Validators.maxLength(72)]],campusId:[''],role:['NAPNE',Validators.required]});
  readonly permissionForm=this.fb.nonNullable.group({userId:['',Validators.required],roles:[[] as string[],Validators.required]});
  readonly resetSecret=this.fb.nonNullable.control('',[Validators.required,Validators.minLength(12),Validators.maxLength(72)]);
  readonly campusForm=this.fb.nonNullable.group({name:['',Validators.required],code:['',Validators.required]});
  ngOnInit():void{this.load();}
  changeRoles():void{if(this.permissionForm.invalid)return;const v=this.permissionForm.getRawValue();this.api.setUserRoles(Number(v.userId),v.roles).subscribe({next:()=>{this.ok('Perfis atualizados e sessões revogadas.');this.load();},error:()=>this.fail()});}
  resetPassword():void{if(this.resetSecret.invalid)return;this.api.resetPassword(Number(this.permissionForm.controls.userId.value),this.resetSecret.value).subscribe({next:()=>{this.resetSecret.reset();this.ok('Senha redefinida e sessões revogadas.');},error:()=>this.fail()});}
  toggleUser(user:UserView):void{this.api.setUserActive(user.id,!user.active).subscribe({next:()=>{this.ok('Situação atualizada.');this.load();},error:()=>this.fail()});}
  load():void{this.api.users().subscribe(v=>this.users.set(v));this.api.campuses().subscribe(v=>this.campuses.set(v));}
  createUser():void{if(this.userForm.invalid)return;const v=this.userForm.getRawValue();this.api.createUser({name:v.name,email:v.email,password:v.password,campusId:v.campusId?Number(v.campusId):null,roles:[v.role]}).subscribe({next:()=>{this.userForm.reset({role:'NAPNE'});this.ok('Conta criada.');this.load();},error:()=>this.fail()});}
  createCampus():void{if(this.campusForm.invalid)return;this.api.createCampus(this.campusForm.getRawValue()).subscribe({next:()=>{this.campusForm.reset();this.ok('Campus criado.');this.load();},error:()=>this.fail()});}
  private ok(v:string):void{this.messageClass.set('success');this.message.set(v)}private fail():void{this.messageClass.set('error');this.message.set('Não foi possível concluir a operação.')}
}
