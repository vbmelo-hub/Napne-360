import { Component, signal, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <section class="login-wrap" aria-labelledby="login-title">
      <div class="intro">
        <span class="eyebrow">Acompanhamento educacional inclusivo</span>
        <h1 id="login-title">NAPNE 360</h1>
        <p>Um espaço protegido para organizar o cuidado pedagógico, preservar o histórico e construir planos individualizados.</p>
      </div>
      <form class="card stack" [formGroup]="form" (ngSubmit)="submit()">
        <h2>Acessar o sistema</h2>
        <label>E-mail institucional<input type="email" formControlName="email" autocomplete="username"></label>
        <label>Senha<input type="password" formControlName="password" autocomplete="current-password"></label>
        @if (error()) { <div class="error" role="alert">{{ error() }}</div> }
        <button type="submit" [disabled]="form.invalid || loading()">{{ loading() ? 'Entrando…' : 'Entrar' }}</button>
        <p class="muted">Use a conta autorizada pela instituição. Em caso de esquecimento da senha, procure o administrador responsável.</p>
      </form>
    </section>
  `,
  styles: [`
    :host { display: grid; min-height: calc(100vh - 4rem); place-items: center; }
    .login-wrap { width: min(920px, 100%); display: grid; grid-template-columns: 1.2fr .8fr; gap: 3rem; align-items: center; }
    .intro h1 { font-size: clamp(3rem, 8vw, 6rem); line-height: .95; margin: .5rem 0 1rem; color: var(--primary-dark); }
    .intro p { font-size: 1.2rem; max-width: 34rem; color: var(--muted); }
    .eyebrow { color: var(--primary); font-weight: 750; text-transform: uppercase; letter-spacing: .08em; }
    form { padding: 2rem; }
    form h2 { margin: 0; }
    .demo { font-size: .8rem; overflow-wrap: anywhere; }
    @media (max-width: 760px) { .login-wrap { grid-template-columns: 1fr; gap: 1.5rem; } .intro h1 { font-size: 3.5rem; } }
  `]
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  readonly loading = signal(false);
  readonly error = signal('');
  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required]
  });

  constructor() {
    const auth = this.auth;
    const router = this.router;

    if (auth.authenticated()) void router.navigate(['/']);
  }

  submit(): void {
    if (this.form.invalid) return;
    this.loading.set(true); this.error.set('');
    this.auth.login(this.form.controls.email.value, this.form.controls.password.value).subscribe({
      next: () => void this.router.navigate(['/']),
      error: () => { this.error.set('Credenciais inválidas ou serviço indisponível.'); this.loading.set(false); }
    });
  }
}
