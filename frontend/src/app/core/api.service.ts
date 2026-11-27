import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { LIST_PAGE_SIZE } from './list-view';
import { AdminCourse, AdminSubject, AssignmentView, Attachment, Campus, CareRecord, CaseHistoryView, CaseResponsibleCandidate, CaseStageConfiguration, CaseStageConfigurationUpdate, CaseStageOption, Course, DocumentTemplateView, Dossier, NapneCase, Page, Pei, PeiAction, PeiAnnexI, PeiCreateRequest, PeiTransferCandidate, ReferenceEntryAdmin, ReferenceKind, ReferenceOption, StudentDetails, StudentRegistrationCandidate, StudentStatusChange, StudentStatusRestore, StudentStatusRestriction, StudentSummary, Subject, TimelineEvent, UserDetails, UserView } from './models';

type PeiVersionAction = Exclude<PeiAction, 'EDIT' | 'TRANSFER'>;

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);


  students(query = '', page = 0, academicQuery = '', archived = false, courseId = '', status = '', reason = '') {
    let params = new HttpParams().set('query', query).set('page', page).set('size', LIST_PAGE_SIZE)
      .append('sort', 'updatedAt,desc').append('sort', 'id,desc');
    if (academicQuery) params = params.set('academicQuery', academicQuery);
    if (archived) params = params.set('archived', true);
    if (courseId) params = params.set('courseId', courseId);
    if (status) params = params.set('status', status);
    if (reason) params = params.set('reason', reason);
    return this.http.get<Page<StudentSummary>>('/api/v1/students', { params });
  }
  studentFilterCourses() {
    return this.http.get<Pick<Course, 'id' | 'name' | 'code'>[]>('/api/v1/students/filter-courses');
  }
  student(id: number) { return this.http.get<StudentDetails>(`/api/v1/students/${id}`); }
  createStudent(value: object) { return this.http.post<StudentDetails>('/api/v1/students', value); }
  updateStudent(id: number, value: object) { return this.http.put<StudentDetails>(`/api/v1/students/${id}`, value); }
  archiveStudent(id: number) { return this.http.delete<void>(`/api/v1/students/${id}`); }
  reactivateStudent(id: number, value: StudentStatusRestore = {}) {
    return this.http.patch<StudentDetails>(`/api/v1/students/${id}/reactivate`, value);
  }
  changeStudentStatus(id: number, value: StudentStatusChange) {
    return this.http.patch<StudentDetails>(`/api/v1/students/${id}/status`, value);
  }
  studentStatusRestrictions(id: number) {
    return this.http.get<StudentStatusRestriction[]>(`/api/v1/students/${id}/status/restrictions`);
  }
  dossier(id: number) { return this.http.get<Dossier>(`/api/v1/students/${id}/dossier`); }
  saveDossier(id: number, value: object) { return this.http.put<Dossier>(`/api/v1/students/${id}/dossier`, value); }
  dossierHistory(id:number) { return this.http.get<{version:number,fields:Record<string,unknown>,author:string,occurredAt:string}[]>(`/api/v1/students/${id}/dossier/history`); }
  cases(id: number) { return this.http.get<NapneCase[]>(`/api/v1/students/${id}/cases`); }
  createCase(id: number, value: object) { return this.http.post<NapneCase>(`/api/v1/students/${id}/cases`, value); }
  getCase(id: number) { return this.http.get<NapneCase>(`/api/v1/cases/${id}`); }
  updateCase(id: number, value: {source: string; summary: string | null; version: number}) {
    return this.http.patch<NapneCase>(`/api/v1/cases/${id}`, value);
  }
  changeCaseStage(id: number, stage: string, summary: string | null, version: number, reason?: string) {
    return this.http.patch<NapneCase>(`/api/v1/cases/${id}/stage`, {
      stage, summary, version, ...(reason === undefined ? {} : {reason})
    });
  }
  caseResponsibleCandidates(id: number) {
    return this.http.get<CaseResponsibleCandidate[]>(`/api/v1/cases/${id}/responsible-candidates`);
  }
  changeCaseResponsible(id: number, value: {responsibleId: number; version: number; reason?: string | null}) {
    return this.http.patch<NapneCase>(`/api/v1/cases/${id}/responsible`, value);
  }
  studentCaseStages(id: number) {
    return this.http.get<CaseStageOption[]>(`/api/v1/students/${id}/cases/stages`);
  }
  caseHistory(id: number, page: number, type = '', filters: { actor?: string; actorId?: string; version?: number; from?: string; to?: string } = {}) {
    let params = new HttpParams().set('page', page).set('size', LIST_PAGE_SIZE);
    if (type) params = params.set('type', type);
    for (const [key, value] of Object.entries(filters)) {
      if (value != null && value !== '') params = params.set(key, value);
    }
    return this.http.get<Page<CaseHistoryView>>(`/api/v1/cases/${id}/history`, {params});
  }
  caseHistoryAuthors(id: number) {
    return this.http.get<{ id: number; name: string }[]>(`/api/v1/cases/${id}/history/actors`);
  }
  records(id: number) { return this.http.get<CareRecord[]>(`/api/v1/students/${id}/records`); }
  createRecord(id: number, value: object) { return this.http.post<CareRecord>(`/api/v1/students/${id}/records`, value); }
  updateRecord(studentId: number, recordId: string, value: object) { return this.http.put<CareRecord>(`/api/v1/students/${studentId}/records/${recordId}`, value); }
  timeline(id: number, type = '', page = 0, filters: { actor?: string; actorKey?: string; from?: string; to?: string } = {}) {
    let params = new HttpParams().set('page', page).set('size', LIST_PAGE_SIZE);
    if (type) params = params.set('type', type);
    for (const [key, value] of Object.entries(filters)) {
      if (value) params = params.set(key, value);
    }
    return this.http.get<Page<TimelineEvent>>(`/api/v1/students/${id}/timeline/page`, { params });
  }
  timelineActors(id: number) {
    return this.http.get<{ id: string; label: string; detail?: string }[]>(`/api/v1/students/${id}/timeline/actors`);
  }
  peis(id: number) { return this.http.get<Pei[]>(`/api/v1/students/${id}/peis`); }
  pei(studentId: number, id: string) { return this.http.get<Pei>(`/api/v1/students/${studentId}/peis/${id}`); }
  peiAnnexI() { return this.http.get<PeiAnnexI>('/api/v1/pei/anexo-i'); }
  downloadPeiPdf(studentId: number, id: string) {
    return this.http.get(`/api/v1/students/${studentId}/peis/${id}/pdf`, { observe: 'response', responseType: 'blob' });
  }
  createPei(studentId: number, value: PeiCreateRequest) { return this.http.post<Pei>(`/api/v1/students/${studentId}/peis`, value); }
  revisePei(studentId: number, id: string, value: {content: Record<string, unknown>; version: number}) {
    return this.http.put<Pei>(`/api/v1/students/${studentId}/peis/${id}`, value);
  }
  peiAction(studentId: number, id: string, action: PeiVersionAction, version: number) {
    const endpoint: Record<PeiVersionAction, string> = {
      START_REVISION: 'revisions', SUBMIT: 'submit', RETURN: 'return', APPROVE: 'approve', ARCHIVE: 'archive'
    };
    return this.http.post<Pei>(`/api/v1/students/${studentId}/peis/${id}/${endpoint[action]}`, {version});
  }
  peiTransferCandidates(studentId: number, id: string) {
    return this.http.get<PeiTransferCandidate[]>(`/api/v1/students/${studentId}/peis/${id}/transfer-candidates`);
  }
  transferPei(studentId: number, id: string, value: {teacherId: number; reason: string; version: number}) {
    return this.http.post<Pei>(`/api/v1/students/${studentId}/peis/${id}/transfer`, value);
  }
  courses() { return this.http.get<Course[]>('/api/v1/catalog/courses'); }
  subjects(courseId: number) { return this.http.get<Subject[]>('/api/v1/catalog/subjects', { params: { courseId } }); }
  studentSubjects(studentId: number) { return this.http.get<Subject[]>('/api/v1/catalog/student-subjects', { params: { studentId } }); }
  studentTeachers(studentId: number) { return this.http.get<{id:number,name:string,subjectId:number}[]>('/api/v1/catalog/student-teachers', { params: { studentId } }); }
  attachments(studentId: number, includeArchived = false) {
    return this.http.get<Attachment[]>(`/api/v1/students/${studentId}/attachments`,
      includeArchived ? { params: { includeArchived: true } } : {});
  }
  uploadAttachment(studentId: number, category: string, file: File, previousVersionId = '', key?: string) {
    const data = new FormData();
    data.append('file', file);
    let params = new HttpParams().set('category', category);
    if (previousVersionId) params = params.set('previousVersionId', previousVersionId);
    return this.http.post<Attachment>(`/api/v1/students/${studentId}/attachments`, data, {
      params, headers: key ? { 'Idempotency-Key': key } : undefined
    });
  }
  attachmentVersions(studentId: number, id: string) {
    return this.http.get<Attachment[]>(`/api/v1/students/${studentId}/attachments/${encodeURIComponent(id)}/versions`);
  }
  archiveAttachment(studentId: number, id: string) {
    return this.http.delete<void>(`/api/v1/students/${studentId}/attachments/${encodeURIComponent(id)}`);
  }
  downloadAttachment(studentId: number, id: string) {
    return this.http.get(`/api/v1/students/${studentId}/attachments/${id}/content`, { responseType: 'blob' });
  }
  campuses() { return this.http.get<Campus[]>('/api/v1/catalog/campuses'); }
  userCandidates(criteria: { roles: readonly string[]; campusId?: number; excludedId?: number;
    query: string; selectedId?: number; page?: number; includeInactive?: true }) {
    return this.http.post<{ content: UserView[]; totalElements: number; selected: UserView | null }>(
      '/api/v1/admin/users/candidates', criteria);
  }
  usersPage(page: number, query: string, filters: Readonly<Record<string, string>>) {
    return this.http.post<Page<UserView>>('/api/v1/admin/users/page', {
      page, size: LIST_PAGE_SIZE, query: query || undefined,
      campus: filters['campus'] || undefined, role: filters['role'] || undefined, status: filters['status'] || undefined,
    });
  }
  userDetails(id: number) { return this.http.get<UserDetails>(`/api/v1/admin/users/${id}`); }
  searchUserCpf(cpf: string) { return this.http.post<{ id: number | null }>('/api/v1/admin/users/cpf-search', { cpf }); }
  updateUser(id: number, value: Omit<UserDetails, 'id'>) { return this.http.put<UserView>(`/api/v1/admin/users/${id}`, value); }
  revokeUserSessions(id: number) { return this.http.post<void>(`/api/v1/admin/users/${id}/sessions/revoke`, null); }
  blockUserAccess(id: number) { return this.http.post<UserView>(`/api/v1/admin/users/${id}/block`, null); }
  createUser(value: object) { return this.http.post<UserView>('/api/v1/admin/users', value); }
  adminCampuses() { return this.http.get<Campus[]>('/api/v1/admin/campuses'); }
  createCampus(value: object) { return this.http.post<Campus>('/api/v1/admin/campuses', value); }
  updateCampus(id: number, value: { name: string; code: string }) {
    return this.http.put<Campus>(`/api/v1/admin/campuses/${id}`, value);
  }
  setCampusActive(id: number, active: boolean) {
    return this.http.patch<Campus>(`/api/v1/admin/campuses/${id}/active`, { active });
  }
  adminCourses() { return this.http.get<AdminCourse[]>('/api/v1/admin/courses'); }
  adminSubjects() { return this.http.get<AdminSubject[]>('/api/v1/admin/subjects'); }
  createCourse(value:object) { return this.http.post<AdminCourse>('/api/v1/admin/courses',value); }
  updateCourse(id: number, value: { campusId: number; name: string; code: string }) {
    return this.http.put<AdminCourse>(`/api/v1/admin/courses/${id}`, value);
  }
  archiveCourse(id: number) {
    return this.http.patch<AdminCourse>(`/api/v1/admin/courses/${id}/archive`, null);
  }
  createSubject(value:object) { return this.http.post<AdminSubject>('/api/v1/admin/subjects',value); }
  updateSubject(id: number, value: { courseId: number; name: string; code: string; workloadHours: number; syllabus: string; version?: number }) {
    return this.http.put<AdminSubject>(`/api/v1/admin/subjects/${id}`, value);
  }
  setSubjectActive(id: number, active: boolean) {
    return this.http.patch<AdminSubject>(`/api/v1/admin/subjects/${id}/${active ? 'reactivate' : 'archive'}`, null);
  }
  studentRegistrationCandidates(criteria: { query?: string; selectedId?: number; page?: number }) {
    return this.http.post<{ content: StudentRegistrationCandidate[]; totalElements: number; selected: StudentRegistrationCandidate | null }>(
      '/api/v1/admin/student-registrations/candidates', criteria);
  }
  assignmentPage(page: number, filters: Readonly<Record<string, string>>) {
    let params = new HttpParams().set('page', page).set('size', LIST_PAGE_SIZE);
    for (const [key, value] of Object.entries(filters)) {
      if (value.trim()) params = params.set(key, value.trim());
    }
    return this.http.get<Page<AssignmentView>>('/api/v1/admin/assignments/page', { params });
  }
  assignmentPeriods(campus: string, course: string) {
    let params = new HttpParams();
    if (campus) params = params.set('campus', campus);
    if (course) params = params.set('course', course);
    return this.http.get<string[]>('/api/v1/admin/assignments/periods', { params });
  }
  createAssignment(value:object) { return this.http.post('/api/v1/admin/assignments',value); }
  revokeAssignment(id:number) { return this.http.patch(`/api/v1/admin/assignments/${id}/active`,{active:false}); }
  regularizeAssignment(id: number) { return this.http.patch(`/api/v1/admin/assignments/${id}/regularize`, {}); }
  setUserActive(id:number,active:boolean) { return this.http.patch<UserView>(`/api/v1/admin/users/${id}/active`,{active}); }
  setUserRoles(id:number,roles:string[]) { return this.http.put<UserView>(`/api/v1/admin/users/${id}/roles`,{roles}); }
  resetPassword(id:number,password:string) { return this.http.post(`/api/v1/admin/users/${id}/password`,{password}); }
  references(kind:ReferenceKind) { return this.http.get<ReferenceOption[]>('/api/v1/catalog/references',{params:{kind}}); }
  adminCaseStages() {
    return this.http.get<CaseStageConfiguration>('/api/v1/admin/case-stages');
  }
  updateCaseStages(configuration: CaseStageConfigurationUpdate) {
    return this.http.put<CaseStageConfiguration>('/api/v1/admin/case-stages', configuration);
  }
  adminReferences() { return this.http.get<ReferenceEntryAdmin[]>('/api/v1/admin/references'); }
  createReference(value: object) { return this.http.post<ReferenceEntryAdmin>('/api/v1/admin/references', value); }
  updateReference(id: number, value: object) { return this.http.put<ReferenceEntryAdmin>(`/api/v1/admin/references/${id}`, value); }
  setReferenceActive(id: number, active: boolean) { return this.http.patch<ReferenceEntryAdmin>(`/api/v1/admin/references/${id}/active`, { active }); }
  adminTemplates() { return this.http.get<DocumentTemplateView[]>('/api/v1/admin/templates'); }
  createTemplate(value: object) { return this.http.post<DocumentTemplateView>('/api/v1/admin/templates', value); }
  updateTemplate(id: string, value: object) { return this.http.put<DocumentTemplateView>(`/api/v1/admin/templates/${id}`, value); }
}
