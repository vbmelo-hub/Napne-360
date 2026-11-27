import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { apiJson, caseFixture } from './case-fixtures';
import { academicFixture } from './catalog-fixtures';

type Revision = { id: string; revision: number; storageVersion: number; status: string; content: Record<string, unknown> };
type TimelineEvent = { eventType: string; data: { peiId?: string } };
type AuditPage = { content: { action: string; actor: string; outcome: string }[] };

function executeFixtureSql(sql: string) {
  const docker = process.env['NAPNE_E2E_DOCKER'] || 'docker';
  const compose = ['compose'];
  if (process.env['NAPNE_E2E_COMPOSE_FILE']) compose.push('-f', process.env['NAPNE_E2E_COMPOSE_FILE']);
  if (process.env['NAPNE_E2E_COMPOSE_PROJECT']) compose.push('-p', process.env['NAPNE_E2E_COMPOSE_PROJECT']);
  const mysql = 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --user=root --database="$MYSQL_DATABASE" --batch';
  return execFileSync(docker, [...compose, 'exec', '-T', 'mysql', 'sh', '-c', mysql], {
    input: sql, encoding: 'utf8', timeout: 30_000
  });
}

test('CA26 recupera a auditoria após falha sem gerar outra revisão ou evento de PEI', async ({ request }) => {
  test.setTimeout(90_000);
  const fixture = await caseFixture(request);
  const { admin, napne, key, path, student } = fixture;
  const teacher = await fixture.account('ca26', 'TEACHER');
  const session = await fixture.login(teacher);
  const subjects = await apiJson<{ id: number }[]>(request, '/catalog/subjects', {
    headers: napne.headers, params: { courseId: student.courseId }
  });
  const subject = subjects[0];
  if (!subject) throw new Error('Componente fictício não encontrado.');
  const { offering } = await academicFixture(request, {
    studentId: student.id, subjectId: subject.id, teacherIds: [teacher.id],
    adminHeaders: admin.headers, napneHeaders: napne.headers
  });
  const plans = path + '/peis';
  const draft = await apiJson<Revision>(request, plans, {
    method: 'POST', headers: session.headers, data: { offeringId: offering.id }
  });
  const content = { ...draft.content, generalObjectives: 'Objetivo fictício para recuperação do CA26' };
  const save = () => request.put('/api/v1' + plans + '/' + draft.id, {
    headers: session.headers, data: { version: draft.storageVersion, content }
  });

  if (!/^[a-f0-9]{8}$/.test(key) || !Number.isSafeInteger(teacher.id) || teacher.id <= 0 ||
      teacher.email !== `test-case-${key}-ca26@napne.local`) {
    throw new Error('O gatilho de teste exige o docente fictício criado para o CA26.');
  }
  const trigger = 'test_ca26_' + key;
  const auditFor = async (id: string) => (await apiJson<AuditPage>(request, '/audit', {
    headers: napne.headers, params: { resourceType: 'PEI', resourceId: id }
  })).content;
  const timelineFor = async (id: string) => (await apiJson<TimelineEvent[]>(request, path + '/timeline', {
    headers: napne.headers, params: { type: 'PEI' }
  })).filter(event => event.eventType === 'PEI_REVISED' && event.data.peiId === id);

  executeFixtureSql(`DELIMITER //
CREATE TRIGGER ${trigger} BEFORE INSERT ON audit_event FOR EACH ROW
BEGIN
    IF NEW.actor_user_id = ${teacher.id} AND NEW.action = 'REVISE' AND NEW.resource_type = 'PEI' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Falha de auditoria fictícia do CA26';
    END IF;
END//
DELIMITER ;
`);

  let saved: Revision;
  try {
    const response = await save();
    expect(response.status(), await response.text()).toBe(200);
    saved = await response.json();
    expect(saved.id).not.toBe(draft.id);
    expect(saved).toMatchObject({ revision: 2, status: 'DRAFT', content });
    const persisted = await apiJson<Revision>(request, plans + '/' + saved.id, { headers: session.headers });
    expect(persisted.content).toEqual(content);
    await expect.poll(async () => (await timelineFor(saved.id)).length).toBe(1);
    expect(await auditFor(saved.id)).toHaveLength(0);
    expect((await save()).status()).toBe(409);
  } finally {
    executeFixtureSql(`DROP TRIGGER IF EXISTS ${trigger};\n`);
  }

  await expect.poll(() => auditFor(saved.id), { timeout: 45_000 }).toEqual([
    expect.objectContaining({ action: 'REVISE', actor: teacher.email, outcome: 'SUCCESS' })
  ]);
  expect(await timelineFor(saved.id)).toHaveLength(1);
  const revisions = await apiJson<Revision[]>(request, plans, { headers: session.headers });
  expect(revisions).toHaveLength(2);
  expect(revisions).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: saved.id, revision: 2, status: 'DRAFT' }),
    expect.objectContaining({ id: draft.id, revision: 1, status: 'SUPERSEDED' })
  ]));
});
