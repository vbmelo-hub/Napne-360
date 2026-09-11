import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { DocumentTemplateView, ReferenceEntryAdmin } from '../core/models';
import { errorMessage, labelFor } from '../core/presentation';
import { ToastService } from '../core/toast.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';

@Component({selector:'app-admin-references',standalone:true,imports:[ReactiveFormsModule,ConfirmDialogComponent],template:`
  <header class="module-head"><span class="eyebrow">Cadastros de referência</span><h2>Períodos, categorias e modelos</h2><p>Padronize opções usadas nos registros e nos novos rascunhos sem expor códigos técnicos aos usuários finais.</p></header>

  @if(loading()){
    <div class="loading-grid" aria-label="Carregando cadastros de referência"><span class="skeleton skeleton-card"></span><span class="skeleton skeleton-card"></span></div>
  } @else {
    <div class="reference-grid">
      <form class="card stack" [formGroup]="entryForm" (ngSubmit)="saveEntry()">
        <div class="section-header"><div><h3>{{entryId()?'Editar item':'Novo item de catálogo'}}</h3><p>Use códigos estáveis e rótulos claros em português.</p></div>@if(entryId()){<button type="button" class="secondary compact" (click)="clearEntry()">Cancelar edição</button>}</div>
        <label class="required">Catálogo<select formControlName="kind"><option value="ACADEMIC_TERM">Período letivo</option><option value="NEED_CATEGORY">Categoria de necessidade</option></select></label>
        <div class="grid two"><label class="required">Código<input formControlName="code"><span class="field-hint">Identificador interno estável.</span></label><label class="required">Nome apresentado<input formControlName="label"><span class="field-hint">Texto que será mostrado na interface.</span></label></div>
        <label>Descrição<textarea formControlName="description"></textarea></label>
        <button [disabled]="entryForm.invalid||busy()">@if(busy()){<span class="spinner"></span>}{{entryId()?'Salvar alterações':'Criar item'}}</button>
      </form>

      <section class="card catalog-card">
        <div class="section-header"><div><h3>Itens cadastrados</h3><p>Ative, inative ou revise os itens utilizados pela plataforma.</p></div><span class="badge">{{entries().length}} item(ns)</span></div>
        @if(entries().length===0){<div class="empty-state"><span class="empty-state-mark">0</span><h3>Nenhum item cadastrado</h3><p>Os períodos letivos e categorias aparecerão aqui.</p></div>}@else{
          <div class="table-wrap"><table class="mobile-cards"><thead><tr><th>Item</th><th>Catálogo</th><th>Código</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>@for(e of entries();track e.id){<tr><td data-label="Item"><strong>{{e.label}}</strong>@if(e.description){<small>{{e.description}}</small>}</td><td data-label="Catálogo">{{kindLabel(e.kind)}}</td><td data-label="Código"><code>{{e.code}}</code></td><td data-label="Situação"><span [class]="e.active?'badge badge--success':'badge'">{{e.active?'Ativo':'Inativo'}}</span></td><td><div class="row"><button type="button" class="secondary compact" (click)="editEntry(e)">Editar</button><button type="button" class="secondary compact" (click)="toggleCandidate.set(e)">{{e.active?'Inativar':'Reativar'}}</button></div></td></tr>}</tbody></table></div>
        }
      </section>
    </div>

    <form class="card stack template-form" [formGroup]="templateForm" (ngSubmit)="saveTemplate()">
      <div class="section-header"><div><span class="eyebrow">Modelos versionados</span><h3>{{templateId()?'Editar modelo':'Novo modelo de documento'}}</h3><p>Os valores do modelo preenchem novos rascunhos; a revisão humana permanece obrigatória.</p></div>@if(templateId()){<button type="button" class="secondary compact" (click)="clearTemplate()">Cancelar edição</button>}</div>
      <div class="grid two"><label class="required">Nome do modelo<input formControlName="name"></label><label class="required">Documento<select formControlName="documentType">@for(type of types;track type){<option [value]="type">{{label(type)}}</option>}</select></label></div>
      <div class="notice"><strong>Configuração avançada</strong><p>Informe apenas um objeto JSON com os campos e valores iniciais do rascunho. Essa configuração não aprova nem finaliza documentos.</p></div>
      <label class="required">Valores iniciais por campo (JSON)<textarea rows="10" formControlName="defaults" spellcheck="false" aria-describedby="template-json-help"></textarea><span id="template-json-help" class="field-hint">Exemplo: <code>&#123;"generalObjectives":"..."&#125;</code></span></label>
      @if(jsonError()){<div class="error" role="alert">{{jsonError()}}</div>}
      <label>Situação<select formControlName="active"><option [ngValue]="true">Ativo</option><option [ngValue]="false">Inativo</option></select></label>
      <div><button [disabled]="templateForm.invalid||busy()">@if(busy()){<span class="spinner"></span>}Salvar versão do modelo</button></div>
    </form>

    <section class="card templates-card">
      <div class="section-header"><div><h3>Modelos cadastrados</h3><p>Versões disponíveis para criação de novos rascunhos.</p></div><span class="badge badge--info">{{templates().length}} modelo(s)</span></div>
      @if(templates().length===0){<div class="empty-state"><span class="empty-state-mark">0</span><h3>Nenhum modelo cadastrado</h3><p>Crie um modelo quando houver valores iniciais institucionais a reutilizar.</p></div>}@else{
        <div class="table-wrap"><table class="mobile-cards"><thead><tr><th>Modelo</th><th>Documento</th><th>Versão</th><th>Campos iniciais</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>@for(t of templates();track t.id){<tr><td data-label="Modelo"><strong>{{t.name}}</strong></td><td data-label="Documento">{{label(t.documentType)}}</td><td data-label="Versão">{{t.version??'—'}}</td><td data-label="Campos iniciais">{{fieldCount(t.defaults)}}</td><td data-label="Situação"><span [class]="t.active?'badge badge--success':'badge'">{{t.active?'Ativo':'Inativo'}}</span></td><td><button type="button" class="secondary compact" (click)="editTemplate(t)">Editar modelo</button></td></tr>}</tbody></table></div>
      }
    </section>
  }

  <app-confirm-dialog [open]="toggleCandidate()!==null" [title]="toggleCandidate()?.active?'Inativar este item?':'Reativar este item?'" [description]="toggleDescription()" [confirmLabel]="toggleCandidate()?.active?'Inativar item':'Reativar item'" [danger]="toggleCandidate()?.active??false" (confirmed)="confirmToggle()" (cancelled)="toggleCandidate.set(null)" />
`,styles:[`
  .module-head{margin-bottom:1rem}.module-head h2{margin:.15rem 0}.module-head p,.section-header p{color:var(--ink-600);margin:0}.reference-grid{display:grid;grid-template-columns:minmax(18rem,.8fr) minmax(0,1.2fr);gap:1rem;align-items:start}.catalog-card{padding:0;overflow:hidden}.catalog-card .section-header{padding:1.25rem 1.5rem;margin:0}.catalog-card .table-wrap{border:0;border-top:1px solid var(--border);border-radius:0}.catalog-card td strong,.catalog-card td small{display:block}.catalog-card td small{color:var(--ink-600);margin-top:.2rem}.template-form,.templates-card{margin-top:1rem}.template-form .notice p{margin:.2rem 0 0;color:var(--ink-700)}.templates-card{padding:0;overflow:hidden}.templates-card .section-header{padding:1.25rem 1.5rem;margin:0}.templates-card .table-wrap{border:0;border-top:1px solid var(--border);border-radius:0}code{font-size:.82em;overflow-wrap:anywhere}@media(max-width:950px){.reference-grid{grid-template-columns:1fr}}` ]})
export class AdminReferencesComponent implements OnInit {
  private readonly api=inject(ApiService);
  private readonly fb=inject(FormBuilder);
  private readonly toast=inject(ToastService);

  readonly entries=signal<ReferenceEntryAdmin[]>([]);
  readonly templates=signal<DocumentTemplateView[]>([]);
  readonly loading=signal(true);
  readonly busy=signal(false);
  readonly jsonError=signal('');
  readonly entryId=signal<number|null>(null);
  readonly templateId=signal<string|null>(null);
  readonly toggleCandidate=signal<ReferenceEntryAdmin|null>(null);
  readonly toggleDescription=computed(()=>{const item=this.toggleCandidate();return item?`${item.label} ficará ${item.active?'indisponível':'disponível'} para novos usos. Registros históricos não serão removidos.`:'';});
  private templateVersion:number|null=null;
  readonly label=labelFor;
  readonly types=['PEI','INITIAL_SCREENING','WELCOMING','CASE_STUDY','PEDAGOGICAL_GUIDANCE','ACTION_PLAN','TEACHER_FEEDBACK','TUTOR_OBSERVATION','SUPPORT_REFUSAL','SUPPORT_REQUEST'];
  readonly entryForm=this.fb.nonNullable.group({kind:['ACADEMIC_TERM',Validators.required],code:['',Validators.required],label:['',Validators.required],description:['']});
  readonly templateForm=this.fb.nonNullable.group({name:['',Validators.required],documentType:['PEI',Validators.required],defaults:['{}',Validators.required],active:[true]});

  ngOnInit(){this.load();}
  load(){this.loading.set(true);forkJoin({entries:this.api.adminReferences(),templates:this.api.adminTemplates()}).subscribe({next:v=>{this.entries.set(v.entries);this.templates.set(v.templates);this.loading.set(false);},error:e=>{this.loading.set(false);this.toast.show(errorMessage(e.status,'carregar os cadastros de referência'),'error');}});}
  saveEntry(){this.entryForm.markAllAsTouched();if(this.entryForm.invalid)return;const id=this.entryId();this.busy.set(true);const call=id?this.api.updateReference(id,this.entryForm.getRawValue()):this.api.createReference(this.entryForm.getRawValue());call.subscribe({next:()=>{this.clearEntry();this.done('Item de catálogo salvo.');},error:e=>this.fail(e.status,'salvar o item')});}
  editEntry(entry:ReferenceEntryAdmin){this.entryId.set(entry.id);this.entryForm.patchValue({kind:entry.kind,code:entry.code,label:entry.label,description:entry.description??''});}
  clearEntry(){this.entryId.set(null);this.entryForm.reset({kind:'ACADEMIC_TERM'});}
  confirmToggle(){const item=this.toggleCandidate();if(!item)return;this.toggleCandidate.set(null);this.busy.set(true);this.api.setReferenceActive(item.id,!item.active).subscribe({next:()=>this.done('Situação do item atualizada.'),error:e=>this.fail(e.status,'alterar a situação do item')});}
  saveTemplate(){this.templateForm.markAllAsTouched();if(this.templateForm.invalid)return;const v=this.templateForm.getRawValue();let defaults:unknown;this.jsonError.set('');try{defaults=JSON.parse(v.defaults);}catch{this.jsonError.set('O conteúdo deve ser um objeto JSON válido.');return;}if(!defaults||Array.isArray(defaults)||typeof defaults!=='object'){this.jsonError.set('Informe um objeto JSON com nomes de campos e valores iniciais.');return;}const data={...v,defaults,version:this.templateVersion};const id=this.templateId();this.busy.set(true);const call=id?this.api.updateTemplate(id,data):this.api.createTemplate(data);call.subscribe({next:()=>{this.clearTemplate();this.done('Modelo salvo como nova versão.');},error:e=>this.fail(e.status,'salvar o modelo')});}
  editTemplate(template:DocumentTemplateView){this.templateId.set(template.id);this.templateVersion=template.version;this.jsonError.set('');this.templateForm.patchValue({name:template.name,documentType:template.documentType,defaults:JSON.stringify(template.defaults,null,2),active:template.active});}
  clearTemplate(){this.templateId.set(null);this.templateVersion=null;this.jsonError.set('');this.templateForm.reset({documentType:'PEI',defaults:'{}',active:true});}
  kindLabel(kind:string){return kind==='ACADEMIC_TERM'?'Período letivo':kind==='NEED_CATEGORY'?'Categoria de necessidade':labelFor(kind);}
  fieldCount(defaults:Record<string,unknown>){return Object.keys(defaults??{}).length;}
  private done(message:string){this.busy.set(false);this.toast.show(message,'success');this.load();}
  private fail(status:number,action:string){this.busy.set(false);this.toast.show(errorMessage(status,action),'error');}
}
