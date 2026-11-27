import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { apiJson, caseFixture } from './case-fixtures';
import { catalogFixture, loginApi, loginUi } from './catalog-fixtures';

async function capture(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(name + '.png');
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

test('modal com 50 componentes edita a ementa e preserva página e filtros', async ({ page, request }, info) => {
  const admin = await loginApi(request, 'admin');
  const headers = { Authorization: 'Bearer ' + admin.token };
  const campuses = await apiJson<{ id: number; active: boolean }[]>(request, '/catalog/campuses', { headers });
  const suffix = randomUUID().slice(0, 8);
  const course = await apiJson<{ id: number; name: string }>(request, '/admin/courses', {
    method: 'POST', headers, data: { campusId: campuses[0].id, code: 'R02-' + suffix, name: 'Curso de teste ' + suffix },
  });

  for (let start = 1; start <= 50; start += 5) {
    await Promise.all(Array.from({ length: 5 }, (_, index) => {
      const code = String(start + index).padStart(2, '0');
      return apiJson(request, '/admin/subjects', {
        method: 'POST', headers,
        data: { courseId: course.id, code, name: 'Componente ' + code, workloadHours: 60, syllabus: 'Ementa ' + code },
      });
    }));
  }

  await loginUi(page, 'admin');
  await page.goto('/administracao');
  await expect(page.getByRole('heading', { name: 'Contas cadastradas' })).toBeVisible();
  await expect(page.locator('.users-card tbody tr').first()).toBeVisible();
  await capture(page, info, 'usuários');
  await page.getByRole('button', { name: 'Cursos, componentes e vínculos' }).click();
  await page.getByRole('searchbox', { name: 'Buscar cursos' }).fill(course.name);
  await capture(page, info, 'cursos');
  await page.getByRole('button', { name: 'Ver componentes de ' + course.name, exact: false }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('row')).toHaveCount(11);
  await dialog.getByRole('combobox', { name: 'Situação', exact: true }).selectOption('Ativo');
  await dialog.getByRole('button', { name: 'Página 5', exact: true }).click();
  await expect(dialog.getByText('Página 5 de 5')).toBeVisible();
  await dialog.getByRole('searchbox').scrollIntoViewIfNeeded();
  await capture(page, info, 'modal-componentes');

  const row = dialog.getByRole('row').filter({ hasText: 'Componente 50' });
  await row.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Ementa' })).toHaveValue('Ementa 50');
  await expect(dialog.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Ementa' }).fill('Ementa revisada no teste');
  await dialog.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(dialog.getByText('Página 5 de 5')).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Situação', exact: true })).toHaveValue('Ativo');
  await row.getByRole('button', { name: 'Arquivar', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirmar arquivamento' }).click();
  await expect(row).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Limpar filtros' }).click();
  await dialog.getByRole('searchbox').fill('Componente 50');
  await row.getByRole('button', { name: 'Consultar', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Ementa' })).toHaveValue('Ementa revisada no teste');
  await expect(dialog.getByRole('textbox', { name: 'Ementa' })).not.toBeEditable();
  await dialog.getByRole('button', { name: 'Voltar aos componentes' }).click();
  await row.getByRole('button', { name: 'Reativar', exact: true }).click();
  await dialog.getByRole('button', { name: 'Confirmar reativação' }).click();
  await expect(row.getByRole('button', { name: 'Editar' })).toBeVisible();
});

test('combina filtros do estudante, dos acompanhamentos e da linha do tempo no navegador', async ({ page, request }, info) => {
  const fixture = await caseFixture(request);
  const { napne, path, student } = fixture;
  await fixture.openCase('Origem do teste');
  for (let index = 1; index <= 12; index++) {
    await apiJson(request, path + '/records', {
      method: 'POST', headers: napne.headers,
      data: { type: 'PEDAGOGICAL_GUIDANCE', status: 'ACTIVE', title: 'Orientação de teste ' + index, content: {} },
    });
  }
  await loginUi(page, 'napne');
  await page.goto('/estudantes');
  await page.getByRole('searchbox', { name: 'Buscar estudante' }).fill(student.registration);
  await page.getByRole('combobox', { name: 'Curso', exact: true }).selectOption(String(student.courseId));
  await page.getByRole('combobox', { name: 'Situação', exact: true }).selectOption('ACTIVE');
  await expect(page.getByText('1 resultado', { exact: true })).toBeVisible();
  await capture(page, info, 'estudantes');
  await page.getByRole('link', { name: 'Abrir acompanhamento' }).click();
  for (const [label, heading] of [
    ['Casos', 'Casos e encaminhamentos'], ['PEI', 'Planos de Ensino Individualizados'], ['Documentos', 'Arquivos disponíveis'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await page.locator('app-list-filters:visible').first().scrollIntoViewIfNeeded();
    await capture(page, info, label.toLowerCase());
  }
  await page.getByRole('button', { name: 'Acompanhamento', exact: true }).click();
  const records = page.getByRole('region', { name: 'Registros de acompanhamento' });
  await expect(records.getByText('12 resultados', { exact: true })).toBeVisible();
  await records.getByRole('button', { name: 'Filtros', exact: true }).click();
  await records.getByLabel('Tipo de registro').selectOption('PEDAGOGICAL_GUIDANCE');
  await records.getByRole('searchbox').fill('teste 12');
  await expect(records.locator('article.record-card')).toHaveCount(1);
  await records.scrollIntoViewIfNeeded();
  await capture(page, info, 'acompanhamentos-filtrados');

  await page.getByRole('button', { name: 'Linha do tempo', exact: true }).click();
  await page.getByRole('combobox', { name: 'Tipo de evento', exact: true }).selectOption('CARE_RECORD');
  await page.getByLabel('Profissional', { exact: true }).fill(napne.name);
  await page.getByRole('button', { name: 'Filtrar eventos' }).click();
  await expect(page.getByText('12 resultado(s)', { exact: true })).toBeVisible();
  await expect(page.locator('ol.timeline li')).toHaveCount(10);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Filtrar eventos' }).scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator('.sidebar').evaluate(node => node.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await capture(page, info, 'linha-do-tempo-mobile');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});


test('seletores de vínculo e atribuição distinguem homônimos com mais de 100 profissionais', async ({ page, request }, info) => {
  const fixture = await catalogFixture(request);
  const campusId = fixture.course.campusId;
  const professionals = Array.from({ length: 120 }, (_, index) => ({
    id: 10000 + index, name: 'Profissional de Teste', institutionalRegistration: 'INST-' + (1000 + index),
    email: 'profissional-' + index + '@example.test', roles: ['TEACHER', 'TUTOR'], active: true,
    campusId: index === 119 ? campusId + 900 : campusId,
  }));
  await page.route('**/api/v1/admin/users/candidates', async route => {
    const scope = route.request().postDataJSON() as {
      roles: string[]; campusId?: number; page?: number; selectedId?: number; query?: string;
    };
    const eligible = professionals.filter(user => (!scope.campusId || user.campusId === scope.campusId)
      && user.roles.some(role => scope.roles.includes(role)));
    const term = scope.query?.toLowerCase() ?? '';
    const matches = eligible.filter(user =>
      (user.name + ' ' + user.institutionalRegistration).toLowerCase().includes(term));
    const response = await route.fetch();
    const real = await response.json();
    const start = (scope.page ?? 0) * 30;
    return route.fulfill({
      response,
      json: {
        content: [...matches.slice(start, start + 30), ...real.content].slice(0, 30),
        totalElements: matches.length + real.totalElements,
        selected: eligible.find(user => user.id === scope.selectedId) ?? real.selected,
      },
    });
  });
  await loginUi(page, 'admin');
  await page.goto('/administracao');
  await page.getByRole('button', { name: 'Cursos, componentes e vínculos' }).click();
  const form = page.locator('form.assignment-form');
  const student = form.locator('app-searchable-select[formControlName="studentId"]');
  await student.getByRole('button').click();
  await student.getByRole('combobox').fill(fixture.student.registration);
  await student.getByRole('option').click();
  const professional = form.locator('app-searchable-select[formControlName="userId"]');
  await professional.getByRole('button').click();
  const input = professional.getByRole('combobox');
  await input.fill('Profissional de Teste');
  await expect(professional.getByRole('option')).toHaveCount(30);
  await expect(professional.getByRole('status')).toContainText('119');
  const list = professional.getByRole('listbox');
  expect(await list.evaluate(node => node.scrollHeight > node.clientHeight)).toBeTruthy();
  await capture(page, info, 'vinculo-profissional');
  await input.fill('INST-1119');
  await expect(professional.getByRole('status')).toContainText('Nenhum resultado');
  await input.fill('INST-1118');
  await expect(professional.getByRole('option')).toHaveCount(1);
  await input.press('ArrowDown');
  await input.press('Enter');
  await expect(professional.getByRole('button')).toContainText('INST-1118');

  await page.getByRole('button', { name: 'Gerenciar', exact: true }).click();
  await page.getByRole('button', { name: 'Ofertas curriculares', exact: true }).click();
  const offers = page.locator('app-admin-academic-offerings');
  const group = fixture.academic.offering.groupCode;
  await offers.getByRole('searchbox').fill(group);
  await offers.getByRole('button', { name: 'Buscar', exact: true }).click();
  await offers.getByRole('row').filter({ hasText: group }).getByRole('button', { name: 'Atribuir professor' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Professor/ }).click();
  await dialog.getByRole('combobox').fill('INST-1118');
  await expect(dialog.getByRole('option')).toContainText('INST-1118');
  await capture(page, info, 'atribuição-docente');
  await dialog.getByRole('combobox').press('Escape');
  await expect(dialog.getByRole('button', { name: /^Professor/ })).toBeFocused();
});
