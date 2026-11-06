export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const LABELS: Record<string, string> = {
  ACTIVE: 'Ativo', INACTIVE: 'Inativo', DRAFT: 'Rascunho', IN_REVIEW: 'Em revisão',
  APPROVED: 'Aprovado', SUPERSEDED: 'Substituído', ARCHIVED: 'Arquivado',
  RECEIVED: 'Recebido', SCREENING: 'Triagem', WELCOMING: 'Acolhimento',
  CASE_STUDY: 'Estudo de caso', GUIDANCE_ISSUED: 'Orientações emitidas',
  ACTION_PLAN: 'Plano de ação', PEI: 'PEI', FOLLOW_UP: 'Acompanhamento', CLOSED: 'Encerrado',
  INITIAL_SCREENING: 'Triagem inicial', PEDAGOGICAL_GUIDANCE: 'Orientações pedagógicas',
  TEACHER_FEEDBACK: 'Devolutiva docente', TUTOR_OBSERVATION: 'Observação de tutoria',
  SUPPORT_REFUSAL: 'Recusa de apoio', SUPPORT_REQUEST: 'Solicitação de apoio',
  CASE: 'Caso', DOSSIER: 'Dossiê', CARE_RECORD: 'Acompanhamento', ATTACHMENT: 'Documento',
  ADMIN: 'Administrador técnico', NAPNE: 'Equipe NAPNE', COTEP: 'COTEP',
  COURSE_COORDINATOR: 'Coordenação de curso', TEACHER: 'Professor', TUTOR: 'Tutor/Monitor',
  MANAGEMENT: 'Gestão', COORDINATOR: 'Coordenação/supervisão'
};

export function labelFor(value: string | null | undefined): string {
  if (!value) return 'Não informado';
  return LABELS[value] ?? value.replaceAll('_', ' ').toLocaleLowerCase('pt-BR').replace(/^./, c => c.toUpperCase());
}

export function toneFor(value: string | null | undefined): StatusTone {
  if (['APPROVED', 'ACTIVE', 'CLOSED'].includes(value ?? '')) return 'success';
  if (['ARCHIVED', 'SUPERSEDED', 'INACTIVE'].includes(value ?? '')) return 'neutral';
  if (['DRAFT', 'RECEIVED', 'SCREENING'].includes(value ?? '')) return 'warning';
  if (['IN_REVIEW', 'FOLLOW_UP', 'PEI', 'GUIDANCE_ISSUED'].includes(value ?? '')) return 'info';
  return 'neutral';
}

export function errorMessage(status?: number, action = 'concluir esta operação'): string {
  if (status === 0) return 'Não foi possível conectar ao serviço. Verifique sua conexão e tente novamente.';
  if (status === 403) return 'Seu perfil não tem permissão para realizar esta ação.';
  if (status === 404) return 'O conteúdo solicitado não foi encontrado.';
  if (status === 409) return 'Este conteúdo foi alterado por outra pessoa. Recarregue a página antes de continuar.';
  return `Não foi possível ${action}. Tente novamente.`;
}
