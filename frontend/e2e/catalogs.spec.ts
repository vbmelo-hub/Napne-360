import { expect, test, type Page } from '@playwright/test';
import { catalogFixture, loginUi, makeLegacyFixture } from './catalog-fixtures';

async function openReferences(page: Page) {
  await page.goto('/administracao');
  await page.getByRole('button', { name: 'Cadastros de referência', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Categorias e modelos', exact: true })).toBeVisible();
}

test('administra catálogos pela interface e preserva snapshots após renomear e inativar', async ({ page, request }) => {
  test.setTimeout(120_000);
  const f = await catalogFixture(request);
  const suffix = Date.now();
  const categoryLabel = `Categoria fictícia ${suffix}`;
  const { term, offering } = f.academic;
  const termLabel = term.label;
  await loginUi(page, 'admin');
  await openReferences(page);
  const form = page.locator('form').filter({ has: page.getByRole('heading', { name: /Novo item de catálogo|Editar item/ }) });
  const create = async (kind: string, code: string, label: string) => {
    await form.getByRole('combobox', { name: /^Catálogo/ }).selectOption(kind);
    await form.getByRole('textbox', { name: /^Código/ }).fill(code);
    await form.getByRole('textbox', { name: /^Nome apresentado/ }).fill(label);
    const response = page.waitForResponse(r => r.url().endsWith('/api/v1/admin/references') && r.request().method() === 'POST');
    await form.getByRole('button', { name: 'Criar item', exact: true }).click();
    const result = await response;
    expect(result.status()).toBe(200);
    await expect(page.getByRole('row').filter({ hasText: label })).toBeVisible();
    return result.json();
  };
  const category = await create('NEED_CATEGORY', `TEST-UI-CATEGORY-${suffix}`, categoryLabel);

  await loginUi(page, 'napne');
  await page.goto(`/estudantes/${f.student.id}`);
  await page.locator('#dossier-educationalNeeds summary').click();
  const categorySelect = page.getByRole('combobox', { name: /Categoria de necessidade educacional/ });
  await categorySelect.selectOption({ label: categoryLabel });
  const dossierResponse = page.waitForResponse(r => r.url().endsWith(`${f.path}/dossier`) && r.request().method() === 'PUT');
  await page.locator('form.dossier-layout').getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  const savedResponse = await dossierResponse;
  expect(savedResponse.status()).toBe(200);
  expect(savedResponse.request().postDataJSON().educationalNeeds.categoryId).toBe(category.id);
  const saved = await savedResponse.json();
  expect(saved.educationalNeeds).toMatchObject({ categoryId: category.id, category: categoryLabel });

  await loginUi(page, 'professor');
  await page.goto(`/estudantes/${f.student.id}`);
  await page.getByRole('button', { name: 'PEI', exact: true }).click();
  const peiForm = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Criar rascunho de PEI', exact: true }) });
  await peiForm.getByRole('combobox', { name: /^Oferta curricular/ }).selectOption(String(offering.id));
  const peiResponse = page.waitForResponse(r => r.url().endsWith(`${f.path}/peis`) && r.request().method() === 'POST');
  await peiForm.getByRole('button', { name: 'Criar rascunho', exact: true }).click();
  const created = await peiResponse;
  expect(created.status()).toBe(200);
  expect(created.request().postDataJSON().offeringId).toBe(offering.id);
  const pei = await created.json();
  expect(pei).toMatchObject({
    academicTermId: term.id, academicTerm: term.code, academicTermLabel: termLabel, formVersion: 'IFAC_76_2025'
  });

  await loginUi(page, 'admin');
  await openReferences(page);
  for (const [item, label] of [[category, categoryLabel]] as const) {
    await page.getByRole('row').filter({ hasText: label }).getByRole('button', { name: 'Editar', exact: true }).click();
    await expect(form.getByRole('textbox', { name: /^Código/ })).toBeDisabled();
    await expect(form.getByRole('combobox', { name: /^Catálogo/ })).toBeDisabled();
    await form.getByRole('textbox', { name: /^Nome apresentado/ }).fill(`${label} renomeado`);
    const renamed = page.waitForResponse(r => r.url().endsWith(`/admin/references/${item.id}`) && r.request().method() === 'PUT');
    await form.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    expect((await renamed).status()).toBe(200);
    await expect(page.getByRole('row').filter({ hasText: `${label} renomeado` })).toBeVisible();
  }
  const another = await f.post('/students', { courseId: f.course.id, registration: `TEST-CATALOG-NEW-${suffix}`, civilName: 'Outra Pessoa Fictícia' });
  await loginUi(page, 'napne');
  await page.goto(`/estudantes/${another.id}`);
  await page.locator('#dossier-educationalNeeds summary').click();
  await expect(categorySelect.locator(`option[value="${category.id}"]`)).toHaveText(`${categoryLabel} renomeado`);
  await loginUi(page, 'professor');
  await page.goto(`/estudantes/${f.student.id}`);
  await page.getByRole('button', { name: 'PEI', exact: true }).click();
  await loginUi(page, 'admin');
  await openReferences(page);
  for (const [item, label] of [[category, categoryLabel]] as const) {
    await page.getByRole('row').filter({ hasText: `${label} renomeado` }).getByRole('button', { name: 'Inativar', exact: true }).click();
    const inactivated = page.waitForResponse(r => r.url().endsWith(`/admin/references/${item.id}/active`) && r.request().method() === 'PATCH');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Inativar item', exact: true }).click();
    expect((await inactivated).status()).toBe(200);
    await expect(page.getByRole('row').filter({ hasText: `${label} renomeado` })).toContainText('Inativo');
  }
  // Technical administration still has no access to the newly protected category.
  expect((await request.get('/api/v1/admin/references', { headers: f.adminHeaders })).status()).toBe(200);
  expect((await request.get(`${f.path}/dossier`, { headers: f.adminHeaders })).status()).toBe(403);
  const redacted = await (await request.get(`${f.path}/dossier`, { headers: f.teacherHeaders })).json();
  expect(redacted.educationalNeeds).toEqual({});

  await loginUi(page, 'napne');
  await page.goto(`/estudantes/${f.student.id}`);
  await page.locator('#dossier-educationalNeeds summary').click();
  await expect(categorySelect).toHaveValue(String(category.id));
  await expect(categorySelect.locator('option:checked')).toContainText(categoryLabel);
  await expect(categorySelect.locator('option:checked')).not.toContainText('renomeado');
  await expect(page.locator('form.dossier-layout').getByRole('button', { name: 'Salvar alterações', exact: true })).toBeDisabled();
  expect((await f.dossier()).educationalNeeds).toMatchObject({ categoryId: category.id, category: categoryLabel });
  await page.getByRole('button', { name: 'PEI', exact: true }).click();
  await expect(page.locator('article.pei-row')).toContainText(termLabel);
  await expect(page.locator('article.pei-row')).not.toContainText('renomeado');
  await loginUi(page, 'professor');
  await page.goto(`/estudantes/${f.student.id}`);
  await page.getByRole('button', { name: 'PEI', exact: true }).click();
  await expect(peiForm.getByRole('combobox', { name: /^Oferta curricular/ }).locator(`option[value="${offering.id}"]`)).toHaveCount(1);
  const revision = await request.put(`${f.path}/peis/${pei.id}`, {
    headers: f.teacherHeaders, data: { version: pei.storageVersion, content: pei.content }
  });
  expect(revision.status()).toBe(200);
  expect(await revision.json()).toMatchObject({ academicTermId: term.id, academicTerm: term.code, academicTermLabel: termLabel, revision: 2 });
  await loginUi(page, 'napne');
  await page.goto(`/estudantes/${another.id}`);
  await page.locator('#dossier-educationalNeeds summary').click();
  await expect(categorySelect.locator(`option[value="${category.id}"]`)).toHaveCount(0);
});

test('valida IDs, código legado, inatividade, omissão e remoção antes de persistir', async ({ request }) => {
  const f = await catalogFixture(request);
  const category = await f.entry('NEED_CATEGORY', 'Categoria fictícia validada');
  const { term, offering } = f.academic;
  const initial = await f.dossier();
  const history = async () => (await request.get(`${f.path}/dossier/history`, { headers: f.headers })).json();
  const timeline = async () => (await request.get(`${f.path}/timeline`, {
    headers: f.headers, params: { type: 'DOSSIER' }
  })).json();
  const initialTimeline = await timeline();
  for (const id of [2147483647, term.id, -1]) {
    const response = await request.put(`${f.path}/dossier`, { headers: f.headers, data: { ...initial, educationalNeeds: { categoryId: id } } });
    expect(response.status()).toBe(400);
    expect((await f.dossier()).version).toBe(initial.version);
    expect(await history()).toHaveLength(0);
    expect(await timeline()).toHaveLength(initialTimeline.length);
  }
  let saved = await f.saveDossier({ ...initial, educationalNeeds: { categoryId: category.id, category: 'Snapshot adulterado', notes: 'Nota fictícia', extra: 'Preservar' } });
  expect(saved.educationalNeeds).toMatchObject({ categoryId: category.id, category: 'Categoria fictícia validada', extra: 'Preservar' });
  for (const item of [category, term]) {
    for (const mutation of [{ code: `${item.code}-MUDADO` }, { kind: item.kind === 'ACADEMIC_TERM' ? 'NEED_CATEGORY' : 'ACADEMIC_TERM' }]) {
      const response = await request.put(`/api/v1/admin/references/${item.id}`, { headers: f.adminHeaders, data: { ...item, label: 'Não deve ser salvo', ...mutation } });
      expect(response.status()).toBe(400);
    }
  }
  const items = await (await request.get('/api/v1/admin/references', { headers: f.adminHeaders })).json();
  expect(items.find((item: { id: number }) => item.id === category.id)).toMatchObject({ label: category.label, code: category.code, kind: category.kind });
  const peiData = { subjectId: f.subject.id, teacherId: f.teacher.id };
  for (const invalid of [{ academicTermId: category.id }, { academicTermId: 2147483647 }, { academicTerm: term.code + ' ' }, { academicTerm: 'NAO-CADASTRADO' }]) {
    const response = await request.post(`${f.path}/peis`, { headers: f.teacherHeaders, data: { ...peiData, ...invalid } });
    expect(response.status()).toBe(400);
  }
  expect(await (await request.get(`${f.path}/peis`, { headers: f.headers })).json()).toHaveLength(0);
  const oldClient = await f.post(`/students/${f.student.id}/peis`, { ...peiData, academicTerm: term.code }, f.teacherHeaders);
  expect(oldClient).toMatchObject({ academicTermId: term.id, academicTerm: term.code, academicTermLabel: term.label });
  const duplicated = await request.post(`${f.path}/peis`, {
    headers: f.teacherHeaders, data: { ...peiData, academicTermId: term.id }
  });
  expect(duplicated.status()).toBe(409);
  const { term: secondTerm, offering: secondOffering } = await f.academicForSemester(2);
  const newClient = await f.post(`/students/${f.student.id}/peis`, {
    offeringId: secondOffering.id, academicTermLabel: 'Adulterado'
  }, f.teacherHeaders);
  expect(newClient).toMatchObject({ academicTermId: secondTerm.id, academicTerm: secondTerm.code, academicTermLabel: secondTerm.label });
  const categoryStatus = await request.patch(`/api/v1/admin/references/${category.id}/active`, {
    headers: f.adminHeaders, data: { active: false }
  });
  expect(categoryStatus.status()).toBe(200);
  const periodStatus = await request.patch(`/api/v1/admin/academic/periods/${term.id}/active`, {
    headers: f.adminHeaders, data: { active: false }
  });
  expect(periodStatus.status()).toBe(409);
  const otherStudent = await f.post('/students', { courseId: f.course.id, registration: `TEST-CATALOG-OTHER-${Date.now()}`, civilName: 'Pessoa Fictícia Sem Vínculo Histórico' });
  const otherPath = `/api/v1/students/${otherStudent.id}/dossier`;
  const otherInitial = await (await request.get(otherPath, { headers: f.headers })).json();
  const otherRefused = await request.put(otherPath, { headers: f.headers, data: { ...otherInitial, educationalNeeds: { categoryId: category.id } } });
  expect(otherRefused.status()).toBe(400);
  expect(await (await request.get(otherPath, { headers: f.headers })).json()).toMatchObject({ version: otherInitial.version, educationalNeeds: {} });
  expect(await (await request.get(`${otherPath}/history`, { headers: f.headers })).json()).toHaveLength(0);
  // Omission preserves the association and its snapshot even with another submitted text.
  saved = await f.saveDossier({ ...saved, educationalNeeds: { notes: 'Outra nota fictícia', category: 'Não substituir histórico' } });
  expect(saved.educationalNeeds).toMatchObject({ categoryId: category.id, category: category.label });
  saved = await f.saveDossier({ ...saved, educationalNeeds: { ...saved.educationalNeeds, categoryId: category.id, category: 'Adulterado' } });
  expect(saved.educationalNeeds.category).toBe(category.label);
  saved = await f.saveDossier({ ...saved, educationalNeeds: { ...saved.educationalNeeds, categoryId: null } });
  expect(saved.educationalNeeds.categoryId).toBeFalsy();
  expect(saved.educationalNeeds.category).toBeFalsy();
  const beforeInvalid = await history();
  await expect.poll(timeline, { timeout: 15_000 }).toHaveLength(beforeInvalid.length + 1);
  const beforeEvents = await timeline();
  const refused = await request.put(`${f.path}/dossier`, { headers: f.headers, data: { ...saved, educationalNeeds: { categoryId: category.id } } });
  expect(refused.status()).toBe(400);
  expect((await f.dossier()).version).toBe(saved.version);
  expect(await history()).toHaveLength(beforeInvalid.length);
  expect(await timeline()).toHaveLength(beforeEvents.length);
  const archivedOffer = await request.patch(`/api/v1/admin/academic/offerings/${offering.id}/active`, {
    headers: f.adminHeaders, data: { active: false }
  });
  expect(archivedOffer.status()).toBe(409);
  const peis = await (await request.get(`${f.path}/peis`, { headers: f.headers })).json();
  expect(peis).toHaveLength(2);
  const snapshots = (await history()).flatMap((revision: { fields: { educationalNeeds?: { category?: string } } }) => revision.fields.educationalNeeds?.category || []);
  expect(snapshots).toContain(category.label);
  expect(snapshots).not.toContain('Adulterado');
});

test('reabre legado sem inventar associação e permite revisão e remoção explícita', async ({ page, request }) => {
  const f = await catalogFixture(request);
  await f.saveDossier(await f.dossier());
  const peiId = makeLegacyFixture(f.student, f.subject.id, f.teacher.id);
  await loginUi(page, 'napne');
  await page.goto(`/estudantes/${f.student.id}`);
  await page.locator('#dossier-educationalNeeds summary').click();
  const select = page.getByRole('combobox', { name: /Categoria de necessidade educacional/ });
  await expect(page.locator('#dossier-educationalNeeds')).toContainText('Categoria legada fictícia');
  const save = async () => {
    const response = page.waitForResponse(r => r.url().endsWith(`${f.path}/dossier`) && r.request().method() === 'PUT');
    await page.locator('form.dossier-layout').getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    expect((await response).status()).toBe(200);
  };
  await expect(page.locator('form.dossier-layout').getByRole('button', { name: 'Salvar alterações', exact: true })).toBeDisabled();
  const preserved = await f.dossier();
  expect(preserved.educationalNeeds).toMatchObject({ category: 'Categoria legada fictícia', notes: 'Notas legadas fictícias', extra: 'Extra preservado' });
  expect(preserved.educationalNeeds.categoryId).toBeFalsy();
  const changedText = await request.put(`${f.path}/dossier`, { headers: f.headers, data: { ...preserved, educationalNeeds: { ...preserved.educationalNeeds, category: 'Texto novo livre' } } });
  expect(changedText.status()).toBe(400);
  await select.selectOption('');
  await save();
  expect((await f.dossier()).educationalNeeds.category).toBeFalsy();
  await page.getByRole('button', { name: 'PEI', exact: true }).click();
  await expect(page.locator('article.pei-row')).toContainText('LEGACY-FICTICIO');
  const previousResponse = await request.get(`${f.path}/peis/${peiId}`, { headers: f.teacherHeaders });
  expect(previousResponse.status()).toBe(200);
  const previous = await previousResponse.json();
  const response = await request.put(`${f.path}/peis/${peiId}`, {
    headers: f.teacherHeaders, data: { version: previous.storageVersion, content: previous.content }
  });
  expect(response.status()).toBe(200);
  const revision = await response.json();
  expect(revision.academicTerm).toBe('LEGACY-FICTICIO');
  expect(revision.academicTermId).toBeFalsy();
  expect(revision.academicTermLabel).toBeFalsy();
  expect(revision.formVersion ?? null).toBeNull();
  expect(revision.content).toMatchObject({
    generalObjectives: 'Objetivo histórico fictício',
    skillsInventory: { oralCommunication: 'REALIZA_COM_AJUDA' }
  });
  await page.reload();
  await page.getByRole('button', { name: 'PEI', exact: true }).click();
  await expect(page.locator('article.pei-row')).toHaveCount(2);
  await expect(page.locator('article.pei-row').first()).toContainText('LEGACY-FICTICIO');

  await loginUi(page, 'professor');
  await page.goto(`/estudantes/${f.student.id}/pei/${revision.id}`);
  await expect(page.getByLabel(/^Objetivo geral/)).toHaveValue('Objetivo histórico fictício');
  await expect(page.getByRole('combobox', { name: 'Comunicação oral', exact: true })).toHaveValue('REALIZA_COM_AJUDA');
  await expect(page.locator('app-pei-annex-i')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Baixar PDF', exact: true })).toHaveCount(0);
});
