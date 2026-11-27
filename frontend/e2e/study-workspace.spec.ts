import { expect, test } from '@playwright/test';
import { apiJson, caseFixture } from './case-fixtures';
import { loginUi } from './catalog-fixtures';
import type { CareRecord } from '../src/app/core/models';

test('separa estudo, colaboração e acompanhamento sem duplicar registros', async ({ request, page }) => {
  const fixture = await caseFixture(request);
  const { napne, student, path } = fixture;
  const recordPath = path + '/records';
  const create = (type: string, title: string, content: Record<string, string> = {}, caseId?: number) =>
    apiJson<CareRecord>(request, recordPath, {
      method: 'POST', headers: napne.headers, data: { type, title, status: 'ACTIVE', content, caseId },
    });

  const study = await fixture.openCase('Encaminhamento fictício');
  const research = await create('CASE_STUDY', 'Investigação fictícia', { interviews: 'Entrevista reservada' }, study.id);
  const guidance = await create('PEDAGOGICAL_GUIDANCE', 'Orientação compartilhada');
  const refusal = await create('SUPPORT_REFUSAL', 'Recusa registrada');
  const coordinator = await fixture.account('colaboracao', 'COTEP');
  await fixture.assignCoordinator(coordinator);
  const pedagogy = (await fixture.login(coordinator)).headers;

  const isolatedCampus = await fixture.alternateCampus();
  const outsider = await fixture.account('outro-campus', 'NAPNE', isolatedCampus.id);
  const outside = await request.get('/api/v1' + recordPath, { headers: (await fixture.login(outsider)).headers });
  expect(outside.status()).toBe(403);
  const authorized = await apiJson<CareRecord[]>(request, recordPath, { headers: pedagogy });
  expect(authorized.map(item => item.id)).toEqual([guidance.id]);
  expect(await request.post('/api/v1' + recordPath, {
    headers: pedagogy, data: { type: 'NAPNE_FOLLOW_UP', title: 'Registro restrito', status: 'ACTIVE' },
  }).then(response => response.status())).toBe(403);

  await loginUi(page, 'napne');
  await page.goto('/estudantes/' + student.id);
  await page.getByRole('button', { name: 'Estudo de caso', exact: true }).click();
  const card = (id: string) => page.locator(`[data-record-id="${id}"]`);
  await expect(card(research.id)).toContainText('Entrevista reservada');
  await expect(card(guidance.id)).toBeVisible();
  await expect(card(refusal.id)).toHaveCount(0);
  await page.getByRole('button', { name: 'Ver registros do estudo', exact: true }).click();
  await expect(card(research.id)).toBeVisible();
  await expect(card(guidance.id)).toHaveCount(0);

  await page.getByRole('button', { name: 'Acompanhamento', exact: true }).click();
  await expect(card(research.id)).toHaveCount(0);
  await expect(card(refusal.id)).toBeVisible();
  const form = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Novo registro', exact: true }) });
  await form.getByLabel(/^Tipo/).selectOption('NAPNE_FOLLOW_UP');
  await form.getByLabel(/^Título/).fill('Monitoramento contínuo');
  await form.getByLabel('Observações e evolução', { exact: true }).fill('Intervenção monitorada');
  await page.getByRole('button', { name: 'Estudo de caso', exact: true }).click();
  await expect(form).toHaveCount(0);
  await page.getByRole('button', { name: 'Voltar ao registro', exact: true }).click();
  await expect(form.getByLabel(/^Título/)).toHaveValue('Monitoramento contínuo');

  const saved = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/v1' + recordPath);
  await form.getByRole('button', { name: 'Salvar registro', exact: true }).click();
  const response = await saved;
  expect(response.status()).toBe(200);
  const followUp: CareRecord = await response.json();
  expect(followUp.caseId).toBeNull();
  await expect(card(followUp.id)).toContainText('Intervenção monitorada');
  const records = await apiJson<CareRecord[]>(request, recordPath, { headers: napne.headers });
  expect(records.map(item => item.id).sort()).toEqual([research.id, guidance.id, refusal.id, followUp.id].sort());

  await loginUi(page, coordinator.email.split('@')[0]);
  await page.goto('/estudantes/' + student.id);
  await expect(page.getByRole('button', { name: 'Estudo de caso', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Orientações e plano de ação', exact: true }).click();
  await expect(card(guidance.id)).toBeVisible();
  await expect(card(research.id)).toHaveCount(0);
  await expect(card(followUp.id)).toHaveCount(0);
  await expect(form.getByRole('combobox', { name: 'Tipo', exact: true })).toBeVisible();
  await expect(form.locator('select[formControlName="type"] option')).toHaveText(['Selecione', 'Orientações pedagógicas', 'Plano de ação']);
});
