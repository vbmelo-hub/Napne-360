import { expect, test } from '@playwright/test';
import type { CaseStageConfiguration, NapneCase } from '../src/app/core/models';
import { caseFixture } from './case-fixtures';
import { loginUi } from './catalog-fixtures';

test('ADMIN configura uma etapa que o NAPNE usa e cujo nome fica registrado no histórico', async ({ page, request }) => {
  const { key, student, openCase } = await caseFixture(request);
  const opened = await openCase('Caso fictício de configuração ' + key);
  const initialLabel = 'Etapa fictícia ' + key;
  const renamedLabel = 'Etapa fictícia revisada ' + key;
  const adminUrl = '/api/v1/admin/case-stages';
  const responseFor = (method: string, path: string) => page.waitForResponse(response =>
    response.request().method() === method && new URL(response.url()).pathname === path
  );
  const openEditor = async () => {
    await loginUi(page, 'admin');
    await page.goto('/administracao');
    const loaded = responseFor('GET', adminUrl);
    await page.getByRole('button', { name: 'Etapas dos casos', exact: true }).click();
    const response = await loaded;
    expect(response.status()).toBe(200);
    return await response.json() as CaseStageConfiguration;
  };
  const nameField = (position: number) => page.getByRole('textbox', {
    name: new RegExp('^Nome da etapa ' + position + '(?: [*])?$')
  });
  const saveSettings = async () => {
    const saving = responseFor('PUT', adminUrl);
    await page.getByRole('button', { name: 'Salvar etapas', exact: true }).click();
    const response = await saving;
    expect(response.status()).toBe(200);
    return { configuration: await response.json() as CaseStageConfiguration, body: response.request().postDataJSON() };
  };

  const created = await test.step('criar e mover uma etapa no cadastro institucional', async () => {
    const original = await openEditor();
    const insertedPosition = original.stages.length - 1;
    const movedPosition = insertedPosition - 1;
    await page.getByRole('button', { name: 'Adicionar etapa', exact: true }).click();
    await nameField(insertedPosition).fill(initialLabel);
    await page.getByRole('button', { name: 'Subir etapa ' + insertedPosition, exact: true }).click();
    await expect(nameField(movedPosition)).toHaveValue(initialLabel);

    const { configuration, body } = await saveSettings();
    expect(body.version).toBe(original.version);
    expect(body.stages[movedPosition - 1]).toEqual({ code: null, label: initialLabel });
    expect(configuration.stages.slice(-2).map(stage => stage.code)).toEqual(['CLOSED', 'ARCHIVED']);
    const created = configuration.stages[movedPosition - 1];
    expect(created).toEqual({ code: expect.any(String), label: initialLabel });
    return { ...created, position: movedPosition, precedingTerminal: original.stages.at(-3)!.code };
  });

  const openCard = async () => {
    await loginUi(page, 'napne');
    await page.goto('/estudantes/' + student.id);
    await page.getByRole('button', { name: 'Estudo de caso', exact: true }).click();
    const card = page.getByRole('article', { name: 'Caso nº ' + opened.id + ' · ' + opened.source, exact: true });
    await expect(card).toBeVisible();
    return card;
  };

  const changed = await test.step('selecionar a etapa criada no caso e usar seu código estável', async () => {
    const card = await openCard();
    const stages = card.getByRole('combobox', { name: 'Próxima etapa', exact: true });
    const codes = await stages.locator('option').evaluateAll(options =>
      options.map(option => (option as HTMLOptionElement).value)
    );
    expect(codes.indexOf(created.code)).toBeGreaterThan(0);
    expect(codes.indexOf(created.code) + 1).toBe(codes.indexOf(created.precedingTerminal));
    await stages.selectOption({ label: initialLabel });

    await card.getByRole('button', { name: 'Registrar etapa', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Registrar mudança de etapa?', exact: true });
    await expect(dialog).toContainText(initialLabel);
    const changing = responseFor('PATCH', '/api/v1/cases/' + opened.id + '/stage');
    await dialog.getByRole('button', { name: 'Registrar etapa', exact: true }).click();
    const response = await changing;
    expect(response.status()).toBe(200);
    expect(response.request().postDataJSON()).toMatchObject({ stage: created.code, version: opened.version });
    const changed = await response.json() as NapneCase;
    expect(changed).toMatchObject({ stage: created.code, stageLabel: initialLabel });
    return changed;
  });

  await test.step('renomear a etapa e manter seu nome anterior no histórico', async () => {
    await openEditor();
    await page.getByRole('searchbox', { name: 'Buscar etapas' }).fill(initialLabel);
    const field = nameField(created.position);
    await expect(field).toHaveValue(initialLabel);
    await field.fill(renamedLabel);
    const saved = await saveSettings();
    expect(saved.configuration.stages[created.position - 1]).toEqual({ code: created.code, label: renamedLabel });

    const card = await openCard();
    await expect(card.getByText(renamedLabel, { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Consultar histórico', exact: true }).click();
    const revision = card.getByRole('listitem').filter({ hasText: 'Mudança de etapa · Versão ' + changed.version });
    await expect(revision).toContainText('→ ' + initialLabel);
  });
});
