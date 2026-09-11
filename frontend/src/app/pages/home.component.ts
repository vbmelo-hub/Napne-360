import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="hero">
      <div>
        <span class="eyebrow">Olá, {{ auth.user()?.name }}</span>
        <h1>Acompanhamento NAPNE</h1>
        <p>Acesse os estudantes vinculados ao seu trabalho e os registros de acompanhamento.</p>
      </div>
    </section>
    <section aria-labelledby="actions-title">
      <h2 id="actions-title">Começar</h2>
      <div class="grid two">
        <a class="card action" routerLink="/conta"><strong>Minha conta</strong><span>Altere sua senha ou renove sua sessão.</span></a>
        @if (!auth.hasRole('ADMIN')) {
          <a class="card action" routerLink="/estudantes"><strong>Estudantes acompanhados</strong><span>Abra o dossiê, a linha do tempo e os registros pedagógicos autorizados.</span></a>
        }
        @if (auth.hasRole('ADMIN')) {
          <a class="card action" routerLink="/administracao"><strong>Configuração institucional</strong><span>Gerencie contas e cadastros sem acesso automático ao conteúdo dos dossiês.</span></a>
        }
      </div>
    </section>
    <aside class="privacy card"><strong>Privacidade desde o início</strong><span>Use apenas dados necessários à finalidade pedagógica. Nunca copie informações do sistema para canais não autorizados.</span></aside>
  `,
  styles: [`
    .hero { display: grid; align-items: center; background: var(--primary-dark); color: white; border-radius: 1.2rem; padding: 1.5rem; margin-bottom: 1.5rem; }
    .hero h1 { max-width: 760px; font-size: clamp(1.6rem, 3vw, 2.3rem); line-height: 1.2; margin: .6rem 0 1rem; }
    .hero p { max-width: 680px; font-size: 1.1rem; opacity: .9; }
    .eyebrow { font-weight: 750; text-transform: uppercase; letter-spacing: .08em; }
    .action { display: grid; text-decoration: none; color: inherit; gap: .4rem; border-left: 5px solid var(--accent); }
    .action strong { color: var(--primary-dark); font-size: 1.2rem; }
    .privacy { margin-top: 2rem; display: flex; gap: .8rem; align-items: baseline; }
    @media (max-width: 620px) { .privacy { display: grid; } }
  `]
})
export class HomeComponent {  auth = inject(AuthService);
}
