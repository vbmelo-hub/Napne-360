import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Page } from './models';

export interface AcademicPeriod {
  id: number;
  code: string;
  label: string;
  active: boolean;
}

export interface AcademicOffering {
  id: number;
  subjectId: number;
  subjectName: string;
  groupCode: string;
  courseId: number;
  courseName: string;
  campusId: number;
  campusName: string;
  periodId: number;
  periodCode: string;
  periodLabel: string;
  active: boolean;
}

export interface TeachingAssignment {
  id: number;
  teacherId: number;
  teacherName: string;
  offering: AcademicOffering;
  active: boolean;
  version: number;
}

export interface AcademicEnrollment {
  id: number;
  offering: AcademicOffering;
  active: boolean;
}

@Injectable({ providedIn: 'root' })
export class AcademicApi {
  private readonly http = inject(HttpClient);
  private readonly admin = '/api/v1/admin/academic';
  private readonly student = (id: number) => `/api/v1/students/${id}/academic`;

  periods(page: number, query: string) {
    return this.http.get<Page<AcademicPeriod>>(`${this.admin}/periods`, { params: this.listParams(page, query) });
  }

  activePeriods() {
    return this.http.get<AcademicPeriod[]>('/api/v1/catalog/references', { params: { kind: 'ACADEMIC_TERM' } });
  }

  setPeriodActive(id: number, active: boolean) {
    return this.http.patch<AcademicPeriod>(`${this.admin}/periods/${id}/active`, { active });
  }

  offerings(page: number, query: string, onlyActive = false) {
    return this.http.get<Page<AcademicOffering>>(`${this.admin}/offerings`, {
      params: this.listParams(page, query).set('onlyActive', onlyActive),
    });
  }

  createOffering(subjectId: number, periodId: number, groupCode: string) {
    return this.http.post<AcademicOffering>(`${this.admin}/offerings`, { subjectId, periodId, groupCode });
  }

  setOfferingActive(id: number, active: boolean) {
    return this.http.patch<AcademicOffering>(`${this.admin}/offerings/${id}/active`, { active });
  }

  teaching(page: number, query: string) {
    return this.http.get<Page<TeachingAssignment>>(`${this.admin}/teaching`, { params: this.listParams(page, query) });
  }

  createTeaching(offeringId: number, teacherId: number) {
    return this.http.post<TeachingAssignment>(`${this.admin}/teaching`, { offeringId, teacherId });
  }

  replaceTeacher(id: number, teacherId: number, version: number) {
    return this.http.put<TeachingAssignment>(`${this.admin}/teaching/${id}`, { teacherId, version });
  }

  setTeachingActive(id: number, active: boolean) {
    return this.http.patch<TeachingAssignment>(`${this.admin}/teaching/${id}/active`, { active });
  }

  enrollmentOptions(studentId: number, page: number, query: string) {
    return this.http.get<Page<AcademicOffering>>(`${this.student(studentId)}/enrollment-options`, {
      params: this.listParams(page, query),
    });
  }

  enrollments(studentId: number, page: number, query: string) {
    return this.http.get<Page<AcademicEnrollment>>(`${this.student(studentId)}/enrollments`, {
      params: this.listParams(page, query),
    });
  }

  createEnrollment(studentId: number, offeringId: number) {
    return this.http.post<AcademicEnrollment>(`${this.student(studentId)}/enrollments`, { offeringId });
  }

  setEnrollmentActive(studentId: number, id: number, active: boolean) {
    return this.http.patch<AcademicEnrollment>(`${this.student(studentId)}/enrollments/${id}/active`, { active });
  }

  peiOffers(studentId: number) {
    return this.http.get<AcademicOffering[]>(`${this.student(studentId)}/pei-offers`);
  }

  private listParams(page: number, query: string) {
    return new HttpParams().set('page', page).set('size', 10).set('query', query.trim());
  }
}
