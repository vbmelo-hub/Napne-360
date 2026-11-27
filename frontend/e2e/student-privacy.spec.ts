import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator } from '@playwright/test';
import type { Course, Page, Pei, StudentDetails, StudentSummary } from '../src/app/core/models';
import { apiJson, fictitiousCpf } from './case-fixtures';
import { academicFixture, loginApi, loginUi } from './catalog-fixtures';

const restrictedFields = ['civilName', 'birthDate', 'institutionalEmail', 'phone'] as const;
type RegistrationData = Record<(typeof restrictedFields)[number], string> & { socialName: string };

async function fillRegistration(dialog: Locator, data: RegistrationData) {
  await dialog.getByRole('textbox', { name: 'Nome civil', exact: true }).fill(data.civilName);
  await dialog.getByLabel('Nome social', { exact: true }).fill(data.socialName);
  await dialog.getByLabel('Data de nascimento', { exact: true }).fill(data.birthDate);
  await dialog.getByLabel('E-mail institucional', { exact: true }).fill(data.institutionalEmail);
  await dialog.getByLabel('Telefone', { exact: true }).fill(data.phone);
}

test('CA05 protege os dados cadastrais e usa o nome de exibição no novo PEI', async ({ page, request }, testInfo) => {
  const key = randomUUID().slice(0, 8);
  const registration = `TEST-CA05-${key}`;
  const initial: RegistrationData = {
    civilName: `Pessoa Civil Inicial ${key}`, socialName: '', birthDate: '2001-02-13',
    institutionalEmail: `privado-inicial-${key}@example.invalid`, phone: '+55 68 90000-1001'
  };
  const updated: RegistrationData = {
    civilName: `Pessoa Civil Revisada ${key}`, socialName: `Pessoa Social Ficticia ${key}`, birthDate: '2002-03-14',
    institutionalEmail: `privado-revisado-${key}@example.invalid`, phone: '+55 68 90000-1002'
  };
  const signIn = async (role: string) => {
    const { id, campusId, token } = await loginApi(request, role) as { id: number; campusId: number | null; token: string };
    return { id, campusId, headers: { Authorization: `Bearer ${token}` } };
  };
  const [napne, admin, teacher, tutor, cotep, coordinator, management] = await Promise.all(
    ['napne', 'admin', 'professor', 'tutor', 'cotep', 'coordenacao', 'gestao'].map(signIn)
  );
  const adminPost = <T>(path: string, data: object) => apiJson<T>(request, `/admin${path}`, {
    method: 'POST', headers: admin.headers, data
  });
  const courses = await apiJson<Course[]>(request, '/catalog/courses', { headers: napne.headers });
  const course = courses.find(item => item.campusId === napne.campusId);
  if (!course) throw new Error('Curso fictício do campus NAPNE não encontrado.');
  const [subject] = await apiJson<{ id: number }[]>(request, '/catalog/subjects', {
    headers: napne.headers, params: { courseId: course.id }
  });
  expect(subject, 'componente curricular do curso fictício').toBeDefined();

  const studentList = '/api/v1/students';
  const waitForWrite = (method: string, path: string) => page.waitForResponse(response =>
    response.request().method() === method && new URL(response.url()).pathname === path
  );
  const student = await test.step('NAPNE cadastra o estudante com nome civil e contatos pela interface', async () => {
    await loginUi(page, 'napne');
    await page.goto('/estudantes');
    await page.getByRole('button', { name: 'Novo estudante', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Cadastrar estudante', exact: true });
    await fillRegistration(dialog, initial);
    await dialog.getByRole('textbox', { name: 'Matrícula', exact: true }).fill(registration);
    await dialog.getByRole('button', { name: /^Curso/ }).click();
    await dialog.getByRole('option').filter({ hasText: course.name }).filter({ hasText: course.code }).click();
    const creation = waitForWrite('POST', studentList);
    await dialog.getByRole('button', { name: 'Salvar estudante', exact: true }).click();
    const response = await creation;
    expect(response.status(), await response.text()).toBe(200);
    await expect(dialog).toBeHidden();
    return await response.json() as StudentDetails;
  });

  const path = `/students/${student.id}`;
  const url = `/estudantes/${student.id}`;
  const list = (headers: typeof napne.headers) => apiJson<Page<StudentSummary>>(request, '/students', {
    headers, params: { query: registration }
  });
  const getStudent = (headers: typeof napne.headers) => apiJson<StudentDetails>(request, path, { headers });
  const metadata = {
    id: student.id, registration, courseId: course.id, course: course.name,
    campusId: napne.campusId, campus: course.campus, status: 'ACTIVE'
  };
  const summary = { id: student.id, registration, course: course.name, campus: course.campus, status: 'ACTIVE' };
  expect(student).toMatchObject({ ...metadata, ...initial, socialName: null, displayName: initial.civilName });

  const pedagogy = [teacher, tutor, cotep, coordinator, management];
  await test.step('lista e detalhe exigem vínculo ativo e campus compatível', async () => {
    const otherCampus = await adminPost<{ id: number }>('/campuses', { name: `Campus fictício CA05 ${key}`, code: `CA05-${key}` });
    const otherLogin = `test-ca05-${key}-napne`;
    await adminPost('/users', {
      name: `NAPNE fictício CA05 ${key}`, email: `${otherLogin}@napne.local`,
      campusId: otherCampus.id, cpf: fictitiousCpf(), roles: ['NAPNE'], password: 'Napne360!Demo'
    });
    const otherNapne = await signIn(otherLogin);
    for (const { headers } of [teacher, otherNapne]) {
      expect((await list(headers)).content).toEqual([]);
      expect((await request.get(`/api/v1${path}`, { headers })).status()).toBe(403);
    }
    expect((await request.put(`/api/v1${path}`, {
      headers: otherNapne.headers, data: { ...updated, registration, courseId: course.id }
    })).status()).toBe(403);
  });

  const academicForSemester = (semester: 1 | 2) => academicFixture(request, {
    semester, studentId: student.id, subjectId: subject.id, teacherIds: [teacher.id],
    adminHeaders: admin.headers, napneHeaders: napne.headers
  });
  const academic = { civil: await academicForSemester(1), social: await academicForSemester(2) };
  await adminPost('/assignments', { studentId: student.id, userId: tutor.id, assignmentType: 'TUTOR' });
  for (const account of [cotep, coordinator, management]) {
    await adminPost('/assignments', { studentId: student.id, userId: account.id, assignmentType: 'COORDINATOR' });
  }
  expect((await request.put(`/api/v1${path}`, {
    headers: teacher.headers, data: { ...updated, registration, courseId: course.id }
  })).status()).toBe(403);

  const checkVisibility = async (state: RegistrationData, displayName: string) => {
    const socialName = state.socialName || null;
    expect(await getStudent(napne.headers)).toMatchObject({ ...metadata, ...state, socialName, displayName });
    const expectedSummary = { ...summary, displayName };
    for (const { headers } of [napne, ...pedagogy]) {
      expect((await list(headers)).content).toEqual([expectedSummary]);
    }

    const forbiddenValues = restrictedFields.map(field => state[field]).filter(value => value !== displayName);
    for (const { headers } of pedagogy) {
      const detail = await getStudent(headers);
      expect(detail).toMatchObject({
        ...metadata, displayName, socialName, civilName: null, birthDate: null, institutionalEmail: null, phone: null
      });
      for (const value of forbiddenValues) expect(JSON.stringify(detail)).not.toContain(value);
    }

    await loginUi(page, 'professor');
    await page.goto('/estudantes');
    await page.getByRole('searchbox', { name: 'Buscar estudante', exact: true }).fill(registration);
    await page.getByRole('button', { name: 'Buscar', exact: true }).click();
    const row = page.getByRole('row').filter({ hasText: registration });
    await expect(row.getByText(displayName, { exact: true })).toBeVisible();
    await row.getByRole('link', { name: 'Abrir acompanhamento', exact: true }).click();
    await expect(page.getByRole('heading', { name: displayName, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Editar cadastro', exact: true })).toHaveCount(0);
    for (const value of forbiddenValues) await expect(page.locator('body')).not.toContainText(value);
    return forbiddenValues;
  };

  const peis = `${path}/peis`;
  const createPei = async (period: 'civil' | 'social', displayName: string, forbidden: string[]) => {
    const draft = await apiJson<Pei>(request, peis, {
      method: 'POST', headers: teacher.headers, data: { offeringId: academic[period].offering.id }
    });
    expect(draft).toMatchObject({ status: 'DRAFT', formVersion: 'IFAC_76_2025', content: { student: displayName } });
    for (const value of forbidden) expect(JSON.stringify(draft)).not.toContain(value);
    return draft;
  };
  const readPei = (id: string) => apiJson<Pei>(request, `${peis}/${id}`, { headers: teacher.headers });
  const showPei = async (id: string, displayName: string, forbidden: string[]) => {
    await page.goto(`${url}/pei/${id}`);
    const annex = page.locator('app-pei-annex-i');
    await expect(annex.locator('.identification').getByText(displayName, { exact: true })).toBeVisible();
    for (const value of forbidden) await expect(annex).not.toContainText(value);
  };
  const downloadPdf = async (id: string, name: string) => {
    const response = await request.get(`/api/v1${peis}/${id}/pdf`, { headers: teacher.headers });
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/pdf');
    const pdf = await response.body();
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    await writeFile(testInfo.outputPath(name), pdf);
  };

  const archived = await test.step('sem nome social, perfis vinculados leem o nome civil como identificação e o PEI o registra', async () => {
    const forbidden = await checkVisibility(initial, initial.civilName);
    const draft = await createPei('civil', initial.civilName, forbidden);
    const saved = await apiJson<Pei>(request, `${peis}/${draft.id}`, {
      method: 'PUT', headers: teacher.headers, data: { version: draft.storageVersion, content: {
        ...draft.content, generalObjectives: 'Objetivo geral fictício',
        specificObjectives: ['Objetivo específico fictício', 'Segundo objetivo específico fictício'],
        contents: [{ description: 'Conteúdo fictício', workloadHours: 4, priority: false }],
        teachingStrategies: ['Estratégia fictícia'], assessmentCriteria: ['Critério fictício'],
        assessmentInstruments: [{ description: 'Instrumento fictício', justification: 'Justificativa fictícia' }]
      } }
    });
    const transition = (plan: Pei, action: string, headers: typeof napne.headers) => apiJson<Pei>(request, `${peis}/${plan.id}/${action}`, {
      method: 'POST', headers, data: { version: plan.storageVersion }
    });
    const submitted = await transition(saved, 'submit', teacher.headers);
    const approved = await transition(submitted, 'approve', napne.headers);
    const historical = await transition(approved, 'archive', napne.headers);
    expect(historical).toMatchObject({ status: 'ARCHIVED', content: { student: initial.civilName } });
    await showPei(historical.id, initial.civilName, forbidden);
    await downloadPdf(historical.id, 'ca05-sem-nome-social.pdf');
    return historical;
  });

  await test.step('NAPNE inclui o nome social, atualiza os dados restritos e reabre o cadastro', async () => {
    await loginUi(page, 'napne');
    await page.goto(url);
    const edit = page.getByRole('button', { name: 'Editar cadastro', exact: true });
    await edit.click();
    const dialog = page.getByRole('dialog', { name: 'Editar dados do estudante', exact: true });
    await expect(dialog.getByRole('textbox', { name: 'Nome civil', exact: true })).toHaveValue(initial.civilName);
    await expect(dialog.getByLabel('Nome social', { exact: true })).toHaveValue('');
    await fillRegistration(dialog, updated);
    const saving = waitForWrite('PUT', `/api/v1${path}`);
    await dialog.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    const response = await saving;
    expect(response.status(), await response.text()).toBe(200);
    expect(await response.json()).toMatchObject({ ...metadata, ...updated, displayName: updated.socialName });
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByRole('heading', { name: updated.socialName, exact: true })).toBeVisible();
    await edit.click();
    await expect(dialog.getByLabel('Nome social', { exact: true })).toHaveValue(updated.socialName);
    await expect(dialog.getByRole('textbox', { name: 'Nome civil', exact: true })).toHaveValue(updated.civilName);
    await expect(dialog.getByLabel('Data de nascimento', { exact: true })).toHaveValue(updated.birthDate);
    await expect(dialog.getByLabel('E-mail institucional', { exact: true })).toHaveValue(updated.institutionalEmail);
    await expect(dialog.getByLabel('Telefone', { exact: true })).toHaveValue(updated.phone);
    await expect(dialog.getByRole('button', { name: /^Curso/ })).toContainText(course.name);
    await expect(dialog.getByText(`Matrícula ${registration}`, { exact: true })).toBeVisible();
  });

  await test.step('nome social prevalece no novo PEI e o documento arquivado preserva a identificação anterior', async () => {
    const forbidden = await checkVisibility(updated, updated.socialName);
    const newPei = await createPei('social', updated.socialName, [...forbidden, initial.civilName]);
    const persisted = await readPei(newPei.id);
    expect(persisted.content).toEqual(newPei.content);
    await showPei(persisted.id, updated.socialName, [...forbidden, initial.civilName]);
    await downloadPdf(persisted.id, 'ca05-com-nome-social.pdf');

    expect(await readPei(archived.id)).toMatchObject({ status: 'ARCHIVED', content: archived.content });
    await showPei(archived.id, initial.civilName, [...forbidden, updated.socialName]);
    await downloadPdf(archived.id, 'ca05-historico-apos-alteracao.pdf');
  });

  await test.step('revogar o vínculo impede a consulta ao cadastro e ao PDF', async () => {
    for (const entry of Object.values(academic)) {
      const disabled = await apiJson<{ active: boolean }>(request, `/admin/academic/teaching/${entry.teaching[0].id}/active`, {
        method: 'PATCH', headers: admin.headers, data: { active: false }
      });
      expect(disabled.active).toBe(false);
    }
    expect((await list(teacher.headers)).content).toEqual([]);
    expect((await request.get(`/api/v1${path}`, { headers: teacher.headers })).status()).toBe(403);
    expect((await request.get(`/api/v1${peis}/${archived.id}/pdf`, { headers: teacher.headers })).status()).toBe(403);
  });
});
