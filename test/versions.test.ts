import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { approvals, materials, purchases, tasks, warehouses } from '@/db/schema';
import { runCommand } from '@/server/domain/registry';
import type { Actor } from '@/server/domain/context';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser } from './helpers/fixtures';

let t: TestDb;
beforeAll(async () => { t = await createMigratedDb(); });
afterAll(async () => { await t?.drop(); });
const run = (actor: Actor, name: string, input: unknown) => runCommand({ db: t.db, actor, ip: null, userAgent: 'vitest' }, name, input);
const purchase = async (id: string) => (await t.db.select().from(purchases).where(eq(purchases.id, id)))[0];

async function setup(status = 'requested') {
  const org = await createOrg(t.db);
  const director = await createUser(t.db, org.id, 'director');
  const project = await createProject(t.db, org.id);
  const [m] = await t.db.insert(materials).values({ organizationId: org.id, sku: 'M', name: 'Материал' }).returning();
  const [w] = await t.db.insert(warehouses).values({ organizationId: org.id, projectId: project.id, name: 'Склад' }).returning();
  const [p] = await t.db.insert(purchases).values({ organizationId: org.id, projectId: project.id, materialId: m.id, warehouseId: w.id, number: 'ЗК-1', quantity: '10', status }).returning();
  await t.db.insert(approvals).values({ organizationId: org.id, entityType: 'purchase', entityId: p.id });
  return { director, project, p };
}

describe('оптимистическая блокировка (§4.1)', () => {
  it('согласование с устаревшей версией заявки → 409, заявка не изменена', async () => {
    const s = await setup();
    await t.db.update(purchases).set({ version: 2, note: 'изменил другой' }).where(eq(purchases.id, s.p.id));
    await expect(run(s.director, 'approvals.decide', { purchaseId: s.p.id, decision: 'approve', version: 1 })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/другой пользователь/) });
    expect((await purchase(s.p.id)).status).toBe('requested');
  });

  it('согласование с актуальной версией проходит и увеличивает version и updated_at', async () => {
    const s = await setup();
    const before = await purchase(s.p.id);
    await run(s.director, 'approvals.decide', { purchaseId: s.p.id, decision: 'approve', version: before.version });
    const after = await purchase(s.p.id);
    expect(after.version).toBe(before.version + 1);
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime());
    const [a] = await t.db.select().from(approvals).where(eq(approvals.entityId, s.p.id));
    expect(a.version).toBe(2);
  });

  it('приёмка с устаревшей версией → 409; без версии — как раньше', async () => {
    const s = await setup('ordered');
    await expect(run(s.director, 'purchases.receive', { purchaseId: s.p.id, quantity: 1, version: 99 })).rejects.toMatchObject({ status: 409 });
    await run(s.director, 'purchases.receive', { purchaseId: s.p.id, quantity: 1 });
    expect(await purchase(s.p.id)).toMatchObject({ receivedQuantity: '1.000', version: 2 });
  });

  it('изменение прогресса увеличивает version работы', async () => {
    const s = await setup();
    const [task] = await t.db.insert(tasks).values({ projectId: s.project.id, name: 'Работа' }).returning();
    await run(s.director, 'progress.set', { taskId: task.id, progress: 10 });
    const [after] = await t.db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(after.version).toBe(2);
  });
});
