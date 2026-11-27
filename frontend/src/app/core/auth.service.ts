import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { computed, DestroyRef, Injectable, inject, NgZone, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { finalize, tap, timeout } from 'rxjs';
import { SessionEndReason, SessionUser } from './models';

interface StoredSession extends SessionUser {
  receivedAt?: number;
}

const sessionEndMessages: Record<SessionEndReason, string> = {
  IDLE_TIMEOUT: 'Sua sessão expirou por inatividade. Entre novamente para continuar.',
  MAX_DURATION: 'Sua sessão atingiu o tempo máximo de acesso contínuo. Entre novamente para continuar.',
  REVOKED: 'Seu acesso foi atualizado e a sessão foi encerrada. Entre novamente para continuar.',
  ACCOUNT_INACTIVE: 'Sua conta está inativa. Procure o administrador autorizado do campus.',
  SESSION_ENDED: 'Sua sessão foi encerrada. Entre novamente para continuar.'
};

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  private readonly storageKey = 'napne360.session';
  private readonly state = signal<StoredSession | null>(this.restore());
  private readonly warning = signal('');
  private readonly notice = signal('');
  private readonly unsavedChanges = signal(false);
  private timer?: number;
  private renewing: StoredSession | null = null;
  private nextRenewalAt = 0;

  readonly user = this.state.asReadonly();
  readonly authenticated = computed(() => !!this.state()?.token);
  readonly sessionWarning = this.warning.asReadonly();
  readonly sessionNotice = this.notice.asReadonly();
  readonly lostUnsavedChanges = this.unsavedChanges.asReadonly();

  constructor() {
    const events = ['pointerdown', 'keydown', 'input', 'click', 'wheel'];
    const onActivity = (event: Event) => {
      if (event.isTrusted && this.document.visibilityState === 'visible') {
        this.recordActivity();
      }
    };
    const onVisibility = () => {
      if (this.document.visibilityState === 'visible') this.zone.run(() => this.updateSessionClock());
    };

    this.zone.runOutsideAngular(() => {
      for (const event of events) this.document.addEventListener(event, onActivity, { passive: true });
      this.document.addEventListener('visibilitychange', onVisibility);
    });
    this.destroyRef.onDestroy(() => {
      for (const event of events) this.document.removeEventListener(event, onActivity);
      this.document.removeEventListener('visibilitychange', onVisibility);
      window.clearTimeout(this.timer);
    });
    this.updateSessionClock();
  }

  login(email: string, password: string) {
    return this.http.post<SessionUser>('/api/v1/auth/login', { email, password }).pipe(
      tap(user => {
        this.notice.set('');
        this.unsavedChanges.set(false);
        this.acceptSession(user);
      })
    );
  }

  logout(): void {
    if (this.token()) this.http.post('/api/v1/auth/logout', {}).subscribe({ error: () => undefined });
    this.clearSession();
  }

  rejectSession(token: string, status: string | null): void {
    const user = this.state();
    if (user?.token !== token) return;
    if (this.renewing === user && (status === 'IDLE_TIMEOUT' || status === 'MAX_DURATION')) return;
    this.endSession(status);
  }

  changePassword(currentPassword: string, newPassword: string) {
    return this.http.post('/api/v1/auth/password', { currentPassword, newPassword }).pipe(tap(() => this.clearSession()));
  }

  hasRole(...roles: string[]): boolean {
    return this.state()?.roles.some(role => roles.includes(role)) ?? false;
  }

  token(): string | null { return this.state()?.token ?? null; }

  private recordActivity(): void {
    const user = this.state();
    if (!user?.token || user.session?.reason === 'MAX_DURATION' || this.renewing === user
        || Date.now() < this.nextRenewalAt) return;
    const expiresAt = this.localTime(user, user.session?.expiresAt);
    if (expiresAt !== undefined && Date.now() >= expiresAt) {
      this.zone.run(() => this.updateSessionClock());
      return;
    }
    this.zone.run(() => this.renewOnActivity(user));
  }

  private renewOnActivity(user: StoredSession): void {
    this.renewing = user;
    this.nextRenewalAt = Date.now() + 10_000;
    this.http.post<SessionUser>('/api/v1/auth/refresh', {}).pipe(
      timeout(10_000),
      takeUntilDestroyed(this.destroyRef),
      finalize(() => {
        if (this.renewing === user) this.renewing = null;
        if (this.state() === user && !this.destroyRef.destroyed) this.updateSessionClock();
      })
    ).subscribe({
      next: renewed => {
        if (this.state() === user) this.acceptSession(renewed);
      },
      error: error => {
        if (error.status === 401 && this.state() === user) {
          this.endSession(error.headers.get('X-Session-Status'));
        }
      }
    });
  }

  private acceptSession(user: SessionUser): void {
    const now = Date.now();
    const stored = { ...user, receivedAt: now };
    const remaining = user.session ? user.session.expiresAt - user.session.serverTime : 0;
    this.nextRenewalAt = now + Math.max(0, Math.min(60_000, remaining / 4));
    this.state.set(stored);
    sessionStorage.setItem(this.storageKey, JSON.stringify(stored));
    this.updateSessionClock();
  }

  private updateSessionClock(): void {
    const user = this.state();
    if (!user?.session) return;
    const now = Date.now();
    const expiresAt = this.localTime(user, user.session.expiresAt)!;
    const warningAt = this.localTime(user, user.session.warningAt)!;
    if (now >= expiresAt && this.renewing !== user) {
      this.endSession(user.session.reason);
      return;
    }
    const text = user.session.reason === 'MAX_DURATION'
      ? 'O tempo máximo da sessão está próximo. Salve as alterações em andamento.'
      : 'A sessão está prestes a expirar por inatividade. Salve as alterações em andamento.';
    this.warning.set(now >= warningAt ? text : '');
    this.scheduleSessionClock();
  }

  private scheduleSessionClock(): void {
    window.clearTimeout(this.timer);
    const user = this.state();
    if (!user?.session) return;
    const now = Date.now();
    const expiresAt = this.localTime(user, user.session.expiresAt)!;
    const warningAt = this.localTime(user, user.session.warningAt)!;
    if (now >= expiresAt && this.renewing === user) return;
    const deadline = warningAt > now ? warningAt : expiresAt;
    this.zone.runOutsideAngular(() => {
      this.timer = window.setTimeout(() => this.zone.run(() => this.updateSessionClock()),
        Math.min(2_147_483_647, Math.max(0, deadline - now)));
    });
  }

  private localTime(user: StoredSession, serverTime?: number): number | undefined {
    if (serverTime === undefined || !user.session) return undefined;
    return (user.receivedAt ?? user.session.serverTime) + serverTime - user.session.serverTime;
  }

  private endSession(status: string | null): void {
    const reason = Object.hasOwn(sessionEndMessages, status ?? '') ? status as SessionEndReason : 'SESSION_ENDED';
    this.notice.set(sessionEndMessages[reason]);
    this.unsavedChanges.set(!!this.document.querySelector('main .ng-dirty'));
    this.clearSession();
  }

  private clearSession(): void {
    sessionStorage.removeItem(this.storageKey);
    this.state.set(null);
    this.warning.set('');
    window.clearTimeout(this.timer);
    void this.router.navigate(['/login']);
  }

  private restore(): StoredSession | null {
    try {
      const value = sessionStorage.getItem(this.storageKey);
      return value ? JSON.parse(value) as StoredSession : null;
    } catch {
      sessionStorage.removeItem(this.storageKey);
      return null;
    }
  }
}
