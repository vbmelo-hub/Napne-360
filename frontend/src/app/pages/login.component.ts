import { Component, signal, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  standalone: true, imports: [ReactiveFormsModule],
  template: `
    <section class="login-page" aria-labelledby="login-title">
      <div class="login-story">
        <a class="login-brand" href="/login" aria-label="NAPNE 360"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><strong>NAPNE 360</strong></a>
        <div class="story-content"><span class="eyebrow">Acompanhamento educacional inclusivo</span><h1 id="login-title" class="sr-only">NAPNE 360</h1><h2>Cuidado pedagógico com contexto e continuidade.</h2><p>Uma central segura para reunir o percurso do estudante, os registros de acompanhamento e os Planos de Ensino Individualizados.</p><div class="connection-map" aria-hidden="true"><span>Estudante</span><i></i><span>Equipe NAPNE</span><i></i><span>Rede pedagógica</span></div></div>
        <p class="privacy-line">Privacidade, acesso por perfil e histórico preservado.</p>
      </div>
      <div class="login-panel">
        <form class="login-form" [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div><span class="eyebrow">Acesso institucional</span><h2>Acessar o sistema</h2><p>Entre com a conta fornecida pela sua instituição.</p></div>
          <label for="email" class="required">E-mail institucional<input id="email" type="email" formControlName="email" autocomplete="username" placeholder="nome@instituicao.edu.br" [attr.aria-describedby]="form.controls.email.touched && form.controls.email.invalid ? 'email-error' : null"></label>
          @if (form.controls.email.touched && form.controls.email.invalid) {<small id="email-error" class="field-error">Informe um e-mail válido.</small>}
          <label for="password" class="required">Senha<span class="password-field"><input id="password" [type]="showPassword() ? 'text' : 'password'" formControlName="password" autocomplete="current-password"><button class="password-toggle" type="button" (click)="showPassword.set(!showPassword())" [attr.aria-label]="showPassword() ? 'Ocultar senha' : 'Mostrar senha'">{{ showPassword() ? 'Ocultar' : 'Mostrar' }}</button></span></label>
          @if (error()) {<div class="error" role="alert">{{ error() }}</div>}
          <button class="login-submit" type="submit" [disabled]="form.invalid || loading()">@if (loading()) {<span class="spinner" aria-hidden="true"></span>}{{ loading() ? 'Entrando…' : 'Entrar' }}</button>
          <p class="login-help"><strong>Não consegue acessar?</strong><br>Solicite a recuperação da conta ao administrador autorizado do seu campus.</p>
        </form>
      </div>
    </section>
  `,
  styles: [`
    :host{display:block;min-height:100vh}.login-page{min-height:100vh;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(25rem,.9fr);background:#fff}.login-story{position:relative;overflow:hidden;background:var(--primary-950);color:#fff;padding:clamp(2rem,6vw,5.5rem);display:flex;flex-direction:column;justify-content:space-between}.login-story::before{content:'';position:absolute;width:34rem;height:34rem;border:1px solid rgba(255,255,255,.12);border-radius:50%;right:-15rem;top:-11rem;box-shadow:0 0 0 5rem rgba(255,255,255,.025),0 0 0 10rem rgba(255,255,255,.02)}.login-brand{display:flex;align-items:center;gap:.8rem;color:#fff;text-decoration:none;z-index:1}.story-content{position:relative;z-index:1;max-width:42rem;margin-block:4rem}.story-content .eyebrow{color:#77dcb6}.story-content h1{font-size:clamp(2.4rem,5vw,4.8rem);line-height:1.03;letter-spacing:-.055em;margin:.65rem 0 1.5rem}.story-content>p{font-size:1.12rem;color:#cde1da;max-width:38rem}.connection-map{display:flex;align-items:center;margin-top:2.5rem;color:#e7f2ee;font-size:.8rem;font-weight:750}.connection-map span{border:1px solid rgba(255,255,255,.2);border-radius:999px;padding:.45rem .7rem}.connection-map i{width:2rem;height:1px;background:#57c79e}.privacy-line{position:relative;z-index:1;color:#a9c9be;font-size:.82rem;margin:0}.login-panel{display:grid;place-items:center;padding:2rem}.login-form{width:min(28rem,100%);display:grid;gap:1.15rem}.login-form h2{font-size:2rem;margin:.2rem 0}.login-form>div>p{color:var(--ink-600)}.password-field{position:relative;display:block}.password-field input{padding-right:5rem}.password-toggle{position:absolute;right:.25rem;top:.25rem;min-height:2.25rem;padding:.3rem .55rem;background:transparent;color:var(--primary-700);font-size:.8rem}.password-toggle:hover{background:var(--primary-50)}.field-error{color:var(--danger);margin-top:-.85rem}.login-submit{width:100%;margin-top:.25rem}.login-help{font-size:.84rem;color:var(--ink-600);border-top:1px solid var(--border);padding-top:1rem}.login-help strong{color:var(--ink-800)}@media(max-width:800px){.login-page{grid-template-columns:1fr}.login-story{min-height:auto;padding:1.5rem}.story-content{margin:3rem 0 2rem}.story-content h1{font-size:2.55rem}.connection-map{display:none}.privacy-line{display:none}.login-panel{padding:2rem 1.25rem 3rem}}
    .story-content h2{font-size:clamp(2.4rem,5vw,4.8rem);line-height:1.03;letter-spacing:-.055em;margin:.65rem 0 1.5rem}
  `]
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder); private readonly auth = inject(AuthService); private readonly router = inject(Router);
  readonly loading = signal(false); readonly error = signal(''); readonly showPassword = signal(false);
  readonly form = this.fb.nonNullable.group({email:['',[Validators.required,Validators.email]],password:['',Validators.required]});
  constructor(){if(this.auth.authenticated())void this.router.navigate(['/']);}
  submit():void{this.form.markAllAsTouched();if(this.form.invalid)return;this.loading.set(true);this.error.set('');const v=this.form.getRawValue();this.auth.login(v.email,v.password).subscribe({next:()=>void this.router.navigate(['/']),error:()=>{this.error.set('Não foi possível entrar. Confira o e-mail e a senha ou tente novamente em instantes.');this.loading.set(false);}});}
}
