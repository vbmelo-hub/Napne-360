import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="not-found card" aria-labelledby="not-found-title">
      <span class="not-found-code" aria-hidden="true">404</span>
      <span class="eyebrow">Página não encontrada</span>
      <h1 id="not-found-title">Este endereço não existe no NAPNE 360</h1>
      <p>O endereço pode ter sido digitado incorretamente ou a página pode ter sido movida. Nenhum dado foi alterado.</p>
      <div class="row"><a class="button" routerLink="/">Voltar ao início</a></div>
    </section>
  `,
  styles: [`.not-found{max-width:46rem;margin:8vh auto;text-align:center;padding:clamp(2rem,6vw,4rem)}.not-found-code{display:block;font-size:clamp(3rem,10vw,6rem);font-weight:900;line-height:1;color:var(--primary-100);margin-bottom:.5rem}.not-found p{color:var(--ink-600);max-width:36rem;margin:0 auto 1.5rem}.not-found .row{justify-content:center}@media(max-width:560px){.not-found .row{align-items:stretch;flex-direction:column}.not-found .button{width:100%}}`]
})
export class NotFoundComponent {}
