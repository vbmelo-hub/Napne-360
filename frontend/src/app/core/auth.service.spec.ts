import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('stores the authenticated user for the current browser session', () => {
    service.login('napne@test.local', 'secret').subscribe();
    const request = http.expectOne('/api/v1/auth/login');
    request.flush({ token: 'jwt', id: 2, name: 'NAPNE', email: 'napne@test.local', campusId: 1, roles: ['NAPNE'] });

    expect(service.authenticated()).toBeTrue();
    expect(service.hasRole('NAPNE')).toBeTrue();
    expect(localStorage.getItem('napne360.session')).toBeNull();
  });
});
