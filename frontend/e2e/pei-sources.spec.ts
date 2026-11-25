import { expect, test, type APIRequestContext } from '@playwright/test';
import { catalogFixture, evaluateMongo, loginUi } from './catalog-fixtures';

const forbiddenDossierMarkers = [
  'CA16-METODO-RESTRITO-DO-DOSSIE',
  'CA16-OBSERVACOES-PRIVADAS',
  'CA16-ENCAMINHAMENTOS-PRIVADOS',
  'CA16-CONTATO-PRIVADO',
  'CA16-SAUDE-PRIVADA',
  'CA16-FAMILIA-PRIVADA',
  'CA16-ADAPTACAO-EM-RASCUNHO',
  'CA16-OUTRO-CAMPO-DA-ORIENTACAO'
];

function readPeiFromMongo(studentId: number, peiId: string) {
  const script = `
    const studentId = NumberLong(${JSON.stringify(String(studentId))});
    const peiId = ${JSON.stringify(peiId)};
    const series = db.pei_series.findOne(
      {studentId, 'revisions._id': peiId},
      {revisions: {$elemMatch: {_id: peiId}}}
    );
    const pei = series?.revisions[0];
    if (!pei) throw new Error('PEI fictício não encontrado no Mongo isolado.');
    print(JSON.stringify({
      id: pei._id, studentId: Number(pei.studentId), status: pei.status,
      content: pei.content
    }));
  `;
  return JSON.parse(evaluateMongo(script)) as {
    id: string;
    studentId: number;
    status: string;
    content: Record<string, unknown>;
  };
}

async function seedDossierMarkers(fixture: Awaited<ReturnType<typeof catalogFixture>>) {
  const current = await fixture.dossier();
  return fixture.saveDossier({
    ...current,
    identification: { ...current.identification, contacts: 'CA16-CONTATO-PRIVADO' },
    healthAndSupport: { ...current.healthAndSupport, comorbidities: 'CA16-SAUDE-PRIVADA' },
    familyContext: { ...current.familyContext, context: 'CA16-FAMILIA-PRIVADA' },
    initialInterventions: {
      ...current.initialInterventions,
      methodological: 'CA16-METODO-RESTRITO-DO-DOSSIE',
      observations: 'CA16-OBSERVACOES-PRIVADAS',
      referrals: 'CA16-ENCAMINHAMENTOS-PRIVADOS'
    }
  });
}

async function seedGuidanceMarkers(fixture: Awaited<ReturnType<typeof catalogFixture>>) {
  const create = (status: string, adaptations: string, subjectId?: number) => fixture.post(
    `/students/${fixture.student.id}/records`, {
      type: 'PEDAGOGICAL_GUIDANCE', status, subjectId, title: `Orientação fictícia CA16 ${status}`,
      content: { adaptations, teachingNeeds: 'CA16-OUTRO-CAMPO-DA-ORIENTACAO' }
    }
  );
  await create('ACTIVE', 'CA16-ADAPTACAO-ETAPA-UM\nCA16-ADAPTACAO-ETAPA-DOIS', fixture.subject.id);
  await create('DRAFT', 'CA16-ADAPTACAO-EM-RASCUNHO', fixture.subject.id);
}

async function createDraft(request: APIRequestContext, fixture: Awaited<ReturnType<typeof catalogFixture>>) {
  const term = await fixture.entry('ACADEMIC_TERM', 'Período fictício CA16');
  const response = await request.post(`${fixture.path}/peis`, {
    headers: fixture.teacherHeaders,
    data: { subjectId: fixture.subject.id, teacherId: fixture.teacher.id, academicTermId: term.id }
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<{
    id: string;
    studentId: number;
    status: string;
    content: Record<string, unknown>;
  }>;
}

async function usePeiTemplate(request: APIRequestContext, fixture: Awaited<ReturnType<typeof catalogFixture>>,
                              defaults: Record<string, unknown>, verify: () => Promise<void>) {
  const data = { name: `CA16 modelo fictício ${Date.now()}`, documentType: 'PEI', defaults, active: true };
  const template = await fixture.post('/admin/templates', data, fixture.adminHeaders);
  try {
    await verify();
  } finally {
    const response = await request.put(`/api/v1/admin/templates/${template.id}`, {
      headers: fixture.adminHeaders, data: { ...data, active: false, version: template.version }
    });
    expect(response.status()).toBe(200);
  }
}

test('PEI inicial usa orientação ativa e preserva a privacidade do dossiê no editor e Mongo', async ({ page, request }) => {
  const fixture = await catalogFixture(request);

  await seedDossierMarkers(fixture);
  await seedGuidanceMarkers(fixture);
  // Sem estratégias no modelo, fica visível exatamente o que vem da orientação.
  await usePeiTemplate(request, fixture, { generalObjectives: 'CA16-OBJETIVO-DO-MODELO' }, async () => {
    const created = await createDraft(request, fixture);
    const expectedStrategies = ['CA16-ADAPTACAO-ETAPA-UM', 'CA16-ADAPTACAO-ETAPA-DOIS'];
    expect(created.status).toBe('DRAFT');
    expect(created.content).toMatchObject({
      student: fixture.student.socialName, course: fixture.course.name, subject: fixture.subject.name,
      generalObjectives: 'CA16-OBJETIVO-DO-MODELO'
    });
    expect(created.content['teachingStrategies']).toEqual(expectedStrategies);
    for (const marker of forbiddenDossierMarkers) expect(JSON.stringify(created)).not.toContain(marker);

    const peiPath = `${fixture.path}/peis/${created.id}`;
    const fetchedResponse = await request.get(peiPath, { headers: fixture.teacherHeaders });
    expect(fetchedResponse.status()).toBe(200);
    const fetched = await fetchedResponse.json() as typeof created;
    expect(fetched.status).toBe('DRAFT');
    expect(fetched.content['teachingStrategies']).toEqual(expectedStrategies);
    for (const marker of forbiddenDossierMarkers) expect(JSON.stringify(fetched)).not.toContain(marker);

    await loginUi(page, 'professor');
    await page.goto(`/estudantes/${fixture.student.id}/pei/${created.id}`);
    const strategyField = page.getByLabel('Estratégias facilitadoras', { exact: true });
    await expect(strategyField).toHaveValue(expectedStrategies.join('\n'));
    await expect(page.locator('.pei-header .badge')).toHaveText('Rascunho');
    for (const marker of forbiddenDossierMarkers) await expect(page.locator('body')).not.toContainText(marker);
    await page.reload();
    await expect(strategyField).toHaveValue(expectedStrategies.join('\n'));
    await expect(page.locator('.pei-header .badge')).toHaveText('Rascunho');

    const persisted = readPeiFromMongo(fixture.student.id, created.id);
    expect(persisted).toMatchObject({
      id: created.id,
      studentId: fixture.student.id,
      status: 'DRAFT',
      content: { teachingStrategies: expectedStrategies }
    });
    for (const marker of forbiddenDossierMarkers) expect(JSON.stringify(persisted)).not.toContain(marker);
  });
});

test('modelo PEI ativo pode fornecer estratégias no lugar das adaptações da orientação', async ({ request }) => {
  const fixture = await catalogFixture(request);
  await seedDossierMarkers(fixture);
  await seedGuidanceMarkers(fixture);
  await usePeiTemplate(request, fixture, { teachingStrategies: ['CA16-ESTRATEGIA-DO-MODELO'] }, async () => {
    const created = await createDraft(request, fixture);
    expect(created.status).toBe('DRAFT');
    expect(created.content['teachingStrategies']).toEqual(['CA16-ESTRATEGIA-DO-MODELO']);
    for (const marker of forbiddenDossierMarkers) expect(JSON.stringify(created)).not.toContain(marker);
  });
});
