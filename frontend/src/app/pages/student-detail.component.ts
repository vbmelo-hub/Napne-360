import { Component, OnInit, signal, inject } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { FormBuilder, FormControl, FormRecord, ReactiveFormsModule, Validators } from '@angular/forms';
import { DOSSIER_FIELDS, RECORD_FIELDS } from '../core/care-forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Attachment, CareRecord, Dossier, NapneCase, Pei, StudentDetails, Subject, TimelineEvent } from '../core/models';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, DatePipe, JsonPipe],
  template: `
    <a routerLink="/estudantes" class="back">← Voltar aos estudantes</a>
    @if (loading()) { <p>Carregando acompanhamento…</p> }
    @if (message()) { <div [class]="messageClass()" role="status">{{ message() }}</div> }
    @if (student(); as value) {
      <header class="profile card">
        <div class="avatar" aria-hidden="true">{{ initials(value.displayName) }}</div>
        <div><span class="eyebrow">{{ value.registration }}</span><h1>{{ value.displayName }}</h1><p>{{ value.course }} · {{ value.campus }}</p></div>
        <span class="badge">{{ value.status }}</span>
      </header>

      <nav class="tabs" aria-label="Seções do acompanhamento">
        @for (item of visibleTabs(); track item.id) { <button class="secondary" [attr.aria-current]="tab() === item.id ? 'page' : null" [class.selected]="tab() === item.id" (click)="tab.set(item.id)">{{ item.label }}</button> }
      </nav>


      @if (tab() === 'dossier') {
        <section class="card stack" aria-labelledby="dossier-title">
          <div><h2 id="dossier-title">Dossiê do estudante</h2>@if (dossier()?.redacted) { <p class="muted">Campos sensíveis foram ocultados conforme seu perfil.</p> }</div>
          <form [formGroup]="dossierForm" class="stack" (ngSubmit)="saveDossier()">
            @for (section of dossierSections; track section.key) {
              <details><summary>{{ section.label }}</summary><div class="grid two" [formGroup]="structuredDossier">
                @for (field of dossierFields[section.key]; track field.key) {
                  <label>{{ field.label }}<textarea [formControlName]="section.key + '.' + field.key"></textarea></label>
                }
              </div><label>Notas complementares<textarea [formControlName]="section.key"></textarea></label></details>
            }
            @if (auth.hasRole('NAPNE')) { <div><button type="submit">Salvar dossiê</button></div> }
          </form>
          @if(auth.hasRole('NAPNE')){<button class="secondary" (click)="loadHistory()">Consultar versões anteriores</button>@for(version of dossierHistory();track version.version){<details><summary>Versão {{version.version}} · {{version.author}} · {{version.occurredAt | date:'dd/MM/yyyy HH:mm'}}</summary>@for(change of changes(version.fields);track change.key){<h3>{{change.key}}</h3><div class="grid two"><div><strong>Versão anterior</strong><pre>{{change.previous | json}}</pre></div><div><strong>Versão atual</strong><pre>{{change.current | json}}</pre></div></div>}</details>}}
        </section>
      }

      @if (tab() === 'cases') {
        <section class="stack">
          @if (auth.hasRole('NAPNE')) {
            <form class="card stack" [formGroup]="caseForm" (ngSubmit)="createCase()"><h2>Abrir novo caso</h2>
              <label>Origem do encaminhamento<input formControlName="source"></label>
              <label>Resumo inicial<textarea formControlName="summary"></textarea></label>
              <div><button [disabled]="caseForm.invalid">Abrir caso</button></div>
            </form>
          }
          <section class="card"><h2>Histórico de casos</h2>
            @for (item of cases(); track item.id) { <article class="item"><div><strong>{{ item.source }}</strong><p>{{ item.summary }}</p></div><div><span class="badge">{{ item.stage }}</span><small>{{ item.openedAt | date:'dd/MM/yyyy' }}</small>@if (auth.hasRole('NAPNE')) { <label>Alterar etapa<select #stage [value]="item.stage">@for (option of stages; track option.value) { <option [value]="option.value">{{ option.label }}</option> }</select></label><button class="secondary" (click)="changeStage(item,stage.value)">Registrar etapa</button> }</div></article> }
            @if (cases().length === 0) { <p class="muted">Nenhum caso registrado.</p> }
          </section>
        </section>
      }

      @if (tab() === 'records') {
        <section class="stack">
          @if (canCreateRecord()) {
            <form class="card stack" [formGroup]="recordForm" (ngSubmit)="createRecord()"><h2>Novo registro</h2>
              <div class="grid two"><label>Tipo<select formControlName="type">@for (option of recordTypes(); track option.value) { <option [value]="option.value">{{ option.label }}</option> }</select></label><label>Título<input formControlName="title"></label></div>
              <label>Componente curricular<select formControlName="subjectId"><option value="">Sem componente específico</option>@for (subject of subjects(); track subject.id) { <option [value]="subject.id">{{ subject.name }}</option> }</select></label>
              <div class="grid two" [formGroup]="structuredRecord">@for (field of activeRecordFields(); track field.key) { <label>{{ field.label }}<textarea [formControlName]="field.key"></textarea></label> }</div>
              <label>Comentários adicionais<textarea formControlName="notes" placeholder="Registre somente as informações necessárias à finalidade pedagógica."></textarea></label>
              <label>Situação<select formControlName="status"><option value="DRAFT">Rascunho</option><option value="ACTIVE">Finalizado</option></select></label>
              <div><button [disabled]="recordForm.invalid">Salvar registro</button></div>
            </form>
          }
          <section class="card"><h2>Registros pedagógicos</h2>
            @for (item of records(); track item.id) { <article class="item"><div><span class="eyebrow">{{ recordLabel(item.type) }} · {{ item.status }}</span><strong>{{ item.title }}</strong>@for (field of recordFields[item.type]; track field.key) { @if (item.content[field.key]) { <p><b>{{ field.label }}:</b> {{ item.content[field.key] }}</p> } }<p>{{ item.content['notes'] }}</p></div><small>{{ item.updatedAt | date:'dd/MM/yyyy HH:mm' }}</small></article> }
            @if (records().length === 0) { <p class="muted">Nenhum registro disponível.</p> }
          </section>
        </section>
      }

      @if (tab() === 'pei') {
        <section class="stack">
          @if (auth.hasRole('NAPNE','COTEP','COURSE_COORDINATOR','TEACHER')) { <form class="card stack" [formGroup]="peiForm" (ngSubmit)="createPei()"><h2>Criar rascunho de PEI</h2>
            <div class="grid two"><label>Componente curricular<select formControlName="subjectId"><option value="">Selecione</option>@for (subject of subjects(); track subject.id) { <option [value]="subject.id">{{ subject.name }}</option> }</select></label><label>Período letivo<input formControlName="academicTerm" placeholder="2026.1"></label></div>
            <p class="muted">O sistema cria apenas um rascunho determinístico. A revisão humana é obrigatória.</p>
            <label>Docente responsável<select formControlName="teacherId"><option value="">Selecione o docente vinculado</option>@for (teacher of teachers(); track teacher.id + ':' + teacher.subjectId) { @if (teacher.subjectId === +peiForm.controls.subjectId.value) { <option [value]="teacher.id">{{ teacher.name }}</option> } }</select></label>
            <div><button [disabled]="peiForm.invalid">Criar rascunho</button></div>
          </form> }
          <section class="card"><h2>Planos por componente</h2>
            @for (item of peis(); track item.id) { <article class="item"><div><strong>Componente #{{ item.subjectId }} · {{ item.academicTerm }}</strong><p>Revisão {{ item.revision }} · {{ item.status }}</p></div><a class="button secondary" [routerLink]="['/estudantes', value.id, 'pei', item.id]">Editar</a></article> }
            @if (peis().length === 0) { <p class="muted">Nenhum PEI registrado.</p> }
          </section>
        </section>
      }

      @if (tab() === 'documents') {
        <section class="card stack"><h2>Documentos vinculados</h2>
          @if (auth.hasRole('NAPNE')) { <form class="upload" (ngSubmit)="upload()"><label>Categoria<input [formControl]="attachmentCategory"></label><label>Arquivo<input type="file" (change)="selectFile($event)" accept=".pdf,.png,.jpg,.jpeg,.docx"></label><button [disabled]="!selectedFile()">Enviar</button></form> }
          @if(auth.hasRole('NAPNE')){<label>Versão anterior (opcional)<select [formControl]="previousAttachment"><option value="">Novo documento</option>@for(item of attachments();track item.id){<option [value]="item.id">{{item.originalName}} · revisão {{item.revision}}</option>}</select></label>}
          @for (item of attachments(); track item.id) { <article class="item"><div><strong>{{ item.originalName }}</strong><p>{{ item.category }} · revisão {{item.revision}} · {{ formatSize(item.size) }}</p></div><button class="secondary" (click)="download(item)">Baixar</button></article> }
          @if (attachments().length === 0) { <p class="muted">Nenhum documento disponível.</p> }
        </section>
      }

      @if (tab() === 'timeline') {
        <section class="card"><h2>Linha do tempo</h2><label>Filtrar por tipo<select [value]="timelineFilter()" (change)="filterTimeline($any($event.target).value)"><option value="">Todos os eventos</option><option value="CASE">Casos e etapas</option><option value="DOSSIER">Dossiê</option><option value="CARE_RECORD">Acompanhamentos</option><option value="PEI">PEI</option><option value="ATTACHMENT">Documentos</option></select></label><ol class="timeline">
          @for (item of timeline(); track item.id) { <li><span class="dot"></span><div><strong>{{ item.title }}</strong><p>{{ item.actor }} · {{ item.createdAt | date:'dd/MM/yyyy HH:mm' }}</p></div></li> }
        </ol>@if (timeline().length === 0) { <p class="muted">Nenhum evento registrado.</p> }</section>
      }
    }
  `,
  styles: [`
    .back { display: inline-block; color: var(--primary); margin-bottom: 1rem; }
    .profile { display: flex; align-items: center; gap: 1rem; }
    .profile h1 { margin: .1rem 0; }.profile p { margin: 0; color: var(--muted); }.profile .badge { margin-left: auto; }
    .avatar { width: 4rem; height: 4rem; border-radius: 1rem; background: var(--primary-soft); color: var(--primary-dark); display: grid; place-items: center; font-weight: 800; font-size: 1.25rem; }
    .eyebrow { display: block; color: var(--primary); font-size: .78rem; font-weight: 800; text-transform: uppercase; letter-spacing: .06em; }
    .tabs { display: flex; gap: .5rem; overflow-x: auto; padding: 1.2rem 0; }
    .tabs button { white-space: nowrap; }.tabs button.selected { background: var(--primary); color: white; }
    h2 { margin-block: 0 .8rem; }.item { display: flex; align-items: start; justify-content: space-between; gap: 1rem; padding: 1rem 0; border-top: 1px solid var(--border); }.item:first-of-type { border-top: 0; }.item p { margin: .25rem 0; color: var(--muted); }.item small { color: var(--muted); display: block; }
    .timeline { list-style: none; padding: 0; }.timeline li { display: grid; grid-template-columns: 1rem 1fr; gap: .8rem; padding-bottom: 1.2rem; }.timeline p { margin: .2rem 0; color: var(--muted); }.dot { width: .8rem; height: .8rem; border-radius: 50%; background: var(--accent); margin-top: .4rem; }
    .upload { display: grid; grid-template-columns: 1fr 2fr auto; gap: .75rem; align-items: end; }
    @media (max-width: 700px) { .profile { align-items: start; flex-wrap: wrap; }.profile .badge { margin-left: 0; }.upload { grid-template-columns: 1fr; }.item { flex-direction: column; } }
  `]
})
export class StudentDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(ApiService);
  private fb = inject(FormBuilder);
  auth = inject(AuthService);

  readonly tabs = [{id:'dossier',label:'Dossiê'},{id:'cases',label:'Casos'},{id:'records',label:'Acompanhamento'},{id:'pei',label:'PEI'},{id:'documents',label:'Documentos'},{id:'timeline',label:'Linha do tempo'}];
  readonly id = Number(this.route.snapshot.paramMap.get('id'));
  readonly stages = [{value:'RECEIVED',label:'Recebido'},{value:'SCREENING',label:'Triagem'},{value:'WELCOMING',label:'Acolhimento'},{value:'CASE_STUDY',label:'Estudo de caso'},{value:'GUIDANCE_ISSUED',label:'Orientações emitidas'},{value:'ACTION_PLAN',label:'Plano de ação'},{value:'PEI',label:'PEI'},{value:'FOLLOW_UP',label:'Acompanhamento'},{value:'CLOSED',label:'Encerrado'},{value:'ARCHIVED',label:'Arquivado'}];
  readonly dossierFields = DOSSIER_FIELDS;
  readonly recordFields = RECORD_FIELDS;
  readonly dossierSections = [{key:'identification',label:'Identificação e demanda'},{key:'educationalNeeds',label:'Necessidades educacionais'},{key:'healthAndSupport',label:'Saúde e serviços de apoio'},{key:'familyContext',label:'Contexto familiar e autonomia'},{key:'schoolHistory',label:'História escolar'},{key:'strengths',label:'Potencialidades'},{key:'difficulties',label:'Dificuldades'},{key:'initialInterventions',label:'Intervenções e acompanhamento'}];
  readonly structuredDossier = new FormRecord<FormControl<string>>(Object.fromEntries(Object.entries(DOSSIER_FIELDS).flatMap(([section, fields]) => fields.map(field => [section+'.'+field.key,new FormControl('',{nonNullable:true})]))));
  readonly structuredRecord = new FormRecord<FormControl<string>>(Object.fromEntries(Object.values(RECORD_FIELDS).flat().map(field => [field.key,new FormControl('',{nonNullable:true})])));
  readonly student = signal<StudentDetails | null>(null); readonly dossier = signal<Dossier | null>(null);
  readonly cases = signal<NapneCase[]>([]); readonly records = signal<CareRecord[]>([]); readonly peis = signal<Pei[]>([]);
  readonly timeline = signal<TimelineEvent[]>([]); readonly subjects = signal<Subject[]>([]); readonly attachments = signal<Attachment[]>([]);
  readonly timelineFilter = signal('');
  readonly loading = signal(true); readonly tab = signal('dossier'); readonly message = signal(''); readonly messageClass = signal('success');
  readonly selectedFile = signal<File | null>(null); readonly attachmentCategory = this.fb.nonNullable.control('Laudo ou documento');
  readonly previousAttachment=this.fb.nonNullable.control('');
  readonly dossierHistory=signal<{version:number,fields:Record<string,unknown>,author:string,occurredAt:string}[]>([]);
  readonly teachers = signal<{id:number,name:string,subjectId:number}[]>([]);
  readonly dossierForm = this.fb.nonNullable.group({ identification:[''], educationalNeeds:[''], healthAndSupport:[''], familyContext:[''], schoolHistory:[''], strengths:[''], difficulties:[''], initialInterventions:[''] });
  readonly caseForm = this.fb.nonNullable.group({ source:['',Validators.required], summary:[''] });
  readonly recordForm = this.fb.nonNullable.group({ type:['',Validators.required], title:['',Validators.required], notes:[''], subjectId:[''], status:['DRAFT'] });
  readonly peiForm = this.fb.nonNullable.group({ subjectId:['',Validators.required], academicTerm:['',Validators.required], teacherId:['',Validators.required] });
  ngOnInit(): void { if (!this.auth.hasRole('NAPNE')) this.tab.set('records'); this.loadAll(); }
  visibleTabs() { return this.tabs.filter(t => this.auth.hasRole('NAPNE') || !['dossier','cases','documents'].includes(t.id)); }
  activeRecordFields() { return RECORD_FIELDS[this.recordForm.controls.type.value] ?? []; }
  changeStage(item:NapneCase, stage:string):void { this.api.changeCaseStage(item.id,stage,item.summary).subscribe({next:value=>{this.cases.update(cases=>cases.map(c=>c.id===value.id?value:c));this.refreshTimeline();this.ok('Etapa registrada no histórico.');},error:()=>this.fail()}); }
  filterTimeline(type:string):void { this.timelineFilter.set(type); this.api.timeline(this.id,type).subscribe({next:value=>this.timeline.set(value),error:()=>this.fail()}); }
  loadAll(): void {
    this.loading.set(true);
    forkJoin({student:this.api.student(this.id), dossier:this.api.dossier(this.id), cases:this.api.cases(this.id), records:this.api.records(this.id), peis:this.api.peis(this.id), timeline:this.api.timeline(this.id), attachments:this.api.attachments(this.id)}).subscribe({
      next: value => { this.student.set(value.student); this.dossier.set(value.dossier); this.cases.set(value.cases); this.records.set(value.records); this.peis.set(value.peis); this.timeline.set(value.timeline); this.attachments.set(value.attachments); this.fillDossier(value.dossier); this.api.studentSubjects(this.id).subscribe(s => this.subjects.set(s)); this.api.studentTeachers(this.id).subscribe(t => this.teachers.set(t)); this.setDefaultRecordType(); this.loading.set(false); },
      error: () => { this.messageClass.set('error'); this.message.set('Não foi possível carregar o acompanhamento.'); this.loading.set(false); }
    });
  }
  saveDossier(): void {
    const raw=this.dossierForm.getRawValue();
    const previous=this.dossier();
    const payload: Record<string,unknown>={version:previous?.version ?? null};
    for(const [section,notes] of Object.entries(raw)) {
      const fields:Record<string,unknown>={...(previous?.[section as keyof Dossier] as Record<string,unknown> ?? {}),notes};
      for(const field of DOSSIER_FIELDS[section]) fields[field.key]=this.structuredDossier.controls[section+'.'+field.key].value;
      payload[section]=fields;
    }
    this.api.saveDossier(this.id,payload).subscribe({next:d=>{this.dossier.set(d);this.ok('Dossiê atualizado; versão anterior preservada.');this.refreshTimeline();},error:()=>this.fail()});
  }
  createCase(): void { this.api.createCase(this.id,this.caseForm.getRawValue()).subscribe({next:v=>{this.cases.update(a=>[v,...a]);this.caseForm.reset();this.ok('Caso aberto.');this.refreshTimeline();},error:()=>this.fail()}); }
  createRecord(): void { const v=this.recordForm.getRawValue(); const content={notes:v.notes,...Object.fromEntries(this.activeRecordFields().map(f=>[f.key,this.structuredRecord.controls[f.key].value]))}; this.api.createRecord(this.id,{type:v.type,title:v.title,status:v.status,subjectId:v.subjectId?Number(v.subjectId):null,content}).subscribe({next:r=>{this.records.update(a=>[r,...a]);this.recordForm.controls.title.setValue('');this.recordForm.controls.notes.setValue('');this.structuredRecord.reset();this.ok('Registro salvo.');this.refreshTimeline();},error:()=>this.fail()}); }
  createPei(): void { const v=this.peiForm.getRawValue(); this.api.createPei(this.id,{subjectId:Number(v.subjectId),teacherId:Number(v.teacherId),academicTerm:v.academicTerm}).subscribe({next:p=>{this.peis.update(a=>[p,...a]);this.ok('Rascunho criado; revise antes de aprovar.');this.refreshTimeline();},error:()=>this.fail()}); }
  upload(): void { const file=this.selectedFile(); if(!file)return; this.api.uploadAttachment(this.id,this.attachmentCategory.value,file,this.previousAttachment.value).subscribe({next:a=>{this.attachments.update(v=>[a,...v]);this.selectedFile.set(null);this.previousAttachment.reset();this.ok('Documento enviado; versões anteriores preservadas.');},error:()=>this.fail()}); }
  loadHistory():void{this.api.dossierHistory(this.id).subscribe({next:v=>{this.dossierHistory.set(v);if(!v.length)this.ok('Ainda não há versões anteriores.');},error:()=>this.fail()});}
  changes(fields:Record<string,unknown>){return Object.entries(fields).map(([key,previous])=>({key,previous,current:this.dossier()?.[key as keyof Dossier]})).filter(v=>JSON.stringify(v.previous)!==JSON.stringify(v.current));}
  selectFile(event: Event): void { this.selectedFile.set((event.target as HTMLInputElement).files?.[0] ?? null); }
  download(item: Attachment): void { this.api.downloadAttachment(this.id,item.id).subscribe(blob=>{const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=item.originalName;a.click();URL.revokeObjectURL(url);}); }
  canCreateRecord(): boolean { return this.recordTypes().length > 0; }
  recordTypes(): {value:string,label:string}[] { if(this.auth.hasRole('NAPNE')) return [{value:'INITIAL_SCREENING',label:'Triagem inicial'},{value:'WELCOMING',label:'Acolhimento'},{value:'CASE_STUDY',label:'Estudo de caso'},{value:'PEDAGOGICAL_GUIDANCE',label:'Orientações pedagógicas'},{value:'ACTION_PLAN',label:'Plano de ação'},{value:'SUPPORT_REFUSAL',label:'Recusa de apoio'},{value:'SUPPORT_REQUEST',label:'Nova solicitação de apoio'}]; if(this.auth.hasRole('COTEP','COURSE_COORDINATOR'))return[{value:'PEDAGOGICAL_GUIDANCE',label:'Orientações pedagógicas'},{value:'ACTION_PLAN',label:'Plano de ação'}]; if(this.auth.hasRole('TEACHER'))return[{value:'TEACHER_FEEDBACK',label:'Devolutiva docente'}]; if(this.auth.hasRole('TUTOR'))return[{value:'TUTOR_OBSERVATION',label:'Observação de tutoria'}]; return []; }
  recordLabel(type:string): string { return this.recordTypes().find(x=>x.value===type)?.label ?? type.replaceAll('_',' '); }
  initials(name:string): string { return name.split(' ').slice(0,2).map(v=>v[0]).join('').toUpperCase(); }
  formatSize(size:number): string { return size < 1024*1024 ? `${Math.ceil(size/1024)} KB` : `${(size/1024/1024).toFixed(1)} MB`; }
  private fillDossier(d:Dossier):void { for(const key of Object.keys(this.dossierForm.controls) as (keyof typeof this.dossierForm.controls)[]){const value=d[key] as Record<string,unknown>;this.dossierForm.controls[key].setValue(String(value?.['notes'] ?? ''));for(const field of DOSSIER_FIELDS[key]) this.structuredDossier.controls[key+'.'+field.key].setValue(String(value?.[field.key]??''));} }
  private setDefaultRecordType():void { this.recordForm.controls.type.setValue(this.recordTypes()[0]?.value ?? ''); }
  private refreshTimeline():void { this.api.timeline(this.id).subscribe(v=>this.timeline.set(v)); }
  private ok(v:string):void{this.messageClass.set('success');this.message.set(v);} private fail():void{this.messageClass.set('error');this.message.set('Não foi possível concluir a operação.');}
}
