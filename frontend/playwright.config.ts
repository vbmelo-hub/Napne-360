import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4200', channel: 'chrome', trace: 'retain-on-failure' },
  webServer: { command: 'npm start -- --host 127.0.0.1', url: 'http://127.0.0.1:4200', reuseExistingServer: true }
});
