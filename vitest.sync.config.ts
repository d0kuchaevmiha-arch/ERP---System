import { defineConfig } from 'vitest/config';
import base from './vitest.config';

// Только сценарные sync-тесты P4 (§11): npm run test:sync. Они же входят в общий npm test.
export default defineConfig({ ...base, test: { ...base.test, include: ['test/sync-scenarios.test.ts'] } });
