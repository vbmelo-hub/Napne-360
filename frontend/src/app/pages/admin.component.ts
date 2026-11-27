import { Component, DestroyRef, HostListener, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Observable, Subject, catchError, map, of, switchMap, timer } from 'rxjs';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { LIST_PAGE_SIZE, ListFilters, createListView } from '../core/list-view';
import { Campus, Page, UserView } from '../core/models';
import { cpfDigits, formatCpf, validateCpf } from '../core/cpf';
import { reconcileRequiredSelection } from '../core/required-selection';
import { trackFormChanges } from '../core/form-changes';
import { errorMessage, labelFor } from '../core/presentation';
import { ToastService } from '../core/toast.service';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { ModalShellComponent } from '../shared/modal-shell.component';
import { PaginationComponent } from '../shared/pagination.component';
import { ListFiltersComponent } from '../shared/list-filters.component';
import { AdminAcademicComponent } from './admin-academic.component';
import { AdminCaseStagesComponent } from './admin-case-stages.component';
import { AdminReferencesComponent } from './admin-references.component';

type UserAction = 'archive' | 'reactivate' | 'revoke' | 'block';

const EMPTY_USERS: Page<UserView> = { content: [], totalElements: 0, totalPages: 0, number: 0, size: LIST_PAGE_SIZE };

@Component({standalone:true,imports:[FormsModule,ReactiveFormsModule,AdminAcademicComponent,AdminReferencesComponent,AdminCaseStagesComponent,ConfirmDialogComponent,ModalShellComponent,PaginationComponent,ListFiltersComponent],template:`
  <header class="page-header"><div><span class="eyebrow">Configuração institucional</span><h1>Administração técnica</h1><p>Gerencie a estrutura e os acessos do sistema. Este perfil não recebe acesso automático aos dossiês.</p></div></header>
  <nav class="tabs admin-tabs" aria-label="Áreas da administração">@for(item of tabs;track item.id){<button type="button" [class.selected]="tab()===item.id" [attr.aria-current]="tab()===item.id?'page':null" (click)="selectTab(item.id)">{{item.label}}</button>}</nav>
  @if(tab()==='users'){
    <section class="card users-card"><div class="section-header"><div><h2>Contas cadastradas</h2><p>Perfis, campus e situação de acesso.</p></div><button type="button" (click)="openCreateUser()">Nova conta</button></div>
      <app-list-filters [list]="userFilters" label="Buscar contas" placeholder="Nome, CPF ou matrícula" [showCount]="!loading() && !usersError()" />
      @if (loading()) {
        <div class="loading-grid" aria-label="Carregando contas"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-card"></span></div>
      } @else if (usersError()) {
        <div class="empty-state"><p>Não foi possível carregar as contas.</p><button type="button" class="secondary" (click)="reloadUsers()">Tentar novamente</button></div>
      } @else if (!userResults().totalElements) {
        <p class="empty-state">{{userQuery().trim() || hasUserFilters() ? 'Nenhuma conta corresponde aos filtros.' : 'Nenhuma conta cadastrada.'}}</p>
      } @else {<div class="table-wrap"><table class="mobile-cards"><thead><tr><th>Usuário</th><th>Campus</th><th>Perfis</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>@for(u of userResults().content;track u.id){<tr><td data-label="Usuário"><strong>{{u.name}}</strong><small>{{u.email}}</small>@if (u.cpfMasked || u.institutionalRegistration) {<small>{{u.cpfMasked}} {{u.institutionalRegistration}}</small>}</td><td data-label="Campus">{{campusLabel(u.campusId)}}</td><td data-label="Perfis"><div class="roles">@for(role of u.roles;track role){<span class="badge badge--info">{{label(role)}}</span>}</div></td><td data-label="Situação"><span [class]="u.active?'badge badge--success':'badge'">{{userStatus(u)}}</span></td><td><div class="row"><button class="secondary compact" (click)="openEditUser(u)" [disabled]="busy()">Editar</button><button class="secondary compact" (click)="editAccess(u)">Acessos</button>@if (u.active || u.securityBlocked) {<button class="secondary compact" (click)="askUserAction(u,'archive')">Inativar</button>}@if (!u.active) {<button class="secondary compact" (click)="askUserAction(u,'reactivate')">Reativar</button>}</div></td></tr>}</tbody></table></div>}
      @if (!loading() && userResults().totalPages > 1) {
        <app-pagination class="list-pagination" [page]="userPage()" [totalPages]="userResults().totalPages"
          label="Paginação de contas" (pageChange)="setUserPage($event)" />
      }
    </section>
  }
  @if (tab() === 'campuses') {
    <section class="card">
      <div class="section-header"><h2>Campi cadastrados</h2><button type="button" (click)="openCampusForm()">Novo campus</button></div>
      @if (campuses().length) {
        <app-list-filters [list]="campusList" label="Buscar campi" placeholder="Nome ou código" />
      }
      @if (!campusList.totalElements()) {
        <p class="empty-state">{{campuses().length ? 'Nenhum campus corresponde aos filtros.' : 'Nenhum campus cadastrado.'}}</p>
      }
      @for (campus of campusList.items(); track campus.id) {
        <article class="campus-row">
          <div><strong>{{campus.name}}</strong><small>{{campus.code}}</small></div>
          <div class="row">
            <span [class]="campus.active ? 'badge badge--success' : 'badge'">{{campus.active ? 'Ativo' : 'Arquivado'}}</span>
            <button class="secondary compact" type="button" (click)="openCampusForm(campus)">Editar</button>
            <button class="secondary compact" type="button" (click)="campusTarget.set(campus)">{{campus.active ? 'Arquivar' : 'Reativar'}}</button>
          </div>
        </article>
      }
      <app-pagination [page]="campusList.page()" [totalPages]="campusList.totalPages()"
        label="Paginação de campi" (pageChange)="campusList.setPage($event)" />
    </section>
  }
  @if(tab()==='academic'){<app-admin-academic />}
  @if(tab()==='references'){<app-admin-references />}
  @if(caseStagesOpened()){<app-admin-case-stages [hidden]="tab()!=='case-stages'" />}
  <app-modal-shell [open]="showUserForm()" eyebrow="Conta institucional"
    [title]="editUser() ? 'Editar conta' : 'Criar nova conta'"
    [description]="editUser() ? 'Atualize os dados cadastrais. Alterar e-mail ou campus encerra as sessões da conta.' : 'Comunique a senha temporária por um canal seguro.'"
    (closed)="closeUserForm()">
    <form class="stack" [formGroup]="userForm" (ngSubmit)="saveUser()">
      <div class="grid two">
        <label><span>Nome&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input formControlName="name" maxlength="160" required></label>
        <label [class.required]="cpfRequired()">CPF
          <input formControlName="cpf" inputmode="numeric" maxlength="14" autocomplete="off"
            [attr.aria-required]="cpfRequired() ? 'true' : null" (input)="maskCpf($any($event.target))">
          @if (userForm.controls.cpf.touched && userForm.controls.cpf.hasError('cpf')) {
            <span class="field-hint" role="alert">Informe um CPF válido.</span>
          } @else if (editUser() && !cpfRequired()) {
            <span class="field-hint">Conta legada. Informe o CPF após confirmar o documento.</span>
          }
        </label>
        <label><span>E-mail&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input type="email" formControlName="email" maxlength="190" required></label>
        <label>Matrícula institucional<input formControlName="institutionalRegistration" maxlength="60">
          <span class="field-hint">SIAPE ou matrícula acadêmica, quando aplicável.</span>
        </label>
        <label [class.required]="campusRequired()">Campus
          <select formControlName="campusId" [attr.aria-required]="campusRequired() ? 'true' : null">
            <option value="">{{campusRequired() ? 'Selecione' : 'Sem campus (admin técnico)'}}</option>
            @for (campus of campusOptions(); track campus.id) {
              <option [value]="campus.id">{{campus.name}}{{campus.active ? '' : ' (arquivado)'}}</option>
            }
          </select>
          @if (campusRequired() && !userForm.controls.campusId.value) {
            <span class="field-hint">Vincule a conta a um campus para conceder perfis institucionais.</span>
          }
        </label>
        @if (!editUser()) {
          <label><span>Perfil inicial&nbsp;<span class="field-required" aria-hidden="true">*</span></span><select formControlName="role" required>
            @for (role of roles; track role.value) {<option [value]="role.value">{{role.label}}</option>}
          </select></label>
          <label><span>Senha temporária&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input type="password" formControlName="password" autocomplete="new-password" required>
            <span class="field-hint">12 a 72 caracteres.</span>
          </label>
        }
      </div>
      @if (editUser() && userChanges.changed()) {<p class="field-hint" aria-live="polite">Há alterações pendentes.</p>}
      <div class="dialog-actions">
        <button class="secondary" type="button" (click)="closeUserForm()" [disabled]="busy()">Cancelar</button>
        <button [disabled]="!canSaveUser()">{{editUser() ? 'Salvar alterações' : 'Criar conta'}}</button>
      </div>
    </form>
  </app-modal-shell>
  <app-modal-shell [open]="accessUser() !== null" eyebrow="Perfis e segurança" [title]="'Acessos de ' + (accessUser()?.name ?? 'usuário')"
    [description]="accessUser()?.email ?? ''" (closed)="closeAccess()">
    <div class="access-settings">
      <form class="access-section" (ngSubmit)="changeRoles()">
        <fieldset>
          <legend>Perfis autorizados</legend>
          <div class="role-checks">
            @for (role of roles; track role.value) {
              <label><input type="checkbox" [checked]="selectedRoles().includes(role.value)"
                (change)="toggleRole(role.value, $any($event.target).checked)"><span>{{role.label}}</span></label>
            }
          </div>
        </fieldset>
        @if (campusRoleError()) {<p class="field-hint" role="alert">{{campusRoleError()}}</p>}
        @if (roleChanges.changed()) {<p class="field-hint" aria-live="polite">Há alterações pendentes.</p>}
        <div class="row"><button [disabled]="!selectedRoles().length || !roleChanges.changed() || !!campusRoleError() || busy()">Salvar perfis e revogar sessões</button></div>
      </form>
      <form class="access-section" aria-labelledby="password-reset-title" (ngSubmit)="resetPassword()">
        <div>
          <h3 id="password-reset-title">Redefinição de senha</h3>
          <p>Redefinir a senha temporária revoga as sessões atuais da conta.</p>
        </div>
        <div class="row password-reset-controls">
          <label>Nova senha<input type="password" autocomplete="new-password" [formControl]="resetSecret"></label>
          <button class="secondary" [disabled]="resetSecret.invalid || busy()">Redefinir senha</button>
        </div>
      </form>
      @if (accessUser(); as account) {
        <section class="access-section" aria-labelledby="access-control-title">
          <h3 id="access-control-title">Controle de acesso</h3>
          <div class="row">
            <button class="secondary" type="button" [disabled]="busy()" (click)="askUserAction(account,'revoke')">Revogar sessões</button>
            @if (account.active) {<button class="danger" type="button" [disabled]="busy()" (click)="askUserAction(account,'block')">Bloquear acesso imediatamente</button>}
          </div>
        </section>
      }
    </div>
  </app-modal-shell>
  <app-modal-shell [open]="showCampusForm()" eyebrow="Campus" [title]="editCampus() ? 'Editar campus' : 'Cadastrar campus'"
    (closed)="closeCampusForm()">
    <form class="stack" [formGroup]="campusForm" (ngSubmit)="saveCampus()">
      <div class="grid two">
        <label><span>Nome&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input formControlName="name" maxlength="160" required></label>
        <label><span>Código&nbsp;<span class="field-required" aria-hidden="true">*</span></span><input formControlName="code" maxlength="40" required></label>
      </div>
      @if (editCampus() && campusChanges.changed()) {<p class="field-hint" aria-live="polite">Há alterações pendentes.</p>}
      <div class="dialog-actions">
        <button class="secondary" type="button" [disabled]="busy()" (click)="closeCampusForm()">Cancelar</button>
        <button [disabled]="campusForm.invalid || !campusChanges.changed() || busy()">{{editCampus() ? 'Salvar alterações' : 'Cadastrar campus'}}</button>
      </div>
    </form>
  </app-modal-shell>
  <app-confirm-dialog [open]="userTarget() !== null" [title]="userActionText().title"
    [description]="userActionText().description" [confirmLabel]="userActionText().label"
    [danger]="userTarget()?.action !== 'reactivate'" [busy]="busy()" (confirmed)="confirmUserAction()" (cancelled)="userTarget.set(null)" />
  <app-confirm-dialog [open]="campusTarget() !== null" [title]="campusTarget()?.active ? 'Arquivar este campus?' : 'Reativar este campus?'"
    [description]="campusTarget()?.active ? 'O campus deixa de receber novos vínculos. O histórico permanece disponível.' : 'O campus volta a ficar disponível para novos vínculos.'"
    [confirmLabel]="campusTarget()?.active ? 'Arquivar campus' : 'Reativar campus'"
    [danger]="campusTarget()?.active ?? false" [busy]="busy()" (confirmed)="confirmCampusAction()" (cancelled)="campusTarget.set(null)" />
`,styles:[`.admin-tabs{margin:0 0 1rem}.users-card{padding:0;overflow:hidden}.users-card .section-header{margin:0}.users-card .table-wrap{border-radius:0;border-left:0;border-right:0;border-bottom:0}.users-card td strong,.users-card td small{display:block}.users-card td small{color:var(--ink-600)}.roles{display:flex;gap:.25rem;flex-wrap:wrap}.campus-row{display:flex;align-items:center;justify-content:space-between;padding:.85rem 0;border-top:1px solid var(--border)}.campus-row strong,.campus-row small{display:block}.campus-row small{color:var(--ink-600)}
.users-card { --list-inset: var(--space-6); }
.users-card .section-header { padding: var(--space-5) var(--list-inset); }
.users-card > :is(app-list-filters, .loading-grid, .empty-state) { margin-inline: var(--list-inset); }
.users-card .empty-state button { margin-top: var(--space-2); }
.access-settings { display: grid; gap: var(--space-4); }
.access-section {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--surface-soft);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.access-section fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
.access-section legend { padding: 0; margin-bottom: var(--space-2); }
.access-section h3, .access-section p { margin: 0; }
.access-section p { color: var(--ink-600); font-size: .875rem; }
.role-checks {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
  gap: var(--space-2);
}
.role-checks label {
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.role-checks input { width: auto; }
.password-reset-controls { align-items: end; }
.password-reset-controls label { flex: 0 1 19rem; min-width: 0; }
@media (max-width: 700px) {
  .users-card { --list-inset: var(--space-4); }
  .users-card .table-wrap { padding-inline: var(--list-inset); }
  .access-section { padding: var(--space-3); }
}
` ]})
export class AdminComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly tabs = [
    { id: 'users', label: 'Usuários e acessos' }, { id: 'campuses', label: 'Campi' },
    { id: 'academic', label: 'Cursos, componentes e vínculos' },
    { id: 'references', label: 'Cadastros de referência' }, { id: 'case-stages', label: 'Etapas dos casos' },
  ];
  readonly tab = signal('users');
  readonly roles = [
    { value: 'ADMIN', label: 'Administrador técnico' }, { value: 'NAPNE', label: 'Equipe NAPNE' },
    { value: 'COTEP', label: 'COTEP' }, { value: 'COURSE_COORDINATOR', label: 'Coordenação de curso' },
    { value: 'TEACHER', label: 'Professor' }, { value: 'TUTOR', label: 'Monitor/Tutor' },
    { value: 'MANAGEMENT', label: 'Gestão' },
  ];

  readonly userResults = signal<Page<UserView>>(EMPTY_USERS);
  readonly userQuery = signal('');
  readonly userPage = signal(0);
  readonly usersError = signal(false);
  private readonly selectedUserFilters = signal<Readonly<Record<string, string>>>({});
  private readonly userRequests = new Subject<boolean>();
  readonly hasUserFilters = computed(() => Object.values(this.selectedUserFilters()).some(Boolean));
  readonly campuses = signal<Campus[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly showUserForm = signal(false);
  readonly editUser = signal<UserView | null>(null);
  readonly accessUser = signal<UserView | null>(null);
  readonly showCampusForm = signal(false);
  readonly editCampus = signal<Campus | null>(null);
  readonly userTarget = signal<{ user: UserView; action: UserAction } | null>(null);
  readonly campusTarget = signal<Campus | null>(null);
  readonly caseStagesOpened = signal(false);
  readonly label = labelFor;

  readonly userForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(160), this.nonBlank]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(190)]],
    cpf: ['', validateCpf],
    institutionalRegistration: ['', Validators.maxLength(60)],
    password: ['', [Validators.minLength(12), Validators.maxLength(72)]],
    campusId: [''],
    role: ['NAPNE'],
  });
  private readonly userValues = toSignal(this.userForm.valueChanges.pipe(map(() => this.userForm.getRawValue())),
    { initialValue: this.userForm.getRawValue() });
  private readonly userFields = computed(() => {
    const value = this.userValues();
    return {
      name: value.name.trim(), email: value.email.trim().toLowerCase(), cpf: value.cpf,
      institutionalRegistration: value.institutionalRegistration.trim() || null,
      campusId: value.campusId ? Number(value.campusId) : null,
      role: this.editUser() ? null : value.role, password: this.editUser() ? null : value.password,
    };
  });
  readonly userChanges = trackFormChanges(this.userFields);
  readonly cpfRequired = computed(() => !this.editUser() || !!this.userChanges.saved().cpf);
  readonly campusRequired = computed(() => {
    const user = this.editUser();
    return user ? user.roles.some(role => role !== 'ADMIN') : this.userValues().role !== 'ADMIN';
  });
  readonly campusOptions = computed(() => this.campuses().filter(campus => campus.active || campus.id === this.editUser()?.campusId));

  readonly selectedRoles = signal<string[]>([]);
  readonly roleChanges = trackFormChanges(this.selectedRoles);
  readonly resetSecret = this.fb.nonNullable.control('', [Validators.required, Validators.minLength(12), Validators.maxLength(72)]);
  readonly campusRoleError = computed(() => {
    if (this.accessUser()?.campusId != null) return '';
    const role = this.roles.find(candidate => candidate.value !== 'ADMIN' && this.selectedRoles().includes(candidate.value));
    return role ? `Para conceder o perfil ${role.label}, é necessário vincular este usuário a um campus.` : '';
  });

  readonly campusForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(160), this.nonBlank]],
    code: ['', [Validators.required, Validators.maxLength(40), this.nonBlank]],
  });
  private readonly campusValues = toSignal(this.campusForm.valueChanges.pipe(map(() => this.campusForm.getRawValue())),
    { initialValue: this.campusForm.getRawValue() });
  private readonly campusFields = computed(() => ({
    name: this.campusValues().name.trim(),
    code: this.campusValues().code.trim().toUpperCase(),
  }));
  readonly campusChanges = trackFormChanges(this.campusFields);

  readonly userFilters: ListFilters = {
    query: this.userQuery.asReadonly(),
    filters: this.selectedUserFilters.asReadonly(),
    fields: computed(() => [
      { key: 'campus', label: 'Campus', kind: 'select', options: [
        { value: 'none', label: 'Sem campus' },
        ...this.campuses().map(campus => ({
          value: String(campus.id), label: campus.active ? campus.name : campus.name + ' (arquivado)',
        })),
      ] },
      { key: 'role', label: 'Perfil', kind: 'select', options: this.roles },
      { key: 'status', label: 'Situação', kind: 'select', options: [
        { value: 'ACTIVE', label: 'Ativa' }, { value: 'INACTIVE', label: 'Inativa' },
        { value: 'BLOCKED', label: 'Bloqueada' },
      ] },
    ]),
    totalElements: computed(() => this.loading() ? 0 : this.userResults().totalElements),
    setQuery: value => {
      this.userQuery.set(value);
      this.userPage.set(0);
      this.reloadUsers(true);
    },
    setFilter: (key, value) => {
      this.selectedUserFilters.update(filters => ({ ...filters, [key]: value }));
      this.setUserPage(0);
    },
    reset: () => {
      this.userQuery.set('');
      this.selectedUserFilters.set({});
      this.setUserPage(0);
    },
  };
  readonly campusList = createListView(this.campuses, campus => [
    campus.name, campus.code, campus.active ? 'Ativo' : 'Arquivado Inativo',
  ], { status: { label: 'Situação', value: campus => campus.active ? 'Ativo' : 'Arquivado' } });

  readonly userActionText = computed(() => {
    const target = this.userTarget();
    if (!target) return { title: '', description: '', label: '' };
    const name = target.user.name;
    switch (target.action) {
      case 'archive': return { title: 'Inativar esta conta?', description: `A conta de ${name} perde acesso após a verificação de dependências. O histórico é preservado.`, label: 'Inativar conta' };
      case 'reactivate': return { title: 'Reativar esta conta?', description: `A conta de ${name} recupera o acesso com os perfis atuais.`, label: 'Reativar conta' };
      case 'revoke': return { title: 'Revogar as sessões desta conta?', description: `${name} precisará entrar novamente.`, label: 'Revogar sessões' };
      case 'block': return { title: 'Bloquear o acesso imediatamente?', description: `As sessões de ${name} serão encerradas. Vínculos e responsabilidades continuarão registrados.`, label: 'Bloquear acesso' };
    }
  });

  ngOnInit() {
    this.userForm.controls.role.valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.selectRequiredCampus());
    this.userRequests.pipe(
      switchMap(debounce => {
        const page = this.userPage();
        const query = this.userQuery().trim();
        const filters = this.selectedUserFilters();
        return (debounce ? timer(250) : of(0)).pipe(
          switchMap(() => this.api.usersPage(page, query, filters)),
          catchError(failure => {
            this.toast.show(errorMessage(failure, 'carregar as contas'), 'error');
            return of(null);
          }),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(result => {
      if (result && this.userPage() >= Math.max(result.totalPages, 1)) {
        this.setUserPage(Math.max(0, result.totalPages - 1));
        return;
      }
      this.userResults.set(result ?? EMPTY_USERS);
      this.usersError.set(result === null);
      this.loading.set(false);
    });
    this.reloadUsers();
    this.loadCampuses();
  }

  selectTab(tab: string) {
    if (this.tab() === tab || this.busy() || this.hasPendingChanges(false) && !this.confirmDiscard()) return;
    this.showUserForm.set(false);
    this.accessUser.set(null);
    this.showCampusForm.set(false);
    this.tab.set(tab);
    if (tab === 'case-stages') this.caseStagesOpened.set(true);
  }

  canLeave(): boolean {
    return !this.busy() && (!this.hasPendingChanges() || this.confirmDiscard());
  }

  @HostListener('window:beforeunload', ['$event'])
  warnBeforeUnload(event: BeforeUnloadEvent) {
    if (this.hasPendingChanges()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  campusLabel(id: number | null) {
    return id === null ? 'Sem campus' : this.campuses().find(campus => campus.id === id)?.name ?? 'Campus vinculado';
  }

  userStatus(user: UserView) {
    return user.active ? 'Ativa' : user.securityBlocked ? 'Bloqueada' : 'Inativa';
  }

  openCreateUser() {
    this.editUser.set(null);
    this.userForm.reset({ role: 'NAPNE' });
    this.showUserForm.set(true);
    this.selectRequiredCampus();
    this.userChanges.capture();
  }

  openEditUser(user: UserView) {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.userDetails(user.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: details => {
        this.editUser.set({ ...user, campusId: details.campusId });
        this.userForm.reset({
          name: details.name, email: details.email, cpf: formatCpf(details.cpf ?? ''),
          institutionalRegistration: details.institutionalRegistration ?? '',
          campusId: details.campusId === null ? '' : String(details.campusId), role: 'NAPNE',
        });
        this.userChanges.capture();
        this.busy.set(false);
        this.showUserForm.set(true);
      },
      error: failure => this.fail(failure, 'carregar os dados da conta'),
    });
  }

  maskCpf(input: HTMLInputElement) {
    const formatted = formatCpf(input.value);
    this.userForm.controls.cpf.setValue(formatted);
    input.value = formatted;
  }

  canSaveUser() {
    const fields = this.userFields();
    const { name, email, cpf, institutionalRegistration, password } = this.userForm.controls;
    if ([name, email, cpf, institutionalRegistration].some(control => control.invalid)
        || this.busy() || !this.userChanges.changed()) return false;
    if (this.cpfRequired() && !cpfDigits(fields.cpf)) return false;
    if (this.campusRequired() && fields.campusId === null) return false;
    return !!this.editUser() || password.valid && password.value.length >= 12;
  }

  saveUser() {
    if (!this.canSaveUser()) return;
    const user = this.editUser();
    const { name, email, cpf, institutionalRegistration, campusId, password, role } = this.userFields();
    const fields = { name, email, cpf: cpfDigits(cpf), institutionalRegistration, campusId };
    const request = user
      ? this.api.updateUser(user.id, fields)
      : this.api.createUser({ ...fields, password, roles: [role] });
    this.busy.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.userForm.reset({ role: 'NAPNE' });
        this.userChanges.capture();
        this.showUserForm.set(false);
        this.busy.set(false);
        this.toast.show(user ? 'Conta atualizada.' : 'Conta criada com sucesso.', 'success');
        this.reloadUsers();
      },
      error: failure => this.fail(failure, user ? 'salvar os dados da conta' : 'criar a conta'),
    });
  }

  closeUserForm() {
    if (this.userTarget() || this.busy() || this.userChanges.changed() && !this.confirmDiscard()) return;
    this.showUserForm.set(false);
    this.userForm.reset({ role: 'NAPNE' });
    this.userChanges.capture();
  }

  editAccess(user: UserView) {
    if (this.busy()) return;
    this.accessUser.set(user);
    this.selectedRoles.set([...user.roles].sort());
    this.roleChanges.capture();
    this.resetSecret.reset();
  }

  closeAccess() {
    if (this.userTarget() || this.busy()
        || (this.roleChanges.changed() || !!this.resetSecret.value) && !this.confirmDiscard()) return;
    this.accessUser.set(null);
    this.resetSecret.reset();
  }

  toggleRole(role: string, checked: boolean) {
    this.selectedRoles.update(current => checked ? [...current, role].sort() : current.filter(value => value !== role));
  }

  changeRoles() {
    const user = this.accessUser();
    if (!user || this.busy() || this.campusRoleError() || !this.roleChanges.changed() || !this.selectedRoles().length) return;
    this.busy.set(true);
    this.api.setUserRoles(user.id, this.selectedRoles()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: saved => {
        this.accessUser.set(saved);
        this.selectedRoles.set([...saved.roles].sort());
        this.roleChanges.capture();
        this.busy.set(false);
        this.toast.show('Perfis atualizados e sessões revogadas.', 'success');
        this.reloadUsers();
      },
      error: failure => this.fail(failure, 'salvar os perfis'),
    });
  }

  resetPassword() {
    const user = this.accessUser();
    if (!user || this.resetSecret.invalid || this.busy()) return;
    this.busy.set(true);
    this.api.resetPassword(user.id, this.resetSecret.value).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busy.set(false);
        this.resetSecret.reset();
        this.toast.show('Senha temporária redefinida e sessões revogadas.', 'success');
      },
      error: failure => this.fail(failure, 'redefinir a senha'),
    });
  }

  askUserAction(user: UserView, action: UserAction) {
    if (!this.busy()) this.userTarget.set({ user, action });
  }

  confirmUserAction() {
    const target = this.userTarget();
    if (!target || this.busy()) return;
    const { user, action } = target;
    const request: Observable<UserView | void> = action === 'revoke' ? this.api.revokeUserSessions(user.id)
      : action === 'block' ? this.api.blockUserAccess(user.id)
        : this.api.setUserActive(user.id, action === 'reactivate');
    this.busy.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: value => {
        if (value && this.accessUser()?.id === value.id) this.accessUser.set(value);
        this.busy.set(false);
        this.userTarget.set(null);
        this.toast.show(action === 'revoke' ? 'Sessões revogadas.' : 'Situação da conta atualizada.', 'success');
        this.reloadUsers();
      },
      error: failure => {
        this.userTarget.set(null);
        this.fail(failure, 'alterar o acesso da conta');
      },
    });
  }

  openCampusForm(campus?: Campus) {
    if (this.busy()) return;
    this.editCampus.set(campus ?? null);
    this.campusForm.reset(campus ? { name: campus.name, code: campus.code } : undefined);
    this.campusChanges.capture();
    this.showCampusForm.set(true);
  }

  closeCampusForm() {
    if (this.busy() || this.campusChanges.changed() && !this.confirmDiscard()) return;
    this.showCampusForm.set(false);
  }

  saveCampus() {
    if (this.campusForm.invalid || !this.campusChanges.changed() || this.busy()) return;
    const campus = this.editCampus();
    const request = campus ? this.api.updateCampus(campus.id, this.campusFields()) : this.api.createCampus(this.campusFields());
    this.busy.set(true);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.campusChanges.capture();
        this.showCampusForm.set(false);
        this.busy.set(false);
        this.toast.show(campus ? 'Campus atualizado.' : 'Campus cadastrado.', 'success');
        this.loadCampuses();
      },
      error: failure => this.fail(failure, 'salvar o campus'),
    });
  }

  confirmCampusAction() {
    const campus = this.campusTarget();
    if (!campus || this.busy()) return;
    this.busy.set(true);
    this.api.setCampusActive(campus.id, !campus.active).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busy.set(false);
        this.campusTarget.set(null);
        this.toast.show(campus.active ? 'Campus arquivado.' : 'Campus reativado.', 'success');
        this.loadCampuses();
      },
      error: failure => {
        this.campusTarget.set(null);
        this.fail(failure, campus.active ? 'arquivar o campus' : 'reativar o campus');
      },
    });
  }

  setUserPage(page: number) {
    this.userPage.set(page);
    this.reloadUsers();
  }

  reloadUsers(debounce = false) {
    this.loading.set(true);
    this.usersError.set(false);
    this.userRequests.next(debounce);
  }

  private loadCampuses() {
    this.api.adminCampuses().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: campuses => {
        this.campuses.set(campuses);
        this.selectRequiredCampus();
      },
      error: failure => this.fail(failure, 'carregar os campi'),
    });
  }

  private selectRequiredCampus(): void {
    if (!this.showUserForm() || this.editUser() || this.userForm.controls.role.value === 'ADMIN') return;
    reconcileRequiredSelection(this.userForm.controls.campusId, this.campusOptions().map(campus => String(campus.id)));
  }

  private nonBlank(control: { value: string }) {
    return control.value.trim() ? null : { blank: true };
  }

  private readonly referencesPanel = viewChild(AdminReferencesComponent);
  private readonly stagesPanel = viewChild(AdminCaseStagesComponent);

  private hasPendingChanges(checkStages = true) {
    return this.showUserForm() && this.userChanges.changed()
      || this.showCampusForm() && this.campusChanges.changed()
      || this.accessUser() !== null && (this.roleChanges.changed() || !!this.resetSecret.value)
      || this.referencesPanel()?.hasPendingChanges() === true
      || checkStages && this.stagesPanel()?.hasPendingChanges() === true;
  }

  private confirmDiscard() {
    return window.confirm('Descartar as alterações pendentes?');
  }

  private fail(failure: { status?: number; error?: unknown }, action: string) {
    this.busy.set(false);
    this.toast.show(errorMessage(failure, action), 'error');
  }
}
