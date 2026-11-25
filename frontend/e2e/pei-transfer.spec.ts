import { expect, test, type APIResponse } from '@playwright/test';
import { apiJson, caseFixture } from './case-fixtures';
import { loginUi } from './catalog-fixtures';

type Revision = {
  id: string;
  status: string;
  revision: number;
  storageVersion: number;
  formVersion: string;
  teacherId: number;
  createdBy: string;
  updatedBy: string;
  content: Record<string, unknown>;
  allowedActions: string[];
  transfer?: { fromTeacherId: number; toTeacherId: number; transferredBy: string; transferredAt: string; reason: string } | null;
};

async function readRevision(response: Pick<APIResponse, 'status' | 'text' | 'json'>): Promise<Revision> {
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

test('NAPNE transfere rascunho devolvido e novo docente continua o PEI com histórico preservado', async ({ page, request }) => {
  const fixture = await caseFixture(request);
  const { napne, admin, student } = fixture;
  const author = await fixture.account('pei-autor', 'TEACHER');
  const recipient = await fixture.account('pei-substituto', 'TEACHER');
  const subjects = await apiJson<{ id: number }[]>(request, '/catalog/subjects', {
    headers: napne.headers, params: { courseId: student.courseId }
  });
  expect(subjects.length, 'componente do curso fictício').toBeGreaterThan(0);
  const subjectId = subjects[0].id;
  const assign = (userId: number) => apiJson<{ id: number }>(request, '/admin/assignments', {
    method: 'POST', headers: admin.headers, data: { studentId: student.id, userId, subjectId, assignmentType: 'TEACHER' }
  });
  const authorAssignment = await assign(author.id);
  await assign(recipient.id);
  const authorSession = await fixture.login(author);
  const recipientSession = await fixture.login(recipient);
  const term = await apiJson<{ id: number }>(request, '/admin/references', {
    method: 'POST', headers: admin.headers,
    data: { kind: 'ACADEMIC_TERM', code: `TEST-PEI-TRANSFER-${fixture.key}`, label: 'Período fictício de transferência' }
  });
  const path = `${fixture.path}/peis`;
  const editor = (id: string) => `/estudantes/${student.id}/pei/${id}`;
  const get = (id: string, headers = napne.headers) => apiJson<Revision>(request, `${path}/${id}`, { headers });
  const transition = (item: Revision, action: string, headers = napne.headers) => apiJson<Revision>(request, `${path}/${item.id}/${action}`, {
    method: 'POST', headers, data: { version: item.storageVersion }
  });
  const save = (item: Revision, content: Revision['content']) => apiJson<Revision>(request, `${path}/${item.id}`, {
    method: 'PUT', headers: authorSession.headers, data: { version: item.storageVersion, content }
  });
  const responseFor = (method: string, endpoint: string) => page.waitForResponse(response =>
    response.request().method() === method && new URL(response.url()).pathname === '/api/v1' + endpoint
  );
  const status = page.locator('.pei-header .badge');
  const objective = page.locator('#generalObjectives');
  const transferButton = page.getByRole('button', { name: 'Transferir rascunho', exact: true });
  const reason = `Motivo fictício de transferência ${fixture.key}`;

  const { current, draft } = await test.step('preparar um PEI vigente e um rascunho devolvido ao autor', async () => {
    const firstDraft = await apiJson<Revision>(request, path, {
      method: 'POST', headers: authorSession.headers, data: { subjectId, academicTermId: term.id }
    });
    const complete = await save(firstDraft, {
      ...firstDraft.content,
      generalObjectives: 'Objetivo fictício do PEI vigente',
      specificObjectives: ['Objetivo específico fictício', 'Segundo objetivo específico fictício'],
      contents: [{ description: 'Conteúdo fictício', workloadHours: 4, priority: true }],
      teachingStrategies: ['Estratégia fictícia'], assessmentCriteria: ['Critério fictício'],
      assessmentInstruments: [{ description: 'Instrumento fictício', justification: 'Justificativa fictícia' }]
    });
    const current = await transition(await transition(complete, 'submit', authorSession.headers), 'approve');
    const replacement = await transition(current, 'revisions', authorSession.headers);
    const edited = await save(replacement, { ...replacement.content, generalObjectives: 'Objetivo fictício do autor' });
    const draft = await transition(await transition(edited, 'submit', authorSession.headers), 'return');
    expect(draft).toMatchObject({
      status: 'DRAFT', formVersion: 'IFAC_76_2025', teacherId: author.id,
      createdBy: author.email, content: { teacherName: author.name }
    });
    expect(draft.allowedActions).not.toContain('TRANSFER');
    return { current, draft };
  });

  const candidatesPath = `${path}/${draft.id}/transfer-candidates`;
  const transferPath = `${path}/${draft.id}/transfer`;
  const command = { teacherId: recipient.id, reason, version: draft.storageVersion };

  const transferred = await test.step('desativar o vínculo e confirmar para o novo docente pela interface do NAPNE', async () => {
    await loginUi(page, 'napne');
    await page.goto(editor(draft.id));
    await expect(objective).toHaveValue(String(draft.content['generalObjectives']));
    await expect(transferButton).toHaveCount(0);

    const disabled = await apiJson<{ active: boolean }>(request, `/admin/assignments/${authorAssignment.id}/active`, {
      method: 'PATCH', headers: admin.headers, data: { active: false }
    });
    expect(disabled.active).toBe(false);
    expect((await request.get(`/api/v1${path}/${draft.id}`, { headers: authorSession.headers })).status()).toBe(403);
    expect((await get(draft.id, recipientSession.headers)).allowedActions).toEqual([]);
    expect((await request.get(`/api/v1${candidatesPath}`, { headers: recipientSession.headers })).status()).toBe(403);
    expect((await request.post(`/api/v1${transferPath}`, { headers: recipientSession.headers, data: command })).status()).toBe(403);

    await page.reload();
    await transferButton.click();
    const dialog = page.getByRole('alertdialog', { name: 'Transferir rascunho do PEI?', exact: true });
    const candidate = dialog.getByRole('combobox', { name: 'Novo docente', exact: true });
    const confirm = dialog.getByRole('button', { name: 'Confirmar transferência', exact: true });
    await expect(candidate.getByRole('option', { name: recipient.name, exact: true })).toHaveCount(1);
    await expect(candidate.getByRole('option', { name: author.name, exact: true })).toHaveCount(0);
    await expect(candidate.locator('option:checked')).toHaveText('Selecione um docente');
    await expect(confirm).toBeDisabled();
    await candidate.selectOption({ label: recipient.name });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Motivo', { exact: true }).fill(reason);
    const pending = responseFor('POST', transferPath);
    await confirm.click();
    const response = await pending;
    expect(response.request().postDataJSON()).toEqual(command);
    const next = await readRevision(response);
    expect(next.id).not.toBe(draft.id);
    expect(next).toMatchObject({
      status: 'DRAFT', revision: draft.revision + 1, teacherId: recipient.id,
      formVersion: draft.formVersion, createdBy: author.email, updatedBy: napne.email,
      transfer: { fromTeacherId: author.id, toTeacherId: recipient.id, transferredBy: napne.email, transferredAt: expect.any(String), reason }
    });
    expect(next.content).toEqual({ ...draft.content, teacherName: recipient.name });
    await expect(page).toHaveURL(new RegExp(`${editor(next.id)}$`));
    await expect(status).toHaveText('Rascunho');
    await expect(page.getByText(reason)).toBeVisible();
    await expect(objective).toHaveValue(String(draft.content['generalObjectives']));
    expect((await request.post(`/api/v1${transferPath}`, { headers: napne.headers, data: command })).status()).toBe(409);
    return next;
  });

  await test.step('consultar a revisão anterior e conferir a auditoria restrita', async () => {
    expect(await get(draft.id)).toMatchObject({
      status: 'SUPERSEDED', teacherId: author.id, createdBy: author.email, content: draft.content
    });
    expect(await get(current.id)).toMatchObject({ status: 'APPROVED', content: current.content });
    await page.goto(editor(draft.id));
    await expect(status).toHaveText('Histórico · substituído');
    await expect(objective).toHaveValue(String(draft.content['generalObjectives']));
    await expect(objective).toBeDisabled();

    const auditOptions = { params: { resourceType: 'PEI', resourceId: transferred.id } };
    const audit = await apiJson<{ content: { action: string; actor: string; outcome: string }[] }>(request, '/audit', {
      ...auditOptions, headers: napne.headers
    });
    expect(audit.content.filter(entry => entry.action === 'TRANSFER')).toMatchObject([
      { actor: napne.email, outcome: 'SUCCESS' }
    ]);
    expect((await request.get('/api/v1/audit', { ...auditOptions, headers: recipientSession.headers })).status()).toBe(403);
    type TimelineEvent = { eventType: string; visibility: string; data: { peiId?: string } };
    const timelinePath = `${fixture.path}/timeline`;
    const events = await apiJson<TimelineEvent[]>(request, timelinePath, { headers: napne.headers });
    expect(events.filter(event => event.eventType === 'PEI_TRANSFERRED')).toMatchObject([
      { visibility: 'RESTRICTED', data: { peiId: transferred.id } }
    ]);
    expect(JSON.stringify(events)).not.toContain(reason);
    const teacherEvents = await apiJson<TimelineEvent[]>(request, timelinePath, { headers: recipientSession.headers });
    expect(teacherEvents.some(event => event.eventType === 'PEI_SUBMITTED')).toBe(true);
    expect(teacherEvents.some(event => event.eventType === 'PEI_TRANSFERRED')).toBe(false);
  });

  await test.step('novo docente edita e envia sem receber o motivo da transferência', async () => {
    const teacherDraft = await get(transferred.id, recipientSession.headers);
    expect(teacherDraft.allowedActions).toEqual(expect.arrayContaining(['EDIT', 'SUBMIT']));
    expect(teacherDraft.transfer ?? null).toBeNull();
    const teacherRevisions = await apiJson<Revision[]>(request, path, { headers: recipientSession.headers });
    expect(teacherRevisions.filter(item => item.status === 'DRAFT').map(item => item.id)).toEqual([transferred.id]);
    expect(JSON.stringify(teacherRevisions)).not.toContain(reason);

    await loginUi(page, recipient.email.split('@')[0]);
    await page.goto(editor(transferred.id));
    await expect(objective).toHaveValue(String(draft.content['generalObjectives']));
    await expect(page.getByText(reason)).toHaveCount(0);
    await expect(transferButton).toHaveCount(0);
    const newObjective = 'Objetivo fictício ajustado pelo novo docente';
    await objective.fill(newObjective);
    const saving = responseFor('PUT', `${path}/${transferred.id}`);
    await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
    const saved = await readRevision(await saving);
    expect(saved).toMatchObject({ status: 'DRAFT', teacherId: recipient.id, createdBy: author.email, updatedBy: recipient.email });
    expect(saved.content).toEqual({ ...transferred.content, generalObjectives: newObjective });
    await expect(page).toHaveURL(new RegExp(`${editor(saved.id)}$`));
    await page.getByRole('button', { name: 'Enviar para revisão', exact: true }).click();
    await expect(status).toHaveText('Em revisão');
    const pending = await get(saved.id);
    expect(pending.status).toBe('IN_REVIEW');
    expect(pending.transfer ?? null).toBeNull();
    expect(await get(current.id)).toMatchObject({ status: 'APPROVED', content: current.content });
    expect(await get(transferred.id)).toMatchObject({ status: 'SUPERSEDED', transfer: transferred.transfer });

    await loginUi(page, 'napne');
    await page.goto(editor(transferred.id));
    await expect(status).toHaveText('Histórico · substituído');
    await expect(page.getByText(reason)).toBeVisible();
  });
});
