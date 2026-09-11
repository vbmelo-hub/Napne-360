import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Attachment, Campus, CareRecord, Course, Dossier, NapneCase, Page, Pei, StudentDetails, StudentSummary, Subject, TimelineEvent, UserView } from './models';

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
  changeCaseStage(id: number, stage: string, summary: string | null) { return this.http.patch<NapneCase>(`/api/v1/cases/${id}/stage`, {stage, summary}); }
  records(id: number) { return this.http.get<CareRecord[]>(`/api/v1/students/${id}/records`); }
  createRecord(id: number, value: object) { return this.http.post<CareRecord>(`/api/v1/students/${id}/records`, value); }
  timeline(id: number, type = '') {
    let params = new HttpParams().set('limit', 100);
    if (type) params = params.set('type', type);
    return this.http.get<TimelineEvent[]>(`/api/v1/students/${id}/timeline`, { params });
  }
  peis(id: number) { return this.http.get<Pei[]>(`/api/v1/students/${id}/peis`); }
  pei(studentId: number, id: string) { return this.http.get<Pei>(`/api/v1/students/${studentId}/peis/${id}`); }
  createPei(studentId: number, value: object) { return this.http.post<Pei>(`/api/v1/students/${studentId}/peis`, value); }
  revisePei(studentId: number, id: string, value: object) { return this.http.put<Pei>(`/api/v1/students/${studentId}/peis/${id}`, value); }
  approvePei(studentId: number, id: string) { return this.http.post<Pei>(`/api/v1/students/${studentId}/peis/${id}/approve`, {}); }
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
  references(kind:string) { return this.http.get<{id:number,code:string,label:string}[]>('/api/v1/catalog/references',{params:{kind}}); }
}
