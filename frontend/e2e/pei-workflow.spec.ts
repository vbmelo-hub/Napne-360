import { expect, test, type APIResponse } from '@playwright/test';
import { catalogFixture, loginApi, loginUi } from './catalog-fixtures';

type Revision = {
  id: string;
  status: string;
  revision: number;
  storageVersion: number;
  content: Record<string, unknown>;
  allowedActions: string[];
  reviewedBy: string | null;
  reviewedAt: string | null;
};

async function readRevision(response: APIResponse): Promise<Revision> {
  expect(response.status(), await response.text()).toBe(200);
  const revision = await response.json() as Revision;
  expect(typeof revision.storageVersion).toBe('number');
  return revision;
}

test('docente salva e envia pelo editor e o NAPNE devolve, aprova e arquiva', async ({ page, request }) => {
  const f = await catalogFixture(request);
  const term = await f.entry('ACADEMIC_TERM', 'Período fictício PEI pela interface');
  const path = `/estudantes/${f.student.id}/pei`;
  const draft = await readRevision(await request.post(`${f.path}/peis`, {
    headers: f.teacherHeaders, data: { subjectId: f.subject.id, academicTermId: term.id }
  }));
  const status = page.locator('.pei-header .badge');
  const edit = page.getByRole('button', { name: 'Salvar rascunho', exact: true });
  const submit = page.getByRole('button', { name: 'Enviar para revisão', exact: true });
  const approve = page.getByRole('button', { name: 'Aprovar PEI', exact: true });
  const saveCurrent = async () => {
    const response = page.waitForResponse(result => result.request().method() === 'PUT' &&
      new URL(result.url()).pathname.startsWith(`${f.path}/peis/`));
    await edit.click();
    const result = await response;
    expect(result.status()).toBe(200);
    const item = await result.json() as Revision;
    await expect(page).toHaveURL(new RegExp(`${path}/${item.id}$`));
    await expect(status).toHaveText('Rascunho');
    return item;
  };
  const confirm = async (label: string) => {
    await page.getByRole('alertdialog').getByRole('button', { name: label, exact: true }).click();
  };

  await loginUi(page, 'professor');
  await page.goto(`${path}/${draft.id}`);
  const objective = page.getByLabel(/^Objetivo geral/);
  await objective.fill('');
  await page.getByLabel('Objetivos específicos', { exact: true }).fill('Objetivo específico fictício');
  await expect(submit).toBeDisabled();
  await saveCurrent();
  await expect(objective).toHaveValue('');
  await objective.fill('Objetivo geral fictício');
  await page.getByLabel('Conteúdos prioritários', { exact: true }).fill('Conteúdo fictício');
  await page.getByLabel('Estratégias facilitadoras', { exact: true }).fill('Adaptação fictícia');
  await page.getByLabel('Critérios de avaliação', { exact: true }).fill('Critério fictício');
  await page.getByLabel('Instrumentos de avaliação', { exact: true }).fill('Instrumento fictício');
  const saved = await saveCurrent();
  await submit.click();
  await expect(status).toHaveText('Em revisão');
  await expect(approve).toHaveCount(0);

  await loginUi(page, 'napne');
  await page.goto(`${path}/${saved.id}`);
  await expect(objective).toBeDisabled();
  await page.getByRole('button', { name: 'Devolver para ajustes', exact: true }).click();
  await confirm('Devolver PEI');
  await expect(status).toHaveText('Rascunho');

  await loginUi(page, 'professor');
  await page.goto(`${path}/${saved.id}`);
  await expect(objective).toHaveValue('Objetivo geral fictício');
  await submit.click();
  await expect(status).toHaveText('Em revisão');

  await loginUi(page, 'napne');
  await page.goto(`${path}/${saved.id}`);
  await approve.click();
  await confirm('Aprovar PEI');
  await expect(status).toHaveText('Vigente');
  await page.getByRole('button', { name: 'Arquivar PEI', exact: true }).click();
  await confirm('Arquivar PEI');
  await expect(status).toHaveText('Histórico · arquivado');
  await expect(objective).toHaveValue('Objetivo geral fictício');
});

test('D04 preserva o vigente até a aprovação da substituta e aplica permissões por papel', async ({ request }) => {
  const f = await catalogFixture(request);
  for (const role of ['cotep', 'coordenacao']) {
    const account = await loginApi(request, role);
    await f.post('/admin/assignments', {
      studentId: f.student.id, userId: account.id, assignmentType: 'COORDINATOR'
    }, f.adminHeaders);
  }
  const cotep = await loginApi(request, 'cotep');
  const coordinator = await loginApi(request, 'coordenacao');
  const readOnlyHeaders = [cotep, coordinator].map(({ token }) => ({ Authorization: `Bearer ${token}` }));
  const term = await f.entry('ACADEMIC_TERM', 'Período fictício D04');
  const path = `${f.path}/peis`;
  const create = (headers = f.teacherHeaders) => request.post(path, {
    headers, data: { subjectId: f.subject.id, academicTermId: term.id }
  });
  const action = (item: Revision, name: string, headers = f.headers) => request.post(`${path}/${item.id}/${name}`, {
    headers, data: { version: item.storageVersion }
  });
  const get = async (id: string, headers = f.teacherHeaders) => readRevision(await request.get(`${path}/${id}`, { headers }));
  const edit = async (item: Revision, content: Record<string, unknown>) => readRevision(await request.put(`${path}/${item.id}`, {
    headers: f.teacherHeaders, data: { version: item.storageVersion, content }
  }));

  expect((await create(f.headers)).status()).toBe(403);
  const draft = await readRevision(await create());
  expect(draft.status).toBe('DRAFT');
  expect(draft.allowedActions).toEqual(expect.arrayContaining(['EDIT', 'SUBMIT']));
  expect((await create()).status()).toBe(409);
  expect((await action(draft, 'approve')).status()).toBe(409);
  for (const headers of readOnlyHeaders) {
    expect((await get(draft.id, headers)).allowedActions).toEqual([]);
    expect((await action(draft, 'submit', headers)).status()).toBe(403);
  }

  const submittedIncomplete = await readRevision(await action(draft, 'submit', f.teacherHeaders));
  expect((await action(submittedIncomplete, 'approve')).status()).toBe(400);
  const returned = await readRevision(await action(submittedIncomplete, 'return'));
  expect(returned.status).toBe('DRAFT');
  expect((await action(draft, 'submit', f.teacherHeaders)).status()).toBe(409);

  const complete = {
    ...draft.content,
    generalObjectives: 'Objetivo original fictício', specificObjectives: ['Objetivo específico'],
    contents: ['Conteúdo'], teachingStrategies: ['Ensino por etapas'],
    assessmentCriteria: ['Participação'], assessmentInstruments: ['Atividade']
  };
  const edited = await edit(returned, complete);
  const pending = await readRevision(await action(edited, 'submit', f.teacherHeaders));
  expect(pending.status).toBe('IN_REVIEW');
  expect((await action(pending, 'approve', f.teacherHeaders)).status()).toBe(403);
  expect((await action(pending, 'approve', readOnlyHeaders[0])).status()).toBe(403);
  const approved = await readRevision(await action(pending, 'approve'));
  expect(approved).toMatchObject({ status: 'APPROVED', reviewedBy: 'napne@napne.local' });
  expect(approved.reviewedAt).toBeTruthy();

  const replacement = await readRevision(await action(approved, 'revisions', f.teacherHeaders));
  expect(replacement.status).toBe('DRAFT');
  expect(replacement.content).toEqual(approved.content);
  expect((await get(approved.id)).status).toBe('APPROVED');
  expect((await action(await get(approved.id), 'revisions', f.teacherHeaders)).status()).toBe(409);
  const replacementContent = { ...complete, generalObjectives: 'Objetivo substituto fictício' };
  const newRevision = await edit(replacement, replacementContent);
  const review = await readRevision(await action(newRevision, 'submit', f.teacherHeaders));
  expect((await get(approved.id)).status).toBe('APPROVED');
  const simultaneousApprovals = await Promise.all([action(review, 'approve'), action(review, 'approve')]);
  expect(simultaneousApprovals.map(response => response.status()).sort()).toEqual([200, 409]);
  const effective = await readRevision(simultaneousApprovals.find(response => response.ok())!);
  expect(effective.status).toBe('APPROVED');
  expect(await get(approved.id)).toMatchObject({ status: 'SUPERSEDED', reviewedAt: approved.reviewedAt, content: complete });
  const archived = await readRevision(await action(effective, 'archive'));
  expect(archived.status).toBe('ARCHIVED');
  expect((await get(archived.id, readOnlyHeaders[1])).content).toEqual(replacementContent);
  const all = await (await request.get(path, { headers: f.headers })).json() as Revision[];
  expect(all.filter(item => item.status === 'APPROVED')).toHaveLength(0);
  expect(all.map(item => item.id)).toEqual(expect.arrayContaining([approved.id, archived.id]));
});

test('CA19 serializa aberturas, edições e aprovações concorrentes sem duplicar revisão ou evento', async ({ request }) => {
  const f = await catalogFixture(request);
  const term = await f.entry('ACADEMIC_TERM', 'Período fictício CA19');
  const path = `${f.path}/peis`;
  const create = () => request.post(path, {
    headers: f.teacherHeaders, data: { subjectId: f.subject.id, academicTermId: term.id }
  });
  const race = async (first: Promise<APIResponse>, second: Promise<APIResponse>) => {
    const responses = await Promise.all([first, second]);
    expect(responses.map(response => response.status()).sort()).toEqual([200, 409]);
    return readRevision(responses.find(response => response.ok())!);
  };
  const draft = await race(create(), create());
  const edit = (generalObjectives: string) => request.put(`${path}/${draft.id}`, {
    headers: f.teacherHeaders,
    data: { version: draft.storageVersion, content: {
      ...draft.content, generalObjectives, specificObjectives: ['Alvo'], contents: ['Conteúdo'],
      teachingStrategies: ['Estratégia'], assessmentCriteria: ['Critério'], assessmentInstruments: ['Instrumento']
    } }
  });
  const saved = await race(edit('Primeira edição fictícia'), edit('Segunda edição fictícia'));
  expect(['Primeira edição fictícia', 'Segunda edição fictícia']).toContain(saved.content['generalObjectives']);
  expect((await edit('Repetição que não deve sobrescrever')).status()).toBe(409);
  const submitted = await readRevision(await request.post(`${path}/${saved.id}/submit`, {
    headers: f.teacherHeaders, data: { version: saved.storageVersion }
  }));
  const approve = () => request.post(`${path}/${submitted.id}/approve`, {
    headers: f.headers, data: { version: submitted.storageVersion }
  });
  const approved = await race(approve(), approve());
  expect((await approve()).status()).toBe(409);
  const list = await request.get(path, { headers: f.headers });
  expect(list.status()).toBe(200);
  const revisions = await list.json() as Revision[];
  expect(revisions.map(revision => revision.revision).sort()).toEqual([1, 2]);
  expect(revisions.filter(revision => revision.status === 'APPROVED')).toEqual([approved]);
  expect(revisions.find(revision => revision.id === draft.id)?.content).toEqual(draft.content);
  const timeline = await request.get(`${f.path}/timeline`, { headers: f.headers });
  expect(timeline.status()).toBe(200);
  const events = await timeline.json() as { eventType: string }[];
  expect(events.filter(event => event.eventType === 'PEI_APPROVED')).toHaveLength(1);
});
