import { Component, OnInit, signal, inject } from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {FormBuilder,ReactiveFormsModule,Validators} from '@angular/forms';

interface Entry{id:number;kind:string;code:string;label:string;description:string;active:boolean;version:number;}
interface Template{id:string;name:string;documentType:string;defaults:Record<string,unknown>;active:boolean;version:number|null;}
@Component({selector:'app-admin-references',standalone:true,imports:[ReactiveFormsModule],template:`
<h2>Períodos, categorias e modelos</h2>@if(message()){<p role="status">{{message()}}</p>}
<div class="grid two"><form class="card stack" [formGroup]="entryForm" (ngSubmit)="saveEntry()"><h3>{{entryId()?'Editar item':'Novo item de catálogo'}}</h3>
<label>Catálogo<select formControlName="kind"><option value="ACADEMIC_TERM">Período letivo</option><option value="NEED_CATEGORY">Categoria de necessidade</option></select></label><label>Código<input formControlName="code"></label><label>Nome apresentado<input formControlName="label"></label><label>Descrição<textarea formControlName="description"></textarea></label><button [disabled]="entryForm.invalid">Salvar item</button><button class="secondary" type="button" (click)="clearEntry()">Novo item</button></form>
<section class="card"><h3>Itens cadastrados</h3>@for(e of entries();track e.id){<p>{{e.label}} · {{e.code}} · {{e.active?'Ativo':'Inativo'}} <button class="secondary" (click)="editEntry(e)">Editar</button> <button class="secondary" (click)="toggle(e)">{{e.active?'Inativar':'Reativar'}}</button></p>}</section></div>
<form class="card stack" [formGroup]="templateForm" (ngSubmit)="saveTemplate()"><h3>{{templateId()?'Editar modelo':'Novo modelo de documento'}}</h3><p>Os valores deste modelo preenchem novos rascunhos. A revisão humana continua obrigatória.</p><label>Nome do modelo<input formControlName="name"></label><label>Documento<select formControlName="documentType">@for(type of types;track type){<option [value]="type">{{type}}</option>}</select></label><label>Valores iniciais por campo (JSON)<textarea rows="8" formControlName="defaults" spellcheck="false"></textarea></label><label>Situação<select formControlName="active"><option [ngValue]="true">Ativo</option><option [ngValue]="false">Inativo</option></select></label><button [disabled]="templateForm.invalid">Salvar versão do modelo</button><button type="button" class="secondary" (click)="clearTemplate()">Novo modelo</button></form>
<section class="card"><h3>Modelos cadastrados</h3>@for(t of templates();track t.id){<p>{{t.name}} · {{t.documentType}} · versão {{t.version}} · {{t.active?'Ativo':'Inativo'}} <button class="secondary" (click)="editTemplate(t)">Editar modelo</button></p>}</section>
`,styles:[`.card{margin-block:1rem}`]})
export class AdminReferencesComponent implements OnInit{
  private http = inject(HttpClient);
  private fb = inject(FormBuilder);

  readonly entries=signal<Entry[]>([]);readonly templates=signal<Template[]>([]);readonly message=signal('');readonly entryId=signal<number|null>(null);readonly templateId=signal<string|null>(null);private templateVersion:number|null=null;
  readonly types=['PEI','INITIAL_SCREENING','WELCOMING','CASE_STUDY','PEDAGOGICAL_GUIDANCE','ACTION_PLAN','TEACHER_FEEDBACK','TUTOR_OBSERVATION','SUPPORT_REFUSAL','SUPPORT_REQUEST'];
  readonly entryForm=this.fb.nonNullable.group({kind:['ACADEMIC_TERM',Validators.required],code:['',Validators.required],label:['',Validators.required],description:['']});
  readonly templateForm=this.fb.nonNullable.group({name:['',Validators.required],documentType:['PEI',Validators.required],defaults:['{}',Validators.required],active:[true]});
  ngOnInit(){this.load();}
  load(){this.http.get<Entry[]>('/api/v1/admin/references').subscribe({next:v=>this.entries.set(v),error:()=>this.fail()});this.http.get<Template[]>('/api/v1/admin/templates').subscribe({next:v=>this.templates.set(v),error:()=>this.fail()});}
  saveEntry(){if(this.entryForm.invalid)return;const id=this.entryId();const call=id?this.http.put(`/api/v1/admin/references/${id}`,this.entryForm.getRawValue()):this.http.post('/api/v1/admin/references',this.entryForm.getRawValue());call.subscribe({next:()=>{this.clearEntry();this.done('Item salvo.');},error:()=>this.fail()});}
  editEntry(e:Entry){this.entryId.set(e.id);this.entryForm.patchValue(e);}
  clearEntry(){this.entryId.set(null);this.entryForm.reset({kind:'ACADEMIC_TERM'});}
  toggle(e:Entry){this.http.patch(`/api/v1/admin/references/${e.id}/active`,{active:!e.active}).subscribe({next:()=>this.done('Situação atualizada.'),error:()=>this.fail()});}
  saveTemplate(){if(this.templateForm.invalid)return;const v=this.templateForm.getRawValue();let defaults:unknown;try{defaults=JSON.parse(v.defaults);}catch{this.message.set('O conteúdo deve ser um objeto JSON válido.');return;}if(!defaults||Array.isArray(defaults)||typeof defaults!=='object'){this.message.set('Informe um objeto com nomes de campos e valores iniciais.');return;}const data={...v,defaults,version:this.templateVersion};const id=this.templateId();const call=id?this.http.put(`/api/v1/admin/templates/${id}`,data):this.http.post('/api/v1/admin/templates',data);call.subscribe({next:()=>{this.clearTemplate();this.done('Modelo versionado.');},error:()=>this.fail()});}
  editTemplate(t:Template){this.templateId.set(t.id);this.templateVersion=t.version;this.templateForm.patchValue({...t,defaults:JSON.stringify(t.defaults,null,2)});}
  clearTemplate(){this.templateId.set(null);this.templateVersion=null;this.templateForm.reset({documentType:'PEI',defaults:'{}',active:true});}
  private done(value:string){this.message.set(value);this.load();}private fail(){this.message.set('Não foi possível salvar. Confira os campos ou recarregue a versão atual.');}
}
