import { afterAll, beforeAll, expect, it } from 'vitest';
import { createEmptyDb, type TestDb } from './helpers/db';

let t: TestDb;
beforeAll(async () => { t = await createEmptyDb(); });
afterAll(async () => { await t?.drop(); });

it('тестовый сервер — PostgreSQL 16', async () => {
  const { rows } = await t.pool.query<{ server_version_num: string }>('show server_version_num');
  expect(Number(rows[0].server_version_num)).toBeGreaterThanOrEqual(160000);
  expect(Number(rows[0].server_version_num)).toBeLessThan(170000);
});
