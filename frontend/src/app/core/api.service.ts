import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Attachment, Campus, CareRecord, CaseHistoryView, CaseResponsibleCandidate, CaseStageConfiguration, CaseStageConfigurationUpdate, Course, DocumentTemplateView, Dossier, NapneCase, Page, Pei, PeiAction, PeiCreateRequest, ReferenceEntryAdmin, ReferenceKind, ReferenceOption, StudentDetails, StudentSummary, Subject, TimelineEvent, UserView } from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);


  students(query = '', page = 0) {
    const params = new HttpParams().set('query', query).set('page', page).set('size', 20).set('sort', 'updatedAt,desc');
    return this.http.get<Page<StudentSummary>>('/api/v1/students', { params });
  }
  student(id: number) { return this.http.get<StudentDetails>(`/api/v1/students/${id}`); }
  createStudent(value: object) { return this.http.post<StudentDetails>('/api/v1/students', value); }
  updateStudent(id: number, value: object) { return this.http.put<StudentDetails>(`/api/v1/students/${id}`, value); }
  dossier(id: number) { return this.http.get<Dossier>(`/api/v1/students/${id}/dossier`); }
  saveDossier(id: number, value: object) { return this.http.put<Dossier>(`/api/v1/students/${id}/dossier`, value); }
  dossierHistory(id:number) { return this.http.get<{version:number,fields:Record<string,unknown>,author:string,occurredAt:string}[]>(`/api/v1/students/${id}/dossier/history`); }
  cases(id: number) { return this.http.get<NapneCase[]>(`/api/v1/students/${id}/cases`); }
  createCase(id: number, value: object) { return this.http.post<NapneCase>(`/api/v1/students/${id}/cases`, value); }
  getCase(id: number) { return this.http.get<NapneCase>(`/api/v1/cases/${id}`); }
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
  caseHistory(id: number, page: number) {
    const params = new HttpParams().set('page', page).set('size', 20);
    return this.http.get<Page<CaseHistoryView>>(`/api/v1/cases/${id}/history`, {params});
  }
  records(id: number) { return this.http.get<CareRecord[]>(`/api/v1/students/${id}/records`); }
  createRecord(id: number, value: object) { return this.http.post<CareRecord>(`/api/v1/students/${id}/records`, value); }
  updateRecord(studentId: number, recordId: string, value: object) { return this.http.put<CareRecord>(`/api/v1/students/${studentId}/records/${recordId}`, value); }
  timeline(id: number, type = '') {
    let params = new HttpParams().set('limit', 100);
    if (type) params = params.set('type', type);
    return this.http.get<TimelineEvent[]>(`/api/v1/students/${id}/timeline`, { params });
  }
  peis(id: number) { return this.http.get<Pei[]>(`/api/v1/students/${id}/peis`); }
  pei(studentId: number, id: string) { return this.http.get<Pei>(`/api/v1/students/${studentId}/peis/${id}`); }
  createPei(studentId: number, value: PeiCreateRequest) { return this.http.post<Pei>(`/api/v1/students/${studentId}/peis`, value); }
  revisePei(studentId: number, id: string, value: {content: Record<string, unknown>; version: number}) {
    return this.http.put<Pei>(`/api/v1/students/${studentId}/peis/${id}`, value);
  }
  peiAction(studentId: number, id: string, action: Exclude<PeiAction, 'EDIT'>, version: number) {
    const endpoint: Record<Exclude<PeiAction, 'EDIT'>, string> = {
      START_REVISION: 'revisions', SUBMIT: 'submit', RETURN: 'return', APPROVE: 'approve', ARCHIVE: 'archive'
    };
    return this.http.post<Pei>(`/api/v1/students/${studentId}/peis/${id}/${endpoint[action]}`, {version});
  }
  courses() { return this.http.get<Course[]>('/api/v1/catalog/courses'); }
  subjects(courseId: number) { return this.http.get<Subject[]>('/api/v1/catalog/subjects', { params: { courseId } }); }
  studentSubjects(studentId: number) { return this.http.get<Subject[]>('/api/v1/catalog/student-subjects', { params: { studentId } }); }
  studentTeachers(studentId: number) { return this.http.get<{id:number,name:string,subjectId:number}[]>('/api/v1/catalog/student-teachers', { params: { studentId } }); }
  attachments(studentId: number) { return this.http.get<Attachment[]>(`/api/v1/students/${studentId}/attachments`); }
  uploadAttachment(studentId: number, category: string, file: File, previousVersionId = '') {
    const data = new FormData(); data.append('file', file);
    return this.http.post<Attachment>(`/api/v1/students/${studentId}/attachments?category=${encodeURIComponent(category)}${previousVersionId?'&previousVersionId='+encodeURIComponent(previousVersionId):''}`, data);
  }
  downloadAttachment(studentId: number, id: string) {
    return this.http.get(`/api/v1/students/${studentId}/attachments/${id}/content`, { responseType: 'blob' });
  }
  campuses() { return this.http.get<Campus[]>('/api/v1/catalog/campuses'); }
  users() { return this.http.get<UserView[]>('/api/v1/admin/users'); }
  createUser(value: object) { return this.http.post<UserView>('/api/v1/admin/users', value); }
  createCampus(value: object) { return this.http.post<Campus>('/api/v1/admin/campuses', value); }
  adminCourses() { return this.http.get<Course[]>('/api/v1/admin/courses'); }
  adminSubjects() { return this.http.get<Subject[]>('/api/v1/admin/subjects'); }
  createCourse(value:object) { return this.http.post<Course>('/api/v1/admin/courses',value); }
  createSubject(value:object) { return this.http.post<Subject>('/api/v1/admin/subjects',value); }
  registrations() { return this.http.get<{id:number,registration:string,campusId:number,courseId:number}[]>('/api/v1/admin/student-registrations'); }
  assignments() { return this.http.get<{id:number,studentId:number,userId:number,subjectId:number|null,assignmentType:string,active:boolean}[]>('/api/v1/admin/assignments'); }
  createAssignment(value:object) { return this.http.post('/api/v1/admin/assignments',value); }
  revokeAssignment(id:number) { return this.http.patch(`/api/v1/admin/assignments/${id}/active`,{active:false}); }
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
