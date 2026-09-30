import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Интеграционные тесты работают с настоящим PostgreSQL 16: `npm run test:db:up`.
// Каждый тестовый файл создаёт свою БД (test/helpers/db.ts), поэтому файлы можно гонять параллельно.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      // Модуль src/db требует DATABASE_URL при импорте; тесты используют собственные пулы.
      DATABASE_URL: process.env.TEST_ADMIN_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54329/postgres',
      SESSION_SECRET: 'test-session-secret-0123456789abcdef-0123456789',
    },
  },
});
