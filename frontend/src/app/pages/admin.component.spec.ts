import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UserView } from '../core/models';
import { AdminComponent } from './admin.component';

describe('AdminComponent', () => {
  const users = '/api/v1/admin/users';
  const pageUrl = users + '/page';
  const campuses = '/api/v1/admin/campuses';
  const account: UserView = {
    id: 1, name: 'Conta técnica', email: 'conta@example.test', cpfMasked: '***.***.***-25',
    institutionalRegistration: '00081', active: true, campusId: null, roles: ['ADMIN'],
  };
  const professional: UserView = {
    id: 2, name: 'Profissional de apoio', email: 'apoio@example.test', institutionalRegistration: 'M-02',
    active: true, campusId: 7, roles: ['NAPNE', 'TUTOR'],
  };
  let fixture: ComponentFixture<AdminComponent>;
  let http: HttpTestingController;
  let root: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminComponent], providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(AdminComponent);
    http = TestBed.inject(HttpTestingController);
    root = fixture.nativeElement;
    fixture.detectChanges();
    page(0, [account, professional], 12);
    http.expectOne(campuses).flush([{ id: 7, name: 'Campus de apoio', code: 'APOIO', active: true }]);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function page(number: number, content: UserView[], totalElements = content.length,
                filters: Record<string, string> = {}) {
    const request = http.expectOne(req => req.url === pageUrl && req.body.page === number);
    expect(request.request.method).toBe('POST');
    expect(request.request.body.size).toBe(10);
    for (const [key, value] of Object.entries(filters)) expect(request.request.body[key]).toBe(value);
    request.flush({ content, totalElements, totalPages: Math.ceil(totalElements / 10), number, size: 10 });
    return request;
  }

  function selectUserFilter(label: string, value: string) {
    const field = Array.from(root.querySelectorAll('.users-card app-list-filters label'))
      .find(element => element.textContent?.trim().startsWith(label))!;
    const select = field.querySelector('select')!;
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
  }

  function button(label: string) {
    return Array.from(root.querySelectorAll('button')).find(element => element.textContent?.trim() === label)!;
  }

  function input(selector: string, value: string) {
    const element = root.querySelector<HTMLInputElement>(selector)!;
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    return element;
  }

  function loadEdit() {
    button('Editar').click();
    http.expectOne(users + '/1').flush({
      id: 1, name: account.name, email: account.email, cpf: '52998224725',
      institutionalRegistration: '00081', campusId: null,
    });
    fixture.detectChanges();
  }

  it('preenche o único campus ativo ao abrir o cadastro institucional', () => {
    button('Nova conta').click();
    fixture.detectChanges();
    const { campusId, role } = fixture.componentInstance.userForm.controls;
    expect(campusId.value).toBe('7');
    role.setValue('ADMIN');
    campusId.setValue('');
    expect(campusId.value).toBe('');
    role.setValue('TEACHER');
    expect(campusId.value).toBe('7');
  });

  it('edits cadastro in the existing account and detects a restored value', () => {
    expect(root.textContent).toContain('***.***.***-25');
    expect(root.textContent).not.toContain('52998224725');
    loadEdit();
    const save = button('Salvar alterações');
    const name = 'input[formControlName="name"]';
    expect((root.querySelector('input[formControlName="cpf"]') as HTMLInputElement).value).toBe('529.982.247-25');
    expect(save.disabled).toBeTrue();
    input(name, 'Nome corrigido');
    expect(save.disabled).toBeFalse();
    input(name, 'Conta técnica');
    expect(save.disabled).toBeTrue();
    const field = input(name, 'Nome corrigido');
    save.click();
    fixture.detectChanges();
    expect(save.disabled).toBeTrue();
    const request = http.expectOne(users + '/1');
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      name: 'Nome corrigido', email: account.email, cpf: '52998224725', institutionalRegistration: '00081', campusId: null,
    });
    request.flush({ code: 'USER_CPF_DUPLICATE' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(field.value).toBe('Nome corrigido');
    expect(save.disabled).toBeFalse();
  });

  it('finds a masked account with an exact CPF search before rendering matches', async () => {
    input('input[type="search"]', '529.982.247-25 técnica');
    await fixture.whenStable();
    const result = page(0, [account], 1, { query: '529.982.247-25 técnica' });
    expect(result.request.urlWithParams).not.toContain('529');
    fixture.detectChanges();
    expect(root.querySelector('tbody')?.textContent).toContain('Conta técnica');
    expect(root.querySelector('tbody')?.textContent).not.toContain('529.982.247-25');
  });

  it('requests server pages and combines filters from the first page', async () => {
    button('Próxima').click();
    page(1, [professional], 12);
    fixture.detectChanges();
    selectUserFilter('Perfil', 'TUTOR');
    page(0, [professional], 1, { role: 'TUTOR' });
    selectUserFilter('Campus', '7');
    page(0, [], 0, { role: 'TUTOR', campus: '7' });
    fixture.detectChanges();
    expect(root.textContent).toContain('Nenhuma conta corresponde aos filtros.');
    selectUserFilter('Situação', 'ACTIVE');
    page(0, [professional], 1, { role: 'TUTOR', campus: '7', status: 'ACTIVE' });
    fixture.detectChanges();

    input('input[type="search"]', 'M-02');
    await fixture.whenStable();
    page(0, [professional], 1, { role: 'TUTOR', campus: '7', status: 'ACTIVE', query: 'M-02' });
    fixture.detectChanges();
    expect(root.querySelector('tbody')?.textContent).toContain('Profissional de apoio');
    expect(root.querySelector('tbody')?.textContent).not.toContain('Conta técnica');
    expect(root.textContent).toContain('1 resultado');

    button('Limpar filtros').click();
    const cleared = page(0, [account, professional], 12);
    expect(JSON.parse(cleared.request.serializeBody() as string)).toEqual({ page: 0, size: 10 });
    http.expectNone(users);
  });

  it('cancels a stale page request when the search changes', async () => {
    button('Próxima').click();
    const pending = http.expectOne(req => req.url === pageUrl && req.body.page === 1);
    input('input[type="search"]', 'apoio');
    expect(pending.cancelled).toBeTrue();
    await fixture.whenStable();
    page(0, [professional], 1, { query: 'apoio' });
  });

  it('refreshes the selected page after a mutation and falls back when it becomes empty', () => {
    selectUserFilter('Situação', 'ACTIVE');
    page(0, [account], 11, { status: 'ACTIVE' });
    fixture.detectChanges();
    button('Próxima').click();
    page(1, [professional], 11, { status: 'ACTIVE' });
    fixture.detectChanges();
    button('Inativar').click();
    fixture.detectChanges();
    button('Inativar conta').click();
    const mutation = http.expectOne(users + '/2/active');
    expect(mutation.request.body).toEqual({ active: false });
    mutation.flush({ ...professional, active: false });
    page(1, [], 10, { status: 'ACTIVE' });
    page(0, [account], 10, { status: 'ACTIVE' });
    fixture.detectChanges();
    expect(root.querySelector('tbody')?.textContent).toContain('Conta técnica');
    http.expectNone(campuses);
  });

  it('prevents assigning COTEP to a technical administrator without a campus', () => {
    button('Acessos').click();
    fixture.detectChanges();
    const cotep = Array.from(root.querySelectorAll('fieldset label')).find(label => label.textContent?.trim() === 'COTEP')!;
    cotep.querySelector<HTMLInputElement>('input')!.click();
    fixture.detectChanges();
    expect(button('Salvar perfis e revogar sessões').disabled).toBeTrue();
    expect(root.textContent).toContain('Para conceder o perfil COTEP, é necessário vincular este usuário a um campus.');
    http.expectNone(users + '/1/roles');
  });
});
