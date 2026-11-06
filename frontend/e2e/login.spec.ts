import { test, expect } from '@playwright/test';

test('login screen is keyboard accessible and identifies the product', async ({ page }) => {
  await page.goto('/login');
  const email = page.getByLabel('E-mail institucional', { exact: true });
  const password = page.getByLabel('Senha', { exact: true });
  const submit = page.getByRole('button', { name: 'Entrar', exact: true });

  await expect(page.getByRole('heading', { name: 'NAPNE 360' })).toBeVisible();
  await expect(email).toBeEditable();
  await expect(password).toBeEditable();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(submit).toBeDisabled();

  await email.focus();
  await page.keyboard.type('napne@napne.local');
  await page.keyboard.press('Tab');
  await expect(password).toBeFocused();
  await expect(submit).toBeDisabled();
  await page.keyboard.type('SenhaSomenteTeste!');
  await expect(submit).toBeEnabled();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Mostrar senha', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('SenhaSomenteTeste!');
  await expect(page.getByRole('button', { name: 'Ocultar senha', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(password).toHaveAttribute('type', 'password');
  await expect(password).toHaveValue('SenhaSomenteTeste!');
  await expect(page.getByRole('button', { name: 'Mostrar senha', exact: true })).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(submit).toBeFocused();
  await expect(page).toHaveURL(/\/login$/);
});
