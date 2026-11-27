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

export interface AcademicListFilters {
  courseId?: string;
  subjectId?: string;
  subject?: string;
  groupCode?: string;
  periodCode?: string;
  teacherId?: string;
  active?: string;
}

export type AcademicFilterScope = Pick<AcademicListFilters, 'courseId' | 'subjectId' | 'periodCode'>;

export interface AcademicFilterOptions {
  subjects: { id: number; name: string; code: string }[];
  periodCodes: string[];
  groupCodes: string[];
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

  offerings(page: number, query: string, onlyActive = false, filters: AcademicListFilters = {}) {
    return this.http.get<Page<AcademicOffering>>(`${this.admin}/offerings`, {
      params: this.listParams(page, query, filters).set('onlyActive', onlyActive),
    });
  }

  offeringFilters(section: 'offerings' | 'teaching', scope: AcademicFilterScope) {
    return this.http.get<AcademicFilterOptions>(`${this.admin}/${section}/filter-options`, {
      params: this.filterParams(new HttpParams(), scope),
    });
  }

  createOffering(subjectId: number, periodId: number, groupCode: string) {
    return this.http.post<AcademicOffering>(`${this.admin}/offerings`, { subjectId, periodId, groupCode });
  }

  setOfferingActive(id: number, active: boolean) {
    return this.http.patch<AcademicOffering>(`${this.admin}/offerings/${id}/active`, { active });
  }

  teaching(page: number, query: string, filters: AcademicListFilters = {}) {
    return this.http.get<Page<TeachingAssignment>>(`${this.admin}/teaching`, { params: this.listParams(page, query, filters) });
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

  enrollments(studentId: number, page: number, query: string, filters: AcademicListFilters = {}) {
    return this.http.get<Page<AcademicEnrollment>>(`${this.student(studentId)}/enrollments`, {
      params: this.listParams(page, query, filters),
    });
  }

  enrollmentFilters(studentId: number, scope: AcademicFilterScope) {
    return this.http.get<AcademicFilterOptions>(`${this.student(studentId)}/enrollments/filter-options`, {
      params: this.filterParams(new HttpParams(), scope),
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

  private listParams(page: number, query: string, filters: AcademicListFilters = {}) {
    return this.filterParams(new HttpParams().set('page', page).set('size', 10).set('query', query.trim()), filters);
  }

  private filterParams(params: HttpParams, filters: AcademicListFilters) {
    for (const [key, value] of Object.entries(filters)) {
      if (value.trim()) params = params.set(key, value.trim());
    }
    return params;
  }
}
