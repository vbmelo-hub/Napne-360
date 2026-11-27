import { DatePipe } from '@angular/common';
import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal, viewChildren } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormRecord, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, forkJoin, map, merge } from 'rxjs';
import { DOSSIER_FIELDS, RECORD_FIELDS } from '../core/care-forms';
import { AcademicApi, AcademicOffering } from '../core/academic-api.service';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { createFilterOptions } from '../core/filter-options';
import { trackFormChanges } from '../core/form-changes';
import { createListView } from '../core/list-view';
import { Attachment, CareRecord, CaseStageOption, Course, Dossier, NapneCase, Page, Pei, ReferenceOption, StudentDetails, Subject, TimelineEvent } from '../core/models';
import { errorMessage, labelFor, timelineLabel, toneFor } from '../core/presentation';
import { ToastService } from '../core/toast.service';
import { academicStatusLabel, academicStudentStatus, studentStatusReasonLabel } from '../core/student-status';
import { AppliedFiltersComponent, appliedFilterItems } from '../shared/applied-filters.component';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { FilterDisclosureComponent } from '../shared/filter-disclosure.component';
import { ModalShellComponent } from '../shared/modal-shell.component';
import { PageFragmentDirective } from '../shared/page-fragment.directive';
import { PaginationComponent } from '../shared/pagination.component';
import { SearchableOption, SearchableSelectComponent } from '../shared/searchable-select.component';
import { AttachmentActionsComponent } from './attachment-actions.component';
import { AcademicEnrollmentsComponent } from './academic-enrollments.component';
import { CaseCardComponent } from './case-card.component';
import { CareRecordHistoryComponent } from './care-record-history.component';
import { StudentStatusDialogComponent } from './student-status-dialog.component';

import { ListFiltersComponent } from '../shared/list-filters.component';
import { reconcileRequiredSelection } from '../core/required-selection';

const STUDY_RECORD_TYPES = ['INITIAL_SCREENING', 'WELCOMING', 'CASE_STUDY', 'PEDAGOGICAL_GUIDANCE', 'ACTION_PLAN'];
const GUIDANCE_RECORD_TYPES = ['PEDAGOGICAL_GUIDANCE', 'ACTION_PLAN'];
type RecordSection = 'cases' | 'guidance' | 'records';

@Component({standalone:true,imports:[ReactiveFormsModule,RouterLink,DatePipe,CaseCardComponent,CareRecordHistoryComponent,ModalShellComponent,PaginationComponent,ListFiltersComponent,PageFragmentDirective,ConfirmDialogComponent,AcademicEnrollmentsComponent,AttachmentActionsComponent,SearchableSelectComponent,StudentStatusDialogComponent,FilterDisclosureComponent,AppliedFiltersComponent],template:`
  <a routerLink="/estudantes" class="back-link">← Voltar aos estudantes</a>
  @if(loading()){<div class="loading-grid" aria-label="Carregando acompanhamento"><span class="skeleton skeleton-card"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-card"></span></div>}
  @if(loadError()){<div class="error" role="alert"><strong>Não foi possível carregar o acompanhamento.</strong><p>{{loadError()}}</p><button class="secondary" (click)="loadAll()">Tentar novamente</button></div>}
  @if(student();as value){
    <header class="student-header">
      <span class="avatar" aria-hidden="true">{{initials(value.displayName)}}</span>
      <div class="student-identity">
        <span class="eyebrow">Matrícula {{value.registration}}</span>
        <h1>{{value.displayName}}</h1>
        <div class="student-meta"><span>{{value.course}}</span><span>{{value.campus}}</span></div>
        <p class="student-academic-status">Situação acadêmica
          <span [class]="'badge badge--'+tone(academicStatus(value))">{{statusLabel(academicStatus(value))}}</span>
          @if (value.status === 'ARCHIVED') {<span class="badge badge--neutral">Cadastro arquivado</span>}
          @if (value.statusReason) {<span>{{reasonLabel(value.statusReason)}}</span>}
        </p>
      </div>
      @if(auth.hasRole('NAPNE')) {
        <div class="student-head-actions">
          @if (value.status === 'ARCHIVED') {
            <button type="button" class="secondary compact" (click)="statusDialog.set('restore')">Desarquivar cadastro</button>
          } @else {
            <button type="button" class="secondary compact" (click)="statusDialog.set('change')">Alterar situação</button>
          }
          <button type="button" class="secondary compact" (click)="openStudentEdit()">Editar cadastro</button>
          <button type="button" class="secondary compact" (click)="openStatusHistory()">Histórico de situação</button>
        </div>
      }
    </header>
    @if (statusDialog(); as mode) {
      <app-student-status-dialog [student]="value" [mode]="mode"
        (saved)="onStatusSaved($event)" (cancelled)="statusDialog.set(null)" />
    }
    <nav class="tabs student-tabs" aria-label="Seções do acompanhamento">@for(item of visibleTabs();track item.id){<button type="button" [attr.aria-current]="tab()===item.id?'page':null" [class.selected]="tab()===item.id" (click)="selectTab(item.id)">{{item.label}}</button>}</nav>

    @if (tab() !== recordFormSection() && (editingRecord() || hasRecordChanges())) {
      <p class="notice" role="status">Há um registro aberto em outra seção.
        <button type="button" class="secondary compact" (click)="selectTab(recordFormSection())">Voltar ao registro</button>
      </p>
    }
  @if(tab()!=='dossier' && dossierDirty()){
      <p class="notice" role="status">Há alterações no dossiê ainda não salvas. Volte ao dossiê para salvá-las.</p>
    }

    @if(tab()==='dossier'){
      <section class="section-header"><div><span class="eyebrow">Informações consolidadas</span><h2>Dossiê do estudante</h2><p>{{auth.hasRole('NAPNE') && !dossier()?.redacted
        ? 'Organize o contexto educacional e os apoios necessários em seções temáticas.'
        : 'Consulte o contexto educacional e os apoios disponíveis neste dossiê.'}}</p></div>@if(auth.hasRole('NAPNE')){<button class="secondary" (click)="loadHistory()">Consultar histórico</button>}</section>
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
            <app-list-filters [list]="dossierRevisions" label="Buscar versões" placeholder="Número ou autoria" />
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
      <app-academic-enrollments [studentId]="id" [allowsNewEnrollments]="value.status === 'ACTIVE'" />
    }

    @if(auth.hasRole('NAPNE')){
      <section [hidden]="tab()!=='cases'">
        <div class="section-header"><div><h2>Estudo de caso</h2>
          <p>Documente a identificação, o acolhimento, a investigação e o planejamento das ações de inclusão.</p>
        </div></div>
        @if (value.status === 'ACTIVE') {
        <form class="card stack create-panel" [formGroup]="caseForm" (ngSubmit)="createCase()">
          <div class="section-header"><div><h2>Abrir novo caso</h2><p>Registre a origem e um resumo inicial do encaminhamento.</p></div></div>
          <fieldset class="catalog-field" [disabled]="actionBusy()">
            <div class="grid two"><label><span>Origem do encaminhamento&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input formControlName="source" maxlength="80" aria-required="true"></label><label>Resumo inicial<textarea formControlName="summary" maxlength="500"></textarea></label></div>
          </fieldset>
          <div><button [disabled]="caseForm.invalid||actionBusy()">Abrir caso</button></div>
        </form>
        }
        <section class="card">
          <h3>Processos de estudo de caso</h3>
          <fieldset class="catalog-field" [disabled]="caseListBusy()"><app-list-filters [list]="caseList" label="Número ou resumo" placeholder="Número ou texto do caso" /></fieldset>
          @if(cases().length===0){
            <div class="empty-state"><span class="empty-state-mark">0</span><h3>Nenhum caso registrado</h3><p>Os encaminhamentos e suas etapas aparecerão aqui.</p></div>
          } @else if (caseList.totalElements() === 0) {
            <p role="status">Nenhum caso corresponde à busca.</p>
          }
          @for(item of caseList.items();track item.id){
            <app-case-card [item]="item" [allowsReopening]="value.status === 'ACTIVE'" (caseUpdated)="updateCaseFromCard($event)" (recordsRequested)="showCaseRecords($event, 'records')"
              (studyRequested)="showCaseRecords($event, 'cases')" />
          }
          <fieldset class="catalog-field" [disabled]="caseListBusy()">
            <app-pagination [page]="caseList.page()" [totalPages]="caseList.totalPages()"
              label="Páginas de casos" (pageChange)="caseList.setPage($event)" />
          </fieldset>
        </section>
      </section>
    }

    @if (isRecordSection(tab())) {
      <div class="section-header">
        <div>
          @switch (tab()) {
            @case ('cases') {
              <h3 id="student-records-heading" tabindex="-1">Registros do estudo de caso</h3>
              <p>Organize triagens, acolhimentos, investigações, orientações pedagógicas e planos de ação. Se pertinente, vincule o registro a um processo.</p>
            }
            @case ('guidance') {
              <h2 id="student-records-heading" tabindex="-1">Orientações e plano de ação</h2>
              <p>Consulte os registros pedagógicos compartilhados com sua equipe.</p>
            }
            @default {
              <h2 id="student-records-heading" tabindex="-1">Acompanhamento</h2>
              <p>Registre e consulte intervenções, devolutivas, observações de tutoria e solicitações de apoio.</p>
            }
          }
        </div>
      </div>
      @if (recordFormSection() === tab() && (canCreateRecord() || editingRecord() || hasRecordChanges())) {<form class="card stack create-panel" [formGroup]="recordForm" (ngSubmit)="saveRecord()"><div class="section-header"><div><h2 id="record-form-heading" tabindex="-1">{{editingRecord()?'Editar registro':'Novo registro'}}</h2><p>{{editingRecord()?'Atualize as informações pedagógicas. Os vínculos do registro são preservados.':'O formulário exibe somente os campos pertinentes ao tipo escolhido.'}}</p></div></div>
        @if (!editingRecord() && !canCreateRecord()) {
          <p class="notice" role="status">A situação do estudante impede salvar um novo atendimento. Você pode consultar ou descartar o preenchimento.</p>
        }
        <fieldset [disabled]="actionBusy() || (!editingRecord() && !canCreateRecord())" class="record-form-fields"><div class="grid two"><label><span>Tipo&nbsp;<span class="field-required" aria-hidden="true">*</span></span><select formControlName="type" [attr.disabled]="editingRecord()?'':null">@if (!editingRecord() && recordTypes().length > 1) {<option value="">Selecione</option>}@if(editingRecord()&&!hasRecordType(editingRecord()!.type)){<option [value]="editingRecord()!.type">{{label(editingRecord()!.type)}}</option>}@for(option of recordTypes();track option.value){<option [value]="option.value">{{option.label}}</option>}</select></label><label><span>Título&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input formControlName="title"></label></div><app-searchable-select label="Componente curricular" formControlName="subjectId"
          [required]="recordSubjectRequired()" [options]="recordSubjectOptions()" [readonly]="!!editingRecord() || actionBusy()"
          [selectionPlaceholder]="recordSubjectRequired() ? 'Selecione' : 'Sem componente específico'"
          emptyMessage="Nenhum componente disponível." placeholder="Nome ou código" />
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
        <div class="grid two" [formGroup]="structuredRecord">@for(field of activeRecordFields();track field.key){<label>{{field.label}}<textarea [formControlName]="field.key"></textarea></label>}</div><label>Comentários adicionais<textarea formControlName="notes" placeholder="Registre somente informações necessárias à finalidade pedagógica."></textarea></label><label>Situação<select formControlName="status">@if (value.status === 'ACTIVE' || editingRecord()?.status === 'DRAFT') {<option value="DRAFT">Rascunho</option>}<option value="ACTIVE">Finalizado</option></select>
          <span class="field-hint">{{recordForm.controls.status.value==='DRAFT'
            ? 'Registro em elaboração, visível para quem tem autorização para consultar rascunhos.'
            : 'Registro disponível aos profissionais autorizados, de acordo com seus vínculos e permissões.'}}</span>
        </label></fieldset>
        <div class="record-actions">
          <button type="submit" [disabled]="recordForm.invalid || actionBusy()
            || (editingRecord() ? !recordChanges.changed() : !canCreateRecord())">
            {{editingRecord() ? 'Salvar alterações' : 'Salvar registro'}}
          </button>
          @if (editingRecord() || hasRecordChanges()) {
            <button type="button" class="secondary" (click)="confirmCancelRecordEdit()" [disabled]="actionBusy()">
              {{editingRecord() ? 'Cancelar edição' : 'Descartar rascunho'}}
            </button>
          }
        </div>
      </form>}

      <section class="records-list" aria-labelledby="student-records-heading">
        <app-list-filters [list]="recordList" label="Título do registro" placeholder="Buscar por título" />
        <label class="checkbox-row"><input type="checkbox" [checked]="showArchivedRecords()"
          (change)="showArchivedRecords.set($any($event.target).checked); recordList.setPage(0)"> Mostrar registros arquivados</label>
        <div class="records-grid">
          @if (sectionRecords(recordSection()).length === 0) {
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
          label="Páginas de registros" (pageChange)="recordList.setPage($event)" />
      </section>
    }

    @if(tab()==='pei'){
      <div class="section-header"><div><span class="eyebrow">Planejamento individualizado</span><h2>Planos de Ensino Individualizados</h2><p>{{peiDescription()}}</p></div></div>
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
                <app-searchable-select label="Oferta curricular" formControlName="offeringId" [required]="true"
                  [options]="peiOfferOptions()" placeholder="Componente, turma ou período" />
                <label>Docente responsável<input [value]="auth.user()?.name??''" readonly></label>
              </div>
            </fieldset>
            <div><button type="submit" [disabled]="peiForm.invalid||actionBusy()">Criar rascunho</button></div>
          </form>
        }
      }
      <section class="card">
        <h2>Planos por componente</h2>
        <app-list-filters [list]="peiList" label="Buscar PEIs" placeholder="Componente, período ou docente" />
        @if (peis().length === 0) {
          <div class="empty-state"><span class="empty-state-mark">0</span><h3>Nenhum PEI disponível</h3><p>{{peiOffers().length ? 'Crie um rascunho a partir de uma oferta curricular acima.' : 'Nenhum PEI está disponível neste acompanhamento.'}}</p></div>
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
      @if (auth.hasRole('NAPNE')) {
        <form class="upload-card card stack" [formGroup]="attachmentForm" (ngSubmit)="upload(fileInput)">
          <div><h3>Enviar documento</h3><p>PDF, PNG, JPEG ou DOCX, até 10 MB.</p></div>
          <div class="grid two">
            <label>
              <span>Categoria&nbsp;<span class="field-required" aria-hidden="true">*</span></span>
              <input [formControl]="attachmentCategory">
            </label>
            <label class="upload-field">
              <span>Arquivo&nbsp;<span class="field-required" aria-hidden="true">*</span></span>
              <input #fileInput type="file" (change)="selectFile($event)" accept=".pdf,.png,.jpg,.jpeg,.docx">
              <span class="file-picker">{{selectedFile()?.name || 'Selecione um arquivo'}}</span>
            </label>
            <label>
              Relacionar à versão anterior
              <select [formControl]="previousAttachment">
                <option value="">Criar novo documento</option>
                @for (item of attachments(); track item.id) {
                  <option [value]="item.id">{{item.originalName}} · revisão {{item.revision}}</option>
                }
              </select>
              <span class="field-hint">Use esta opção quando o arquivo substituir uma versão já enviada.</span>
            </label>
          </div>
          <div class="row">
            <button type="submit" [disabled]="!selectedFile() || attachmentForm.invalid || actionBusy()">
              @if (actionBusy()) {<span class="spinner" aria-hidden="true"></span> Enviando…} @else {Enviar documento}
            </button>
          </div>
        </form>
      }
      <section class="card">
        <h2>Arquivos disponíveis</h2>
        <app-list-filters [list]="attachmentList" label="Nome do documento" placeholder="Buscar por nome" />
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
              <div class="document-identity">
                <strong>{{item.originalName}}</strong>
                <p>{{item.category}} · revisão {{item.revision}} · {{formatSize(item.size)}}@if(item.archived){ · Arquivado}</p>
                <small>{{item.uploadedBy}} · {{item.uploadedAt | date:'dd/MM/yyyy, HH:mm'}}</small>
              </div>
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
        <form class="server-list-toolbar filter-toolbar" [formGroup]="timelineForm" (ngSubmit)="filterTimeline()">
          <label>Tipo de evento
            <select #timelineType formControlName="type" (change)="changeTimelineType()">
              <option value="">Todos os eventos</option>
              @for (option of timelineTypes(); track option.value) { <option [value]="option.value">{{option.label}}</option> }
            </select>
          </label>
          <app-filter-disclosure [count]="timelineAdvancedCount()" (expandedChange)="loadTimelineActors($event)">
            <div class="toolbar-grid">
              <app-searchable-select label="Profissional" formControlName="actor" [options]="timelineActors.value()"
                [readonly]="timelineActors.loading() || !!timelineActors.error()"
                selectionPlaceholder="Todos" placeholder="Buscar nome registrado" />
              <label>A partir de <input type="date" formControlName="from"></label>
              <label>Até <input type="date" formControlName="to"></label>
            </div>
            @if (timelineActors.loading()) { <p class="meta" role="status">Carregando autores dos eventos…</p> }
            @if (timelineActors.error(); as error) { <p class="error" role="alert">{{error}}</p> }
            <div class="toolbar-actions"><button type="submit" class="toolbar-button">Aplicar filtros</button></div>
          </app-filter-disclosure>
          @if (timelineFilterActive()) {
            <button type="button" class="toolbar-aux" (click)="clearTimelineFilters(); timelineType.focus()">Limpar filtros</button>
          }
        </form>
        @if (timelineFilterActive()) {
          <app-applied-filters [filters]="timelineAppliedItems()" [fallbackFocus]="timelineType"
            (removed)="removeTimelineFilter($event)" />
        }
        @if (timeline() && !timelineLoading() && !timelineError()) {
          <p class="toolbar-results" role="status">{{timeline()?.totalElements}} resultado(s)</p>
        }
        @if (timelineRangeError()) {<p class="error" role="alert">{{timelineRangeError()}}</p>}
        @if (timelineLoading()) {
          <p role="status">Carregando linha do tempo…</p>
        } @else if (timelineError()) {
          <div class="error" role="alert">{{timelineError()}}</div>
          <button type="button" class="secondary compact" (click)="refreshTimeline(requestedTimelinePage())">Tentar novamente</button>
        } @else if (timeline(); as page) {
          @if (page.content.length === 0) {
            <div class="empty-state"><span class="empty-state-mark">0</span><h3>Nenhum evento na linha do tempo</h3><p>{{timelineFilterActive() ? 'Nenhum acontecimento corresponde aos filtros selecionados.' : 'Os acontecimentos autorizados aparecerão aqui.'}}</p></div>
          }
          <ol class="timeline">
            @for (item of page.content; track item.id) {
              <li [attr.data-type]="item.eventType">
                <span class="timeline-dot" aria-hidden="true"></span>
                <div>
                  <span class="eyebrow">{{timelineLabel(item.eventType)}}</span>
                  @if (timelineLabel(item.eventType)!==item.title) {<h3>{{item.title}}</h3>}
                  <p>{{item.actor}} · {{item.createdAt | date:'dd/MM/yyyy, HH:mm'}}</p>
                  @if (item.eventType.startsWith('STUDENT_') && item.data?.effectiveDate) {
                    <p>Data da ocorrência: {{item.data?.effectiveDate | date:'dd/MM/yyyy'}}</p>
                    @if (item.data?.previousStatus !== item.data?.newStatus) {
                      <p>Situação acadêmica: {{statusLabel(item.data?.previousStatus)}} → {{statusLabel(item.data?.newStatus)}}</p>
                    } @else {
                      <p>Situação acadêmica: {{statusLabel(item.data?.newStatus)}}</p>
                    }
                    @if (item.data?.reason; as reason) {<p>Motivo: {{reasonLabel(reason)}}</p>}
                    @if (item.data?.observations; as observations) {<p class="status-observations">{{observations}}</p>}
                  }
                </div>
              </li>
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
      <fieldset><legend>Vínculo acadêmico e contato</legend><div class="grid two">@if(editStudentOpen()) {
        <app-searchable-select label="Curso" formControlName="courseId" [required]="true"
          [options]="studentCourseOptions()" [readonly]="studentSaving()" placeholder="Nome, código ou campus" />
      }<label>E-mail institucional<input type="email" formControlName="institutionalEmail"></label><label>Telefone<input formControlName="phone"></label></div></fieldset>
      <div class="dialog-actions"><button type="button" class="secondary" (click)="closeStudentEdit()" [disabled]="studentSaving()">Cancelar</button><button type="submit" [disabled]="studentEditForm.invalid||studentSaving()||!studentChanges.changed()">@if(studentSaving()){<span class="spinner"></span>}Salvar alterações</button></div>
    </form>
  </app-modal-shell>
`,styles:[`.dossier-fields,.catalog-field{border:0;padding:0;margin:0;min-width:0}.dossier-fields{display:grid}.dossier-fields details{scroll-margin-top:10rem}.back-link{display:inline-flex;margin-bottom:1rem;font-weight:700;text-decoration:none}.student-header{display:flex;align-items:center;gap:1.15rem;background:linear-gradient(120deg,#fff 60%,var(--primary-50));border:1px solid var(--border);border-radius:var(--radius-xl);padding:1.5rem}.student-identity{min-width:0;flex:1}.student-head-actions{display:flex;align-items:center;gap:.65rem;flex-wrap:wrap;justify-content:flex-end}.student-identity h1{margin:.15rem 0}.student-meta{display:flex;gap:.7rem;flex-wrap:wrap;color:var(--ink-600)}.student-academic-status{display:flex;flex-wrap:wrap;align-items:center;gap:.45rem;margin:.65rem 0 0}.status-observations{white-space:pre-wrap;overflow-wrap:anywhere}.student-meta span+span::before{content:'·';margin-right:.7rem}.student-tabs{background:var(--background);position:sticky;top:4.75rem;z-index:20;padding-top:1rem}.dossier-layout{display:grid;grid-template-columns:14rem minmax(0,1fr);gap:1rem;align-items:start}.section-index{position:sticky;top:9rem;display:grid;gap:.25rem;padding:1rem}.section-index strong{padding:.4rem}.section-index a{padding:.45rem;border-radius:.4rem;text-decoration:none;font-size:.85rem}.section-index a:hover{background:var(--primary-50)}summary{display:flex;justify-content:space-between;gap:1rem}summary small{color:var(--ink-600);font-weight:500}.sticky-actions{position:sticky;bottom:1rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;background:var(--primary-950);color:#fff;border-radius:var(--radius-md);padding:.8rem 1rem;box-shadow:var(--shadow-md);font-size:.85rem}.history{margin-top:1rem;display:grid;gap:.75rem}.change{padding:.5rem 0}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:.75rem}.comparison>div{background:var(--surface-soft);border:1px solid var(--border);border-radius:.5rem;padding:.8rem;min-width:0}.comparison span{font-size:.75rem;color:var(--ink-600);text-transform:uppercase;font-weight:800}.comparison p{white-space:pre-wrap;overflow-wrap:anywhere;margin:.5rem 0 0}.create-panel{margin-bottom:1rem}.records-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.record-card{display:flex;flex-direction:column}.record-head{display:flex;justify-content:space-between;gap:1rem}.record-head h3{margin:.2rem 0}.record-content p{border-top:1px solid var(--border);padding-top:.75rem}.record-content strong,.record-content span{display:block}.record-content strong{font-size:.78rem;color:var(--ink-600);margin-bottom:.15rem}.record-card footer{margin-top:auto;padding-top:1rem;color:var(--ink-600);font-size:.8rem}.record-badges{display:flex;align-items:center;gap:.5rem}.record-actions{display:flex;align-items:center;gap:.75rem}fieldset.record-form-fields{border:0;padding:0;margin:0;min-width:0;display:grid;gap:1rem}.pei-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:1rem;padding:1rem 0;border-top:1px solid var(--border)}.pei-row:first-of-type{border-top:0}.pei-row strong,.pei-row span{display:block}.pei-row>div>span{color:var(--ink-600);margin:0}.upload-field input{position:absolute;opacity:0;width:1px;height:1px}.upload-field>.file-picker{display:flex;align-items:center;min-height:2.8rem;border:1px dashed var(--border-strong);border-radius:.5rem;padding:.7rem;color:var(--ink-600);cursor:pointer}.file-mark{width:3rem;height:3rem;border-radius:.65rem;display:grid;place-items:center;background:var(--primary-100);color:var(--primary-900);font-size:.67rem;font-weight:900}.timeline{list-style:none;padding:0;margin:0}.timeline li{position:relative;display:grid;grid-template-columns:1.2rem 1fr;gap:1rem;padding-bottom:1.5rem}.timeline li:not(:last-child)::before{content:'';position:absolute;left:.38rem;top:1rem;bottom:0;width:2px;background:var(--border)}.timeline-dot{position:relative;z-index:1;width:.82rem;height:.82rem;border:3px solid var(--primary-700);background:#fff;border-radius:50%;margin-top:.2rem}.timeline li[data-type=PEI] .timeline-dot{border-color:var(--info)}.timeline li[data-type=ATTACHMENT] .timeline-dot{border-color:var(--warning)}.timeline h3{margin:.15rem 0}.timeline p{color:var(--ink-600);margin:0}@media(max-width:900px){.student-tabs{top:4.25rem}.dossier-layout{grid-template-columns:1fr}.section-index{display:none}.records-grid{grid-template-columns:1fr}}@media(max-width:700px){.student-header{align-items:flex-start;flex-wrap:wrap}.student-head-actions{width:100%;justify-content:flex-start;margin-left:5.15rem}.student-tabs{margin-inline:-1rem;padding-left:1rem}.comparison{grid-template-columns:1fr}.sticky-actions{align-items:stretch;flex-direction:column}.sticky-actions button{width:100%}.pei-row{grid-template-columns:auto 1fr}.pei-row>.badge{grid-column:2}.pei-row>.button{grid-column:1/-1;width:100%}.section-header>label{width:100%}}
.upload-card { margin-bottom: var(--space-4); }
.upload-card h3 { margin-bottom: var(--space-1); }
.upload-card h3 + p { color: var(--ink-600); margin: 0; }
.upload-field .file-picker { min-width: 0; overflow-wrap: anywhere; }
.upload-field:focus-within .file-picker { outline: 3px solid var(--focus); outline-offset: 2px; }
.document-row {
  display: grid;
  grid-template-columns: 3rem minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--space-2) var(--space-3);
  padding-block: var(--space-4);
}
.document-row + .document-row { border-top: 1px solid var(--border); }
.document-identity { min-width: 0; overflow-wrap: anywhere; }
.document-identity :is(strong, p, small) { display: block; }
.document-identity :is(p, small) { color: var(--ink-600); margin: 0; }
.attachment-actions { display: flex; align-self: center; justify-content: flex-end; gap: var(--space-2); flex-wrap: wrap; }
@media (max-width: 800px) {
  .document-row { grid-template-columns: 3rem minmax(0, 1fr); }
  .attachment-actions { grid-column: 2; justify-content: flex-start; }
}
` ]})
export class StudentDetailComponent implements OnInit{
  private attachmentUpload?: { file: File; category: string; previousId: string; key: string };
  private timelineRequest?: Subscription;
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly route=inject(ActivatedRoute);private readonly api=inject(ApiService);private readonly academic=inject(AcademicApi);private readonly fb=inject(FormBuilder);private readonly toast=inject(ToastService);readonly auth=inject(AuthService);
  readonly id=Number(this.route.snapshot.paramMap.get('id'));readonly tabs=[{id:'dossier',label:'Dossiê'},{id:'enrollments',label:'Matrículas'},{id:'cases',label:'Estudo de caso'},{id:'guidance',label:'Orientações e plano de ação'},{id:'records',label:'Acompanhamento'},{id:'pei',label:'PEI'},{id:'documents',label:'Documentos'},{id:'timeline',label:'Linha do tempo'}];readonly dossierFields=DOSSIER_FIELDS;readonly recordFields=RECORD_FIELDS;readonly dossierSections=[{key:'identification',label:'Identificação e demanda'},{key:'educationalNeeds',label:'Necessidades educacionais'},{key:'healthAndSupport',label:'Saúde e serviços de apoio'},{key:'familyContext',label:'Contexto familiar e autonomia'},{key:'schoolHistory',label:'História escolar'},{key:'strengths',label:'Potencialidades'},{key:'difficulties',label:'Dificuldades'},{key:'initialInterventions',label:'Intervenções e acompanhamento'}];readonly label=labelFor;readonly tone=toneFor;
  readonly structuredDossier=new FormRecord<FormControl<string>>(Object.fromEntries(Object.entries(DOSSIER_FIELDS).flatMap(([section,fields])=>fields.map(field=>[section+'.'+field.key,new FormControl('',{nonNullable:true})]))));readonly structuredRecord=new FormRecord<FormControl<string>>(Object.fromEntries(Object.values(RECORD_FIELDS).flat().map(field=>[field.key,new FormControl('',{nonNullable:true})])));
  readonly student=signal<StudentDetails|null>(null);readonly dossier=signal<Dossier|null>(null);readonly cases=signal<NapneCase[]>([]);readonly records=signal<CareRecord[]>([]);readonly editingRecord=signal<CareRecord|null>(null);readonly peis=signal<Pei[]>([]);readonly subjects=signal<Subject[]>([]);readonly courses=signal<Course[]>([]);readonly attachments=signal<Attachment[]>([]);readonly loading=signal(true);readonly loadError=signal('');readonly tab=signal('dossier');readonly selectedFile=signal<File|null>(null);readonly editStudentOpen=signal(false);readonly studentSaving=signal(false);readonly actionBusy=signal(false);readonly dossierSaving=signal(false);readonly historyVisible=signal(false);readonly historyLoading=signal(false);readonly dossierHistory=signal<{version:number,fields:Record<string,unknown>,author:string,occurredAt:string}[]>([]);
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
  readonly dossierRevisions = createListView(this.dossierHistory, version => [`Versão ${version.version}`, version.author], {
    author: { label: 'Autoria', value: item => item.author },
    version: { label: 'Versão', value: item => item.version },
    from: { label: 'A partir de', value: item => item.occurredAt, kind: 'from' },
    to: { label: 'Até', value: item => item.occurredAt, kind: 'to' },
  });
  private readonly configuredCaseStages = signal<CaseStageOption[] | null>(null);
  readonly caseList = createListView(this.cases, item => [item.id, item.summary, item.source], {
    source: { label: 'Origem', value: item => item.source },
    stage: { label: 'Etapa', value: item => item.stage, display: stage =>
      this.cases().find(item => item.stage === stage)?.stageLabel ?? this.label(stage),
      options: () => (this.configuredCaseStages() ?? []).map(stage => ({ value: stage.code, label: stage.label })) },
    responsible: { label: 'Responsável', value: item => item.responsibleId, display: id =>
      this.cases().find(item => item.responsibleId === Number(id))?.responsible ?? id },
    status: { label: 'Situação', value: item => item.stage === 'ARCHIVED' ? 'Arquivado' : item.closedAt ? 'Encerrado' : 'Aberto' },
    openedFrom: { label: 'Abertura a partir de', value: item => item.openedAt, kind: 'from' },
    openedTo: { label: 'Abertura até', value: item => item.openedAt, kind: 'to' },
    closedFrom: { label: 'Encerramento a partir de', value: item => item.closedAt, kind: 'from' },
    closedTo: { label: 'Encerramento até', value: item => item.closedAt, kind: 'to' },
  });
  readonly recordToArchive = signal<CareRecord | null>(null);
  readonly showArchivedRecords = signal(false);
  protected readonly recordFormSection = signal<RecordSection>('records');
  protected readonly recordSection = computed<RecordSection>(() => {
    const tab = this.tab();
    return this.isRecordSection(tab) ? tab : this.recordFormSection();
  });
  private readonly caseRecords = this.createRecordList('cases');
  private readonly guidanceRecords = this.createRecordList('guidance');
  private readonly followUpRecords = this.createRecordList('records');

  protected get recordList() {
    switch (this.recordSection()) {
      case 'cases': return this.caseRecords;
      case 'guidance': return this.guidanceRecords;
      default: return this.followUpRecords;
    }
  }

  protected isRecordSection(tab: string): tab is RecordSection {
    return tab === 'cases' || tab === 'guidance' || tab === 'records';
  }

  protected sectionRecords(section: RecordSection) {
    return this.records().filter(item => this.sectionForType(item.type) === section
      && (section !== 'guidance' || GUIDANCE_RECORD_TYPES.includes(item.type)));
  }

  private sectionForType(type: string): RecordSection {
    if (!STUDY_RECORD_TYPES.includes(type)) return 'records';
    if (this.auth.hasRole('NAPNE')) return 'cases';
    return 'guidance';
  }

  private createRecordList(section: RecordSection) {
    const visible = computed(() => this.sectionRecords(section).filter(item =>
      this.showArchivedRecords() || item.status !== 'ARCHIVED'));
    return createListView(visible, item => [
      item.title, this.label(item.type), this.recordStatusLabel(item.status), item.createdBy,
    ], {
      type: { label: 'Tipo de registro', value: item => item.type, display: this.label },
      author: { label: 'Autoria', value: item => item.createdBy },
      subject: { label: 'Componente', value: item => item.subjectId ?? 'general',
        display: id => id === 'general' ? 'Sem componente específico' : this.subjectName(Number(id)) },
      ...(this.auth.hasRole('NAPNE') ? { case: {
        label: 'Caso vinculado', value: (item: CareRecord) => item.caseId ?? 'none',
        display: (id: string) => id === 'none' ? 'Sem caso vinculado' : this.recordCaseLabel(Number(id)),
      } } : {}),
      status: { label: 'Situação', value: item => item.status, display: status => this.recordStatusLabel(status) },
      from: { label: 'Registro a partir de', value: item => item.createdAt ?? item.updatedAt, kind: 'from' },
      to: { label: 'Registro até', value: item => item.createdAt ?? item.updatedAt, kind: 'to' },
  });
  }

  readonly unlistedStudentCourse = computed(() => {
    const current = this.student();
    return current && !this.courses().some(course => course.id === current.courseId) ? current : null;
  });
  readonly studentCourseOptions = computed(() => {
    const current = this.unlistedStudentCourse();
    return [
      ...(current ? [{ id: String(current.courseId), label: current.course, detail: 'vínculo atual' }] : []),
      ...this.courses().map(course => ({
        id: String(course.id), label: course.name, detail: `${course.code} · ${course.campus}`,
      })),
    ];
  });
  readonly peiList = createListView(this.peis, item => [
    this.peiSubjectName(item), item.academicTermLabel ?? item.academicTerm, this.peiStatusLabel(item.status), this.peiTeacher(item),
  ], {
    subject: { label: 'Componente curricular', value: item => item.subjectId,
      display: id => {
        const item = this.peis().find(pei => pei.subjectId === Number(id));
        return item ? this.peiSubjectName(item) : this.subjectName(Number(id));
      } },
    term: { label: 'Período letivo', value: item => item.academicTerm, display: term =>
      this.peis().find(item => item.academicTerm === term)?.academicTermLabel ?? term },
    teacher: { label: 'Docente responsável', value: item => item.teacherId, display: id => {
      const item = this.peis().find(pei => pei.teacherId === Number(id));
      return item ? this.peiTeacher(item) || 'Docente #' + id : 'Docente #' + id;
    } },
    status: { label: 'Situação', value: item => item.status, display: status => this.peiStatusLabel(status) },
  });
  readonly showArchivedAttachments = signal(false);
  readonly archivedAttachmentsLoading = signal(false);
  readonly archivedAttachmentsError = signal('');
  private readonly archivedAttachments = signal<Attachment[]>([]);
  protected readonly displayedAttachments = computed(() => this.showArchivedAttachments()
    ? [...this.attachments(), ...this.archivedAttachments()]
    : this.attachments());
  readonly attachmentList = createListView(this.displayedAttachments, item => [item.originalName, item.category, item.uploadedBy], {
    category: { label: 'Categoria', value: item => item.category },
    author: { label: 'Autor do envio', value: item => item.uploadedBy },
    status: { label: 'Situação', value: item => item.archived ? 'Arquivado' : 'Ativo' },
    from: { label: 'Envio a partir de', value: item => item.uploadedAt, kind: 'from' },
    to: { label: 'Envio até', value: item => item.uploadedAt, kind: 'to' },
  });
  readonly timelineForm = this.fb.nonNullable.group({ type: '', actor: '', from: '', to: '' });
  protected readonly timelineActors = createFilterOptions<SearchableOption[]>([]);
  protected readonly timelineTypes = computed(() => [
    { value: 'CASE', label: 'Estudo de caso e etapas' },
    { value: 'DOSSIER', label: 'Dossiê' },
    { value: 'CARE_RECORD', label: 'Acompanhamentos' },
    { value: 'PEI', label: 'PEI' },
    { value: 'ATTACHMENT', label: 'Documentos' },
    ...(this.auth.hasRole('NAPNE') ? [{ value: 'STUDENT_', label: 'Situação e cadastro do estudante' }] : []),
  ]);
  readonly timelineRangeError = signal('');
  private readonly timelineApplied = signal(this.timelineForm.getRawValue());
  protected readonly timelineAppliedItems = computed(() => {
    const formatDate = (value: string) => value.split('-').reverse().join('/');
    return appliedFilterItems(this.timelineApplied(), {
      type: 'Tipo de evento', actor: 'Profissional', from: 'A partir de', to: 'Até',
    }, {
      type: value => this.timelineTypes().find(option => option.value === value)?.label ?? value,
      actor: key => this.timelineActors.value().find(option => option.id === key)?.label ?? 'Nome registrado',
      from: formatDate,
      to: formatDate,
    });
  });
  readonly timelineFilterActive = computed(() => this.timelineAppliedItems().length > 0);
  protected readonly timelineAdvancedCount = computed(() => this.timelineAppliedItems().filter(item => item.key !== 'type').length);
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
  readonly peiOfferOptions = computed(() => this.peiOffers().map(offer => ({
    id: String(offer.id), label: offer.subjectName,
    detail: `${offer.groupCode} · ${offer.periodLabel}${offer.periodLabel === offer.periodCode ? '' : ` · ${offer.periodCode}`}`,
  })));
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
  ngOnInit() {
    this.recordForm.controls.type.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reconcileRecordSubject());
    if (!this.auth.hasRole('NAPNE')) {
      this.selectTab(this.auth.hasRole('COTEP', 'COURSE_COORDINATOR') ? 'guidance' : 'records');
    }
    this.loadAll();
    if (this.auth.hasRole('NAPNE')) this.loadCategories();
    if (this.canCreatePei()) this.loadPeiOffers();
  }

  recordSubjectRequired(): boolean {
    return !this.editingRecord() && this.recordForm.controls.type.value === 'TEACHER_FEEDBACK';
  }

  protected readonly recordSubjectOptions = computed(() => {
    const options = this.subjects().map(subject => ({ id: String(subject.id), label: subject.name, detail: subject.code }));
    const selectedId = this.editingRecord()?.subjectId;
    return selectedId && !options.some(option => option.id === String(selectedId))
      ? [...options, { id: String(selectedId), label: this.subjectName(selectedId), detail: 'Vínculo original' }]
      : options;
  });

  private reconcileRecordSubject(): void {
    const control = this.recordForm.controls.subjectId;
    control.setValidators(this.recordSubjectRequired() ? Validators.required : null);
    if (this.recordSubjectRequired()) {
      reconcileRequiredSelection(control, this.subjects().map(subject => String(subject.id)));
    }
    control.updateValueAndValidity();
  }

  private loadStudentSubjects(): void {
    this.api.studentSubjects(this.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: subjects => {
        this.subjects.set(subjects);
        this.reconcileRecordSubject();
      },
      error: error => this.toast.show(errorMessage(error, 'carregar os componentes curriculares'), 'error'),
    });
  }
  protected selectTab(id: string) {
    this.tab.set(id);
    if (this.isRecordSection(id) && !this.actionBusy() && !this.hasRecordChanges()) {
      if (this.editingRecord() && id !== this.recordFormSection()) {
        this.cancelRecordEdit();
      } else if (!this.editingRecord()) {
        this.recordFormSection.set(id);
        this.reconcileRecordType();
      }
    }
    if (id === 'timeline') this.refreshTimeline();
    if (id === 'cases' && this.auth.hasRole('NAPNE') && this.configuredCaseStages() === null) {
      this.api.studentCaseStages(this.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: stages => this.configuredCaseStages.set(stages),
        error: error => this.toast.show(errorMessage(error, 'carregar as etapas para filtragem'), 'error'),
      });
    }
  }
  canLeave(): boolean {
    return !this.auth.authenticated() || !this.hasUnsavedChanges()
      || window.confirm('Há alterações ainda não salvas. Sair do acompanhamento?');
  }

  private hasUnsavedChanges(): boolean {
    return this.dossierDirty() || (this.editStudentOpen() && this.studentChanges.changed())
      || this.hasRecordChanges() || this.caseForm.dirty || !!this.selectedFile();
  }

  protected hasRecordChanges(): boolean {
    return this.editingRecord() ? this.recordChanges.changed() : this.recordForm.dirty || this.structuredRecord.dirty;
  }

  @HostListener('window:beforeunload', ['$event'])
  protected preventUnsavedUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
      event.returnValue = true;
    }
  }

  canCreatePei(){return this.auth.hasRole('TEACHER') && (this.student()?.status ?? 'ACTIVE') === 'ACTIVE'}

  protected peiDescription(): string {
    const actions = this.peis().flatMap(item => item.allowedActions ?? []);
    const canDraft = (this.canCreatePei() && this.peiOffers().length > 0) || actions.includes('EDIT');
    const canReview = actions.some(action => action === 'APPROVE' || action === 'RETURN');
    if (canDraft && canReview) return 'Elabore, revise e acompanhe os PEIs por componente curricular.';
    if (canDraft) return 'Elabore e acompanhe os PEIs por componente curricular.';
    if (canReview) return 'Analise e acompanhe os PEIs disponíveis para revisão.';
    if (!this.peis().length && !this.auth.hasRole('NAPNE', 'TEACHER', 'COTEP', 'COURSE_COORDINATOR')) {
      return 'A disponibilidade de PEIs segue as permissões do acompanhamento.';
    }
    return 'Consulte os PEIs disponíveis para este estudante por componente curricular.';
  }

  private peiTeacher(item: Pei): string {
    const name = item.content?.['teacherName'];
    return typeof name === 'string' ? name : '';
  }
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
        this.updatePeiOffers(offers);
        this.offersLoading.set(false);
      },
      error: error => {
        this.offersLoading.set(false);
        this.offersError.set(errorMessage(error, 'carregar as ofertas do PEI'));
      },
    });
  }
  visibleTabs() {
    return this.tabs.filter(tab => {
      if (this.auth.hasRole('NAPNE')) return tab.id !== 'guidance';
      if (tab.id === 'guidance') {
        return this.auth.hasRole('COTEP', 'COURSE_COORDINATOR') || this.sectionRecords('guidance').length > 0;
      }
      return !['dossier', 'enrollments', 'cases', 'documents'].includes(tab.id);
    });
  }

  activeRecordFields() { return RECORD_FIELDS[this.recordForm.controls.type.value] ?? []; }

  readonly recordTypes = computed(() => {
    const types = new Set<string>();
    if (this.auth.hasRole('NAPNE')) {
      [...STUDY_RECORD_TYPES, 'NAPNE_FOLLOW_UP', 'SUPPORT_REFUSAL', 'SUPPORT_REQUEST'].forEach(type => types.add(type));
    }
    if (this.auth.hasRole('COTEP', 'COURSE_COORDINATOR')) {
      GUIDANCE_RECORD_TYPES.forEach(type => types.add(type));
    }
    if (this.auth.hasRole('TEACHER')) types.add('TEACHER_FEEDBACK');
    if (this.auth.hasRole('TUTOR')) types.add('TUTOR_OBSERVATION');
    return Array.from(types).filter(type => this.sectionForType(type) === this.recordSection())
      .map(value => ({ value, label: this.label(value) }));
  });

  private reconcileRecordType(): void {
    reconcileRequiredSelection(this.recordForm.controls.type, this.recordTypes().map(option => option.value));
  }

  readonly statusDialog = signal<'change' | 'restore' | null>(null);
  readonly academicStatus = academicStudentStatus;
  readonly statusLabel = academicStatusLabel;
  readonly reasonLabel = studentStatusReasonLabel;

  openStatusHistory(): void {
    this.timelineForm.reset();
    this.timelineForm.controls.type.setValue('STUDENT_');
    if (this.tab() !== 'timeline') this.tab.set('timeline');
    this.filterTimeline();
  }

  onStatusSaved(updated: StudentDetails): void {
    const restored = this.statusDialog() === 'restore';
    const resumed = this.student()?.status !== 'ACTIVE' && updated.status === 'ACTIVE';
    this.student.set(updated);
    if (resumed) this.api.cases(this.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: cases => this.cases.set(cases),
      error: failure => this.toast.show(errorMessage(failure, 'atualizar as opções dos casos'), 'error'),
    });
    this.statusDialog.set(null);
    this.toast.show(restored ? 'Cadastro desarquivado.' : 'Situação acadêmica atualizada.', 'success');
    this.refreshTimeline();
    if (this.canCreatePei()) this.loadPeiOffers();
  }

  canCreateRecord() { return this.student()?.status === 'ACTIVE' && this.recordTypes().length > 0; }

  loadAll(){this.loading.set(true);this.loadError.set('');forkJoin({student:this.api.student(this.id),dossier:this.api.dossier(this.id),cases:this.api.cases(this.id),records:this.api.records(this.id),peis:this.api.peis(this.id),attachments:this.api.attachments(this.id)}).subscribe({next:v=>{this.student.set(v.student);this.dossier.set(v.dossier);this.cases.set(v.cases);this.records.set(v.records);this.peis.set(v.peis);this.attachments.set(v.attachments);this.fillDossier(v.dossier);this.loadStudentSubjects();if(this.auth.hasRole('NAPNE'))this.api.courses().subscribe({next:c=>this.courses.set(c),error:e=>this.toast.show(errorMessage(e,'carregar os cursos'),'error')});if (!this.editingRecord() && !this.hasRecordChanges()) this.reconcileRecordType();this.loading.set(false);this.refreshTimeline()},error:e=>{this.loading.set(false);this.loadError.set(errorMessage(e,'carregar o acompanhamento'))}})}
  openStudentEdit(){const value=this.student();if(!value)return;this.studentEditForm.reset({courseId:String(value.courseId),civilName:value.civilName??'',socialName:value.socialName??'',birthDate:value.birthDate??'',institutionalEmail:value.institutionalEmail??'',phone:value.phone??''});this.studentChanges.capture();this.editStudentOpen.set(true)}
  closeStudentEdit(){
    if (!this.studentSaving() && (!this.studentChanges.changed()
        || window.confirm('Descartar alterações ainda não salvas no cadastro?'))) this.editStudentOpen.set(false);
  }
  saveStudent(){const current=this.student();this.studentEditForm.markAllAsTouched();if(!current||this.studentEditForm.invalid||this.studentSaving()||!this.studentChanges.changed())return;const value=this.studentEditForm.getRawValue();this.studentSaving.set(true);this.api.updateStudent(this.id,{registration:current.registration,courseId:Number(value.courseId),civilName:value.civilName,socialName:value.socialName,birthDate:value.birthDate||null,institutionalEmail:value.institutionalEmail||null,phone:value.phone||null}).subscribe({next:updated=>{this.student.set(updated);this.studentSaving.set(false);this.editStudentOpen.set(false);this.toast.show('Dados cadastrais do estudante atualizados.','success');this.loadStudentSubjects()},error:e=>{this.studentSaving.set(false);this.toast.show(errorMessage(e,'atualizar o cadastro do estudante'),'error')}})}
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
    if(this.student()?.status !== 'ACTIVE' || this.caseForm.invalid || this.actionBusy())return;
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

  showCaseRecords(caseId: number, section: 'cases' | 'records'): void {
    this.selectTab(section);
    this.recordList.setFilter('case', String(caseId));
    setTimeout(() => document.getElementById('student-records-heading')?.focus(), 0);
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
    if (this.student()?.status === 'ARCHIVED' || item.status === 'ARCHIVED' || item.status === 'SUPERSEDED') return false;
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
    if (this.hasRecordChanges() && !window.confirm('Descartar as alterações do registro em edição?')) return;
    this.editingRecord.set(item);
    this.recordFormSection.set(this.sectionForType(item.type));
    this.tab.set(this.recordFormSection());
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
    if (!this.hasRecordChanges() || window.confirm('Descartar alterações ainda não salvas no registro?')) {
      this.cancelRecordEdit();
    }
  }

  cancelRecordEdit(){
    this.editingRecord.set(null);
    this.recordFormSection.set(this.recordSection());
    this.recordForm.reset();
    this.reconcileRecordType();
    this.reconcileRecordSubject();
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
      if (!this.canCreateRecord() || !this.hasRecordType(v.type)) return;
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
    const offer = this.peiOffers().find(candidate => candidate.id === offeringId);
    if (!offer) return;
    this.actionBusy.set(true);
    this.api.createPei(this.id, { offeringId }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: pei => {
        this.peis.update(items => [pei, ...items.filter(item => item.id !== pei.id)]);
        this.updatePeiOffers(this.peiOffers().filter(candidate =>
          candidate.subjectId !== offer.subjectId || candidate.periodCode !== offer.periodCode));
        if (this.hasUnsavedChanges()) {
          this.done('Rascunho criado. Conclua as outras alterações e abra o rascunho na listagem.');
          return;
        }
        this.toast.show('Rascunho do PEI criado.', 'success');
        void this.router.navigate(['/estudantes', this.id, 'pei', pei.id]).then(
          opened => { if (!opened) this.peiNavigationFailed(); },
          () => this.peiNavigationFailed(),
        );
      },
      error: error => {
        this.actionBusy.set(false);
        this.toast.show(errorMessage(error, 'criar o PEI'), 'error');
      },
    });
  }
  private updatePeiOffers(offers: AcademicOffering[]): void {
    this.peiOffers.set(offers);
    reconcileRequiredSelection(this.peiForm.controls.offeringId, offers.map(offer => String(offer.id)));
  }

  private peiNavigationFailed(): void {
    this.actionBusy.set(false);
    this.toast.show('Rascunho criado. Abra o editor pela listagem de PEIs.', 'error');
    this.refreshTimeline();
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

  filterTimeline(): void {
    const filter = this.timelineForm.getRawValue();
    if (filter.from && filter.to && filter.from > filter.to) {
      this.timelineRangeError.set('A data final deve ser igual ou posterior à data inicial.');
      return;
    }
    this.timelineRangeError.set('');
    this.timelineApplied.set(filter);
    this.refreshTimeline();
  }

  protected changeTimelineType(): void {
    this.timelineApplied.update(applied => ({ ...applied, type: this.timelineForm.controls.type.value }));
    this.refreshTimeline();
  }

  protected removeTimelineFilter(key: string): void {
    const control = this.timelineForm.get(key);
    if (!control) return;
    control.reset();
    this.timelineRangeError.set('');
    this.timelineApplied.update(applied => ({ ...applied, [key]: '' }));
    this.refreshTimeline();
  }

  protected loadTimelineActors(open: boolean): void {
    if (open) this.timelineActors.load(this.api.timelineActors(this.id));
    else this.timelineActors.cancel();
  }

  clearTimelineFilters(): void {
    this.timelineForm.reset();
    this.filterTimeline();
  }

  changes(fields:Record<string,unknown>){return Object.entries(fields).map(([key,previous])=>({key,previous,current:this.dossier()?.[key as keyof Dossier]})).filter(v=>JSON.stringify(v.previous)!==JSON.stringify(v.current))}
  selectFile(event:Event){this.selectedFile.set((event.target as HTMLInputElement).files?.[0]??null)}download(item:Attachment){this.api.downloadAttachment(this.id,item.id).subscribe({next:blob=>{const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=item.originalName;a.click();URL.revokeObjectURL(url)},error:e=>this.toast.show(errorMessage(e,'baixar o documento'),'error')})}
  private subjectName(id: number): string {
    return this.subjects().find(subject => subject.id === id)?.name ?? `Componente #${id}`;
  }

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
    const { type, actor, from, to } = this.timelineApplied();
    const filters = {
      actorKey: actor,
      from: from ? new Date(from + 'T00:00:00').toISOString() : undefined,
      to: to ? new Date(to + 'T23:59:59.999').toISOString() : undefined,
    };
    this.timelineRequest = this.api.timeline(this.id, type, page, filters)
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
