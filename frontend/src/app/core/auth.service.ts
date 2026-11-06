import { computed, Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs';
import { SessionUser } from './models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  private readonly storageKey = 'napne360.session';
  private readonly state = signal<SessionUser | null>(this.restore());
  readonly user = this.state.asReadonly();
  readonly authenticated = computed(() => !!this.state()?.token);

  login(email: string, password: string) {
    return this.http.post<SessionUser>('/api/v1/auth/login', { email, password }).pipe(
      tap(user => {
        this.state.set(user);
        sessionStorage.setItem(this.storageKey, JSON.stringify(user));
      })
    );
  }

  logout(): void {
    if (this.token()) this.http.post('/api/v1/auth/logout', {}).subscribe({ error: () => undefined });
    this.clearSession();
  }

  clearSession(): void {
    sessionStorage.removeItem(this.storageKey);
    this.state.set(null);
    void this.router.navigate(['/login']);
  }

  refresh() {
    return this.http.post<SessionUser>('/api/v1/auth/refresh', {}).pipe(tap(user => {
      this.state.set(user);
      sessionStorage.setItem(this.storageKey, JSON.stringify(user));
    }));
  }

  changePassword(currentPassword: string, newPassword: string) {
    return this.http.post('/api/v1/auth/password', { currentPassword, newPassword }).pipe(tap(() => this.clearSession()));
  }

  hasRole(...roles: string[]): boolean {
    return this.state()?.roles.some(role => roles.includes(role)) ?? false;
  }

  token(): string | null { return this.state()?.token ?? null; }

  private restore(): SessionUser | null {
    try {
      const value = sessionStorage.getItem(this.storageKey);
      return value ? JSON.parse(value) as SessionUser : null;
    } catch {
      sessionStorage.removeItem(this.storageKey);
      return null;
    }
  }
}
