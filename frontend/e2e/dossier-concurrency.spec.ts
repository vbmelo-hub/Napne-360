import { expect, test, type BrowserContext } from '@playwright/test';
import { caseFixture, apiJson } from './case-fixtures';

type DossierView = {
  id: string;
  studentId: number;
  identification: Record<string, unknown>;
  educationalNeeds: Record<string, unknown>;
  healthAndSupport: Record<string, unknown>;
  familyContext: Record<string, unknown>;
  schoolHistory: Record<string, unknown>;
  strengths: Record<string, unknown>;
  difficulties: Record<string, unknown>;
  initialInterventions: Record<string, unknown>;
  updatedBy: string;
  updatedAt: string;
  version: number | null;
  redacted: boolean;
};

type DossierRevision = {
  version: number | null;
  fields: Record<string, unknown>;
  author: string;
  occurredAt: string;
};

const sections = [
  'identification', 'educationalNeeds', 'healthAndSupport', 'familyContext',
  'schoolHistory', 'strengths', 'difficulties', 'initialInterventions'
] as const;

test('duas sessões preservam a primeira revisão do dossiê e recusam PUT incompleto', async ({ browser, request }) => {
  const fixture = await caseFixture(request);
  const secondAccount = await fixture.account('napne-segundo', 'NAPNE');
  const firstSession = await apiJson<{ id: number; name: string; email: string; campusId: number; roles: string[]; token: string }>(
    request, '/auth/login', { method: 'POST', data: { email: fixture.napne.email, password: 'Napne360!Demo' } }
  );
  const secondSession = await apiJson<{ id: number; name: string; email: string; campusId: number; roles: string[]; token: string }>(
    request, '/auth/login', { method: 'POST', data: { email: secondAccount.email, password: 'Napne360!Demo' } }
  );
  expect(secondSession.campusId).toBe(firstSession.campusId);

  const firstHeaders = { Authorization: `Bearer ${firstSession.token}` };
  const secondHeaders = { Authorization: `Bearer ${secondSession.token}` };
  const dossierPath = `${fixture.path}/dossier`;
  const initialDemand = `Base CA06 ${fixture.key}`;
  const winningDemand = `Primeira edição ${fixture.key}`;
  const losingDraft = `Rascunho concorrente ${fixture.key}`;
  const base = {
    identification: { notes: 'Notas fictícias de identificação', demand: initialDemand },
    educationalNeeds: { notes: 'Necessidades fictícias' },
    healthAndSupport: { notes: 'Apoio fictício' },
    familyContext: { notes: 'Contexto fictício' },
    schoolHistory: { notes: 'Histórico fictício' },
    strengths: { notes: 'Potencialidade fictícia' },
    difficulties: { notes: 'Barreira fictícia' },
    initialInterventions: { notes: 'Intervenção fictícia' },
    version: null
  };
  const seeded = await request.put('/api/v1' + dossierPath, { headers: secondHeaders, data: base });
  expect(seeded.status()).toBe(200);
  const initial = await seeded.json() as DossierView;
  const revisionPath = dossierPath + '/history';
  const timelinePath = `${fixture.path}/timeline?limit=100&type=DOSSIER`;
  const contexts: BrowserContext[] = [];

  const openNapne = async (session: typeof firstSession) => {
    const context = await browser.newContext();
    contexts.push(context);
    await context.addInitScript(value => {
      sessionStorage.setItem('napne360.session', JSON.stringify(value));
    }, session);
    const page = await context.newPage();
    await page.goto(`/estudantes/${fixture.student.id}`);
    await expect(page.getByRole('heading', { name: fixture.student.socialName, exact: true })).toBeVisible();
    return page;
  };

  try {
    const firstPage = await openNapne(firstSession);
    const secondPage = await openNapne(secondSession);
    const demandLabel = 'Demanda e origem do encaminhamento';
    const firstDemand = firstPage.getByLabel(demandLabel, { exact: true });
    const secondDemand = secondPage.getByLabel(demandLabel, { exact: true });
    await expect(firstDemand).toHaveValue(initialDemand);
    await expect(secondDemand).toHaveValue(initialDemand);

    await firstDemand.fill(winningDemand);
    await secondDemand.fill(losingDraft);
    const firstPut = firstPage.waitForResponse(response =>
      response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/v1${dossierPath}`
    );
    await firstPage.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    const firstResponse = await firstPut;
    expect(firstResponse.status()).toBe(200);
    const winner = await firstResponse.json() as DossierView;
    expect(winner.identification['demand']).toBe(winningDemand);
    expect(winner.version).toBe((initial.version ?? 0) + 1);

    const secondPut = secondPage.waitForResponse(response =>
      response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/v1${dossierPath}`
    );
    await secondPage.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    expect((await secondPut).status()).toBe(409);
    await expect(secondDemand).toHaveValue(losingDraft);
    await expect(secondPage.getByText('Existem alterações não salvas.', { exact: true })).toBeVisible();

    const current = await apiJson<DossierView>(request, dossierPath, { headers: firstHeaders });
    expect(current.version).toBe(winner.version);
    expect(current.identification['demand']).toBe(winningDemand);
    const revisionsAfterConflict = await apiJson<DossierRevision[]>(request, revisionPath, { headers: firstHeaders });
    expect(revisionsAfterConflict).toHaveLength(1);

    await firstPage.reload();
    await expect(firstPage.getByRole('heading', { name: fixture.student.socialName, exact: true })).toBeVisible();
    await expect(firstPage.getByLabel(demandLabel, { exact: true })).toHaveValue(winningDemand);
    await firstPage.getByRole('button', { name: 'Consultar histórico', exact: true }).click();
    const revisionRow = firstPage.locator('.history details').filter({ hasText: secondSession.email });
    await expect(revisionRow.locator('summary')).toContainText(secondSession.email);
    await expect(revisionRow.locator('summary')).toContainText(/\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}/);
    await revisionRow.locator('summary').click();
    await expect(revisionRow).toContainText('Versão anterior');
    await expect(revisionRow).toContainText(initialDemand);
    await expect(revisionRow).toContainText('Versão atual');
    await expect(revisionRow).toContainText(winningDemand);

    const beforeIncomplete = current;
    const beforeHistory = await apiJson<DossierRevision[]>(request, revisionPath, { headers: firstHeaders });
    const beforeTimeline = await apiJson<unknown[]>(request, timelinePath, { headers: firstHeaders });
    expect(beforeTimeline).toHaveLength(2);
    expect(beforeTimeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'DOSSIER_UPDATED' }),
      expect.objectContaining({ eventType: 'DOSSIER_UPDATED' })
    ]));
    const incomplete: Record<string, unknown> = { version: beforeIncomplete.version };
    for (const section of sections) {
      if (section !== 'initialInterventions') incomplete[section] = beforeIncomplete[section];
    }
    const rejected = await request.put('/api/v1' + dossierPath, { headers: firstHeaders, data: incomplete });
    expect(rejected.status()).toBe(400);
    const afterIncomplete = await apiJson<DossierView>(request, dossierPath, { headers: firstHeaders });
    const afterHistory = await apiJson<DossierRevision[]>(request, revisionPath, { headers: firstHeaders });
    const afterTimeline = await apiJson<unknown[]>(request, timelinePath, { headers: firstHeaders });
    expect(afterIncomplete).toMatchObject({
      version: beforeIncomplete.version,
      identification: beforeIncomplete.identification,
      educationalNeeds: beforeIncomplete.educationalNeeds,
      healthAndSupport: beforeIncomplete.healthAndSupport,
      familyContext: beforeIncomplete.familyContext,
      schoolHistory: beforeIncomplete.schoolHistory,
      strengths: beforeIncomplete.strengths,
      difficulties: beforeIncomplete.difficulties,
      initialInterventions: beforeIncomplete.initialInterventions
    });
    expect(afterHistory).toEqual(beforeHistory);
    expect(afterTimeline).toEqual(beforeTimeline);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
