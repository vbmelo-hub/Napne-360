import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';

type RequestOptions = NonNullable<Parameters<APIRequestContext['fetch']>[1]>;
type Headers = { Authorization: string };

export type CaseView = {
  id: number;
  studentId: number;
  source: string;
  summary: string | null;
  responsibleId: number;
  responsible: string;
  version: number;
  stage: string;
  allowedNextStages: string[];
  openedAt: string;
  closedAt: string | null;
};

type Account = { id: number; name: string; email: string; campusId: number | null };
type Session = Account & { headers: Headers };
type Student = { id: number; registration: string; socialName: string; courseId: number };
type Course = { id: number; campusId: number };
type Campus = { id: number };

export async function apiJson<T>(request: APIRequestContext, path: string, options: RequestOptions = {}): Promise<T> {
  const response = await request.fetch('/api/v1' + path, options);
  expect(response.status(), path).toBe(200);
  return response.json();
}

async function signIn(request: APIRequestContext, email: string): Promise<Session> {
  const session = await apiJson<Account & { token: string }>(request, '/auth/login', {
    method: 'POST', data: { email, password: 'Napne360!Demo' }
  });
  const { token, ...account } = session;
  return { ...account, headers: { Authorization: 'Bearer ' + token } };
}

export async function caseFixture(request: APIRequestContext) {
  const key = randomUUID().slice(0, 8);
  const napne = await signIn(request, 'napne@napne.local');
  const admin = await signIn(request, 'admin@napne.local');
  const courses = await apiJson<Course[]>(request, '/catalog/courses', { headers: napne.headers });
  const course = courses.find(item => item.campusId === napne.campusId);
  if (!course) throw new Error('Curso fictício do campus da sessão NAPNE não encontrado.');

  const student = await apiJson<Student>(request, '/students', {
    method: 'POST', headers: napne.headers,
    data: {
      courseId: course.id, registration: 'TEST-CASE-' + key, civilName: 'Pessoa Fictícia Casos',
      socialName: 'Teste de Casos ' + key
    }
  });
  const path = '/students/' + student.id;
  const adminPost = <T>(endpoint: string, data: object) =>
    apiJson<T>(request, '/admin' + endpoint, { method: 'POST', headers: admin.headers, data });

  const account = (label: string, role: string, campusId = napne.campusId) => adminPost<Account>('/users', {
    name: 'Teste ' + label + ' ' + key,
    email: 'test-case-' + key + '-' + label + '@napne.local',
    campusId, roles: [role], password: 'Napne360!Demo'
  });

  const openCase = (source: string) => apiJson<CaseView>(request, path + '/cases', {
    method: 'POST', headers: napne.headers, data: { source, summary: 'Resumo fictício do caso' }
  });

  const alternateCampus = () => adminPost<Campus>('/campuses', {
    name: 'Campus Fictício Casos ' + key, code: 'CASE-' + key
  });
  const disable = (user: Account) => apiJson<Account & { active: boolean }>(request, '/admin/users/' + user.id + '/active', {
    method: 'PATCH', headers: admin.headers, data: { active: false }
  });
  const assignCoordinator = (user: Account) => adminPost('/assignments', {
    studentId: student.id, userId: user.id, assignmentType: 'COORDINATOR'
  });

  return { key, napne, admin, student, path, account, openCase, alternateCampus, disable, assignCoordinator,
    login: (user: Account) => signIn(request, user.email) };
}

/** Account rename has no API. Change only the fictitious account created by this test. */
export function renameCaseFixtureAccount(account: Account, key: string): string {
  const nextName = 'Teste responsavel-renomeado ' + key;
  if (!/^[a-f0-9]{8}$/.test(key) || !Number.isSafeInteger(account.id) || account.id <= 0 ||
      account.email !== 'test-case-' + key + '-responsavel@napne.local' ||
      account.name !== 'Teste responsavel ' + key) {
    throw new Error('Renomeação de fixture exige a conta fictícia de responsável criada pelo teste.');
  }

  const docker = process.env['NAPNE_E2E_DOCKER'] || 'docker';
  const compose = ['compose'];
  if (process.env['NAPNE_E2E_COMPOSE_FILE']) compose.push('-f', process.env['NAPNE_E2E_COMPOSE_FILE']);
  if (process.env['NAPNE_E2E_COMPOSE_PROJECT']) compose.push('-p', process.env['NAPNE_E2E_COMPOSE_PROJECT']);
  const mysql = 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" --database="$MYSQL_DATABASE" --batch --skip-column-names';
  const sql = "UPDATE app_user SET name = '" + nextName + "' WHERE id = " + account.id +
    " AND email = '" + account.email + "' AND name = '" + account.name + "';\nSELECT ROW_COUNT();\n";
  const rows = execFileSync(docker, [...compose, 'exec', '-T', 'mysql', 'sh', '-c', mysql], {
    input: sql, encoding: 'utf8', timeout: 30_000
  }).trim();
  expect(rows, 'uma conta fictícia renomeada').toBe('1');
  return nextName;
}
