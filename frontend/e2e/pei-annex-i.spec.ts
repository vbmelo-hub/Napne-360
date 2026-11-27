import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { catalogFixture, loginUi } from './catalog-fixtures';

test('docente preenche, reabre e baixa o PEI do Anexo I na revisão salva', async ({ page, request }, testInfo) => {
  const f = await catalogFixture(request);
  const { term, offering } = f.academic;
  const apiPath = `${f.path}/peis`;
  const editorResponse = (method: string, pathname: string) => page.waitForResponse(response =>
    response.request().method() === method && new URL(response.url()).pathname === pathname
  );

  await loginUi(page, 'professor');
  await page.goto(`/estudantes/${f.student.id}`);
  await page.getByRole('button', { name: 'PEI', exact: true }).click();
  const create = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Criar rascunho de PEI' }) });
  await create.getByRole('combobox', { name: /^Oferta curricular/ }).selectOption(String(offering.id));
  const creation = editorResponse('POST', apiPath);
  await create.getByRole('button', { name: 'Criar rascunho', exact: true }).click();
  const created = await creation;
  expect(created.status(), await created.text()).toBe(200);
  const draft = await created.json();
  const identification = {
    course: f.course.name,
    subject: f.subject.name,
    teacherName: f.teacher.name,
    student: f.student.socialName,
    workloadHours: f.subject.workloadHours
  };
  expect(draft).toMatchObject({
    status: 'DRAFT', revision: 1, storageVersion: 0, formVersion: 'IFAC_76_2025',
    academicTermId: term.id, academicTermLabel: term.label, content: identification
  });
  expect(Object.values(draft.content.skillsInventory)).toEqual(Array(28).fill('NAO_OBSERVADO'));

  await page.locator('article.pei-row').filter({ hasText: term.label })
    .getByRole('link', { name: 'Editar rascunho', exact: true }).click();
  const annex = page.locator('app-pei-annex-i');
  const status = page.locator('.pei-header .badge');
  await expect(annex.getByRole('heading', { name: 'Plano de Ensino Individualizado - PEI', exact: true })).toBeVisible();
  await expect(status).toHaveText('Rascunho');
  const context = annex.locator('.identification');
  await expect(context.locator('dt')).toHaveText([
    'CURSO:', 'COMPONENTE CURRICULAR:', 'PROFESSOR(ES):', 'ALUNO(A):', 'PERÍODO LETIVO:', 'CARGA HORÁRIA:'
  ]);
  await expect(context.locator('dd')).toHaveText([
    identification.course, identification.subject, identification.teacherName, identification.student,
    term.label, String(identification.workloadHours)
  ]);
  await expect(context.locator('input, select, textarea, [contenteditable="true"]')).toHaveCount(0);

  expect(await annex.locator('.annex-sheet > section').evaluateAll(sections => sections.map(section => section.id))).toEqual([
    'annex-objectives', 'annex-professionalSkills', 'annex-syllabus', 'annex-prerequisites',
    'annex-contents', 'annex-teachingStrategies', 'annex-methodologicalResources', 'annex-assessment',
    'annex-recoveryProposal', 'annex-basicBibliography', 'annex-complementaryBibliography',
    'annex-inventory', 'annex-observations'
  ]);
  const indicators = annex.locator('#annex-inventory [data-indicator]');
  await expect(indicators).toHaveCount(29);
  await expect(annex.locator('#annex-inventory fieldset[data-indicator]')).toHaveCount(28);
  expect(await indicators.evaluateAll(nodes => nodes.map(node =>
    Array.from(node.querySelectorAll('input[type=radio]'), radio => (radio as HTMLInputElement).value)
  ))).toEqual([
    ...Array.from({ length: 28 }, () => ['REALIZA_COM_AJUDA', 'REALIZA_SEM_AJUDA', 'NAO_REALIZA', 'NAO_OBSERVADO']),
    []
  ]);
  await expect(indicators.last()).toHaveText('Demonstra autonomia no uso de softwares aplicados ao curso técnico');

  const objective = annex.locator('#generalObjectives');
  const general = 'Desenvolver autonomia na criação de páginas web acessíveis.';
  const guidance = annex.locator('p#instruction-generalObjectives');
  await expect(guidance).toBeVisible();
  await expect(objective).toHaveAccessibleDescription(/Descrever o objetivo geral da disciplina/);
  await expect(objective).toHaveValue('');
  await objective.fill(general);
  await page.locator('.editor-nav').getByText('INVENTÁRIO DE HABILIDADES E COMPETÊNCIAS – IFAC', { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/estudantes/${f.student.id}/pei/${draft.id}(?:#annex-inventory)?$`));
  await expect(annex.getByRole('heading', { name: 'INVENTÁRIO DE HABILIDADES E COMPETÊNCIAS – IFAC', exact: true })).toBeInViewport();
  await expect(objective).toHaveValue(general);

  const specific = (index: number) => annex.locator(`#pei-annex-i-specific-objective-${index + 1}`);
  const objectives = [
    'Criar uma página com HTML semântico.\nTestar a navegação por teclado na página criada.',
    'Identificar problemas de contraste e corrigi-los na folha de estilos.'
  ];
  const contents = annex.locator('#annex-contents');
  const content = contents.getByRole('textbox', { name: 'Conteúdo 1', exact: true });
  const hours = contents.getByRole('spinbutton', { name: 'Carga horária do conteúdo 1', exact: true });
  const priority = contents.getByRole('checkbox', { name: 'Prioritário', exact: true });
  const instrument = annex.getByRole('textbox', { name: 'Instrumento 1', exact: true });
  const justification = annex.getByRole('textbox', { name: 'Justificativa 1', exact: true });
  const bibliography = annex.locator('#annex-basicBibliography');
  const bibliographyRow = bibliography.locator('tbody tr').first();
  const bibliographyValues = ['Referência fictícia', 'Autor Fictício', '2', 'Rio Branco', 'Editora Fictícia', '2025', 'Sim'];
  const indicator = annex.locator('fieldset[data-indicator="oralCommunication1"]');
  const rating = indicator.locator('input[value="REALIZA_SEM_AJUDA"]');
  const observations = annex.locator('#observations');
  const location = annex.locator('#location');
  const date = annex.locator('#documentDate');
  for (const [index, value] of objectives.entries()) {
    await specific(index).fill(value);
  }
  await content.fill('Conteúdo prioritário fictício');
  await hours.fill('6');
  await priority.check();
  await annex.locator('#teachingStrategies').fill('Sequência fictícia em etapas');
  await annex.locator('#assessmentCriteria').fill('Registro de participação fictício');
  await instrument.fill('Instrumento fictício do Anexo I');
  await justification.fill('Justificativa fictícia do instrumento');
  await expect(bibliography.getByRole('columnheader')).toHaveText([
    'Título/Periódico', 'Autor', 'Ed.', 'Local', 'Editora', 'Ano', 'LT'
  ]);
  for (const [index, value] of bibliographyValues.entries()) {
    await bibliographyRow.getByRole('textbox').nth(index).fill(value);
  }
  const withHelp = indicator.locator('input[value="REALIZA_COM_AJUDA"]');
  await withHelp.check();
  await withHelp.press('ArrowRight');
  await expect(rating).toBeFocused();
  await expect(rating).toBeChecked();
  await observations.fill('Observação fictícia do Anexo I');
  await location.fill('Rio Branco, AC');
  await date.fill('2026-11-25');

  const saving = editorResponse('PUT', `${apiPath}/${draft.id}`);
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  const savedResponse = await saving;
  expect(savedResponse.status(), await savedResponse.text()).toBe(200);
  const saved = await savedResponse.json();
  expect(saved.id).not.toBe(draft.id);
  expect(saved).toMatchObject({
    status: 'DRAFT', revision: 2, storageVersion: 0, formVersion: 'IFAC_76_2025', academicTermLabel: term.label,
    content: {
      ...identification, generalObjectives: general, specificObjectives: objectives,
      contents: [{ description: 'Conteúdo prioritário fictício', workloadHours: 6, priority: true }],
      teachingStrategies: ['Sequência fictícia em etapas'], assessmentCriteria: ['Registro de participação fictício'],
      assessmentInstruments: [{ description: 'Instrumento fictício do Anexo I', justification: 'Justificativa fictícia do instrumento' }],
      basicBibliography: [{ title: 'Referência fictícia', author: 'Autor Fictício', edition: '2',
        location: 'Rio Branco', publisher: 'Editora Fictícia', year: '2025', lt: 'Sim' }],
      skillsInventory: { oralCommunication1: 'REALIZA_SEM_AJUDA', oralCommunication2: 'NAO_OBSERVADO' },
      observations: 'Observação fictícia do Anexo I', location: 'Rio Branco, AC', documentDate: '2026-11-25'
    }
  });
  expect(saved.content.skillsInventory).not.toHaveProperty('digitalTechnologies5');
  const previous = await request.get(`${apiPath}/${draft.id}`, { headers: f.teacherHeaders });
  expect(previous.status()).toBe(200);
  expect(await previous.json()).toMatchObject({
    status: 'SUPERSEDED', revision: 1, storageVersion: 1, formVersion: 'IFAC_76_2025', content: draft.content
  });
  const savedPath = `/estudantes/${f.student.id}/pei/${saved.id}`;
  await expect(page).toHaveURL(new RegExp(`${savedPath}$`));
  await page.reload();
  await expect(status).toHaveText('Rascunho');
  await expect(objective).toHaveValue(general);
  for (const [index, value] of objectives.entries()) {
    await expect(specific(index)).toHaveValue(value);
  }
  await expect(content).toHaveValue('Conteúdo prioritário fictício');
  await expect(hours).toHaveValue('6');
  await expect(priority).toBeChecked();
  await expect(instrument).toHaveValue('Instrumento fictício do Anexo I');
  await expect(justification).toHaveValue('Justificativa fictícia do instrumento');
  for (const [index, value] of bibliographyValues.entries()) {
    await expect(bibliographyRow.getByRole('textbox').nth(index)).toHaveValue(value);
  }
  await expect(rating).toBeChecked();
  await expect(observations).toHaveValue('Observação fictícia do Anexo I');
  await expect(location).toHaveValue('Rio Branco, AC');
  await expect(date).toHaveValue('2026-11-25');

  const updatedObservation = 'Observação gravada pelo botão Baixar PDF';
  await observations.fill(updatedObservation);
  const savingForPdf = editorResponse('PUT', `${apiPath}/${saved.id}`);
  const pdfResponse = page.waitForResponse(response => {
    const pathname = new URL(response.url()).pathname;
    return response.request().method() === 'GET' && pathname.startsWith(`${apiPath}/`) && pathname.endsWith('/pdf');
  });
  const pdfDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Baixar PDF', exact: true }).click();
  const [updatedResponse, pdf, download] = await Promise.all([savingForPdf, pdfResponse, pdfDownload]);
  expect(updatedResponse.status(), await updatedResponse.text()).toBe(200);
  const exported = await updatedResponse.json();
  expect(exported.id).not.toBe(saved.id);
  expect(exported).toMatchObject({ status: 'DRAFT', revision: 3, content: { observations: updatedObservation } });
  expect(new URL(pdf.url()).pathname).toBe(`${apiPath}/${exported.id}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toBe('application/pdf');
  expect(pdf.headers()['content-disposition']).toBe('attachment; filename="pei-revisao-3-rascunho.pdf"');
  expect(download.suggestedFilename()).toBe('pei-revisao-3-rascunho.pdf');
  const pdfPath = testInfo.outputPath('pei-baixado.pdf');
  await download.saveAs(pdfPath);
  const file = await readFile(pdfPath);
  expect(file.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  expect(file.equals(await pdf.body())).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/estudantes/${f.student.id}/pei/${exported.id}$`));
  await page.reload();
  await expect(observations).toHaveValue(updatedObservation);
  const persisted = await request.get(`${apiPath}/${exported.id}`, { headers: f.teacherHeaders });
  expect(persisted.status()).toBe(200);
  expect(await persisted.json()).toMatchObject({
    status: 'DRAFT', revision: 3, storageVersion: exported.storageVersion, formVersion: 'IFAC_76_2025',
    content: { observations: updatedObservation }
  });
  const denied = await request.get(`${apiPath}/${exported.id}/pdf`, { headers: f.adminHeaders });
  expect(denied.status()).toBe(403);
  const audit = await request.get('/api/v1/audit', {
    headers: f.headers, params: { resourceType: 'PEI', resourceId: exported.id }
  });
  expect(audit.status()).toBe(200);
  const downloads = (await audit.json()).content.filter((entry: { action: string }) => entry.action === 'DOWNLOAD');
  expect(downloads).toMatchObject([{ actor: f.teacher.email, outcome: 'SUCCESS' }]);
});
