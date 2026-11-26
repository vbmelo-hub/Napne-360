import { expect, test } from '@playwright/test';
import { apiJson, caseFixture, renameCaseFixtureAccount, type CaseView } from './case-fixtures';

type Candidate = { id: number; name: string };
type Revision = {
  id: number;
  caseId: number;
  version: number;
  type: 'OPENED' | 'STAGE_CHANGED' | 'RESPONSIBLE_CHANGED';
  fromStage: string | null;
  toStage: string | null;
  fromResponsibleId: number | null;
  fromResponsible: string | null;
  toResponsibleId: number | null;
  toResponsible: string | null;
  actorId: number;
  actor: string;
  occurredAt: string;
  reason: string | null;
};
type HistoryPage = { content: Revision[]; totalElements: number; totalPages: number; number: number; size: number };
type TimelineEvent = { id: string; eventType: string; visibility: string; data: Record<string, unknown> };
type AuditPage = { content: { id: number; action: string; details: string | null }[]; totalElements: number };

test('API de casos restringe transferências e registra revisões concorrentes e paginadas', async ({ request }) => {
  const fixture = await caseFixture(request);
  const { napne, admin, path } = fixture;
  const recipient = await fixture.account('responsavel', 'NAPNE');
  const inactive = await fixture.account('inativo', 'NAPNE');
  expect((await fixture.disable(inactive)).active).toBe(false);
  const pedagogical = await fixture.account('pedagogico', 'COTEP');
  await fixture.assignCoordinator(pedagogical);
  const distantCampus = await fixture.alternateCampus();
  const distant = await fixture.account('outro-campus', 'NAPNE', distantCampus.id);
  const second = await fixture.login(recipient);
  const coordinator = await fixture.login(pedagogical);
  const outsider = await fixture.login(distant);
  const opened = await fixture.openCase('Caso principal fictício');
  const other = await fixture.openCase('Outro caso fictício do mesmo estudante');
  const casePath = '/cases/' + opened.id;
  const otherPath = '/cases/' + other.id;
  const headers = napne.headers;
  const reason = 'TEST-CASE-REASON-' + fixture.key;
  const fetchCase = (endpoint = casePath) => apiJson<CaseView>(request, endpoint, { headers });
  const history = (endpoint = casePath, params?: { page: number; size: number }) =>
    apiJson<HistoryPage>(request, endpoint + '/history', { headers, params });
  const timeline = () => apiJson<TimelineEvent[]>(request, path + '/timeline', {
    headers, params: { type: 'CASE', limit: 200 }
  });
  const audit = (id: number) => apiJson<AuditPage>(request, '/audit', {
    headers, params: { resourceType: 'NAPNE_CASE', resourceId: id, size: 100 }
  });
  const waitForProjections = async (state: CaseView) => {
    const count = state.version + 1;
    await expect.poll(async () => {
      const [events, auditLog] = await Promise.all([timeline(), audit(state.id)]);
      return [events.filter(event => event.data['caseId'] === state.id).length, auditLog.totalElements];
    }, { timeout: 15_000 }).toEqual([count, count]);
  };
  const snapshot = async (endpoint: string, id: number) => {
    const state = await fetchCase(endpoint);
    await waitForProjections(state);
    return {
      state,
      history: await history(endpoint),
      timeline: (await timeline()).map(event => event.id).sort(),
      audit: (await audit(id)).content.map(event => event.id).sort((first, last) => first - last)
    };
  };
  const patch = (endpoint: string, data: object, auth = headers) =>
    request.patch('/api/v1' + endpoint, { headers: auth, data });
  const transfer = (responsibleId: number, version: number, auth = headers, note?: string) =>
    patch(casePath + '/responsible', { responsibleId, version, reason: note }, auth);
  const stage = (current: CaseView, nextStage: string, auth = headers, reason?: string) =>
    apiJson<CaseView>(request, '/cases/' + current.id + '/stage', {
      method: 'PATCH', headers: auth, data: { stage: nextStage, summary: current.summary, version: current.version, reason }
    });

  await test.step('validar elegibilidade, escopo de leitura e recusas sem efeitos', async () => {
    expect(opened).toMatchObject({ responsibleId: napne.id, responsible: napne.name, version: 0 });
    const candidates = await apiJson<Candidate[]>(request, casePath + '/responsible-candidates', { headers });
    expect(candidates).toEqual(expect.arrayContaining([
      { id: napne.id, name: napne.name }, { id: recipient.id, name: recipient.name }
    ]));
    for (const account of [inactive, pedagogical, distant]) {
      expect(candidates.map(candidate => candidate.id)).not.toContain(account.id);
    }
    await waitForProjections(other);
    const initial = await snapshot(casePath, opened.id);
    expect(initial.history.content).toEqual([expect.objectContaining({
      caseId: opened.id, type: 'OPENED', version: opened.version, fromStage: null,
      toStage: opened.stage, fromResponsibleId: null, toResponsibleId: napne.id,
      toResponsible: napne.name, actorId: napne.id, actor: napne.name,
      occurredAt: expect.any(String), reason: null
    })]);

    for (const session of [admin, coordinator, outsider]) {
      const me = await apiJson<{ id: number }>(request, '/auth/me', { headers: session.headers });
      expect(me.id).toBe(session.id);
      for (const endpoint of [casePath, casePath + '/responsible-candidates', casePath + '/history']) {
        expect((await request.get('/api/v1' + endpoint, { headers: session.headers })).status(), endpoint).toBe(403);
      }
      expect((await transfer(recipient.id, opened.version, session.headers)).status()).toBe(403);
      expect((await patch(casePath + '/stage', { stage: 'SCREENING', version: opened.version }, session.headers)).status()).toBe(403);
    }
    await apiJson(request, path, { headers: coordinator.headers });
    expect(await apiJson(request, path + '/cases', { headers: coordinator.headers })).toEqual([]);
    expect(await apiJson(request, path + '/timeline', { headers: coordinator.headers, params: { type: 'CASE' } })).toEqual([]);

    for (const id of [inactive.id, pedagogical.id, distant.id, 0]) {
      expect((await transfer(id, opened.version)).status(), 'destino inválido ' + id).toBe(400);
    }
    for (const data of [
      { version: opened.version, reason: 'x'.repeat(501) },
      { version: opened.version, responsibleId: null },
      { version: opened.version, responsibleId: undefined },
      { version: opened.version + 0.5 },
      { version: String(opened.version) },
      { version: opened.version, responsibleId: recipient.id + 0.5 },
      { version: opened.version, responsibleId: String(recipient.id) }
    ]) {
      expect((await patch(casePath + '/responsible', { responsibleId: recipient.id, ...data })).status()).toBe(400);
    }
    for (const version of [null, undefined]) {
      expect((await patch(casePath + '/responsible', { responsibleId: recipient.id, version })).status()).toBe(409);
      expect((await patch(casePath + '/stage', { stage: 'SCREENING', version })).status()).toBe(409);
    }
    for (const params of [{ page: -1, size: 20 }, { page: 0, size: 0 }, { page: 0, size: 101 }]) {
      expect((await request.get('/api/v1' + casePath + '/history', { headers, params })).status()).toBe(400);
    }
    expect(await snapshot(casePath, opened.id)).toEqual(initial);
  });

  let current = opened;
  await test.step('persistir a versão devolvida e preservar o estado após conflito ou repetição', async () => {
    const secondRead = await apiJson<CaseView>(request, casePath, { headers: second.headers });
    const response = await transfer(recipient.id, opened.version, headers, reason);
    expect(response.status()).toBe(200);
    const transferred: CaseView = await response.json();
    expect(transferred).toEqual({
      ...secondRead, responsibleId: recipient.id, responsible: recipient.name, version: secondRead.version + 1
    });
    const beforeConflict = await snapshot(casePath, opened.id);
    expect(beforeConflict.state).toEqual(transferred);
    expect((await transfer(napne.id, secondRead.version, second.headers)).status()).toBe(409);
    expect((await patch(casePath + '/stage', {
      stage: 'WELCOMING', summary: 'Rascunho fictício obsoleto', version: secondRead.version
    }, second.headers)).status()).toBe(409);
    expect(await snapshot(casePath, opened.id)).toEqual(beforeConflict);

    current = await stage(transferred, 'SCREENING', second.headers);
    expect(current).toMatchObject({ stage: 'SCREENING', version: transferred.version + 1, responsibleId: recipient.id });
    const beforeNoOp = await snapshot(casePath, opened.id);
    const noOp = await transfer(recipient.id, current.version, headers, 'Motivo fictício sem alteração');
    expect(noOp.status()).toBe(200);
    expect(await noOp.json()).toEqual(current);
    expect(await stage(current, current.stage)).toEqual(current);
    expect(await snapshot(casePath, opened.id)).toEqual(beforeNoOp);

    const renamed = renameCaseFixtureAccount(recipient, fixture.key);
    expect((await fetchCase()).responsible).toBe(renamed);
    const saved = (await history()).content.find(revision => revision.type === 'RESPONSIBLE_CHANGED');
    expect(saved).toMatchObject({
      caseId: opened.id, version: transferred.version, actorId: napne.id, actor: napne.name, reason,
      fromResponsibleId: napne.id, fromResponsible: napne.name, toResponsibleId: recipient.id, toResponsible: recipient.name
    });

    const events = await timeline();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: 'CASE_RESPONSIBLE_CHANGED', visibility: 'RESTRICTED',
        data: expect.objectContaining({ caseId: opened.id }) }),
      expect.objectContaining({ eventType: 'CASE_STAGE_CHANGED', visibility: 'RESTRICTED',
        data: expect.objectContaining({ caseId: opened.id, from: opened.stage, to: 'SCREENING' }) })
    ]));
    const auditLog = await audit(opened.id);
    expect(auditLog.totalElements).toBe(3);
    expect(JSON.stringify(events)).not.toContain(reason);
    expect(JSON.stringify(auditLog)).not.toContain(reason);
  });

  await test.step('enviar mutações em paralelo e percorrer todas as revisões além da primeira página', async () => {
    const auditCount = (await audit(opened.id)).totalElements;
    const eventCount = (await timeline()).length;
    const competing = await Promise.all([
      patch(casePath + '/stage', { stage: 'WELCOMING', summary: current.summary, version: current.version }),
      transfer(napne.id, current.version, second.headers)
    ]);
    expect(competing.map(response => response.status()).sort()).toEqual([200, 409]);
    const winner = competing.find(response => response.status() === 200);
    if (!winner) throw new Error('Mutações concorrentes não devolveram a versão vencedora.');
    const persisted: CaseView = await winner.json();
    expect(persisted.version).toBe(current.version + 1);
    expect(await fetchCase()).toEqual(persisted);
    expect((await history()).totalElements).toBe(persisted.version + 1);
    await waitForProjections(persisted);
    expect((await audit(opened.id)).totalElements).toBe(auditCount + 1);
    expect(await timeline()).toHaveLength(eventCount + 1);
    current = persisted;

    for (let index = 0; index < 20; index++) {
      current = await stage(current, current.stage === 'SCREENING' ? 'WELCOMING' : 'SCREENING');
    }
    const first = await history();
    const next = await history(casePath, { page: 1, size: 20 });
    expect(first).toMatchObject({ number: 0, size: 20, totalPages: 2, totalElements: current.version + 1 });
    expect(next).toMatchObject({ number: 1, size: 20, totalPages: 2, totalElements: first.totalElements });
    expect(first.content).toHaveLength(20);
    const all = [...first.content, ...next.content];
    expect(new Set(all.map(revision => revision.id)).size).toBe(first.totalElements);
    expect(all.map(revision => revision.version)).toEqual(Array.from({ length: first.totalElements }, (_, index) => current.version - index));
    expect(new Set(all.map(revision => revision.caseId))).toEqual(new Set([opened.id]));
    expect(next.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'OPENED', version: opened.version }),
      expect.objectContaining({ type: 'RESPONSIBLE_CHANGED', reason, toResponsible: recipient.name })
    ]));
    expect((await history(otherPath)).content).toEqual([expect.objectContaining({ caseId: other.id, type: 'OPENED' })]);
  });

  await test.step('consultar o histórico de casos encerrados ou arquivados e recusar novas transferências', async () => {
    for (const active of [current, other]) {
      expect(active.allowedNextStages).toContain('CLOSED');
      expect(active.allowedNextStages).not.toContain('ARCHIVED');
    }
    const firstClosure = await stage(current, 'CLOSED');
    expect(firstClosure.allowedNextStages).toEqual(['SCREENING', 'ARCHIVED']);
    const beforeReopen = await snapshot(casePath, current.id);
    const reopenReason = 'TEST-REOPEN-REASON-' + fixture.key;
    const reopening = { stage: 'SCREENING', summary: firstClosure.summary, version: firstClosure.version };
    expect((await patch(casePath + '/stage', { ...reopening, reason: '   ' })).status()).toBe(400);
    expect((await patch(casePath + '/stage', { ...reopening, reason: reopenReason }, outsider.headers)).status()).toBe(403);
    expect(await snapshot(casePath, current.id)).toEqual(beforeReopen);

    const reopened = await stage(firstClosure, 'SCREENING', second.headers, '  ' + reopenReason + '  ');
    expect(reopened).toMatchObject({ stage: 'SCREENING', version: firstClosure.version + 1, closedAt: null,
      summary: current.summary, responsibleId: current.responsibleId });
    expect((await history()).content[0]).toMatchObject({
      fromStage: 'CLOSED', toStage: 'SCREENING', reason: reopenReason, actorId: second.id
    });
    await waitForProjections(reopened);
    expect(JSON.stringify(await timeline())).not.toContain(reopenReason);
    expect(JSON.stringify(await audit(current.id))).not.toContain(reopenReason);

    const closed = await stage(reopened, 'CLOSED');
    const otherClosed = await stage(other, 'CLOSED');
    const archived = await stage(otherClosed, 'ARCHIVED');
    expect(archived.closedAt).toBe(otherClosed.closedAt);
    expect(archived.allowedNextStages).toEqual([]);
    await waitForProjections(archived);
    const beforeClosed = await snapshot(casePath, closed.id);
    const beforeArchived = await snapshot(otherPath, archived.id);
    expect((await patch(otherPath + '/stage', {
      stage: 'SCREENING', summary: archived.summary, version: archived.version, reason: reopenReason
    })).status()).toBe(400);
    for (const [state, before] of [[closed, beforeClosed], [archived, beforeArchived]] as const) {
      const endpoint = '/cases/' + state.id;
      expect(state.closedAt).toEqual(expect.any(String));
      expect(before.history.content[0]).toMatchObject({ caseId: state.id, type: 'STAGE_CHANGED', toStage: state.stage });
      const target = state.responsibleId === napne.id ? recipient.id : napne.id;
      expect((await patch(endpoint + '/responsible', { responsibleId: target, version: state.version })).status()).toBe(409);
      expect(await snapshot(endpoint, state.id)).toEqual(before);
    }
  });
});
