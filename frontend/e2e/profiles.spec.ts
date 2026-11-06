import { test, expect } from '@playwright/test';

for (const role of ['napne','professor','tutor','cotep','coordenacao','gestao']) {
  test(`${role}: login, acompanhamento autorizado e logout`, async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail institucional').fill(`${role}@napne.local`);
    await page.getByLabel('Senha',{exact:true}).fill('Napne360!Demo');
    await page.getByRole('button',{name:'Entrar',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Acompanhamento NAPNE',exact:true})).toBeVisible();
    await page.locator('a[href="/estudantes"]').filter({hasText:'Estudantes acompanhados'}).click();
    const row=page.getByRole('row').filter({hasText:'Alex Exemplo'});
    await expect(row).toBeVisible();
    await row.getByRole('link',{name:'Abrir acompanhamento',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Alex Exemplo',exact:true})).toBeVisible();
    if(role==='napne') {
      await expect(page.getByRole('button',{name:'Dossiê',exact:true})).toBeVisible();
    } else {
      await expect(page.getByRole('button',{name:'Dossiê',exact:true})).toHaveCount(0);
      await expect(page.getByRole('button',{name:'Documentos',exact:true})).toHaveCount(0);
    }
    if(role==='gestao') await expect(page.getByRole('heading',{name:'Novo registro',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'Sair',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Acessar o sistema'})).toBeVisible();
  });
}

test('administrador: configuração sem conteúdo clínico',async({page})=>{
  await page.goto('/login');
  await page.getByLabel('E-mail institucional').fill('admin@napne.local');
  await page.getByLabel('Senha',{exact:true}).fill('Napne360!Demo');
  await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.locator('a[href="/administracao"]').filter({hasText:'Configuração institucional'}).click();
  await expect(page.getByRole('heading',{name:'Administração técnica'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Contas cadastradas'})).toBeVisible();
  await page.goto('/estudantes/1');
  await expect(page.getByText('Não foi possível carregar o acompanhamento.')).toBeVisible();
});
