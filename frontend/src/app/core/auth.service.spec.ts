import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';
import { SessionEndReason, SessionUser } from './models';

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;
  let router: jasmine.SpyObj<Router>;

  const user = (token = 'jwt', duration = 120_000, reason: SessionEndReason = 'IDLE_TIMEOUT'): SessionUser => {
    const now = Date.now();
    return {
      token, id: 2, name: 'NAPNE', email: 'napne@test.local', campusId: 1, roles: ['NAPNE'],
      session: { serverTime: now, warningAt: now + duration / 2, expiresAt: now + duration, reason }
    };
  };

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(), provideRouter([])]
    });
    router = TestBed.inject(Router) as jasmine.SpyObj<Router>;
    spyOn(router, 'navigate').and.resolveTo(true);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
  });

  const login = (details: SessionUser): void => {
    service = TestBed.inject(AuthService);
    service.login('napne@test.local', 'secret').subscribe();
    http.expectOne('/api/v1/auth/login').flush(details);
  };

  it('stores the authenticated user for the current browser session', () => {
    login(user());

    expect(service.authenticated()).toBeTrue();
    expect(service.hasRole('NAPNE')).toBeTrue();
    expect(localStorage.getItem('napne360.session')).toBeNull();
  });

  it('warns and returns to login after inactivity without making automatic renewal requests', fakeAsync(() => {
    login(user('jwt', 2_000));

    tick(1_000);
    expect(service.sessionWarning()).toContain('inatividade');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    TestBed.inject(HttpClient).get('/api/v1/auth/me').subscribe();
    http.expectOne('/api/v1/auth/me').flush(user());
    tick(1_000);

    http.expectNone('/api/v1/auth/refresh');
    expect(router.navigate).toHaveBeenCalledOnceWith(['/login']);
    expect(service.authenticated()).toBeFalse();
    expect(service.sessionNotice()).toContain('inatividade');
  }));

  it('reuses the ongoing renewal for several interactions and extends the deadline from the new token', fakeAsync(() => {
    login(user('jwt', 20_000));

    tick(6_000);
    service['recordActivity']();
    service['recordActivity']();
    const renewal = http.expectOne('/api/v1/auth/refresh');
    expect(renewal.request.headers.get('Authorization')).toBe('Bearer jwt');
    renewal.flush(user('renewed', 20_000));
    tick(14_000);

    expect(service.token()).toBe('renewed');
    expect(service.sessionWarning()).toContain('inatividade');
    expect(router.navigate).not.toHaveBeenCalled();
    tick(6_000);
    expect(router.navigate).toHaveBeenCalledOnceWith(['/login']);
  }));

  it('preserves the hard deadline and identifies unsaved changes without persisting them', fakeAsync(() => {
    const content = document.createElement('main');
    content.innerHTML = '<form class="ng-dirty"><textarea>rascunho temporário</textarea></form>';
    document.body.append(content);
    try {
      login(user('jwt', 2_000, 'MAX_DURATION'));
      tick(1_000);
      service['recordActivity']();

      expect(service.sessionWarning()).toContain('tempo máximo');
      http.expectNone('/api/v1/auth/refresh');
      tick(1_000);

      expect(router.navigate).toHaveBeenCalledOnceWith(['/login']);
      expect(service.sessionNotice()).toContain('tempo máximo');
      expect(service.lostUnsavedChanges()).toBeTrue();
      expect(sessionStorage.getItem('napne360.session')).toBeNull();
    } finally {
      content.remove();
    }
  }));

  it('redirects once when the session is administratively revoked during renewal', fakeAsync(() => {
    login(user('jwt', 4_000));

    tick(1_000);
    service['recordActivity']();
    http.expectOne('/api/v1/auth/refresh').flush({}, {
      status: 401, statusText: 'Unauthorized', headers: { 'X-Session-Status': 'REVOKED' }
    });

    expect(router.navigate).toHaveBeenCalledOnceWith(['/login']);
    expect(service.sessionNotice()).toContain('acesso foi atualizado');
  }));
});
