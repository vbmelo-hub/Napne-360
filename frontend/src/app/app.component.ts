import { Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from './core/auth.service';
import { labelFor } from './core/presentation';
import { ToastOutletComponent } from './shared/toast-outlet.component';

@Component({
  selector: 'app-root', standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ToastOutletComponent],
  template: `
    <a class="skip-link" href="#conteudo">Pular para o conteúdo</a>
    @if (auth.authenticated()) {
      <div class="app-shell">
        <aside class="sidebar" [class.sidebar--open]="menuOpen()" aria-label="Navegação principal">
          <div class="brand-block"><a class="brand" routerLink="/" (click)="closeMenu()"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span><strong>NAPNE 360</strong><small>Acompanhamento inclusivo</small></span></a><button class="icon-button sidebar-close" type="button" (click)="closeMenu()" aria-label="Fechar menu">×</button></div>
          <nav>
            <a routerLink="/" [routerLinkActiveOptions]="{exact:true}" routerLinkActive="active" (click)="closeMenu()"><span class="nav-icon" aria-hidden="true">⌂</span><span>Início</span></a>
            @if (!auth.hasRole('ADMIN')) {<a routerLink="/estudantes" routerLinkActive="active" (click)="closeMenu()"><span class="nav-icon" aria-hidden="true">◎</span><span>Estudantes</span></a>}
            @if (auth.hasRole('ADMIN')) {<a routerLink="/administracao" routerLinkActive="active" (click)="closeMenu()"><span class="nav-icon" aria-hidden="true">▦</span><span>Administração</span></a>}
            <a routerLink="/conta" routerLinkActive="active" (click)="closeMenu()"><span class="nav-icon" aria-hidden="true">○</span><span>Minha conta</span></a>
          </nav>
          <div class="sidebar-note"><strong>Ambiente protegido</strong><p>Consulte apenas dados necessários ao acompanhamento educacional.</p></div>
        </aside>
        @if (menuOpen()) {<button class="shell-backdrop" type="button" aria-label="Fechar menu" (click)="closeMenu()"></button>}
        <div class="shell-content">
          <header class="topbar">
            <button class="icon-button menu-button" type="button" (click)="menuOpen.set(true)" aria-label="Abrir menu" [attr.aria-expanded]="menuOpen()">☰</button>
            <div class="topbar-context"><span>NAPNE 360</span><strong>{{ pageTitle() }}</strong></div>
            <a class="user-summary" routerLink="/conta"><span class="avatar avatar--small" aria-hidden="true">{{ initials(auth.user()?.name ?? '') }}</span><span><strong>{{ auth.user()?.name }}</strong><small>{{ primaryRole() }}</small></span></a>
            <button class="secondary compact" type="button" (click)="auth.logout()">Sair</button>
          </header>
          <main id="conteudo" tabindex="-1"><router-outlet /></main>
        </div>
      </div>
    } @else {<main id="conteudo" class="public-main" tabindex="-1"><router-outlet /></main>}
    <app-toast-outlet />
  `
})
export class AppComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly menuOpen = signal(false);
  readonly path = signal(this.router.url);
  readonly pageTitle = computed(() => {
    const value = this.path();
    if (value.startsWith('/administracao')) return 'Configuração institucional';
    if (value.startsWith('/conta')) return 'Minha conta';
    if (value.includes('/pei/')) return 'Editor do PEI';
    if (value.startsWith('/estudantes/')) return 'Central do estudante';
    if (value.startsWith('/estudantes')) return 'Estudantes';
    return 'Início';
  });
  readonly primaryRole = computed(() => labelFor(this.auth.user()?.roles[0]));
  constructor() { this.router.events.pipe(filter(event => event instanceof NavigationEnd)).subscribe(event => { this.path.set(event.urlAfterRedirects); this.closeMenu(); }); }
  initials(name: string): string { return name.split(' ').filter(Boolean).slice(0, 2).map(value => value[0]).join('').toUpperCase(); }
  closeMenu(): void { this.menuOpen.set(false); }
}
