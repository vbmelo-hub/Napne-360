import { AcademicStudentStatus, StudentStatusReason, StudentSummary } from './models';

export const ACADEMIC_STATUSES: Readonly<Record<AcademicStudentStatus, string>> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  COMPLETED: 'Concluído',
  TRANSFERRED: 'Transferido',
};

export const STUDENT_STATUS_REASONS: Readonly<Record<StudentStatusReason, string>> = {
  DROPOUT: 'Evasão',
  COURSE_COMPLETION: 'Conclusão do curso',
  TRANSFER: 'Transferência',
  LEAVE_OF_ABSENCE: 'Trancamento',
  DISMISSAL: 'Desligamento',
  OTHER: 'Outro',
  ACADEMIC_RESUMPTION: 'Retomada acadêmica',
  ADMINISTRATIVE_CORRECTION: 'Correção cadastral',
};

export const ACADEMIC_STATUS_OPTIONS = Object.entries(ACADEMIC_STATUSES).map(([id, label]) => ({
  id: id as AcademicStudentStatus, label,
}));
export const STUDENT_STATUS_REASON_OPTIONS = Object.entries(STUDENT_STATUS_REASONS).map(([id, label]) => ({
  id: id as StudentStatusReason, label,
}));

export function academicStudentStatus(student: StudentSummary): AcademicStudentStatus | null {
  return student.academicStatus === undefined
    ? ACADEMIC_STATUS_OPTIONS.find(option => option.id === student.status)?.id ?? null
    : student.academicStatus;
}

export function academicStatusLabel(status: AcademicStudentStatus | null | undefined): string {
  return status ? ACADEMIC_STATUSES[status] : 'Não informada';
}

export function studentStatusReasonLabel(reason: StudentStatusReason | null | undefined): string {
  return reason ? STUDENT_STATUS_REASONS[reason] : '';
}
