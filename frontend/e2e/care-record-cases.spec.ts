import { expect, test } from '@playwright/test';
import { apiJson, caseFixture, type CaseView } from './case-fixtures';
import { loginUi } from './catalog-fixtures';

interface SavedRecord {
  id: string;
  caseId: number | null;
  version: number;
  title: string;
  history: { title: string }[];
}

test('NAPNE escolhe o caso pertinente e conserva o vínculo após arquivamento', async ({ page, request }) => {
  const fixture = await caseFixture(request);
  const { napne, student, path } = fixture;
  const original = await fixture.openCase('Coordenação');
  const otherStudent = await caseFixture(request);
  const wrong = await otherStudent.openCase('Caso de outro estudante');
  const scope = { headers: napne.headers };
  const recordPath = path + '/records';
  const stage = (id: number, version: number, next: string) => apiJson<CaseView>(request, `/cases/${id}/stage`, {
    ...scope, method: 'PATCH', data: { stage: next, version }
  });
  const recordBody = { type: 'PEDAGOGICAL_GUIDANCE', title: 'Orientação do caso', status: 'ACTIVE', content: {} };
  const responseFor = (method: string, endpoint: string) => page.waitForResponse(response =>
    response.request().method() === method && new URL(response.url()).pathname === '/api/v1' + endpoint
  );

  await loginUi(page, 'napne');
  await page.goto('/estudantes/' + student.id);
  const openRecords = () => page.getByRole('button', { name: 'Estudo de caso', exact: true }).click();
  await openRecords();
  const selector = page.getByRole('combobox', { name: 'Caso vinculado (opcional)', exact: true });
  await expect(selector.locator('option')).toHaveCount(2);
  await expect(selector).toHaveValue('');
  await page.getByRole('textbox', { name: 'Título', exact: true }).fill('Registro geral');
  const unlinkedRequest = responseFor('POST', recordPath);
  await page.locator('select[formControlName=type]').selectOption('PEDAGOGICAL_GUIDANCE');
  await page.getByRole('button', { name: 'Salvar registro', exact: true }).click();
  const unlinked = await unlinkedRequest;
  expect(unlinked.status()).toBe(200);
  expect(await unlinked.json()).toMatchObject({ caseId: null });

  const selected = await fixture.openCase('Solicitação do estudante');
  const terminal = await fixture.openCase('Encaminhamento concluído');
  const closedOther = await stage(terminal.id, terminal.version, 'CLOSED');
  await page.reload();
  await openRecords();
  await expect(selector.locator('option')).toHaveCount(3);
  await expect(selector).toHaveValue('');
  await expect(selector.locator(`option[value="${original.id}"]`)).toHaveText(/Caso #\d+ · Coordenação · Recebido · \d{2}\/\d{2}\/\d{4}/);
  await expect(selector.locator(`option[value="${selected.id}"]`)).toContainText('Solicitação do estudante');
  await expect(selector.locator(`option[value="${closedOther.id}"]`)).toHaveCount(0);

  for (const invalidCase of [wrong.id, closedOther.id]) {
    const rejected = await request.post('/api/v1' + recordPath, { ...scope, data: { ...recordBody, caseId: invalidCase } });
    expect(rejected.status()).toBe(400);
  }
  const coordinator = await fixture.account('vinculo-ca08', 'COTEP');
  await fixture.assignCoordinator(coordinator);
  const pedagogy = { headers: (await fixture.login(coordinator)).headers };
  const rejectedRole = await request.post('/api/v1' + recordPath, { ...pedagogy, data: { ...recordBody, caseId: selected.id } });
  expect(rejectedRole.status()).toBe(403);
  expect(await apiJson<SavedRecord[]>(request, recordPath, scope)).toHaveLength(1);

  await selector.selectOption(String(selected.id));
  await page.getByLabel('Tipo', { exact: false }).selectOption(recordBody.type);
  await page.getByRole('textbox', { name: 'Título', exact: true }).fill(recordBody.title);
  await page.locator('select[formControlName="status"]').selectOption(recordBody.status);
  const linkedRequest = responseFor('POST', recordPath);
  await page.locator('select[formControlName=type]').selectOption('PEDAGOGICAL_GUIDANCE');
  await page.getByRole('button', { name: 'Salvar registro', exact: true }).click();
  const linked = await linkedRequest;
  expect(linked.status()).toBe(200);
  const saved: SavedRecord = await linked.json();
  expect(saved.caseId).toBe(selected.id);
  await expect(selector).toHaveValue('');

  const visibleToCotep = await apiJson<SavedRecord[]>(request, recordPath, pedagogy);
  expect(visibleToCotep.find(item => item.id === saved.id)).toMatchObject({ caseId: null });
  const selectedClosed = await stage(selected.id, selected.version, 'CLOSED');
  const archived = await stage(selected.id, selectedClosed.version, 'ARCHIVED');
  const rejectedArchived = await request.post('/api/v1' + recordPath, { ...scope, data: { ...recordBody, caseId: selected.id } });
  expect(rejectedArchived.status()).toBe(400);

  await page.reload();
  await openRecords();
  const record = page.locator(`[data-record-id="${saved.id}"]`);
  await expect(record).toContainText(`Caso #${archived.id} · Solicitação do estudante · Arquivado`);
  await record.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(selector).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Editar registro', exact: true }).locator('xpath=ancestor::form')).toContainText(`Caso #${archived.id} · Solicitação do estudante · Arquivado`);
  await page.getByRole('textbox', { name: 'Título', exact: true }).fill('Orientação revisada');
  const updateRequest = responseFor('PUT', recordPath + '/' + saved.id);
  await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  const updated = await updateRequest;
  expect(updated.status()).toBe(200);
  expect(await updated.json()).toMatchObject({ caseId: selected.id, title: 'Orientação revisada', history: [{ title: recordBody.title }] });
  await expect(record).toContainText('Orientação revisada');
  await expect(selector.locator('option')).toHaveCount(2);
  expect(await apiJson<CaseView>(request, `/cases/${selected.id}`, scope)).toMatchObject({
    stage: 'ARCHIVED', version: archived.version, responsibleId: napne.id
  });
});
