import { Component, OnInit, signal, inject } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Course, StudentSummary } from '../core/models';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <header class="page-head">
      <div><span class="eyebrow">Acompanhamento</span><h1>Estudantes</h1><p class="muted">A lista respeita seu campus e os vínculos atribuídos.</p></div>
      @if (auth.hasRole('NAPNE')) { <button (click)="showForm.set(!showForm())">{{ showForm() ? 'Cancelar' : 'Novo estudante' }}</button> }
    </header>

    @if (showForm()) {
      <form class="card stack" [formGroup]="form" (ngSubmit)="create()" aria-labelledby="new-student-title">
        <h2 id="new-student-title">Cadastrar estudante</h2>
        <div class="grid two">
          <label>Matrícula<input formControlName="registration"></label>
          <label>Curso<select formControlName="courseId"><option value="">Selecione</option>@for (course of courses(); track course.id) { <option [value]="course.id">{{ course.name }}</option> }</select></label>
          <label>Nome civil<input formControlName="civilName" autocomplete="off"></label>
          <label>Nome social<input formControlName="socialName" autocomplete="off"></label>
          <label>Data de nascimento<input type="date" formControlName="birthDate"></label>
          <label>E-mail institucional<input type="email" formControlName="institutionalEmail"></label>
          <label>Telefone<input formControlName="phone"></label>
        </div>
        @if (message()) { <div [class]="messageClass()" role="status">{{ message() }}</div> }
        <div><button type="submit" [disabled]="form.invalid || saving()">Salvar cadastro</button></div>
      </form>
    }

    <section class="card list" aria-label="Lista de estudantes">
      <form class="search" (ngSubmit)="load()"><label class="sr-only" for="search">Buscar estudante</label><input id="search" [formControl]="search" placeholder="Buscar por nome ou matrícula"><button type="submit">Buscar</button></form>
      @if (loading()) { <p aria-live="polite">Carregando…</p> }
      @if (!loading() && students().length === 0) { <p class="muted">Nenhum estudante disponível para este perfil.</p> }
      @if (students().length > 0) {
        <table><thead><tr><th>Estudante</th><th>Matrícula</th><th>Curso</th><th>Situação</th><th><span class="sr-only">Ações</span></th></tr></thead>
          <tbody>@for (student of students(); track student.id) { <tr><td><strong>{{ student.displayName }}</strong></td><td>{{ student.registration }}</td><td>{{ student.course }}</td><td><span class="badge">{{ student.status }}</span></td><td><a class="button secondary" [routerLink]="['/estudantes', student.id]">Abrir</a></td></tr> }</tbody>
        </table>
      }
    </section>
  `,
  styles: [`
    .page-head { display: flex; justify-content: space-between; align-items: end; gap: 1rem; margin-bottom: 1.5rem; }
    h1 { margin: .2rem 0; font-size: 2.5rem; }
    .eyebrow { color: var(--primary); font-weight: 750; text-transform: uppercase; letter-spacing: .06em; }
    form.card { margin-bottom: 1.5rem; }
    .search { display: grid; grid-template-columns: 1fr auto; gap: .6rem; margin-bottom: 1rem; }
    @media (max-width: 620px) { .page-head { align-items: stretch; flex-direction: column; } }
  `]
})
export class StudentsComponent implements OnInit {
  private api = inject(ApiService);
  private fb = inject(FormBuilder);
  auth = inject(AuthService);

  readonly students = signal<StudentSummary[]>([]);
  readonly courses = signal<Course[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly showForm = signal(false);
  readonly message = signal('');
  readonly messageClass = signal('success');
  readonly search = this.fb.nonNullable.control('');
  readonly form = this.fb.group({
    registration: ['', Validators.required], courseId: ['', Validators.required], civilName: ['', Validators.required],
    socialName: [''], birthDate: [''], institutionalEmail: ['', Validators.email], phone: ['']
  });
  ngOnInit(): void { this.load(); if (this.auth.hasRole('NAPNE')) this.api.courses().subscribe(v => this.courses.set(v)); }
  load(): void { this.loading.set(true); this.api.students(this.search.value).subscribe({ next: p => { this.students.set(p.content); this.loading.set(false); }, error: () => this.loading.set(false) }); }
  create(): void {
    if (this.form.invalid) return;
    this.saving.set(true); this.message.set('');
    const raw = this.form.getRawValue();
    this.api.createStudent({ ...raw, courseId: Number(raw.courseId), birthDate: raw.birthDate || null }).subscribe({
      next: () => { this.form.reset(); this.saving.set(false); this.messageClass.set('success'); this.message.set('Estudante cadastrado.'); this.load(); },
      error: () => { this.saving.set(false); this.messageClass.set('error'); this.message.set('Não foi possível salvar o cadastro.'); }
    });
  }
}
