export interface SessionUser {
  token: string | null;
  id: number;
  name: string;
  email: string;
  campusId: number | null;
  roles: string[];
  session?: SessionTiming;
}

export type SessionEndReason = 'IDLE_TIMEOUT' | 'MAX_DURATION' | 'SESSION_ENDED' | 'REVOKED' | 'ACCOUNT_INACTIVE';

export interface SessionTiming {
  serverTime: number;
  warningAt: number;
  expiresAt: number;
  reason: SessionEndReason;
}

export interface Page<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
}

export interface StudentSummary {
  id: number;
  registration: string;
  displayName: string;
  course: string;
  campus: string;
  status: string;
}

export interface StudentDetails extends StudentSummary {
  civilName: string;
  socialName: string | null;
  birthDate: string | null;
  institutionalEmail: string | null;
  phone: string | null;
  campusId: number;
  courseId: number;
  version: number;
}

export interface EducationalNeeds extends Record<string, unknown> {
  category?: string;
  categoryId?: number | null;
}

export interface Dossier {
  studentId: number;
  identification: Record<string, unknown>;
  educationalNeeds: EducationalNeeds;
  healthAndSupport: Record<string, unknown>;
  familyContext: Record<string, unknown>;
  schoolHistory: Record<string, unknown>;
  strengths: Record<string, unknown>;
  difficulties: Record<string, unknown>;
  initialInterventions: Record<string, unknown>;
  version: number | null;
  redacted: boolean;
}

export interface CaseStageOption {
  code: string;
  label: string;
}

export interface CaseStageConfiguration {
  version: number;
  stages: CaseStageOption[];
}

export interface CaseStageConfigurationUpdate {
  version: number;
  stages: { code: string | null; label: string }[];
}

export interface NapneCase {
  id: number;
  studentId: number;
  stage: string;
  allowedNextStages: string[];
  stageLabel?: string;
  stageOptions?: CaseStageOption[];
  source: string;
  openedAt: string;
  closedAt: string | null;
  responsible: string;
  responsibleId: number;
  summary: string | null;
  version: number;
}

export interface CaseResponsibleCandidate {
  id: number;
  name: string;
}

export interface CaseHistoryView {
  id: number;
  caseId: number;
  version: number;
  type: 'OPENED' | 'STAGE_CHANGED' | 'RESPONSIBLE_CHANGED' | 'DETAILS_UPDATED';
  fromSource?: string | null;
  toSource?: string | null;
  fromSummary?: string | null;
  toSummary?: string | null;
  fromStage: string | null;
  toStage: string | null;
  fromStageLabel?: string | null;
  toStageLabel?: string | null;
  fromResponsibleId: number | null;
  fromResponsible: string | null;
  toResponsibleId: number | null;
  toResponsible: string | null;
  actorId: number;
  actor: string;
  occurredAt: string;
  reason: string | null;
}

export interface CareRecordRevision {
  version: number | null;
  title: string;
  status: string;
  content: Record<string, unknown>;
  author: string;
  occurredAt: string;
}

export interface CareRecord {
  id: string;
  studentId: number;
  caseId: number | null;
  subjectId: number | null;
  type: string;
  status: string;
  title: string;
  content: Record<string, unknown>;
  createdBy: string;
  updatedBy?: string;
  createdAt?: string;
  updatedAt: string;
  version: number | null;
  history?: CareRecordRevision[];
  editable?: boolean | null;
}

export interface Pei {
  id: string;
  studentId: number;
  subjectId: number;
  teacherId: number | null;
  academicTerm: string;
  academicTermId?: number | null;
  academicTermLabel?: string | null;
  academicOfferingId?: number | null;
  revision: number;
  status: string;
  content: Record<string, unknown>;
  reviewedBy: string | null;
  reviewedAt: string | null;
  updatedAt: string;
  storageVersion?: number;
  formVersion?: string | null;
  allowedActions?: PeiAction[];
  transfer?: PeiTransfer;
}

export const PEI_ANNEX_I_VERSION = 'IFAC_76_2025';

export interface PeiAnnexI {
  version: string;
  title: string;
  labels: Record<string, string>;
  instructions: Record<string, string>;
  inventoryGroups: {
    id: string;
    label: string;
    indicators: { id: string; label: string; hasOptions: boolean }[];
  }[];
  ratings: { value: PeiSkillRating; label: string }[];
}

export type PeiSkillRating = 'REALIZA_COM_AJUDA' | 'REALIZA_SEM_AJUDA' | 'NAO_REALIZA' | 'NAO_OBSERVADO';

export type PeiAction = 'EDIT' | 'START_REVISION' | 'SUBMIT' | 'RETURN' | 'APPROVE' | 'ARCHIVE' | 'TRANSFER';

export interface PeiTransferCandidate {
  id: number;
  name: string;
}

export interface PeiTransfer {
  fromTeacherId: number;
  toTeacherId: number;
  transferredBy: string;
  transferredAt: string;
  reason: string;
}

export interface TimelineEvent {
  id: string;
  eventType: string;
  title: string;
  actor: string;
  visibility: string;
  createdAt: string;
}

export interface Attachment {
  revision: number;
  archived: boolean;
  previousVersionId: string|null;
  id: string;
  studentId: number;
  category: string;
  originalName: string;
  contentType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface Course { id: number; name: string; code: string; campusId: number; campus: string; }
export interface AdminCourse extends Course { active: boolean; }
export interface Subject { id: number; name: string; code: string; workloadHours: number; courseId: number; }
export interface AssignmentView {
  id: number;
  studentId: number;
  userId: number;
  subjectId: number | null;
  studentName?: string;
  registration?: string;
  userName?: string;
  subjectName?: string | null;
  origin?: 'MANUAL' | 'AUTOMATIC';
  periodCode?: string | null;
  assignmentType: string;
  active: boolean;
}

export interface AdminSubject extends Subject { active: boolean; syllabus?: string | null; version?: number; }
export interface Campus { id: number; name: string; code: string; active: boolean; }
export interface UserView {
  id: number;
  name: string;
  email: string;
  active: boolean;
  campusId: number | null;
  roles: string[];
  cpfMasked?: string | null;
  institutionalRegistration?: string | null;
  securityBlocked?: boolean;
}
export interface UserDetails {
  id: number;
  name: string;
  email: string;
  cpf: string | null;
  institutionalRegistration: string | null;
  campusId: number | null;
}

export type ReferenceKind = 'NEED_CATEGORY' | 'ACADEMIC_TERM';

export interface ReferenceOption {
  id: number;
  code: string;
  label: string;
}

export interface PeiCreateRequest {
  offeringId: number;
}

export interface ReferenceEntryAdmin {
  id: number;
  kind: string;
  code: string;
  label: string;
  description: string;
  active: boolean;
  version: number;
}

export interface DocumentTemplateView {
  id: string;
  name: string;
  documentType: string;
  defaults: Record<string, unknown>;
  active: boolean;
  version: number | null;
}
