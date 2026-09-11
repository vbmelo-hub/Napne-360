import { Component, signal, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '../core/auth.service';

@Component({
  standalone:true,
  imports:[ReactiveFormsModule],
  template:`<h1>Minha conta</h1><p>{{ auth.user()?.name }}</p>
    <form class="card stack" [formGroup]="form" (ngSubmit)="changePassword()">
      <h2>Alterar senha</h2><label>Senha atual<input type="password" autocomplete="current-password" formControlName="currentPassword"></label>
      <label>Nova senha — 12 a 72 caracteres<input type="password" autocomplete="new-password" formControlName="newPassword"></label>
      <label>Confirmar nova senha<input type="password" autocomplete="new-password" formControlName="confirmation"></label>
      @if(message()){<p role="status">{{message()}}</p>}
      <div><button [disabled]="form.invalid || busy()">Alterar senha e encerrar sessões</button></div>
    </form><p>Para recuperar uma senha esquecida, solicite a redefinição ao administrador autorizado do campus.</p>
    <button class="secondary" (click)="renew()" [disabled]="busy()">Renovar sessão</button>`
})
export class AccountComponent {
  auth = inject(AuthService);
  private fb = inject(FormBuilder);

  readonly busy=signal(false); readonly message=signal('');
  readonly form=this.fb.nonNullable.group({currentPassword:['',Validators.required],newPassword:['',[Validators.required,Validators.minLength(12),Validators.maxLength(72)]],confirmation:['',Validators.required]});
  changePassword():void {
    const value=this.form.getRawValue();
    if(this.form.invalid)return;
    if(value.newPassword!==value.confirmation){this.message.set('A confirmação deve ser igual à nova senha.');return;}
    this.busy.set(true);
    this.auth.changePassword(value.currentPassword,value.newPassword).subscribe({next:()=>this.busy.set(false),error:()=>{this.busy.set(false);this.message.set('Não foi possível alterar a senha. Confira a senha atual.');}});
  }
  renew():void {this.busy.set(true);this.auth.refresh().subscribe({next:()=>{this.busy.set(false);this.message.set('Sessão renovada.');},error:()=>{this.busy.set(false);this.message.set('Entre novamente para renovar a sessão.');}});}
}
