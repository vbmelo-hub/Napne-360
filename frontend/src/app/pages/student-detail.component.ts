import { DatePipe } from '@angular/common';
import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal, viewChildren } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormRecord, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription, forkJoin, map, merge } from 'rxjs';
import { DOSSIER_FIELDS, RECORD_FIELDS } from '../core/care-forms';
import { AcademicApi, AcademicOffering } from '../core/academic-api.service';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { trackFormChanges } from '../core/form-changes';
import { createListView } from '../core/list-view';
import { Attachment, CareRecord, Course, Dossier, NapneCase, Page, Pei, ReferenceOption, StudentDetails, Subject, TimelineEvent } from '../core/models';
import { errorMessage, labelFor, timelineLabel, toneFor } from '../core/presentation';
import { ToastService } from '../core/toast.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { ModalShellComponent } from '../shared/modal-shell.component';
import { PageFragmentDirective } from '../shared/page-fragment.directive';
import { PaginationComponent } from '../shared/pagination.component';
import { AttachmentActionsComponent } from './attachment-actions.component';
import { AcademicEnrollmentsComponent } from './academic-enrollments.component';
import { CaseCardComponent } from './case-card.component';
import { CareRecordHistoryComponent } from './care-record-history.component';

@Component({standalone:true,imports:[ReactiveFormsModule,RouterLink,DatePipe,CaseCardComponent,CareRecordHistoryComponent,ModalShellComponent,PaginationComponent,PageFragmentDirective,ConfirmDialogComponent,AcademicEnrollmentsComponent,AttachmentActionsComponent],template:`
  <a routerLink="/estudantes" class="back-link">← Voltar aos estudantes</a>
  @if(loading()){<div class="loading-grid" aria-label="Carregando acompanhamento"><span class="skeleton skeleton-card"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-card"></span></div>}
  @if(loadError()){<div class="error" role="alert"><strong>Não foi possível carregar o acompanhamento.</strong><p>{{loadError()}}</p><button class="secondary" (click)="loadAll()">Tentar novamente</button></div>}
  @if(student();as value){
    <header class="student-header"><span class="avatar" aria-hidden="true">{{initials(value.displayName)}}</span><div class="student-identity"><span class="eyebrow">Matrícula {{value.registration}}</span><h1>{{value.displayName}}</h1><div class="student-meta"><span>{{value.course}}</span><span>{{value.campus}}</span></div></div><div class="student-head-actions"><span [class]="'badge badge--'+tone(value.status)">{{label(value.status)}}</span>@if(auth.hasRole('NAPNE')){<button type="button" class="secondary compact" (click)="openStudentEdit()">Editar cadastro</button>}</div></header>
    <nav class="tabs student-tabs" aria-label="Seções do acompanhamento">@for(item of visibleTabs();track item.id){<button type="button" [attr.aria-current]="tab()===item.id?'page':null" [class.selected]="tab()===item.id" (click)="selectTab(item.id)">{{item.label}}</button>}</nav>

    @if(tab()!=='records' && editingRecord() && recordChanges.changed()){
    <p class="notice" role="status">Há alterações ainda não salvas no acompanhamento. Volte à aba Acompanhamento para salvá-las.</p>
  }
  @if(tab()!=='dossier' && dossierDirty()){
      <p class="notice" role="status">Há alterações no dossiê ainda não salvas. Volte ao dossiê para salvá-las.</p>
    }

    @if(tab()==='dossier'){
      <section class="section-header"><div><span class="eyebrow">Informações consolidadas</span><h2>Dossiê do estudante</h2><p>Organize o contexto educacional e os apoios necessários em seções temáticas.</p></div>@if(auth.hasRole('NAPNE')){<button class="secondary" (click)="loadHistory()">Consultar histórico</button>}</section>
      @if(dossier()?.redacted){<div class="notice">Algumas informações estão ocultas porque seu perfil possui acesso limitado. O conteúdo protegido não é exibido.</div>}
      <form [formGroup]="dossierForm" class="dossier-layout" (ngSubmit)="saveDossier()">
        <aside class="section-index card"><strong>Neste dossiê</strong>@for(section of dossierSections;track section.key){<a [appPageFragment]="'dossier-'+section.key">{{section.label}}</a>}</aside>
        <div class="stack"><fieldset class="dossier-fields stack" [disabled]="dossierSaving()||!auth.hasRole('NAPNE')||dossier()?.redacted">
          @for(section of dossierSections;track section.key;let first=$first){
            <details [open]="first" [id]="'dossier-'+section.key"><summary><span>{{section.label}}</span><small>{{dossierFields[section.key].length+1}} campos</small></summary>
              <div class="details-content stack"><div class="grid two" [formGroup]="structuredDossier">
                @for(field of dossierFields[section.key];track field.key){
                  @if(section.key==='educationalNeeds'&&field.key==='category'){
                    @if(auth.hasRole('NAPNE')&&!dossier()?.redacted){
                      <div class="stack">
                        <fieldset class="catalog-field" [disabled]="categoriesLoading()||!!categoriesError()">
                          <label>{{field.label}}<select data-testid="need-category" [formControl]="categoryControl">
                            <option value="">Sem categoria</option>
                            @if(!originalCategoryId()&&categorySnapshot()){<option value="legacy">{{categorySnapshot()}} · registro anterior</option>}
                            @for(option of categoryOptions();track option.id){<option [value]="option.id">{{option.label}}</option>}
                          </select></label>
                        </fieldset>
                        @if(categoriesLoading()){<span class="field-hint" role="status">Carregando categorias…</span>}
                        @if(categoriesError()){<div class="error" data-testid="category-catalog-error" role="alert">{{categoriesError()}} <button type="button" class="secondary compact" data-testid="category-catalog-retry" (click)="loadCategories()">Tentar novamente</button></div>}
                        @if(!categoriesLoading()&&!categoriesError()&&needCategories().length===0){<p class="field-hint" data-testid="category-catalog-empty">Nenhuma categoria ativa. Solicite o cadastro ou a ativação à administração. A categoria registrada será preservada.</p>}
                        @if(categorySnapshot()){<span class="field-hint">Categoria registrada: {{categorySnapshot()}}.</span>}
                      </div>
                    }
                  }@else{<label>{{field.label}}<textarea [formControlName]="section.key+'.'+field.key"></textarea></label>}
                }
              </div><label>Notas complementares<textarea [formControlName]="section.key"></textarea></label></div>
            </details>
          }
        </fieldset>
        @if(auth.hasRole('NAPNE')&&!dossier()?.redacted){<div class="sticky-actions"><span>{{dossierDirty()?'Existem alterações não salvas.':'Todas as alterações estão salvas.'}}</span><button type="submit" [disabled]="!canSaveDossier()">@if(dossierSaving()){<span class="spinner"></span>}Salvar alterações</button></div>}
        </div>
      </form>
      <app-modal-shell [open]="historyVisible()" title="Histórico do dossiê"
        (closed)="historyVisible.set(false)">
          @if (historyLoading()) {
            <span class="skeleton skeleton-card"></span>
          } @else {
            <label class="list-filter">
              Buscar versões do dossiê por número ou autoria
              <input type="search" [value]="dossierRevisions.query()" (input)="dossierRevisions.setQuery($any($event.target).value)">
            </label>
            @if (dossierHistory().length === 0) {
              <div class="empty-state"><span class="empty-state-mark">0</span><h3>Nenhuma versão anterior</h3><p>O histórico aparecerá após uma nova atualização do dossiê.</p></div>
            }
            @for (version of dossierRevisions.items(); track version.version) {
              <details>
                <summary>Versão {{version.version}} · {{version.author}} · {{version.occurredAt | date:'dd/MM/yyyy, HH:mm'}}</summary>
                <div class="details-content">
                  @for (change of changes(version.fields); track change.key) {
                    <article class="change">
                      <h3>{{sectionLabel(change.key)}}</h3>
                      <div class="comparison">
                        <div><span>Versão anterior</span><p>{{displayValue(change.previous)}}</p></div>
                        <div><span>Versão atual</span><p>{{displayValue(change.current)}}</p></div>
                      </div>
                    </article>
                  }
                </div>
              </details>
            }
            @if (dossierHistory().length > 0 && dossierRevisions.totalElements() === 0) {
              <p role="status">Nenhuma versão do dossiê corresponde à busca.</p>
            }
            <app-pagination [page]="dossierRevisions.page()" [totalPages]="dossierRevisions.totalPages()"
              label="Páginas do histórico do dossiê" (pageChange)="dossierRevisions.setPage($event)" />
          }
      </app-modal-shell>
    }

    @if (tab() === 'enrollments' && auth.hasRole('NAPNE')) {
      <app-academic-enrollments [studentId]="id" />
    }

    @if(auth.hasRole('NAPNE')){
      <section [hidden]="tab()!=='cases'">
        <div class="section-header"><div><span class="eyebrow">Fluxo de acompanhamento</span><h2>Casos e encaminhamentos</h2><p>Acompanhe a etapa atual e o histórico de cada caso.</p></div></div>
        <form class="card stack create-panel" [formGroup]="caseForm" (ngSubmit)="createCase()">
          <div class="section-header"><div><h2>Abrir novo caso</h2><p>Registre a origem e um resumo inicial do encaminhamento.</p></div></div>
          <fieldset class="catalog-field" [disabled]="actionBusy()">
            <div class="grid two"><label><span>Origem do encaminhamento&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input formControlName="source" maxlength="80" aria-required="true"></label><label>Resumo inicial<textarea formControlName="summary" maxlength="500"></textarea></label></div>
          </fieldset>
          <div><button [disabled]="caseForm.invalid||actionBusy()">Abrir caso</button></div>
        </form>
        <section class="card">
          <h2>Casos registrados</h2>
          <label class="list-filter">
            Buscar casos por origem, etapa, responsável ou resumo
            <input type="search" [value]="caseList.query()" [disabled]="caseListBusy()" (input)="caseList.setQuery($any($event.target).value)">
          </label>
          @if(cases().length===0){
            <div class="empty-state"><span class="empty-state-mark">0</span><h3>Nenhum caso registrado</h3><p>Os encaminhamentos e suas etapas aparecerão aqui.</p></div>
          } @else if (caseList.totalElements() === 0) {
            <p role="status">Nenhum caso corresponde à busca.</p>
          }
          @for(item of caseList.items();track item.id){
            <app-case-card [item]="item" (caseUpdated)="updateCaseFromCard($event)" (recordsRequested)="showCaseRecords($event)" />
          }
          <fieldset class="catalog-field" [disabled]="caseListBusy()">
            <app-pagination [page]="caseList.page()" [totalPages]="caseList.totalPages()"
              label="Páginas de casos" (pageChange)="caseList.setPage($event)" />
          </fieldset>
        </section>
      </section>
    }

    @if(tab()==='records'){
      <div class="section-header"><div><span class="eyebrow">Prática pedagógica</span><h2>Acompanhamento</h2><p>Registros organizados por tipo, autoria e situação.</p></div></div>
      @if(canCreateRecord()||editingRecord()){<form class="card stack create-panel" [formGroup]="recordForm" (ngSubmit)="saveRecord()"><div class="section-header"><div><h2 id="record-form-heading" tabindex="-1">{{editingRecord()?'Editar registro':'Novo registro'}}</h2><p>{{editingRecord()?'Atualize as informações pedagógicas. Os vínculos do registro são preservados.':'O formulário exibe somente os campos pertinentes ao tipo escolhido.'}}</p></div></div><fieldset [disabled]="actionBusy()" class="record-form-fields"><div class="grid two"><label><span>Tipo&nbsp;<span class="field-required" aria-hidden="true">*</span></span><select formControlName="type" [attr.disabled]="editingRecord()?'':null"><option value="">Selecione</option>@if(editingRecord()&&!hasRecordType(editingRecord()!.type)){<option [value]="editingRecord()!.type">{{label(editingRecord()!.type)}}</option>}@for(option of recordTypes();track option.value){<option [value]="option.value">{{option.label}}</option>}</select></label><label><span>Título&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input formControlName="title"></label></div><label>Componente curricular<select formControlName="subjectId" [attr.disabled]="editingRecord()?'':null"><option value="">Sem componente específico</option>@for(subject of subjects();track subject.id){<option [value]="subject.id">{{subject.name}}</option>}</select></label>
        @if(auth.hasRole('NAPNE')){
          @if(editingRecord();as record){
            @if(record.caseId;as caseId){<p><strong>Caso vinculado</strong><br>{{recordCaseLabel(caseId)}}</p>}
          }@else{
            <label>Caso vinculado (opcional)
              <select formControlName="caseId">
                <option value="">Sem caso vinculado</option>
                @for(item of activeRecordCases();track item.id){
                  <option [value]="item.id">{{caseLabel(item)}} · {{item.openedAt|date:'dd/MM/yyyy'}}</option>
                }
              </select>
            </label>
          }
        }
        <div class="grid two" [formGroup]="structuredRecord">@for(field of activeRecordFields();track field.key){<label>{{field.label}}<textarea [formControlName]="field.key"></textarea></label>}</div><label>Comentários adicionais<textarea formControlName="notes" placeholder="Registre somente informações necessárias à finalidade pedagógica."></textarea></label><label>Situação<select formControlName="status"><option value="DRAFT">Rascunho</option><option value="ACTIVE">Finalizado</option></select>
          <span class="field-hint">{{recordForm.controls.status.value==='DRAFT'
            ? 'Registro em elaboração, visível para quem tem autorização para consultar rascunhos.'
            : 'Registro disponível aos profissionais autorizados, de acordo com seus vínculos e permissões.'}}</span>
        </label></fieldset><div class="record-actions"><button type="submit" [disabled]="recordForm.invalid||actionBusy()||(!!editingRecord()&&!recordChanges.changed())">{{editingRecord()?'Salvar alterações':'Salvar registro'}}</button>@if(editingRecord()){<button type="button" class="secondary" (click)="confirmCancelRecordEdit()" [disabled]="actionBusy()">Cancelar edição</button>}</div></form>}
      <section class="records-list" aria-label="Registros de acompanhamento">
        <label class="list-filter">
          Buscar registros por título, tipo, situação ou autoria
          <input type="search" [value]="recordList.query()" (input)="recordList.setQuery($any($event.target).value)">
        </label>
        <label class="checkbox-row"><input type="checkbox" [checked]="showArchivedRecords()"
          (change)="showArchivedRecords.set($any($event.target).checked); recordList.setPage(0)"> Mostrar acompanhamentos arquivados</label>
        @if (auth.hasRole('NAPNE') && cases().length > 0) {
          <label class="list-filter">Caso vinculado
            <select [value]="recordCaseFilter()" (change)="recordCaseFilter.set($any($event.target).value); recordList.setPage(0)">
              <option value="">Todos os registros</option>
              <option value="none">Sem caso vinculado</option>
              @for (item of cases(); track item.id) { <option [value]="item.id">{{caseLabel(item)}}</option> }
            </select>
          </label>
        }
        <div class="records-grid">
          @if (records().length === 0) {
            <div class="empty-state card"><span class="empty-state-mark">0</span><h3>Nenhum registro pedagógico</h3><p>Os registros autorizados para este estudante aparecerão aqui.</p></div>
          } @else if (recordList.totalElements() === 0) {
            <p role="status">Nenhum registro corresponde aos filtros selecionados.</p>
          }
          @for (item of recordList.items(); track item.id) {
            <article class="card record-card" [attr.data-record-id]="item.id">
              <div class="record-head">
                <div><span class="eyebrow">{{label(item.type)}}</span><h3>{{item.title}}</h3></div>
                <div class="record-badges">
                  <span [class]="'badge badge--' + tone(item.status)">{{recordStatusLabel(item.status)}}</span>
                  @if (canEditRecord(item)) {
                    <button type="button" class="secondary compact" (click)="editRecord(item)" [disabled]="actionBusy()">Editar</button>
                    <button type="button" class="secondary compact" (click)="recordToArchive.set(item)" [disabled]="actionBusy()">Arquivar</button>
                  }
                </div>
              </div>
              @if (auth.hasRole('NAPNE') && item.caseId; as caseId) {
                <p>{{recordCaseLabel(caseId)}}</p>
              }
              <div class="record-content">
                @for (field of recordFields[item.type]; track field.key) {
                  @if (item.content[field.key]) {
                    <p><strong>{{field.label}}</strong><span>{{item.content[field.key]}}</span></p>
                  }
                }
                @if (item.content['notes']) {
                  <p><strong>Comentários adicionais</strong><span>{{item.content['notes']}}</span></p>
                }
              </div>
              @if (item.history?.length) {
                <app-care-record-history [record]="item" />
              }
              <footer>{{item.createdBy}} · {{item.updatedAt | date:'dd/MM/yyyy, HH:mm'}}@if (item.version !== null && item.version !== undefined) { · v{{item.version}} }</footer>
            </article>
          }
        </div>
        <app-pagination [page]="recordList.page()" [totalPages]="recordList.totalPages()"
          label="Páginas de acompanhamentos" (pageChange)="recordList.setPage($event)" />
      </section>
    }

    @if(tab()==='pei'){
      <div class="section-header"><div><span class="eyebrow">Planejamento individualizado</span><h2>Planos de Ensino Individualizados</h2><p>Crie, revise e acompanhe os PEIs por componente curricular.</p></div></div>
      @if (canCreatePei()) {
        @if (offersLoading()) {
          <p role="status">Carregando ofertas válidas…</p>
        } @else if (offersError()) {
          <div class="error" data-testid="offer-error" role="alert">{{offersError()}}
            <button type="button" class="secondary compact" (click)="loadPeiOffers()">Tentar novamente</button>
          </div>
        } @else if (!peiOffers().length) {
          <p class="field-hint">Nenhuma oferta com matrícula e atribuição docente válidas está disponível para iniciar um PEI.</p>
        } @else {
          <form class="card stack create-panel" [formGroup]="peiForm" (ngSubmit)="createPei()">
            <div class="section-header"><div><h2>Criar rascunho de PEI</h2><p>O rascunho exige revisão humana.</p></div></div>
            <fieldset class="catalog-field" [disabled]="actionBusy()">
              <div class="grid two">
                <label><span>Oferta curricular&nbsp;<span class="field-required" aria-hidden="true">*</span></span>
                  <select formControlName="offeringId" required>
                    <option value="">Selecione</option>
                    @for (offer of peiOffers(); track offer.id) {
                      <option [value]="offer.id">{{offer.subjectName}} · {{offer.groupCode}} · {{offer.periodLabel}}</option>
                    }
                  </select>
                </label>
                <label>Docente responsável<input [value]="auth.user()?.name??''" readonly></label>
              </div>
            </fieldset>
            <div><button type="submit" [disabled]="peiForm.invalid||actionBusy()">Criar rascunho</button></div>
          </form>
        }
      }
      <section class="card">
        <h2>Planos por componente</h2>
        <label class="list-filter">
          Buscar PEIs por componente, período ou situação
          <input type="search" [value]="peiList.query()" (input)="peiList.setQuery($any($event.target).value)">
        </label>
        @if (peis().length === 0) {
          <div class="empty-state"><span class="empty-state-mark">0</span><h3>Nenhum PEI criado</h3><p>Nenhum PEI criado está disponível para este estudante.</p></div>
        } @else if (peiList.totalElements() === 0) {
          <p role="status">Nenhum PEI corresponde à busca.</p>
        }
        @for (item of peiList.items(); track item.id) {
          <article class="pei-row">
            <div><strong>{{peiSubjectName(item)}}</strong><span>{{item.academicTermLabel ?? item.academicTerm}} · revisão {{item.revision}}</span></div>
            <span [class]="'badge badge--' + tone(item.status)">{{peiStatusLabel(item.status)}}</span>
            <a class="button secondary compact" [routerLink]="['/estudantes',value.id,'pei',item.id]">@if (item.allowedActions?.includes('EDIT')) { Editar rascunho } @else { Consultar PEI }</a>
          </article>
        }
        <app-pagination [page]="peiList.page()" [totalPages]="peiList.totalPages()"
          label="Páginas de PEIs" (pageChange)="peiList.setPage($event)" />
      </section>
    }

    @if(tab()==='documents'){
      <div class="section-header"><div><span class="eyebrow">Acervo autorizado</span><h2>Documentos</h2><p>Arquivos protegidos com histórico de versões.</p></div></div>
      @if(auth.hasRole('NAPNE')){<form class="upload-card card" [formGroup]="attachmentForm" (ngSubmit)="upload(fileInput)"><div><h3>Enviar documento</h3><p>PDF, PNG, JPEG ou DOCX, até 10 MB.</p></div><div class="grid two"><label><span>Categoria&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input [formControl]="attachmentCategory"></label><label class="upload-field"><span>Arquivo&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input #fileInput type="file" (change)="selectFile($event)" accept=".pdf,.png,.jpg,.jpeg,.docx"><span class="file-picker">{{selectedFile()?.name||'Selecione um arquivo'}}</span></label><label>Relacionar à versão anterior<select [formControl]="previousAttachment"><option value="">Criar novo documento</option>@for(item of attachments();track item.id){<option [value]="item.id">{{item.originalName}} · revisão {{item.revision}}</option>}</select><span class="field-hint">Use esta opção quando o arquivo substituir uma versão já enviada.</span></label></div><button type="submit" [disabled]="!selectedFile()||attachmentForm.invalid||actionBusy()">
        @if(actionBusy()){<span class="spinner" aria-hidden="true"></span> Enviando…}@else{Enviar documento}
      </button></form>}
      <section class="card">
        <h2>Arquivos disponíveis</h2>
        <label class="list-filter">
          Buscar documentos por nome, categoria ou autoria
          <input type="search" [value]="attachmentList.query()" (input)="attachmentList.setQuery($any($event.target).value)">
        </label>
        @if (auth.hasRole('NAPNE')) {
          <label class="checkbox-row"><input type="checkbox" [checked]="showArchivedAttachments()"
            (change)="toggleArchivedAttachments($any($event.target).checked)"> Incluir documentos arquivados</label>
          @if (archivedAttachmentsLoading()) { <p role="status">Carregando documentos arquivados…</p> }
          @if (archivedAttachmentsError()) {
            <p class="error" role="alert">{{archivedAttachmentsError()}}</p>
            <button type="button" class="secondary compact" (click)="toggleArchivedAttachments(true)">Tentar novamente</button>
          }
        }
        @if (displayedAttachments().length === 0 && !archivedAttachmentsLoading()) {
          <div class="empty-state"><span class="empty-state-mark">0</span><h3>Nenhum documento</h3><p>Nenhum arquivo autorizado está disponível para este estudante.</p></div>
        } @else if (attachmentList.totalElements() === 0) {
          <p role="status">Nenhum documento corresponde à busca.</p>
        }
        <div class="document-list">
          @for (item of attachmentList.items(); track item.id) {
            <article class="document-row">
              <span class="file-mark" aria-hidden="true">{{fileType(item)}}</span>
              <div><strong>{{item.originalName}}</strong><p>{{item.category}} · revisão {{item.revision}} · {{formatSize(item.size)}}@if(item.archived){ · Arquivado}</p><small>{{item.uploadedBy}} · {{item.uploadedAt | date:'dd/MM/yyyy, HH:mm'}}</small></div>
              <div class="attachment-actions">
                @if (!item.archived) { <button type="button" class="secondary compact" (click)="download(item)">Baixar</button> }
                <app-attachment-actions [attachment]="item" [archiveDisabled]="actionBusy() || archivedAttachmentsLoading()" (archived)="onAttachmentArchived($event)" />
              </div>
            </article>
          }
        </div>
        <app-pagination [page]="attachmentList.page()" [totalPages]="attachmentList.totalPages()"
          label="Páginas de documentos" (pageChange)="attachmentList.setPage($event)" />
      </section>
    }

    @if (tab() === 'timeline') {
      <div class="section-header"><div><span class="eyebrow">Histórico integrado</span><h2>Linha do tempo</h2><p>Acontecimentos do acompanhamento em ordem cronológica.</p></div></div>
      <section class="card">
        <label class="list-filter">Filtrar por tipo
          <select [value]="timelineFilter()" (change)="filterTimeline($any($event.target).value)">
            <option value="">Todos os eventos</option><option value="CASE">Casos e etapas</option><option value="DOSSIER">Dossiê</option>
            <option value="CARE_RECORD">Acompanhamentos</option><option value="PEI">PEI</option><option value="ATTACHMENT">Documentos</option>
          </select>
        </label>
        @if (timelineLoading()) {
          <p role="status">Carregando linha do tempo…</p>
        }
        @if (timelineError()) {
          <div class="error" role="alert">{{timelineError()}}</div>
          <button type="button" class="secondary compact" (click)="refreshTimeline(requestedTimelinePage())">Tentar novamente</button>
        }
        @if (timeline(); as page) {
          @if (page.content.length === 0) {
            <div class="empty-state"><span class="empty-state-mark">0</span><h3>Nenhum evento na linha do tempo</h3><p>{{timelineFilter() ? 'Nenhum acontecimento do tipo selecionado está disponível.' : 'Os acontecimentos autorizados aparecerão aqui.'}}</p></div>
          }
          <ol class="timeline">
            @for (item of page.content; track item.id) {
              <li [attr.data-type]="item.eventType"><span class="timeline-dot" aria-hidden="true"></span><div><span class="eyebrow">{{timelineLabel(item.eventType)}}</span>@if (timelineLabel(item.eventType)!==item.title) {<h3>{{item.title}}</h3>}<p>{{item.actor}} · {{item.createdAt | date:'dd/MM/yyyy, HH:mm'}}</p></div></li>
            }
          </ol>
          <app-pagination [page]="page.number" [totalPages]="page.totalPages"
            label="Páginas da linha do tempo" (pageChange)="refreshTimeline($event)" />
        }
      </section>
    }
  }
  <app-confirm-dialog [open]="!!recordToArchive()" title="Arquivar acompanhamento?"
    description="O acompanhamento e suas versões permanecerão disponíveis no histórico autorizado."
    confirmLabel="Arquivar" (confirmed)="archiveRecord()" (cancelled)="recordToArchive.set(null)" />
  <app-modal-shell [open]="editStudentOpen()" eyebrow="Cadastro acadêmico" title="Editar dados do estudante" description="Atualize somente os dados cadastrais. O histórico pedagógico e o dossiê permanecem preservados." (closed)="closeStudentEdit()">
    <form class="stack" [formGroup]="studentEditForm" (ngSubmit)="saveStudent()">
      <div class="notice"><strong>Matrícula {{student()?.registration}}</strong><br><span>A matrícula identifica o cadastro e não é alterada por esta edição.</span></div>
      <fieldset><legend>Identificação</legend><div class="grid two"><label><span>Nome civil&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input formControlName="civilName" autocomplete="off"></label><label>Nome social<input formControlName="socialName" autocomplete="off"></label><label>Data de nascimento<input type="date" formControlName="birthDate"></label></div></fieldset>
      <fieldset><legend>Vínculo acadêmico e contato</legend><div class="grid two"><label><span>Curso&nbsp;<span class="field-required" aria-hidden="true">*</span></span><select formControlName="courseId"><option value="">Selecione</option>
        @if (unlistedStudentCourse(); as current) {
          <option [value]="current.courseId">{{current.course}} · vínculo atual</option>
        }
        @for(course of courses();track course.id){<option [value]="course.id">{{course.name}}</option>}</select></label><label>E-mail institucional<input type="email" formControlName="institutionalEmail"></label><label>Telefone<input formControlName="phone"></label></div></fieldset>
      <div class="dialog-actions"><button type="button" class="secondary" (click)="closeStudentEdit()" [disabled]="studentSaving()">Cancelar</button><button type="submit" [disabled]="studentEditForm.invalid||studentSaving()||!studentChanges.changed()">@if(studentSaving()){<span class="spinner"></span>}Salvar alterações</button></div>
    </form>
  </app-modal-shell>
`,styles:[`.dossier-fields,.catalog-field{border:0;padding:0;margin:0;min-width:0}.dossier-fields{display:grid}.dossier-fields details{scroll-margin-top:10rem}.back-link{display:inline-flex;margin-bottom:1rem;font-weight:700;text-decoration:none}.student-header{display:flex;align-items:center;gap:1.15rem;background:linear-gradient(120deg,#fff 60%,var(--primary-50));border:1px solid var(--border);border-radius:var(--radius-xl);padding:1.5rem}.student-identity{min-width:0;flex:1}.student-head-actions{display:flex;align-items:center;gap:.65rem;flex-wrap:wrap;justify-content:flex-end}.student-identity h1{margin:.15rem 0}.student-meta{display:flex;gap:.7rem;flex-wrap:wrap;color:var(--ink-600)}.student-meta span+span::before{content:'·';margin-right:.7rem}.student-tabs{background:var(--background);position:sticky;top:4.75rem;z-index:20;padding-top:1rem}.dossier-layout{display:grid;grid-template-columns:14rem minmax(0,1fr);gap:1rem;align-items:start}.section-index{position:sticky;top:9rem;display:grid;gap:.25rem;padding:1rem}.section-index strong{padding:.4rem}.section-index a{padding:.45rem;border-radius:.4rem;text-decoration:none;font-size:.85rem}.section-index a:hover{background:var(--primary-50)}summary{display:flex;justify-content:space-between;gap:1rem}summary small{color:var(--ink-600);font-weight:500}.sticky-actions{position:sticky;bottom:1rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;background:var(--primary-950);color:#fff;border-radius:var(--radius-md);padding:.8rem 1rem;box-shadow:var(--shadow-md);font-size:.85rem}.history{margin-top:1rem;display:grid;gap:.75rem}.change{padding:.5rem 0}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.comparison>div{background:var(--surface-soft);border:1px solid var(--border);border-radius:.5rem;padding:.8rem;min-width:0}.comparison span{font-size:.75rem;color:var(--ink-600);text-transform:uppercase;font-weight:800}.comparison p{white-space:pre-wrap;overflow-wrap:anywhere;margin:.5rem 0 0}.create-panel{margin-bottom:1rem}.records-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.record-card{display:flex;flex-direction:column}.record-head{display:flex;justify-content:space-between;gap:1rem}.record-head h3{margin:.2rem 0}.record-content p{border-top:1px solid var(--border);padding-top:.75rem}.record-content strong,.record-content span{display:block}.record-content strong{font-size:.78rem;color:var(--ink-600);margin-bottom:.15rem}.record-card footer{margin-top:auto;padding-top:1rem;color:var(--ink-600);font-size:.8rem}.record-badges{display:flex;align-items:center;gap:.5rem}.record-actions{display:flex;align-items:center;gap:.75rem}fieldset.record-form-fields{border:0;padding:0;margin:0;min-width:0;display:grid;gap:1rem}.pei-row,.document-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:1rem;padding:1rem 0;border-top:1px solid var(--border)}.pei-row:first-of-type,.document-row:first-of-type{border-top:0}.pei-row strong,.pei-row span,.document-row strong,.document-row p,.document-row small{display:block}.pei-row>div>span,.document-row p,.document-row small{color:var(--ink-600);margin:0}.upload-card{margin-bottom:1rem}.attachment-actions{display:flex;gap:.5rem;flex-wrap:wrap}.upload-field input{position:absolute;opacity:0;width:1px;height:1px}.upload-field>.file-picker{display:flex;align-items:center;min-height:2.8rem;border:1px dashed var(--border-strong);border-radius:.5rem;padding:.7rem;color:var(--ink-600);cursor:pointer}.file-mark{width:3rem;height:3rem;border-radius:.65rem;display:grid;place-items:center;background:var(--primary-100);color:var(--primary-900);font-size:.67rem;font-weight:900}.timeline{list-style:none;padding:0;margin:0}.timeline li{position:relative;display:grid;grid-template-columns:1.2rem 1fr;gap:1rem;padding-bottom:1.5rem}.timeline li:not(:last-child)::before{content:'';position:absolute;left:.38rem;top:1rem;bottom:0;width:2px;background:var(--border)}.timeline-dot{position:relative;z-index:1;width:.82rem;height:.82rem;border:3px solid var(--primary-700);background:#fff;border-radius:50%;margin-top:.2rem}.timeline li[data-type=PEI] .timeline-dot{border-color:var(--info)}.timeline li[data-type=ATTACHMENT] .timeline-dot{border-color:var(--warning)}.timeline h3{margin:.15rem 0}.timeline p{color:var(--ink-600);margin:0}@media(max-width:900px){.student-tabs{top:4.25rem}.dossier-layout{grid-template-columns:1fr}.section-index{display:none}.records-grid{grid-template-columns:1fr}}@media(max-width:700px){.student-header{align-items:flex-start;flex-wrap:wrap}.student-head-actions{width:100%;justify-content:flex-start;margin-left:5.15rem}.student-tabs{margin-inline:-1rem;padding-left:1rem}.comparison{grid-template-columns:1fr}.sticky-actions{align-items:stretch;flex-direction:column}.sticky-actions button{width:100%}.pei-row,.document-row{grid-template-columns:auto 1fr}.pei-row>.badge{grid-column:2}.pei-row>.button,.document-row>button{grid-column:1/-1;width:100%}.section-header>label{width:100%}}` ]})
export class StudentDetailComponent implements OnInit{
  private attachmentUpload?: { file: File; category: string; previousId: string; key: string };
  private timelineRequest?: Subscription;
  private readonly destroyRef = inject(DestroyRef);
  private readonly route=inject(ActivatedRoute);private readonly api=inject(ApiService);private readonly academic=inject(AcademicApi);private readonly fb=inject(FormBuilder);private readonly toast=inject(ToastService);readonly auth=inject(AuthService);
  readonly id=Number(this.route.snapshot.paramMap.get('id'));readonly tabs=[{id:'dossier',label:'Dossiê'},{id:'enrollments',label:'Matrículas'},{id:'cases',label:'Casos'},{id:'records',label:'Acompanhamento'},{id:'pei',label:'PEI'},{id:'documents',label:'Documentos'},{id:'timeline',label:'Linha do tempo'}];readonly dossierFields=DOSSIER_FIELDS;readonly recordFields=RECORD_FIELDS;readonly dossierSections=[{key:'identification',label:'Identificação e demanda'},{key:'educationalNeeds',label:'Necessidades educacionais'},{key:'healthAndSupport',label:'Saúde e serviços de apoio'},{key:'familyContext',label:'Contexto familiar e autonomia'},{key:'schoolHistory',label:'História escolar'},{key:'strengths',label:'Potencialidades'},{key:'difficulties',label:'Dificuldades'},{key:'initialInterventions',label:'Intervenções e acompanhamento'}];readonly label=labelFor;readonly tone=toneFor;
  readonly structuredDossier=new FormRecord<FormControl<string>>(Object.fromEntries(Object.entries(DOSSIER_FIELDS).flatMap(([section,fields])=>fields.map(field=>[section+'.'+field.key,new FormControl('',{nonNullable:true})]))));readonly structuredRecord=new FormRecord<FormControl<string>>(Object.fromEntries(Object.values(RECORD_FIELDS).flat().map(field=>[field.key,new FormControl('',{nonNullable:true})])));
  readonly student=signal<StudentDetails|null>(null);readonly dossier=signal<Dossier|null>(null);readonly cases=signal<NapneCase[]>([]);readonly records=signal<CareRecord[]>([]);readonly editingRecord=signal<CareRecord|null>(null);readonly peis=signal<Pei[]>([]);readonly subjects=signal<Subject[]>([]);readonly courses=signal<Course[]>([]);readonly attachments=signal<Attachment[]>([]);readonly loading=signal(true);readonly loadError=signal('');readonly tab=signal('dossier');readonly timelineFilter=signal('');readonly selectedFile=signal<File|null>(null);readonly editStudentOpen=signal(false);readonly studentSaving=signal(false);readonly actionBusy=signal(false);readonly dossierSaving=signal(false);readonly historyVisible=signal(false);readonly historyLoading=signal(false);readonly dossierHistory=signal<{version:number,fields:Record<string,unknown>,author:string,occurredAt:string}[]>([]);
  readonly attachmentForm = this.fb.nonNullable.group({
    category: ['Laudo ou documento', Validators.required],
    previousVersion: [''],
  });
  readonly attachmentCategory = this.attachmentForm.controls.category;
  readonly previousAttachment = this.attachmentForm.controls.previousVersion;
  readonly studentEditForm=this.fb.nonNullable.group({courseId:['',Validators.required],civilName:['',Validators.required],socialName:[''],birthDate:[''],institutionalEmail:['',Validators.email],phone:['']});readonly dossierForm=this.fb.nonNullable.group({identification:[''],educationalNeeds:[''],healthAndSupport:[''],familyContext:[''],schoolHistory:[''],strengths:[''],difficulties:[''],initialInterventions:['']});readonly caseForm=this.fb.nonNullable.group({source:['',Validators.required],summary:['']});readonly recordForm=this.fb.nonNullable.group({type:['',Validators.required],title:['',Validators.required],notes:[''],subjectId:[''],caseId:[''],status:['DRAFT']});readonly peiForm=this.fb.nonNullable.group({offeringId:['',Validators.required]});
  readonly activeRecordCases = computed(() => this.cases().filter(item =>
    item.studentId === this.id && item.stage !== 'CLOSED' && item.stage !== 'ARCHIVED'
  ));
  private readonly caseCards = viewChildren(CaseCardComponent);
  readonly caseListBusy = computed(() => this.caseCards().some(card => card.busy()));
  readonly dossierRevisions = createListView(this.dossierHistory, version => [`Versão ${version.version}`, version.author]);
  readonly caseList = createListView(this.cases, item => [this.caseLabel(item), item.responsible, item.summary]);
  readonly recordToArchive = signal<CareRecord | null>(null);
  readonly showArchivedRecords = signal(false);
  readonly recordCaseFilter = signal('');
  private readonly displayedRecords = computed(() => {
    const caseFilter = this.recordCaseFilter();
    return this.records().filter(item => (this.showArchivedRecords() || item.status !== 'ARCHIVED')
      && (!caseFilter || (item.caseId == null ? 'none' : String(item.caseId)) === caseFilter));
  });
  readonly recordList = createListView(this.displayedRecords, item => [
    item.title, this.label(item.type), this.recordStatusLabel(item.status), item.createdBy,
  ]);
  readonly unlistedStudentCourse = computed(() => {
    const current = this.student();
    return current && !this.courses().some(course => course.id === current.courseId) ? current : null;
  });
  readonly peiList = createListView(this.peis, item => [
    this.peiSubjectName(item), item.academicTermLabel ?? item.academicTerm, this.peiStatusLabel(item.status),
  ]);
  readonly showArchivedAttachments = signal(false);
  readonly archivedAttachmentsLoading = signal(false);
  readonly archivedAttachmentsError = signal('');
  private readonly archivedAttachments = signal<Attachment[]>([]);
  protected readonly displayedAttachments = computed(() => this.showArchivedAttachments()
    ? [...this.attachments(), ...this.archivedAttachments()]
    : this.attachments());
  readonly attachmentList = createListView(this.displayedAttachments, item => [item.originalName, item.category, item.uploadedBy]);
  readonly timeline = signal<Page<TimelineEvent> | null>(null);
  readonly requestedTimelinePage = signal(0);
  readonly timelineLoading = signal(false);
  readonly timelineError = signal('');
  readonly categoryControl=this.fb.nonNullable.control('');
  private readonly studentEditValues = toSignal(this.studentEditForm.valueChanges.pipe(map(() => this.studentEditForm.getRawValue())), {
    initialValue: this.studentEditForm.getRawValue(),
  });
  protected readonly studentChanges = trackFormChanges(this.studentEditValues);
  private readonly recordValues = toSignal(merge(this.recordForm.valueChanges, this.structuredRecord.valueChanges)
    .pipe(map(() => this.readRecordValues())), { initialValue: this.readRecordValues() });
  protected readonly recordChanges = trackFormChanges(this.recordValues);

  private readRecordValues() {
    return { record: this.recordForm.getRawValue(), fields: this.structuredRecord.getRawValue() };
  }

  private readonly dossierValues = toSignal(merge(
    this.dossierForm.valueChanges, this.structuredDossier.valueChanges, this.categoryControl.valueChanges,
  ).pipe(map(() => this.readDossierValues())), { initialValue: this.readDossierValues() });
  private readonly dossierChanges = trackFormChanges(this.dossierValues);
  readonly dossierDirty = this.dossierChanges.changed;

  protected canSaveDossier(): boolean {
    const dossier = this.dossier();
    return !!dossier && !dossier.redacted && this.auth.hasRole('NAPNE')
      && !this.dossierSaving() && this.dossierForm.valid && this.structuredDossier.valid
      && this.categoryControl.valid && this.dossierDirty();
  }

  private readDossierValues() {
    return {
      notes: this.dossierForm.getRawValue(),
      fields: this.structuredDossier.getRawValue(),
      category: this.categoryControl.value,
    };
  }

  readonly needCategories=signal<ReferenceOption[]>([]);
  readonly peiOffers = signal<AcademicOffering[]>([]);
  readonly categoriesLoading=signal(false);
  readonly categoriesError=signal('');
  readonly offersLoading = signal(false);
  readonly offersError = signal('');
  readonly originalCategoryId=computed(()=>this.dossier()?.redacted?null:this.dossier()?.educationalNeeds.categoryId??null);
  readonly categorySnapshot=computed(()=>this.dossier()?.redacted?'':this.dossier()?.educationalNeeds.category??'');
  readonly categoryOptions=computed(()=>{
    const id=this.originalCategoryId(),snapshot=this.categorySnapshot(),active=this.needCategories();
    if(!id)return active;
    if(active.some(option=>option.id===id))return active.map(option=>option.id===id?{...option,label:snapshot||option.label}:option);
    return [{id,code:'',label:`${snapshot||'Categoria registrada'} · referência histórica`},...active];
  });
  ngOnInit(){if(!this.auth.hasRole('NAPNE'))this.tab.set('records');this.loadAll();if(this.auth.hasRole('NAPNE'))this.loadCategories();if(this.canCreatePei())this.loadPeiOffers()}
  protected selectTab(id: string) {
    this.tab.set(id);
    if (id === 'timeline') this.refreshTimeline();
  }
  canLeave(): boolean {
    return !this.auth.authenticated() || !this.hasUnsavedChanges()
      || window.confirm('Há alterações ainda não salvas. Sair do acompanhamento?');
  }

  private hasUnsavedChanges(): boolean {
    return this.dossierDirty() || (this.editStudentOpen() && this.studentChanges.changed())
      || (!!this.editingRecord() && this.recordChanges.changed());
  }

  @HostListener('window:beforeunload', ['$event'])
  protected preventUnsavedUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = true;
    }
  }

  canCreatePei(){return this.auth.hasRole('TEACHER')}
  loadCategories(){
    if(!this.auth.hasRole('NAPNE')||this.dossier()?.redacted||this.categoriesLoading()||this.dossierSaving())return;
    this.categoriesLoading.set(true);this.categoriesError.set('');
    this.api.references('NEED_CATEGORY').subscribe({next:options=>{this.needCategories.set(options);this.categoriesLoading.set(false)},error:e=>{this.categoriesLoading.set(false);this.categoriesError.set(errorMessage(e,'carregar as categorias'))}});
  }
  loadPeiOffers(): void {
    if (!this.canCreatePei() || this.offersLoading()) return;
    this.offersLoading.set(true);
    this.offersError.set('');
    this.academic.peiOffers(this.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: offers => {
        this.peiOffers.set(offers);
        const current = this.peiForm.controls.offeringId.value;
        if (!offers.some(offer => String(offer.id) === current)) {
          this.peiForm.controls.offeringId.setValue(offers.length === 1 ? String(offers[0].id) : '');
        }
        this.offersLoading.set(false);
      },
      error: error => {
        this.offersLoading.set(false);
        this.offersError.set(errorMessage(error, 'carregar as ofertas do PEI'));
      },
    });
  }
  visibleTabs(){return this.tabs.filter(t=>this.auth.hasRole('NAPNE')||!['dossier','enrollments','cases','documents'].includes(t.id))} activeRecordFields(){return RECORD_FIELDS[this.recordForm.controls.type.value]??[]} recordTypes(){if(this.auth.hasRole('NAPNE'))return[{value:'INITIAL_SCREENING',label:'Triagem inicial'},{value:'WELCOMING',label:'Acolhimento'},{value:'CASE_STUDY',label:'Estudo de caso'},{value:'PEDAGOGICAL_GUIDANCE',label:'Orientações pedagógicas'},{value:'ACTION_PLAN',label:'Plano de ação'},{value:'SUPPORT_REFUSAL',label:'Recusa de apoio'},{value:'SUPPORT_REQUEST',label:'Nova solicitação de apoio'}];if(this.auth.hasRole('COTEP','COURSE_COORDINATOR'))return[{value:'PEDAGOGICAL_GUIDANCE',label:'Orientações pedagógicas'},{value:'ACTION_PLAN',label:'Plano de ação'}];if(this.auth.hasRole('TEACHER'))return[{value:'TEACHER_FEEDBACK',label:'Devolutiva docente'}];if(this.auth.hasRole('TUTOR'))return[{value:'TUTOR_OBSERVATION',label:'Observação de tutoria'}];return[]} canCreateRecord(){return this.recordTypes().length>0}
  loadAll(){this.loading.set(true);this.loadError.set('');forkJoin({student:this.api.student(this.id),dossier:this.api.dossier(this.id),cases:this.api.cases(this.id),records:this.api.records(this.id),peis:this.api.peis(this.id),attachments:this.api.attachments(this.id)}).subscribe({next:v=>{this.student.set(v.student);this.dossier.set(v.dossier);this.cases.set(v.cases);this.records.set(v.records);this.peis.set(v.peis);this.attachments.set(v.attachments);this.fillDossier(v.dossier);this.api.studentSubjects(this.id).subscribe(s=>this.subjects.set(s));if(this.auth.hasRole('NAPNE'))this.api.courses().subscribe({next:c=>this.courses.set(c),error:e=>this.toast.show(errorMessage(e,'carregar os cursos'),'error')});this.recordForm.controls.type.setValue(this.recordTypes()[0]?.value??'');this.loading.set(false);this.refreshTimeline()},error:e=>{this.loading.set(false);this.loadError.set(errorMessage(e,'carregar o acompanhamento'))}})}
  openStudentEdit(){const value=this.student();if(!value)return;this.studentEditForm.reset({courseId:String(value.courseId),civilName:value.civilName??'',socialName:value.socialName??'',birthDate:value.birthDate??'',institutionalEmail:value.institutionalEmail??'',phone:value.phone??''});this.studentChanges.capture();this.editStudentOpen.set(true)}
  closeStudentEdit(){
    if (!this.studentSaving() && (!this.studentChanges.changed()
        || window.confirm('Descartar alterações ainda não salvas no cadastro?'))) this.editStudentOpen.set(false);
  }
  saveStudent(){const current=this.student();this.studentEditForm.markAllAsTouched();if(!current||this.studentEditForm.invalid||this.studentSaving()||!this.studentChanges.changed())return;const value=this.studentEditForm.getRawValue();this.studentSaving.set(true);this.api.updateStudent(this.id,{registration:current.registration,courseId:Number(value.courseId),civilName:value.civilName,socialName:value.socialName,birthDate:value.birthDate||null,institutionalEmail:value.institutionalEmail||null,phone:value.phone||null}).subscribe({next:updated=>{this.student.set(updated);this.studentSaving.set(false);this.editStudentOpen.set(false);this.toast.show('Dados cadastrais do estudante atualizados.','success');this.api.studentSubjects(this.id).subscribe(s=>this.subjects.set(s))},error:e=>{this.studentSaving.set(false);this.toast.show(errorMessage(e,'atualizar o cadastro do estudante'),'error')}})}
  saveDossier(){
    const previous=this.dossier();
    if (!previous || !this.canSaveDossier()) return;
    const selected=this.categoryControl.value,categoryId=selected?Number(selected):null;
    const changeCategory=selected!==this.dossierChanges.saved().category&&selected!=='legacy';
    if(changeCategory&&categoryId!==null&&categoryId!==this.originalCategoryId()&&(this.categoriesLoading()||this.categoriesError()||!this.needCategories().some(option=>option.id===categoryId))){
      this.toast.show('Carregue as categorias e selecione uma opção ativa antes de salvar.','error');return;
    }
    const raw=this.dossierForm.getRawValue(),payload:Record<string,unknown>={version:previous.version};
    for(const[section,notes]of Object.entries(raw)){
      const fields:Record<string,unknown>={...(previous[section as keyof Dossier] as Record<string,unknown>??{}),notes};
      for(const field of DOSSIER_FIELDS[section]){
        if(section==='educationalNeeds'&&field.key==='category')continue;
        fields[field.key]=this.structuredDossier.controls[section+'.'+field.key].value;
      }
      if(section==='educationalNeeds'){
        if(changeCategory){fields['categoryId']=categoryId;if(categoryId===null)fields['category']=''}
        else if(fields['categoryId']===null)delete fields['categoryId'];
      }
      payload[section]=fields;
    }
    this.dossierSaving.set(true);
    this.api.saveDossier(this.id,payload).subscribe({next:d=>{this.dossier.set(d);this.fillDossier(d);this.dossierSaving.set(false);this.toast.show('Dossiê atualizado. A versão anterior foi preservada.','success');this.refreshTimeline()},error:e=>{this.dossierSaving.set(false);this.toast.show(errorMessage(e,'salvar o dossiê'),'error')}});
  }
  createCase(){
    if(this.caseForm.invalid||this.actionBusy())return;
    this.actionBusy.set(true);
    this.api.createCase(this.id,this.caseForm.getRawValue()).subscribe({
      next:value=>{
        this.cases.update(items=>[value,...items]);
        this.caseForm.reset();
        this.done('Caso aberto com sucesso.');
      },
      error:error=>this.failed(error.status,'abrir o caso')
    });
  }
  updateCaseFromCard({value,mutated}:{value:NapneCase;mutated:boolean}){
    if(value.studentId!==this.id)return;
    this.cases.update(items=>items.map(item=>item.id===value.id?value:item));
    if(mutated)this.refreshTimeline();
  }
  caseLabel(item: NapneCase): string {
    return `Caso #${item.id} · ${item.source} · ${item.stageLabel ?? this.label(item.stage)}`;
  }

  showCaseRecords(caseId: number): void {
    this.recordCaseFilter.set(String(caseId));
    this.recordList.setPage(0);
    this.selectTab('records');
  }

  recordCaseLabel(id: number): string {
    const item = this.cases().find(item => item.id === id && item.studentId === this.id);
    return item ? this.caseLabel(item) : `Caso #${id}`;
  }

  hasRecordType(type:string):boolean{return this.recordTypes().some(t=>t.value===type)}
  recordStatusLabel(status: string): string {
    return status === 'ACTIVE' ? 'Finalizado' : labelFor(status);
  }

  canEditRecord(item:CareRecord):boolean{
    if (item.status === 'ARCHIVED' || item.status === 'SUPERSEDED') return false;
    if (item.editable !== undefined && item.editable !== null) return item.editable;
    if(this.auth.hasRole('NAPNE'))return true;
    const user=this.auth.user();
    if(!user||item.createdBy!==user.email)return false;
    const roles=user.roles??[];
    if(roles.includes('NAPNE'))return true;
    if(roles.some(r=>['COTEP','COURSE_COORDINATOR'].includes(r))&&['PEDAGOGICAL_GUIDANCE','ACTION_PLAN','TEACHER_FEEDBACK','TUTOR_OBSERVATION'].includes(item.type))return true;
    if(roles.includes('TEACHER')&&item.type==='TEACHER_FEEDBACK')return true;
    if(roles.includes('TUTOR')&&item.type==='TUTOR_OBSERVATION')return true;
    return false;
  }
  editRecord(item:CareRecord){
    if(this.actionBusy())return;
    if(!this.canEditRecord(item))return;
    if (this.editingRecord() && this.recordChanges.changed()
        && !window.confirm('Descartar as alterações do registro em edição?')) return;
    this.editingRecord.set(item);
    this.tab.set('records');
    this.recordForm.controls.type.setValue(item.type);
    this.recordForm.controls.title.setValue(item.title);
    this.recordForm.controls.status.setValue(item.status);
    this.recordForm.controls.subjectId.setValue(item.subjectId?String(item.subjectId):'');
    this.recordForm.controls.notes.setValue(String(item.content['notes']??''));
    this.structuredRecord.reset();
    for(const f of this.activeRecordFields()){
      if(this.structuredRecord.controls[f.key]){
        this.structuredRecord.controls[f.key].setValue(String(item.content[f.key]??''));
      }
    }
    this.recordChanges.capture();
    setTimeout(()=>{
      const heading=document.getElementById('record-form-heading')||document.querySelector('.create-panel input');
      (heading as HTMLElement)?.focus?.();
    },0);
  }
  confirmCancelRecordEdit() {
    if (!this.recordChanges.changed() || window.confirm('Descartar alterações ainda não salvas no registro?')) {
      this.cancelRecordEdit();
    }
  }

  cancelRecordEdit(){
    this.editingRecord.set(null);
    this.recordForm.reset({type:this.recordTypes()[0]?.value??'',title:'',notes:'',subjectId:'',caseId:'',status:'DRAFT'});
    this.structuredRecord.reset();
  }
  saveRecord(){
    if(this.recordForm.invalid||this.actionBusy())return;
    const editing=this.editingRecord(),v=this.recordForm.getRawValue(),structured=Object.fromEntries(this.activeRecordFields().map(f=>[f.key,this.structuredRecord.controls[f.key]?.value??'']));
    if(editing){
      if (!this.recordChanges.changed()) return;
      const savingId=editing.id;
      const content:Record<string,unknown>={...(editing.content??{}),...structured,notes:v.notes};
      const payload={caseId:editing.caseId,subjectId:editing.subjectId,type:editing.type,title:v.title,status:v.status,content,version:editing.version??null};
      this.actionBusy.set(true);
      this.api.updateRecord(this.id,savingId,payload).subscribe({
        next:updated=>{
          this.records.update(list=>list.map(r=>r.id===updated.id?updated:r));
          if(this.editingRecord()?.id===savingId){
            this.cancelRecordEdit();
          }
          this.done('Registro de acompanhamento atualizado.');
        },
        error:e=>{
          this.actionBusy.set(false);
          this.toast.show(errorMessage(e,'atualizar o registro'),'error');
        }
      });
    }else{
      const caseId = this.auth.hasRole('NAPNE') && v.caseId ? Number(v.caseId) : null;
      if (caseId !== null && !this.activeRecordCases().some(item => item.id === caseId)) {
        this.clearUnavailableRecordCase();
        return;
      }
      const content={notes:v.notes,...structured};
      this.actionBusy.set(true);
      this.api.createRecord(this.id,{type:v.type,title:v.title,status:v.status,subjectId:v.subjectId?Number(v.subjectId):null,caseId,content}).subscribe({
        next:r=>{
          this.records.update(a=>[r,...a]);
          this.cancelRecordEdit();
          this.done('Registro pedagógico salvo.');
        },
        error: e => {
          if (e.status === 400 && caseId !== null) {
            this.refreshRecordCasesAfterRejection(caseId);
          } else {
            this.failed(e.status, 'salvar o registro');
          }
        }
      });
    }
  }
  private refreshRecordCasesAfterRejection(caseId: number) {
    this.api.cases(this.id).subscribe({
      next: cases => {
        this.cases.set(cases);
        if (this.activeRecordCases().some(item => item.id === caseId)) {
          this.failed(400, 'salvar o registro');
        } else {
          this.actionBusy.set(false);
          this.clearUnavailableRecordCase();
        }
      },
      error: e => this.failed(e.status, 'atualizar a lista de casos')
    });
  }

  private clearUnavailableRecordCase() {
    this.recordForm.controls.caseId.reset();
    this.toast.show('O caso escolhido já não está ativo. Confira o vínculo antes de salvar.', 'error');
  }

  archiveRecord(): void {
    const item = this.recordToArchive();
    this.recordToArchive.set(null);
    if (!item || !this.canEditRecord(item) || this.actionBusy()) return;
    this.actionBusy.set(true);
    const { caseId, subjectId, type, title, content, version } = item;
    this.api.updateRecord(this.id, item.id, { caseId, subjectId, type, title, content, version, status: 'ARCHIVED' })
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: updated => {
          this.records.update(list => list.map(value => value.id === updated.id ? updated : value));
          if (this.editingRecord()?.id === item.id) this.cancelRecordEdit();
          this.done('Acompanhamento arquivado.');
        },
        error: error => {
          this.actionBusy.set(false);
          this.toast.show(errorMessage(error, 'arquivar o acompanhamento'), 'error');
        },
      });
  }

  createRecord(){this.saveRecord()}
  createPei(): void {
    if (!this.canCreatePei() || this.peiForm.invalid || this.actionBusy() || this.offersLoading() || this.offersError()) return;
    const offeringId = Number(this.peiForm.controls.offeringId.value);
    if (!this.peiOffers().some(offer => offer.id === offeringId)) return;
    this.actionBusy.set(true);
    this.api.createPei(this.id, { offeringId }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: pei => {
        this.peis.update(items => [pei, ...items.filter(item => item.id !== pei.id)]);
        this.done('Rascunho do PEI criado. Revise-o e envie-o quando estiver pronto.');
      },
      error: error => {
        this.actionBusy.set(false);
        this.toast.show(errorMessage(error, 'criar o PEI'), 'error');
      },
    });
  }
  upload(fileInput?: HTMLInputElement) {
    const file = this.selectedFile();
    if (!file || this.attachmentForm.invalid || this.actionBusy()) return;
    if (file.size > 10 * 1024 * 1024) {
      this.toast.show('O arquivo ultrapassa o limite de 10 MB.', 'error');
      return;
    }
    const category = this.attachmentCategory.value;
    const previousId = this.previousAttachment.value;
    let pending = this.attachmentUpload;
    if (!pending || pending.file !== file || pending.category !== category || pending.previousId !== previousId) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const key = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      pending = this.attachmentUpload = { file, category, previousId, key };
    }
    this.actionBusy.set(true);
    this.api.uploadAttachment(this.id, category, file, previousId, pending.key).subscribe({
      next: attachment => {
        this.attachmentUpload = undefined;
        this.attachments.update(items => {
          const others = items.filter(item => item.id !== attachment.id);
          return attachment.archived ? others : [attachment, ...others];
        });
        if (this.selectedFile() === file) {
          this.selectedFile.set(null);
          if (fileInput) fileInput.value = '';
        }
        if (this.previousAttachment.value === previousId) this.previousAttachment.reset();
        this.done('Documento enviado com versionamento preservado.');
      },
      error: e => { this.actionBusy.set(false); this.toast.show(errorMessage(e, 'enviar o documento'), 'error'); }
    });
  }
  toggleArchivedAttachments(show: boolean): void {
    this.showArchivedAttachments.set(show);
    this.attachmentList.setPage(0);
    if (!show || this.archivedAttachmentsLoading()) return;
    this.archivedAttachmentsLoading.set(true);
    this.archivedAttachmentsError.set('');
    this.api.attachments(this.id, true).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: items => {
        this.archivedAttachments.set(items.filter(item => item.archived));
        this.archivedAttachmentsLoading.set(false);
      },
      error: error => {
        this.archivedAttachmentsLoading.set(false);
        this.archivedAttachmentsError.set(errorMessage(error, 'carregar os documentos arquivados'));
      },
    });
  }

  onAttachmentArchived(id: string): void {
    const item = this.attachments().find(attachment => attachment.id === id);
    if (item && this.showArchivedAttachments()) {
      this.archivedAttachments.update(items => [{...item, archived: true}, ...items.filter(value => value.id !== id)]);
    }
    this.attachments.update(items => items.filter(item => item.id !== id));
    if (this.previousAttachment.value === id) this.previousAttachment.reset();
    this.refreshTimeline();
  }

  loadHistory(){this.historyVisible.set(true);this.historyLoading.set(true);this.api.dossierHistory(this.id).subscribe({next:v=>{this.dossierHistory.set(v);this.historyLoading.set(false)},error:e=>{this.historyLoading.set(false);this.toast.show(errorMessage(e,'carregar o histórico'),'error')}})}

  readonly timelineLabel = timelineLabel;

  filterTimeline(type: string) {
    this.timelineFilter.set(type);
    this.timeline.set(null);
    this.refreshTimeline();
  }

  changes(fields:Record<string,unknown>){return Object.entries(fields).map(([key,previous])=>({key,previous,current:this.dossier()?.[key as keyof Dossier]})).filter(v=>JSON.stringify(v.previous)!==JSON.stringify(v.current))}
  selectFile(event:Event){this.selectedFile.set((event.target as HTMLInputElement).files?.[0]??null)}download(item:Attachment){this.api.downloadAttachment(this.id,item.id).subscribe({next:blob=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=item.originalName;a.click();URL.revokeObjectURL(url)},error:e=>this.toast.show(errorMessage(e,'baixar o documento'),'error')})}
  peiSubjectName(pei: Pei): string {
    const subject = this.subjects().find(item => item.id === pei.subjectId);
    const savedName = pei.content['subject'];
    return subject?.name ?? (typeof savedName === 'string' && savedName.trim() ? savedName : 'Componente não disponível');
  }
  peiStatusLabel(status:string){if(status==='APPROVED')return'Vigente';if(status==='SUPERSEDED')return'Histórico · substituído';if(status==='ARCHIVED')return'Histórico · arquivado';return labelFor(status)}fileType(item:Attachment){if(item.contentType.includes('pdf'))return'PDF';if(item.contentType.includes('word'))return'DOCX';return'IMG'}formatSize(size:number){return size<1048576?`${Math.ceil(size/1024)} KB`:`${(size/1048576).toFixed(1)} MB`}initials(name:string){return name.split(' ').filter(Boolean).slice(0,2).map(v=>v[0]).join('').toUpperCase()}sectionLabel(key:string){return this.dossierSections.find(s=>s.key===key)?.label??labelFor(key)}displayValue(value:unknown){if(value===null||value===undefined||value==='')return'Não informado';if(typeof value==='object')return Object.entries(value as Record<string,unknown>).filter(([,v])=>v).map(([k,v])=>`${labelFor(k)}: ${String(v)}`).join('\n')||'Não informado';return String(value)}
  private fillDossier(d:Dossier){for(const key of Object.keys(this.dossierForm.controls)as(keyof typeof this.dossierForm.controls)[]){const value=d[key]as Record<string,unknown>;this.dossierForm.controls[key].setValue(String(value?.['notes']??''));for(const field of DOSSIER_FIELDS[key])this.structuredDossier.controls[key+'.'+field.key].setValue(String(value?.[field.key]??''))}this.categoryControl.reset(d.redacted?'':d.educationalNeeds.categoryId?String(d.educationalNeeds.categoryId):d.educationalNeeds.category?'legacy':'');this.dossierForm.markAsPristine();this.dossierChanges.capture()}

  refreshTimeline(page = 0) {
    if (this.tab() !== 'timeline') return;
    this.timelineRequest?.unsubscribe();
    this.requestedTimelinePage.set(page);
    this.timelineLoading.set(true);
    this.timelineError.set('');
    this.timelineRequest = this.api.timeline(this.id, this.timelineFilter(), page)
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: response => {
          this.timeline.set(response);
          this.timelineLoading.set(false);
        },
        error: error => {
          this.timelineError.set(errorMessage(error, 'carregar a linha do tempo'));
          this.timelineLoading.set(false);
        },
      });
  }

  private done(message:string){this.actionBusy.set(false);this.toast.show(message,'success');this.refreshTimeline()}private failed(status:number,action:string){this.actionBusy.set(false);this.toast.show(errorMessage(status,action),'error')}
}
