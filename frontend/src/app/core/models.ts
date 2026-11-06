export interface SessionUser {
  token: string | null;
  id: number;
  name: string;
  email: string;
  campusId: number | null;
  roles: string[];
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

export interface Dossier {
  studentId: number;
  identification: Record<string, unknown>;
  educationalNeeds: Record<string, unknown>;
  healthAndSupport: Record<string, unknown>;
  familyContext: Record<string, unknown>;
  schoolHistory: Record<string, unknown>;
  strengths: Record<string, unknown>;
  difficulties: Record<string, unknown>;
  initialInterventions: Record<string, unknown>;
  version: number | null;
  redacted: boolean;
}

export interface NapneCase {
  id: number;
  studentId: number;
  stage: string;
  source: string;
  openedAt: string;
  closedAt: string | null;
  responsible: string;
  summary: string | null;
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
  updatedAt: string;
}

export interface Pei {
  id: string;
  studentId: number;
  subjectId: number;
  teacherId: number | null;
  academicTerm: string;
  revision: number;
  status: string;
  content: Record<string, unknown>;
  reviewedBy: string | null;
  reviewedAt: string | null;
  updatedAt: string;
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
export interface Subject { id: number; name: string; code: string; workloadHours: number; courseId: number; }
export interface Campus { id: number; name: string; code: string; active: boolean; }
export interface UserView { id: number; name: string; email: string; active: boolean; campusId: number | null; roles: string[]; }

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
