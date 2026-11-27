import { academicFixture } from './catalog-fixtures';
import { expect, test } from '@playwright/test';
import type { SessionUser, CareRecord } from '../src/app/core/models';

for (const scenario of [
  { role: 'napne', type: 'PEDAGOGICAL_GUIDANCE', field: 'Informações necessárias ao ensino' },
  { role: 'professor', type: 'TEACHER_FEEDBACK', field: 'Desempenho observado' },
  { role: 'tutor', type: 'TUTOR_OBSERVATION', field: 'Atividade acompanhada' }
]) {
  test(`${scenario.role}: retoma rascunho, cancela e finaliza preservando histórico`, async ({ page, request }) => {
    const login = async (role: string): Promise<SessionUser> => {
      const response = await request.post('/api/v1/auth/login', {
        data: { email: `${role}@napne.local`, password: 'Napne360!Demo' }
      });
      expect(response.status(), await response.text()).toBe(200);
      return response.json();
    };
    const napne = await login('napne');
    const admin = await login('admin');
    const actor = scenario.role === 'napne' ? napne : await login(scenario.role);
    const headers = { Authorization: `Bearer ${napne.token}` };
    const actorHeaders = { Authorization: `Bearer ${actor.token}` };
    const courses = await (await request.get('/api/v1/catalog/courses', { headers })).json();
    const subjects = await (await request.get('/api/v1/catalog/subjects', { headers, params: { courseId: courses[0].id } })).json();
    const createdStudent = await request.post('/api/v1/students', { headers, data: {
      courseId: courses[0].id, registration: `TEST-CARE-${scenario.role}-${Date.now()}`,
      civilName: 'Pessoa Fictícia', socialName: 'Teste de Acompanhamento'
    } });
    expect(createdStudent.status(), await createdStudent.text()).toBe(200);
    const student = await createdStudent.json();
    if (scenario.role === 'professor') {
      await academicFixture(request, { studentId: student.id, subjectId: subjects[0].id, teacherIds: [actor.id],
        adminHeaders: { Authorization: `Bearer ${admin.token}` }, napneHeaders: headers });
    } else if (scenario.role !== 'napne') {
      const assignment = await request.post('/api/v1/admin/assignments', {
        headers: { Authorization: `Bearer ${admin.token}` }, data: {
          studentId: student.id, userId: actor.id,
          assignmentType: 'TUTOR'
        }
      });
      expect(assignment.status(), await assignment.text()).toBe(200);
    }

    await page.goto('/login');
    await page.getByRole('textbox', { name: 'E-mail institucional', exact: true }).fill(actor.email);
    await page.getByLabel(/^Senha/).fill('Napne360!Demo');
    const loginResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    expect((await loginResponse).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Acompanhamento NAPNE', exact: true })).toBeVisible();
    await page.goto(`/estudantes/${student.id}`);
    await page.getByRole('button', { name: 'Acompanhamento', exact: true }).click();
    const title = `Registro fictício ${scenario.role}`;
    const createForm = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Novo registro', exact: true }) });
    await createForm.getByRole('combobox', { name: /^Tipo/ }).selectOption(scenario.type);
    if (scenario.role === 'professor') await createForm.getByRole('combobox', { name: /^Componente curricular/ }).selectOption(String(subjects[0].id));
    await createForm.getByRole('textbox', { name: 'Título', exact: true }).fill(title);
    await createForm.getByLabel(scenario.field, { exact: true }).fill('Campo pedagógico inicial');
    await createForm.getByLabel('Comentários adicionais', { exact: true }).fill('Nota inicial fictícia');
    await createForm.getByRole('button', { name: 'Salvar registro', exact: true }).click();
    const card = page.locator('article.record-card').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await expect(card.getByText('Nota inicial fictícia', { exact: true })).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: 'Acompanhamento', exact: true }).click();
    await card.getByRole('button', { name: 'Editar', exact: true }).click();
    const editForm = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Editar registro', exact: true }) });
    await expect(editForm.getByLabel(scenario.field, { exact: true })).toHaveValue('Campo pedagógico inicial');
    await editForm.getByLabel('Comentários adicionais', { exact: true }).fill('Alteração a cancelar');
    await editForm.getByRole('button', { name: 'Cancelar edição', exact: true }).click();
    await expect(card.getByText('Nota inicial fictícia', { exact: true })).toBeVisible();

    await card.getByRole('button', { name: 'Editar', exact: true }).click();
    await editForm.getByLabel(scenario.field, { exact: true }).fill('Campo pedagógico revisado');
    await editForm.getByLabel('Comentários adicionais', { exact: true }).fill('Nota final fictícia');
    await editForm.getByRole('combobox', { name: /^Situação/ }).selectOption('ACTIVE');
    await editForm.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
    await expect(card.getByText('Nota final fictícia', { exact: true })).toBeVisible();
    await card.getByText(/Histórico de versões/).click();
    await expect(card.getByText('Nota inicial fictícia', { exact: true })).toBeVisible();

    const records: CareRecord[] = await (await request.get(`/api/v1/students/${student.id}/records`, { headers: actorHeaders })).json();
    const updated = records.find(record => record.title === title);
    expect(updated?.status).toBe('ACTIVE');
    expect(updated?.history).toHaveLength(1);
    expect(updated?.version).toBe(1);
    const stale = await request.put(`/api/v1/students/${student.id}/records/${updated?.id}`, {
      headers: actorHeaders, data: { ...updated, version: 0, title: 'Não deve sobrescrever' }
    });
    expect(stale.status()).toBe(409);
    await expect.poll(async () => {
      const response = await request.get(`/api/v1/students/${student.id}/timeline`, { headers: actorHeaders });
      expect(response.ok()).toBe(true);
      const timeline: { eventType: string; data: { recordId?: string } }[] = await response.json();
      return timeline.filter(event => event.eventType === 'CARE_RECORD_UPDATED' && event.data.recordId === updated?.id);
    }, { timeout: 15_000 }).toHaveLength(1);
  });
}
