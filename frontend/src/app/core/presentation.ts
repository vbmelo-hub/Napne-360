export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const LABELS: Record<string, string> = {
  ACTIVE: 'Ativo', INACTIVE: 'Inativo', DRAFT: 'Rascunho', IN_REVIEW: 'Em revisão',
  APPROVED: 'Aprovado', SUPERSEDED: 'Substituído', ARCHIVED: 'Arquivado',
  RECEIVED: 'Recebido', SCREENING: 'Triagem', WELCOMING: 'Acolhimento',
  CASE_STUDY: 'Estudo de caso', GUIDANCE_ISSUED: 'Orientações emitidas',
  ACTION_PLAN: 'Plano de ação', PEI: 'PEI', FOLLOW_UP: 'Acompanhamento', CLOSED: 'Encerrado',
  INITIAL_SCREENING: 'Triagem inicial', PEDAGOGICAL_GUIDANCE: 'Orientações pedagógicas',
  TEACHER_FEEDBACK: 'Devolutiva docente', TUTOR_OBSERVATION: 'Observação de tutoria',
  NAPNE_FOLLOW_UP: 'Acompanhamento NAPNE', SUPPORT_REFUSAL: 'Recusa de apoio', SUPPORT_REQUEST: 'Solicitação de apoio',
  CASE: 'Caso', DOSSIER: 'Dossiê', CARE_RECORD: 'Acompanhamento', ATTACHMENT: 'Documento',
  ADMIN: 'Administrador técnico', NAPNE: 'Equipe NAPNE', COTEP: 'COTEP',
  COURSE_COORDINATOR: 'Coordenação de curso', TEACHER: 'Professor', TUTOR: 'Tutor/Monitor',
  MANAGEMENT: 'Gestão', COORDINATOR: 'Coordenação/supervisão',
  DOSSIER_UPDATED: 'Atualização do dossiê',
  CASE_OPENED: 'Abertura de caso', CASE_STAGE_CHANGED: 'Mudança de etapa',
  CASE_RESPONSIBLE_CHANGED: 'Transferência de responsabilidade', CASE_DETAILS_UPDATED: 'Edição de caso',
  CARE_RECORD_CREATED: 'Criação de acompanhamento', CARE_RECORD_UPDATED: 'Atualização de acompanhamento',
  CARE_RECORD_ARCHIVED: 'Arquivamento de acompanhamento',
  ATTACHMENT_UPLOADED: 'Envio de documento', ATTACHMENT_ARCHIVED: 'Arquivamento de documento',
  PEI_CREATED: 'Criação de PEI', PEI_REVISED: 'Revisão de PEI', PEI_SUBMITTED: 'Envio de PEI para revisão',
  PEI_APPROVED: 'Aprovação de PEI', PEI_RETURNED: 'Devolução de PEI para ajustes',
  PEI_ARCHIVED: 'Arquivamento de PEI', PEI_TRANSFERRED: 'Transferência de responsabilidade pelo PEI',
  STUDENT_CREATED: 'Cadastro de estudante', STUDENT_UPDATED: 'Atualização de estudante',
  STUDENT_STATUS_CHANGED: 'Situação acadêmica alterada', STUDENT_ARCHIVED: 'Cadastro do estudante arquivado',
  STUDENT_UNARCHIVED: 'Cadastro do estudante desarquivado'
};

export function labelFor(value: string | null | undefined): string {
  if (!value) return 'Não informado';
  return LABELS[value] ?? value.replaceAll('_', ' ').toLocaleLowerCase('pt-BR').replace(/^./, c => c.toUpperCase());
}

export function timelineLabel(value: string | null | undefined): string {
  return value && Object.hasOwn(LABELS, value) ? LABELS[value] : 'Evento do acompanhamento';
}

export function toneFor(value: string | null | undefined): StatusTone {
  if (['APPROVED', 'ACTIVE', 'CLOSED'].includes(value ?? '')) return 'success';
  if (['ARCHIVED', 'SUPERSEDED', 'INACTIVE'].includes(value ?? '')) return 'neutral';
  if (['DRAFT', 'RECEIVED', 'SCREENING'].includes(value ?? '')) return 'warning';
  if (['IN_REVIEW', 'FOLLOW_UP', 'PEI', 'GUIDANCE_ISSUED'].includes(value ?? '')) return 'info';
  return 'neutral';
}

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  USER_CPF_REQUIRED: 'Informe o CPF.',
  USER_CPF_INVALID: 'Informe um CPF válido.',
  USER_CPF_DUPLICATE: 'Este CPF já está cadastrado.',
  USER_EMAIL_DUPLICATE: 'Este e-mail já está vinculado a outra conta.',
  USER_CAMPUS_REQUIRED: 'Vincule esta conta a um campus para conceder perfis institucionais.',
  USER_CAMPUS_ARCHIVED: 'Reative o campus ou selecione um campus ativo.',
  USER_CAMPUS_CHANGED: 'O campus desta conta foi alterado. Atualize a listagem e tente novamente.',
  USER_SELF_ADMIN: 'Mantenha sua própria conta de administrador ativa e com o perfil técnico.',
  USER_LAST_ADMIN: 'O sistema deve manter ao menos um administrador ativo.',
  USER_ACTIVE_ASSIGNMENTS: 'Resolva os vínculos e as atribuições ativas da conta antes de continuar.',
  USER_ACTIVE_CASES: 'Transfira os casos em andamento sob responsabilidade desta conta antes de continuar.',
  USER_ACTIVE_PEIS: 'Resolva os PEIs vigentes ou em elaboração sob responsabilidade desta conta antes de continuar.',
  USER_ACTIVE_RECORDS: 'Resolva os rascunhos de acompanhamento da conta antes de continuar.',
  CAMPUS_CODE_DUPLICATE: 'Já existe um campus com este código.',
  CAMPUS_ACTIVE_COURSES: 'Arquive os cursos ativos antes de arquivar este campus.',
  CAMPUS_ACTIVE_USERS: 'Resolva o vínculo das contas ativas antes de arquivar este campus.',
  CAMPUS_ACTIVE_STUDENTS: 'Este campus possui estudantes ativos vinculados.',
  CAMPUS_ACTIVE_ASSIGNMENTS: 'Este campus possui vínculos, matrículas, ofertas ou atribuições ativas.',
  CAMPUS_ACTIVE_CASES: 'Este campus possui casos em andamento.',
  ATTACHMENT_CONFIRMATION_UNAVAILABLE: 'A confirmação está temporariamente indisponível. Consulte os documentos antes de tentar novamente.',
  ATTACHMENT_EMPTY: 'O arquivo está vazio. Selecione um documento com conteúdo.',
  ATTACHMENT_UNSUPPORTED: 'Selecione um arquivo PDF, PNG, JPEG ou DOCX.',
  ATTACHMENT_INVALID: 'O conteúdo do arquivo não corresponde ao formato informado ou o documento está danificado.',
  ATTACHMENT_VERSION_MISSING: 'A versão anterior do documento não foi encontrada.',
  PEI_DRAFT_EXISTS: 'Já existe um PEI em andamento ou vigente para este componente e período.',
  PEI_SUBJECT_ARCHIVED: 'O componente da oferta está arquivado.',
  CASE_STUDENT_ARCHIVED: 'Desarquive o cadastro do estudante antes de abrir um caso.',
  CASE_STUDENT_INACTIVE: 'A situação acadêmica do estudante não permite abrir ou reabrir um caso.',
  CARE_RECORD_STUDENT_INACTIVE: 'A situação acadêmica do estudante não permite iniciar ou reabrir acompanhamentos.',
  CASE_STAGE_INVALID: 'A mudança para essa etapa não é permitida no estado atual do caso.',
  CASE_REOPEN_REASON_REQUIRED: 'Informe um motivo de reabertura com até 500 caracteres.',
  CASE_RESPONSIBLE_INELIGIBLE: 'Selecione um profissional ativo da equipe NAPNE do campus do estudante.',
  CASE_DETAILS_CLOSED: 'Reabra o caso encerrado antes de editar os seus dados.',
  CASE_TRANSFER_CLOSED: 'O caso precisa estar ativo para transferir a responsabilidade.',
};

interface ResponseFailure {
  status?: number;
  error?: unknown;
}

export function errorMessage(failure?: number | ResponseFailure, action = 'concluir esta operação'): string {
  const status = typeof failure === 'number' ? failure : failure?.status;
  const body = typeof failure === 'object' ? failure?.error : null;
  if (typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
      && Object.hasOwn(ERROR_MESSAGES, body.code)) return ERROR_MESSAGES[body.code];
  if (typeof body === 'object' && body !== null && 'code' in body && typeof body.code === 'string'
      && /^(ACADEMIC|STUDENT)_[A-Z_]+$/.test(body.code) && 'detail' in body
      && typeof body.detail === 'string' && body.detail.trim()) return body.detail;
  if (status === 401) return 'Sua sessão expirou. Entre novamente para continuar.';
  if (status === 413) return 'O arquivo ultrapassa o limite permitido de 10 MB.';
  if (status === 0) return 'Não foi possível conectar ao serviço. Verifique sua conexão e tente novamente.';
  if (status === 403) return 'Seu perfil não tem permissão para realizar esta ação.';
  if (status === 404) return 'O conteúdo solicitado não foi encontrado.';
  if (status === 409) return 'Este conteúdo foi alterado por outra pessoa. Recarregue a página antes de continuar.';
  return `Não foi possível ${action}. Tente novamente.`;
}
