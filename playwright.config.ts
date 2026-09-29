import { defineConfig } from '@playwright/test';

// E2E десктопа (§11): настоящий Electron против сервера docker compose на http://localhost:3000.
// Запуск: npm run desktop:build && npx playwright test   (установленная программа: E2E_APP=<путь к .exe>)
export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  workers: 1,
  reporter: [['list']],
});
