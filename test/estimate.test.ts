import { afterAll, beforeAll, expect, it } from 'vitest';
import { expenses, tasks } from '@/db/schema';
import { estimateAll, estimateUser, INDEX_FACTOR } from '@/server/sync/estimate';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser, grant } from './helpers/fixtures';

let t: TestDb;
beforeAll(async () => { t = await createMigratedDb(); });
afterAll(async () => { await t?.drop(); });

it('оценка реплики: считает только видимое пользователю; директор — худший случай (все объекты)', async () => {
  const org = await createOrg(t.db);
  const director = await createUser(t.db, org.id, 'director');
  const foreman = await createUser(t.db, org.id, 'foreman');
  const [p1, p2] = [await createProject(t.db, org.id), await createProject(t.db, org.id)];
  await grant(t.db, foreman.id, p1.id, 'edit');
  for (const p of [p1, p2]) for (let i = 0; i < 50; i++) {
    await t.db.insert(tasks).values({ projectId: p.id, name: `Работа ${i}` });
    await t.db.insert(expenses).values({ projectId: p.id, category: 'Работы', description: `Расход ${'x'.repeat(100)}`, amount: '1.00', incurredAt: '2026-09-01' });
  }
  const f = await estimateUser(t.db, foreman.id);
  const d = await estimateUser(t.db, director.id);
  expect(f.entities.find(e => e.entity === 'tasks')?.rows).toBe(50);
  expect(d.entities.find(e => e.entity === 'tasks')?.rows).toBe(100);
  expect(d.dataBytes).toBeGreaterThan(f.dataBytes);
  expect(d.estimatedBytes).toBe(d.dataBytes * INDEX_FACTOR);
  const all = await estimateAll(t.db);
  expect(all[0].estimatedBytes).toBeGreaterThanOrEqual(all.at(-1)!.estimatedBytes);
});
