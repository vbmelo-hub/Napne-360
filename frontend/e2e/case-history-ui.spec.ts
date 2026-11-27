import { expect, test } from '@playwright/test';
import { apiJson, caseFixture, type CaseView } from './case-fixtures';
import { loginUi } from './catalog-fixtures';

test('NAPNE abre o caso, mantém rascunhos no conflito e consulta as revisões persistidas', async ({ page, request }) => {
  const fixture = await caseFixture(request);
  const { napne, student, path } = fixture;
  const recipient = await fixture.account('destino-ui', 'NAPNE');
  const otherActor = await fixture.login(recipient);
  const other = await fixture.openCase('Outro caso fictício');
  const source = 'Encaminhamento fictício pela interface';
  const summary = 'Resumo fictício pela interface';
  const draft = 'Encaminhamento fictício ainda sem salvar';
  const reason = 'TEST-CASE-REASON-UI-' + fixture.key;
  const responseFor = (method: string, endpoint: string) => page.waitForResponse(response =>
    response.request().method() === method && new URL(response.url()).pathname === '/api/v1' + endpoint
  );

  await loginUi(page, 'napne');
  const detail = responseFor('GET', path);
  await page.goto('/estudantes/' + student.id);
  expect((await detail).status()).toBe(200);
  await expect(page.getByRole('heading', { name: student.socialName, exact: true })).toBeVisible();
  const casesTab = page.getByRole('button', { name: 'Estudo de caso', exact: true });
  await casesTab.click();
  const sourceField = page.getByRole('textbox', { name: 'Origem do encaminhamento', exact: true });
  await sourceField.fill(source);
  await page.getByLabel('Resumo inicial', { exact: true }).fill(summary);
  const opening = responseFor('POST', path + '/cases');
  await page.getByRole('button', { name: 'Abrir caso', exact: true }).click();
  const createdResponse = await opening;
  expect(createdResponse.status()).toBe(200);
  const opened: CaseView = await createdResponse.json();
  expect(opened).toMatchObject({ source, summary, responsibleId: napne.id, version: 0 });

  const card = page.getByRole('article', { name: 'Caso nº ' + opened.id + ' · ' + source, exact: true });
  const otherCard = page.getByRole('article', { name: 'Caso nº ' + other.id + ' · ' + other.source, exact: true });
  const expectResponsible = async (name: string, version: number) => {
    await expect(card.getByText('Responsável: ' + name + ' · Versão ' + version, { exact: false })).toBeVisible();
  };
  await expectResponsible(napne.name, opened.version);
  await sourceField.fill(draft);
  const casePath = '/cases/' + opened.id;

  const transferred = await test.step('manter a transferência preenchida até sincronização explícita do caso', async () => {
    await card.getByRole('button', { name: 'Transferir responsabilidade', exact: true }).click();
    const transferDialog = card.getByRole('dialog', { name: 'Transferir responsabilidade' });
    const candidate = transferDialog.getByRole('button', { name: /^Novo responsável/ });
    const reasonField = transferDialog.getByLabel('Motivo (opcional)', { exact: true });
    const confirm = transferDialog.getByRole('button', { name: 'Confirmar transferência', exact: true });
    await candidate.click();
    await transferDialog.getByRole('combobox', { name: 'Novo responsável' }).fill(recipient.name);
    await transferDialog.getByRole('option', { name: recipient.name, exact: true }).click();
    await reasonField.fill(reason);

    const updated = await apiJson<CaseView>(request, casePath + '/stage', {
      method: 'PATCH', headers: otherActor.headers,
      data: { stage: 'SCREENING', summary, version: opened.version }
    });
    const conflict = responseFor('PATCH', casePath + '/responsible');
    await confirm.click();
    expect((await conflict).status()).toBe(409);
    await expect(transferDialog.getByRole('alert')).toContainText('Sincronize este caso');
    await expect(confirm).toBeDisabled();
    await expect(candidate).toContainText(recipient.name);
    await expect(reasonField).toHaveValue(reason);
    await expect(sourceField).toHaveValue(draft);

    const reading = responseFor('GET', casePath);
    await transferDialog.getByRole('button', { name: 'Sincronizar caso', exact: true }).click();
    expect((await reading).status()).toBe(200);
    await expectResponsible(napne.name, updated.version);
    await expect(candidate).toContainText(recipient.name);
    await expect(reasonField).toHaveValue(reason);
    await expect(sourceField).toHaveValue(draft);

    const transfer = responseFor('PATCH', casePath + '/responsible');
    await confirm.click();
    const response = await transfer;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({ responsibleId: recipient.id, version: updated.version, reason });
    const saved: CaseView = await response.json();
    expect(saved).toMatchObject({ responsibleId: recipient.id, version: updated.version + 1 });
    await expectResponsible(recipient.name, saved.version);
    return saved;
  });

  await test.step('usar a nova versão para registrar uma etapa e consultar o histórico após recarregar', async () => {
    await card.getByRole('combobox', { name: 'Próxima etapa', exact: true }).selectOption('WELCOMING');
    await card.getByRole('button', { name: 'Registrar etapa', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Registrar mudança de etapa?', exact: true });
    await expect(dialog).toBeVisible();
    const stageChange = responseFor('PATCH', casePath + '/stage');
    await dialog.getByRole('button', { name: 'Registrar etapa', exact: true }).click();
    const response = await stageChange;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({ stage: 'WELCOMING', version: transferred.version });
    const staged: CaseView = await response.json();
    expect(staged.version).toBe(transferred.version + 1);
    await expectResponsible(recipient.name, staged.version);
    await expect(otherCard.getByText('Responsável: ' + napne.name + ' · Versão ' + other.version, { exact: false })).toBeVisible();
    await expect(sourceField).toHaveValue(draft);

    await page.reload();
    await casesTab.click();
    await expectResponsible(recipient.name, staged.version);
    await card.getByRole('button', { name: 'Consultar histórico', exact: true }).click();
    await expect(card.getByRole('heading', { name: 'Histórico do caso', exact: true })).toBeVisible();
    const revisions = card.getByRole('listitem');
    await expect(revisions).toHaveCount(4);
    await expect(revisions.filter({ hasText: 'Transferência de responsabilidade · Versão ' + transferred.version }))
      .toContainText(napne.name + ' → ' + recipient.name);
    await expect(card.getByText('Motivo: ' + reason, { exact: true })).toBeVisible();
    await expect(revisions.filter({ hasText: 'Mudança de etapa · Versão ' + staged.version })).toContainText('Triagem → Acolhimento');

    await card.getByRole('button', { name: 'Fechar janela' }).click();
    await otherCard.getByRole('button', { name: 'Consultar histórico', exact: true }).click();
    await expect(otherCard.getByRole('listitem')).toHaveCount(1);
    await expect(otherCard.getByRole('listitem')).toContainText('Abertura · Versão ' + other.version);
    await expect(otherCard.getByText('Motivo: ' + reason, { exact: true })).toHaveCount(0);
    await otherCard.getByRole('button', { name: 'Fechar janela' }).click();
  });

  await test.step('reabrir com motivo e manter o caso arquivado disponível para consulta', async () => {
    const nextStage = card.getByRole('combobox', { name: 'Próxima etapa', exact: true });
    const register = card.getByRole('button', { name: 'Registrar etapa', exact: true });
    const saveStage = async (title = 'Registrar mudança de etapa?') => {
      const dialog = page.getByRole('alertdialog', { name: title, exact: true });
      await register.click();
      const saved = responseFor('PATCH', casePath + '/stage');
      await dialog.getByRole('button', { name: 'Registrar etapa', exact: true }).click();
      const response = await saved;
      expect(response.status()).toBe(200);
      return { value: await response.json() as CaseView, body: response.request().postDataJSON() };
    };

    await nextStage.selectOption('CLOSED');
    const { value: firstClosure } = await saveStage();
    expect(firstClosure.closedAt).toEqual(expect.any(String));
    await expect(nextStage.locator('option:not([value=""])')).toHaveCount(2);
    await nextStage.selectOption('SCREENING');
    await expect(register).toBeDisabled();
    const reopenReason = ('TEST-REOPEN-REASON-UI-' + fixture.key + ' ').padEnd(500, 'x');
    const reopenField = card.getByLabel('Motivo da reabertura', { exact: true });
    await reopenField.fill(reopenReason + 'x');
    await expect(register).toBeDisabled();
    await expect(card.getByRole('status')).toHaveText('O motivo deve ter até 500 caracteres.');
    await reopenField.fill('  ' + reopenReason + '  ');
    const reopened = await saveStage();
    expect(reopened.body).toEqual({ stage: 'SCREENING', summary, version: firstClosure.version, reason: reopenReason });
    expect(reopened.value).toMatchObject({ closedAt: null, responsibleId: recipient.id });
    await card.getByRole('button', { name: 'Consultar histórico', exact: true }).click();
    await expect(card.getByText('Motivo: ' + reopenReason, { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Fechar janela' }).click();

    await nextStage.selectOption('CLOSED');
    const { value: closed } = await saveStage();
    await nextStage.selectOption('ARCHIVED');
    const archived = await saveStage('Arquivar caso?');
    expect(archived.body).toEqual({ stage: 'ARCHIVED', summary, version: closed.version });
    expect(archived.value.closedAt).toBe(closed.closedAt);
    await expect(nextStage).toHaveCount(0);
    await expect(register).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Transferir responsabilidade', exact: true })).toHaveCount(0);
    await card.getByRole('button', { name: 'Consultar histórico', exact: true }).click();
    await expect(card.getByRole('heading', { name: 'Histórico do caso', exact: true })).toBeVisible();
    await expect(card.getByRole('listitem').first()).toContainText('Encerrado → Arquivado');
  });
});
