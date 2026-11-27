import { Component, DestroyRef, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ApiService } from '../core/api.service';
import {
  AcademicStudentStatus, StudentDetails, StudentStatusReason, StudentStatusRestriction, StudentSummary,
} from '../core/models';
import { errorMessage } from '../core/presentation';
import {
  ACADEMIC_STATUS_OPTIONS, STUDENT_STATUS_REASON_OPTIONS, academicStatusLabel, academicStudentStatus,
} from '../core/student-status';
import { ModalShellComponent } from '../shared/modal-shell.component';

const DESTINATIONS: Partial<Record<StudentStatusReason, AcademicStudentStatus>> = {
  DROPOUT: 'INACTIVE', LEAVE_OF_ABSENCE: 'INACTIVE', DISMISSAL: 'INACTIVE',
  COURSE_COMPLETION: 'COMPLETED', TRANSFER: 'TRANSFERRED', ACADEMIC_RESUMPTION: 'ACTIVE',
};

@Component({
  selector: 'app-student-status-dialog',
  imports: [ModalShellComponent, ReactiveFormsModule],
  template: `
    <app-modal-shell [open]="true" eyebrow="Cadastro do estudante" [title]="title()"
      [description]="description()" (closed)="close()">
      <form [formGroup]="form" class="stack" (ngSubmit)="save()" novalidate>
        <p class="notice">Situação acadêmica atual: <strong>{{statusLabel(currentStatus())}}</strong></p>
        <fieldset class="status-fields stack" [disabled]="saving()">
          @if (mode() === 'change') {
            <label><span>Motivo <span class="field-required" aria-hidden="true">*</span></span>
              <select formControlName="reason" required (change)="chooseResult()">
                <option value="">Selecione um motivo</option>
                @for (reason of reasons(); track reason.id) { <option [value]="reason.id">{{reason.label}}</option> }
              </select>
            </label>
          }
          @if (mode() === 'change' || legacyArchive()) {
            <div class="grid two">
              <label><span>Situação resultante <span class="field-required" aria-hidden="true">*</span></span>
                <select formControlName="status" required>
                  <option value="">Selecione a situação</option>
                  @for (status of destinations(); track status.id) { <option [value]="status.id">{{status.label}}</option> }
                </select>
              </label>
              @if (mode() === 'change') {
                <label><span>Data da ocorrência <span class="field-required" aria-hidden="true">*</span></span>
                  <input type="date" formControlName="effectiveDate" [max]="today" required>
                </label>
              }
            </div>
            <label><span>{{legacyArchive() ? 'Justificativa' : 'Observações'}}
              @if (observationsRequired()) { <span class="field-required" aria-hidden="true">*</span> }</span>
              <textarea formControlName="observations" [required]="observationsRequired()" maxlength="1000" rows="3"></textarea>
            </label>
          }
        </fieldset>
        @if (showEffect()) {
          <p class="field-hint" role="status">{{effect()}}</p>
        }
        @if (requiresReview()) {
          @if (checking()) { <p role="status">Verificando matrículas, vínculos, casos e PEIs…</p> }
          @if (restrictionError()) {
            <div class="error" role="alert">{{restrictionError()}}
              <button type="button" class="secondary compact" (click)="checkRestrictions()">Tentar novamente</button>
            </div>
          }
          @if (restrictions().length) {
            <div class="notice" role="status">
              <strong>Resolva as pendências para salvar esta situação.</strong>
              <ul>@for (restriction of restrictions(); track restriction.code) { <li>{{restriction.message}}</li> }</ul>
            </div>
          }
        }
        @if (form.controls.effectiveDate.touched && form.controls.effectiveDate.value > today) {
          <p class="error" role="alert">A data da ocorrência deve ser igual ou anterior a hoje.</p>
        }
        @if (failure()) { <p class="error" role="alert">{{failure()}}</p> }
        <div class="dialog-actions">
          <button type="button" class="secondary" (click)="close()" [disabled]="saving()">Cancelar</button>
          <button type="submit" [disabled]="!canSubmit()">{{mode() === 'change' ? 'Salvar situação' : 'Desarquivar cadastro'}}</button>
        </div>
      </form>
    </app-modal-shell>
  `,
  styles: [`
    .status-fields { border: 0; padding: 0; margin: 0; min-width: 0; }
    p.notice, p.field-hint { margin: 0; }
    ul { margin-bottom: 0; }
  `],
})
export class StudentStatusDialogComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  readonly student = input.required<StudentSummary & { version?: number }>();
  readonly mode = input<'change' | 'restore'>('change');
  readonly cancelled = output<void>();
  readonly saved = output<StudentDetails>();
  readonly statusLabel = academicStatusLabel;
  readonly today = new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeZone: 'America/Rio_Branco' }).format();
  readonly form = this.fb.nonNullable.group({
    reason: this.fb.nonNullable.control<StudentStatusReason | ''>(''),
    status: this.fb.nonNullable.control<AcademicStudentStatus | ''>(''),
    effectiveDate: this.today,
    observations: ['', Validators.maxLength(1000)],
  });
  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.value });
  readonly currentStatus = computed(() => academicStudentStatus(this.student()));
  readonly legacyArchive = computed(() => this.mode() === 'restore' && this.currentStatus() === null);
  readonly title = computed(() => this.mode() === 'change' ? 'Alterar situação' : 'Desarquivar cadastro');
  readonly description = computed(() => this.legacyArchive()
    ? 'Confirme a situação acadêmica atual. O arquivamento antigo não guardou essa informação.'
    : this.mode() === 'restore' ? 'O cadastro volta à listagem com a situação acadêmica registrada.'
      : 'Registre a ocorrência acadêmica e confira o efeito no acompanhamento NAPNE.');
  readonly reasons = computed(() => STUDENT_STATUS_REASON_OPTIONS.filter(({ id }) =>
    this.currentStatus() === 'ACTIVE' ? id !== 'ACADEMIC_RESUMPTION'
      : id === 'ACADEMIC_RESUMPTION' || id === 'ADMINISTRATIVE_CORRECTION'));
  readonly destinations = computed(() => {
    const reason = this.formValue().reason;
    if (this.legacyArchive()) return ACADEMIC_STATUS_OPTIONS;
    if (!reason) return [];
    const destination = DESTINATIONS[reason];
    if (reason === 'ADMINISTRATIVE_CORRECTION') return ACADEMIC_STATUS_OPTIONS;
    return ACADEMIC_STATUS_OPTIONS.filter(({ id }) => id !== this.currentStatus()
      && (destination ? id === destination : id !== 'ACTIVE'));
  });
  readonly observationsRequired = computed(() => this.legacyArchive() || this.formValue().reason === 'OTHER'
    || this.formValue().reason === 'ADMINISTRATIVE_CORRECTION');
  readonly checking = signal(false);
  readonly restrictions = signal<StudentStatusRestriction[]>([]);
  readonly restrictionError = signal('');
  readonly failure = signal('');
  readonly saving = signal(false);
  readonly showEffect = computed(() => !!this.formValue().status);
  readonly requiresReview = computed(() => this.showEffect() && this.formValue().status !== 'ACTIVE'
    && (this.legacyArchive() || this.formValue().status !== this.currentStatus()));
  readonly effect = computed(() => this.formValue().status === 'ACTIVE'
    ? 'A situação ativa permite novos atendimentos quando houver as autorizações necessárias.'
    : 'A situação selecionada impede novos atendimentos e preserva o histórico acadêmico e pedagógico.');
  readonly canSubmit = computed(() => {
    if (this.saving()) return false;
    if (this.mode() === 'restore' && !this.legacyArchive()) return true;
    const { reason, status, effectiveDate, observations } = this.formValue();
    return !!(status && this.destinations().some(option => option.id === status)
      && (this.legacyArchive() || reason && effectiveDate && effectiveDate <= this.today)
      && (this.legacyArchive() || this.student().version !== undefined)
      && (!this.observationsRequired() || observations?.trim())
      && (observations?.length ?? 0) <= 1000
      && (!this.requiresReview() || !this.checking() && !this.restrictionError() && !this.restrictions().length));
  });

  ngOnInit(): void {
    const opener = document.activeElement;
    if (opener instanceof HTMLElement) this.destroyRef.onDestroy(() => queueMicrotask(() => opener.focus()));
    if (this.mode() === 'change' || this.legacyArchive()) this.checkRestrictions();
  }

  chooseResult(): void {
    const options = this.destinations();
    this.form.controls.status.setValue(options.length === 1 ? options[0].id : '');
  }

  checkRestrictions(): void {
    if (this.checking()) return;
    this.checking.set(true);
    this.restrictionError.set('');
    this.api.studentStatusRestrictions(this.student().id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: restrictions => { this.restrictions.set(restrictions); this.checking.set(false); },
      error: failure => {
        this.restrictionError.set(errorMessage(failure, 'verificar as pendências do cadastro'));
        this.checking.set(false);
      },
    });
  }

  close(): void {
    if (!this.saving()) this.cancelled.emit();
  }

  save(): void {
    if (!this.canSubmit()) return;
    const student = this.student();
    const { reason, status, effectiveDate, observations } = this.form.getRawValue();
    this.saving.set(true);
    this.failure.set('');
    const request = this.mode() === 'restore'
      ? this.api.reactivateStudent(student.id, {
          version: student.version,
          ...(this.legacyArchive() && status ? { academicStatus: status, observations: observations.trim() } : {}),
        })
      : this.api.changeStudentStatus(student.id, {
          status: status as AcademicStudentStatus, reason: reason as StudentStatusReason,
          effectiveDate, observations: observations.trim() || null, version: student.version!,
        });
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: updated => { this.saving.set(false); this.saved.emit(updated); },
      error: failure => {
        this.saving.set(false);
        this.failure.set(errorMessage(failure, 'salvar a situação do estudante'));
        if (typeof failure.error?.code === 'string' && failure.error.code.startsWith('STUDENT_HAS_')) this.checkRestrictions();
      },
    });
  }
}
