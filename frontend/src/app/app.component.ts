import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <a class="skip" href="#conteudo">Pular para o conteúdo</a>
    @if (auth.authenticated()) {
      <header>
        <div class="container nav">
          <a class="brand" routerLink="/" aria-label="NAPNE 360 - início"><span aria-hidden="true">N360</span> NAPNE 360</a>
          <nav aria-label="Navegação principal">
            <a routerLink="/" [routerLinkActiveOptions]="{exact: true}" routerLinkActive="active">Início</a>
            @if (!auth.hasRole('ADMIN')) { <a routerLink="/estudantes" routerLinkActive="active">Estudantes</a> }
            @if (auth.hasRole('ADMIN')) { <a routerLink="/administracao" routerLinkActive="active">Administração</a> }
          </nav>
          <div class="account"><span>{{ auth.user()?.name }}</span><button class="secondary" (click)="auth.logout()">Sair</button></div>
        </div>
      </header>
    }
    <main id="conteudo" class="container"><router-outlet /></main>
  `,
  styles: [`
    header { background: var(--surface); border-bottom: 1px solid var(--border); }
    .nav { min-height: 4.5rem; display: flex; align-items: center; gap: 1.5rem; }
    .brand { color: var(--primary-dark); font-weight: 800; text-decoration: none; white-space: nowrap; }
    .brand span { display: inline-grid; place-items: center; width: 2.4rem; height: 2.4rem; border-radius: .65rem; background: var(--primary); color: white; margin-right: .45rem; font-size: .76rem; }
    nav { display: flex; gap: .35rem; flex: 1; }
    nav a { color: var(--ink); padding: .6rem .8rem; border-radius: .45rem; text-decoration: none; }
    nav a.active, nav a:hover { background: var(--primary-soft); color: var(--primary-dark); }
    .account { display: flex; align-items: center; gap: .75rem; }
    main { padding-block: 2rem 4rem; }
    .skip { position: absolute; left: -9999px; top: .5rem; z-index: 100; background: white; padding: .7rem; }
    .skip:focus { left: .5rem; }
    @media (max-width: 760px) { .nav { flex-wrap: wrap; padding-block: .7rem; } nav { order: 3; width: 100%; } .account span { display: none; } }
  `]
})
export class AppComponent {
  auth = inject(AuthService);
}
