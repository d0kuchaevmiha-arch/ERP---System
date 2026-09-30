import { defineConfig } from 'vitest/config';
import base from './vitest.config';

// Сценарные sync-тесты P4 (§11) — отдельный прогон, пока офлайн-ввод не готов (решение P4 №14).
export default defineConfig({ ...base, test: { ...base.test, include: ['test/sync-scenarios.test.ts'], exclude: ['node_modules/**'] } });
