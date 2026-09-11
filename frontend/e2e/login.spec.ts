import { test, expect } from '@playwright/test';

test('login screen is keyboard accessible and identifies the product', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'NAPNE 360' })).toBeVisible();
  await expect(page.getByLabel('E-mail institucional')).toBeEditable();
  await expect(page.getByLabel('Senha')).toBeEditable();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeDisabled();
});
