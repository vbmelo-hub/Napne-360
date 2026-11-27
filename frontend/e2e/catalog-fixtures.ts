import { execFileSync } from 'node:child_process';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export async function loginApi(request: APIRequestContext, role: string) {
  const response = await request.post('/api/v1/auth/login', {
    data: { email: `${role}@napne.local`, password: 'Napne360!Demo' }
  });
  expect(response.status()).toBe(200);
  return response.json();
}

export async function loginUi(page: Page, role: string) {
  // Logout revokes every session for the account, including API fixture tokens.
  // Leave the old app before clearing storage so an in-flight refresh cannot restore the session.
  if (/^https?:/.test(page.url())) {
    await page.route('**/__e2e_session_reset', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Troca de sessão de teste</title>',
    }), { times: 1 });
    await page.goto('/__e2e_session_reset');
    await page.evaluate(() => sessionStorage.removeItem('napne360.session'));
  }
  await page.goto('/login');
  await page.getByRole('textbox', { name: 'E-mail institucional', exact: true }).fill(`${role}@napne.local`);
  await page.getByLabel(/^Senha/).fill('Napne360!Demo');
  const response = page.waitForResponse(r => r.url().endsWith('/api/v1/auth/login') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole('heading', {
    name: role === 'admin' ? 'Estrutura institucional em um só lugar' : 'Acompanhamento NAPNE', exact: true
  })).toBeVisible();
}

type AcademicFixtureInput = {
  studentId: number;
  subjectId: number;
  teacherIds: readonly number[];
  adminHeaders: Record<string, string>;
  napneHeaders: Record<string, string>;
  semester?: 1 | 2;
};

export async function academicFixture(request: APIRequestContext, input: AcademicFixtureInput) {
  const year = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Rio_Branco', year: 'numeric' }).format(new Date());
  const response = await request.get('/api/v1/catalog/references', {
    params: { kind: 'ACADEMIC_TERM' }, headers: input.napneHeaders
  });
  expect(response.status(), await response.text()).toBe(200);
  const periods = await response.json() as { id: number; code: string; label: string; kind: string }[];
  const term = periods.find(period => period.code === `${year}.${input.semester ?? 1}`);
  expect(term, 'Período letivo gerado pelo backend').toBeTruthy();

  async function create(path: string, data: object, headers: Record<string, string>) {
    const response = await request.post(`/api/v1${path}`, { data, headers });
    expect(response.status(), `${path}: ${await response.text()}`).toBe(200);
    return response.json();
  }

  const offering = await create('/admin/academic/offerings', {
    subjectId: input.subjectId, periodId: term!.id,
    groupCode: `TEST-${input.studentId}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }, input.adminHeaders) as { id: number; groupCode: string };
  const teaching = [];
  for (const teacherId of input.teacherIds) {
    teaching.push(await create('/admin/academic/teaching', { teacherId, offeringId: offering.id }, input.adminHeaders) as { id: number });
  }
  const enrollment = await create(`/students/${input.studentId}/academic/enrollments`, {
    offeringId: offering.id
  }, input.napneHeaders) as { id: number };
  return { term: term!, offering, teaching, enrollment };
}

export async function catalogFixture(request: APIRequestContext) {
  const napne = await loginApi(request, 'napne');
  const admin = await loginApi(request, 'admin');
  const teacher = await loginApi(request, 'professor');
  const headers = { Authorization: `Bearer ${napne.token}` };
  const adminHeaders = { Authorization: `Bearer ${admin.token}` };
  const teacherHeaders = { Authorization: `Bearer ${teacher.token}` };
  const courses = await (await request.get('/api/v1/catalog/courses', { headers })).json();
  const subjects = await (await request.get('/api/v1/catalog/subjects', { headers, params: { courseId: courses[0].id } })).json();
  const post = async (path: string, data: object, auth = headers) => {
    const response = await request.post(`/api/v1${path}`, { headers: auth, data });
    expect(response.status(), `${path}: ${await response.text()}`).toBe(200);
    return response.json();
  };
  const student = await post('/students', {
    courseId: courses[0].id, registration: `TEST-CATALOG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    civilName: 'Pessoa Fictícia Catálogo', socialName: 'Teste de Catálogo'
  });
  const academicForSemester = (semester: 1 | 2) => academicFixture(request, {
    semester, studentId: student.id, subjectId: subjects[0].id, teacherIds: [teacher.id], adminHeaders, napneHeaders: headers
  });
  const academic = await academicForSemester(1);
  const path = `/api/v1/students/${student.id}`;
  const dossier = async () => (await request.get(`${path}/dossier`, { headers })).json();
  const saveDossier = async (data: object) => {
    const response = await request.put(`${path}/dossier`, { headers, data });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const entry = (kind: string, label: string) => post('/admin/references', {
    kind, code: `TEST-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, label
  }, adminHeaders);
  return { student, course: courses[0], teacher, subject: subjects[0], headers, adminHeaders, teacherHeaders, path, post, dossier, saveDossier, entry, academic, academicForSemester };
}

export function evaluateMongo(script: string): string {
  const docker = process.env['NAPNE_E2E_DOCKER'] || 'docker';
  const compose = ['compose'];
  if (process.env['NAPNE_E2E_COMPOSE_FILE']) compose.push('-f', process.env['NAPNE_E2E_COMPOSE_FILE']);
  if (process.env['NAPNE_E2E_COMPOSE_PROJECT']) compose.push('-p', process.env['NAPNE_E2E_COMPOSE_PROJECT']);
  const container = process.env['NAPNE_E2E_MONGO_CONTAINER'] ||
    execFileSync(docker, [...compose, 'ps', '-q', 'mongo'], { encoding: 'utf8', timeout: 30_000 }).trim();
  if (!container || container.includes('\n')) throw new Error('Container Mongo isolado não identificado.');
  const database = process.env['NAPNE_E2E_MONGO_DB'] || 'napne360_documents';
  return execFileSync(docker, ['exec', container, 'mongosh', database, '--quiet', '--eval', script], {
    encoding: 'utf8', timeout: 30_000
  }).trim();
}

/** Old records cannot be created through the new API. Touch only this newly created TEST student. */
export function makeLegacyFixture(student: { id: number; registration: string }, subjectId: number, teacherId: number): string {
  if (!Number.isSafeInteger(student.id) || student.id <= 0 || !student.registration.startsWith('TEST-CATALOG-') ||
      ![subjectId, teacherId].every(id => Number.isSafeInteger(id) && id > 0)) {
    throw new Error('Fixture de legado exige estudante fictício recém-criado e vínculo válido.');
  }
  // The independent academic relation uses a current term. This legacy grant preserves access to the historical PEI.
  const docker = process.env['NAPNE_E2E_DOCKER'] || 'docker';
  const compose = ['compose'];
  if (process.env['NAPNE_E2E_COMPOSE_FILE']) compose.push('-f', process.env['NAPNE_E2E_COMPOSE_FILE']);
  if (process.env['NAPNE_E2E_COMPOSE_PROJECT']) compose.push('-p', process.env['NAPNE_E2E_COMPOSE_PROJECT']);
  const mysql = 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root --database="$MYSQL_DATABASE" --batch';
  execFileSync(docker, [...compose, 'exec', '-T', 'mysql', 'sh', '-c', mysql], {
    input: `insert into student_assignment (student_id, user_id, subject_id, assignment_type, origin)
      values (${student.id}, ${teacherId}, ${subjectId}, 'TEACHER', 'MANUAL');`,
    encoding: 'utf8', timeout: 30_000
  });

  // Arguments and JavaScript literals are passed separately; no shell interpolation is used.
  const script = `
    const studentId = NumberLong(${JSON.stringify(String(student.id))});
    const dossier = db.student_dossiers.updateOne({studentId}, {$set: {educationalNeeds: {
      category: 'Categoria legada fictícia', notes: 'Notas legadas fictícias', extra: 'Extra preservado'
    }}});
    if (dossier.matchedCount !== 1) throw new Error('Fixture histórica de dossiê não localizada');
    const pei = db.pei_documents.insertOne({studentId,
      subjectId: NumberLong(${JSON.stringify(String(subjectId))}),
      teacherId: NumberLong(${JSON.stringify(String(teacherId))}),
      academicTerm: 'LEGACY-FICTICIO', revision: 1, status: 'DRAFT',
      content: {
        generalObjectives: 'Objetivo histórico fictício',
        skillsInventory: { oralCommunication: 'REALIZA_COM_AJUDA' }
      },
      createdBy: 'docente-ficticio@example.test', updatedBy: 'docente-ficticio@example.test',
      createdAt: new Date(), updatedAt: new Date(), storageVersion: NumberLong('0')
    });
    print(pei.insertedId.toString());
  `;
  return evaluateMongo(script);
}
