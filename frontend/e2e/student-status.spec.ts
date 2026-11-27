import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Course, Page, StudentDetails, StudentSummary, TimelineEvent } from '../src/app/core/models';
import { apiJson, fictitiousCpf } from './case-fixtures';
import { loginApi, loginUi } from './catalog-fixtures';

test('R03-NAPNE-F01 registra a ocorrência, bloqueia dependências e preserva o histórico', async ({ page, request }, testInfo) => {
  test.setTimeout(90_000);
  const registration = 'TEST-R03-STATUS-' + randomUUID().slice(0, 8);
  const signIn = async (role: string) => {
    const { id, campusId, name, token } = await loginApi(request, role);
    return { id, campusId, name, headers: { Authorization: `Bearer ${token}` } };
  };
  const [napne, admin, tutor] = await Promise.all(['napne', 'admin', 'tutor'].map(signIn));
  const courses = await apiJson<Course[]>(request, '/catalog/courses', { headers: napne.headers });
  const course = courses.find(item => item.campusId === napne.campusId);
  expect(course).toBeDefined();
  const student = await apiJson<StudentDetails>(request, '/students', {
    method: 'POST', headers: napne.headers,
    data: { registration, civilName: `Estudante fictício ${registration}`, courseId: course!.id },
  });
  const path = `/students/${student.id}`;
  const assignment = await apiJson<{ id: number }>(request, '/admin/assignments', {
    method: 'POST', headers: admin.headers, data: { studentId: student.id, userId: tutor.id, assignmentType: 'TUTOR' },
  });
  const historicalRecord = await apiJson<{ id: string }>(request, path + '/records', {
    method: 'POST', headers: napne.headers, data: {
      type: 'SUPPORT_REQUEST', status: 'ACTIVE', title: 'Solicitação de apoio preservada', content: {},
    },
  });
  const occurrence = '2026-01-02';
  const statusChange = { status: 'INACTIVE', reason: 'OTHER', effectiveDate: occurrence,
    observations: 'Ocorrência acadêmica conferida.', version: student.version };
  const change = (headers = napne.headers, data: object = statusChange) =>
    request.patch('/api/v1' + path + '/status', { headers, data });

  expect((await change(tutor.headers)).status()).toBe(403);
  const restricted = await request.patch('/api/v1' + path + '/status', { headers: napne.headers, data: statusChange });
  expect(restricted.status()).toBe(409);
  expect(await restricted.json()).toMatchObject({ code: 'STUDENT_HAS_ASSIGNMENTS' });
  const archiveBlocked = await request.delete('/api/v1' + path, { headers: napne.headers });
  expect(archiveBlocked.status()).toBe(409);
  expect(await archiveBlocked.json()).toMatchObject({ code: 'STUDENT_HAS_ASSIGNMENTS' });

  const otherName = 'status-outra-' + randomUUID().slice(0, 8);
  const otherCampus = await apiJson<{ id: number }>(request, '/admin/campuses', {
    method: 'POST', headers: admin.headers, data: { name: otherName, code: otherName },
  });
  await apiJson(request, '/admin/users', {
    method: 'POST', headers: admin.headers, data: {
      name: otherName, email: `${otherName}@napne.local`, campusId: otherCampus.id,
      cpf: fictitiousCpf(), roles: ['NAPNE'], password: 'Napne360!Demo',
    },
  });
  const otherNapne = await signIn(otherName);
  expect((await change(otherNapne.headers)).status()).toBe(403);
  expect((await request.get('/api/v1' + path + '/timeline/page', { headers: otherNapne.headers })).status()).toBe(403);

  await loginUi(page, 'napne');
  await page.goto(`/estudantes/${student.id}`);
  const openStatusModal = async () => {
    const restrictions = page.waitForResponse(response => response.url().endsWith(path + '/status/restrictions'),
      { timeout: 20_000 });
    await page.getByRole('button', { name: 'Alterar situação' }).click();
    const response = await restrictions;
    expect(response.status()).toBe(200);
    return response.json();
  };
  const pending = await openStatusModal();
  expect(pending).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'STUDENT_HAS_ASSIGNMENTS' })]));
  const dialog = page.getByRole('dialog', { name: 'Alterar situação' });
  await dialog.getByLabel('Motivo').selectOption('OTHER');
  await dialog.getByLabel('Situação resultante').selectOption('INACTIVE');
  await dialog.getByLabel('Data da ocorrência').fill(occurrence);
  await dialog.getByLabel('Observações').fill(statusChange.observations);
  await expect(dialog.getByText('Solicite à Administração o encerramento dos vínculos profissionais ativos.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Salvar situação' })).toBeDisabled();
  await dialog.screenshot({ path: testInfo.outputPath('situacao-pendencia.png') });
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  await apiJson(request, `/admin/assignments/${assignment.id}/active`, {
    method: 'PATCH', headers: admin.headers, data: { active: false },
  });
  expect(await openStatusModal()).toEqual([]);
  await dialog.getByLabel('Motivo').selectOption('OTHER');
  await dialog.getByLabel('Situação resultante').selectOption('INACTIVE');
  await dialog.getByLabel('Data da ocorrência').fill(occurrence);
  await expect(dialog.getByRole('button', { name: 'Salvar situação' })).toBeDisabled();
  await dialog.getByLabel('Observações').fill(statusChange.observations);
  await expect(dialog.getByRole('button', { name: 'Salvar situação' })).toBeEnabled();
  const saved = page.waitForResponse(response => response.url().endsWith(path + '/status')
    && response.request().method() === 'PATCH');
  await dialog.getByRole('button', { name: 'Salvar situação' }).click();
  const statusResult = await saved;
  expect(statusResult.status(), await statusResult.text()).toBe(200);
  const changed = await statusResult.json() as StudentDetails;
  expect(changed).toMatchObject({ registration, academicStatus: 'INACTIVE', statusReason: 'OTHER', archived: false });
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Inativo', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Histórico de situação' }).click();
  const timeline = page.locator('.timeline');
  await expect(timeline).toContainText('Situação acadêmica alterada');
  await expect(timeline).toContainText('Ativo → Inativo');
  await expect(timeline).toContainText('02/01/2026');
  await expect(timeline).toContainText('Motivo: Outro');
  await expect(timeline).toContainText(statusChange.observations);
  await expect(timeline).toContainText(napne.name);
  await page.screenshot({ path: testInfo.outputPath('situacao-historico.png'), fullPage: true });
  const stored = await apiJson<Page<TimelineEvent>>(request, path + '/timeline/page', {
    headers: napne.headers, params: { type: 'STUDENT_STATUS_CHANGED' },
  });
  expect(stored.content).toHaveLength(1);
  expect(stored.content[0]).toMatchObject({
    actor: napne.name, data: { previousStatus: 'ACTIVE', newStatus: 'INACTIVE', effectiveDate: occurrence },
  });

  const archived = await request.delete('/api/v1' + path, { headers: napne.headers });
  expect(archived.status()).toBe(200);
  const records = await apiJson<{ id: string; title: string }[]>(request, path + '/records', { headers: napne.headers });
  expect(records).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: historicalRecord.id, title: 'Solicitação de apoio preservada' }),
  ]));
  const archiveList = await apiJson<Page<StudentSummary>>(request, '/students', {
    headers: napne.headers, params: { archived: true, status: 'INACTIVE', reason: 'OTHER', query: registration },
  });
  expect(archiveList.content).toMatchObject([{ registration, status: 'ARCHIVED', academicStatus: 'INACTIVE', archived: true }]);
  const override = await request.patch('/api/v1' + path + '/reactivate', {
    headers: napne.headers, data: { academicStatus: 'ACTIVE', observations: 'Tentativa de alterar pelo desarquivamento.' },
  });
  expect(override.status()).toBe(400);
  const restored = await apiJson<StudentDetails>(request, path + '/reactivate', { method: 'PATCH', headers: napne.headers, data: {} });
  expect(restored).toMatchObject({ registration, status: 'INACTIVE', academicStatus: 'INACTIVE', archived: false });
  const newRecord = await request.post('/api/v1' + path + '/records', {
    headers: napne.headers, data: { type: 'SUPPORT_REQUEST', title: 'Tentativa de novo acompanhamento', content: {} },
  });
  expect(newRecord.status()).toBe(409);
  expect(await newRecord.json()).toMatchObject({ code: 'CARE_RECORD_STUDENT_INACTIVE' });
  const newLink = await request.post('/api/v1/admin/assignments', {
    headers: admin.headers, data: { studentId: student.id, userId: tutor.id, assignmentType: 'TUTOR' },
  });
  expect(newLink.status()).toBe(409);
  expect(await newLink.json()).toMatchObject({ code: 'ACADEMIC_LINK_STUDENT_INACTIVE' });
  const active = await change(napne.headers, { status: 'ACTIVE', reason: 'ACADEMIC_RESUMPTION',
    effectiveDate: occurrence, version: restored.version });
  expect(active.status(), await active.text()).toBe(200);
  expect(await active.json()).toMatchObject({ registration, academicStatus: 'ACTIVE', archived: false });
});
