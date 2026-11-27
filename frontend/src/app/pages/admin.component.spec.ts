import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UserView } from '../core/models';
import { AdminComponent } from './admin.component';

describe('AdminComponent', () => {
  const users = '/api/v1/admin/users';
  const campuses = '/api/v1/admin/campuses';
  const account: UserView = {
    id: 1, name: 'Conta técnica', email: 'conta@example.test', cpfMasked: '***.***.***-25',
    institutionalRegistration: '00081', active: true, campusId: null, roles: ['ADMIN'],
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
    http.expectOne(users).flush([account, {
      id: 2, name: 'Profissional de apoio', email: 'apoio@example.test', institutionalRegistration: 'M-02',
      active: true, campusId: 7, roles: ['NAPNE', 'TUTOR'],
    }]);
    http.expectOne(campuses).flush([]);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

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
    input('input[type="search"]', '529.982.247-25');
    await fixture.whenStable();
    const request = http.expectOne(users + '/cpf-search');
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ cpf: '529.982.247-25' });
    request.flush({ id: 1 });
    fixture.detectChanges();
    expect(root.querySelector('tbody')?.textContent).toContain('Conta técnica');
    expect(root.querySelector('tbody')?.textContent).not.toContain('529.982.247-25');
  });

  it('keeps matches for each role when an account has multiple roles', () => {
    input('input[type="search"]', 'napne tutor/monitor M-02');
    expect(root.querySelector('tbody')?.textContent).toContain('Profissional de apoio');
    expect(root.querySelector('tbody')?.textContent).not.toContain('Conta técnica');
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
