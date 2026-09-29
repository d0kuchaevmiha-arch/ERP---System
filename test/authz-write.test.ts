import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contracts, counterparties, materials, purchases, stockMovements, tasks, warehouses } from '@/db/schema';
import { runCommand } from '@/server/domain/registry';
import type { Actor } from '@/server/domain/context';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser, grant } from './helpers/fixtures';

let t: TestDb;
const run = (actor: Actor, name: string, input: unknown) => runCommand({ db: t.db, actor, ip: null, userAgent: 'vitest' }, name, input);

// Мир: организация A (объекты P1 — прораб с edit, P2 — без доступа), организация B со своими сущностями.
async function world() {
  const a = await createOrg(t.db);
  const b = await createOrg(t.db);
  const p1 = await createProject(t.db, a.id);
  const p2 = await createProject(t.db, a.id);
  const pb = await createProject(t.db, b.id);
  const director = await createUser(t.db, a.id, 'director');
  const foreman = await createUser(t.db, a.id, 'foreman');
  const pm = await createUser(t.db, a.id, 'project_manager');
  await grant(t.db, foreman.id, p1.id, 'edit');
  await grant(t.db, pm.id, p1.id, 'edit');
  const [t1, t2] = await t.db.insert(tasks).values([{ projectId: p1.id, name: 'Работа 1' }, { projectId: p2.id, name: 'Работа 2' }]).returning();
  const [tb] = await t.db.insert(tasks).values({ projectId: pb.id, name: 'Работа B' }).returning();
  const [m] = await t.db.insert(materials).values({ organizationId: a.id, sku: 'M', name: 'Материал', price: '10' }).returning();
  const [w1, w2] = await t.db.insert(warehouses).values([{ organizationId: a.id, projectId: p1.id, name: 'Склад 1' }, { organizationId: a.id, projectId: p2.id, name: 'Склад 2' }]).returning();
  const [wb] = await t.db.insert(warehouses).values({ organizationId: b.id, projectId: pb.id, name: 'Склад B' }).returning();
  const [cb] = await t.db.insert(counterparties).values({ organizationId: b.id, name: 'Контрагент B' }).returning();
  const [kb] = await t.db.insert(contracts).values({ organizationId: b.id, counterpartyId: cb.id, number: 'B-1', kind: 'supply' }).returning();
  const [buy2] = await t.db.insert(purchases).values({ organizationId: a.id, projectId: p2.id, materialId: m.id, warehouseId: w2.id, number: 'ЗК-2', quantity: '5', status: 'ordered' }).returning();
  await t.db.insert(stockMovements).values([{ materialId: m.id, warehouseId: w1.id, type: 'receipt', quantity: '100' }, { materialId: m.id, warehouseId: w2.id, type: 'receipt', quantity: '100' }]);
  return { a, b, p1, p2, pb, director, foreman, pm, t1, t2, tb, m, w1, w2, wb, cb, kb, buy2 };
}
let W: Awaited<ReturnType<typeof world>>;
beforeAll(async () => { t = await createMigratedDb(); W = await world(); });
afterAll(async () => { await t?.drop(); });

describe('доступ к объекту проверяется всегда (§5.2.3)', () => {
  it('прораб без доступа не меняет прогресс чужой работы; с edit — меняет', async () => {
    await expect(run(W.foreman, 'progress.set', { taskId: W.t2.id, progress: 10 })).rejects.toMatchObject({ status: 403 });
    await expect(run(W.foreman, 'progress.set', { taskId: W.t1.id, progress: 10 })).resolves.toMatchObject({ progress: 10 });
  });

  it('доступ view не даёт записи', async () => {
    const viewer = await createUser(t.db, W.a.id, 'foreman');
    await grant(t.db, viewer.id, W.p2.id, 'view');
    await expect(run(viewer, 'progress.set', { taskId: W.t2.id, progress: 10 })).rejects.toMatchObject({ status: 403 });
  });

  it('РП без доступа к объекту заявки не согласует и не принимает её', async () => {
    await expect(run(W.pm, 'approvals.decide', { purchaseId: W.buy2.id, decision: 'approve' })).rejects.toMatchObject({ status: 403 });
    await expect(run(W.pm, 'purchases.receive', { purchaseId: W.buy2.id, quantity: 1 })).rejects.toMatchObject({ status: 403 });
  });

  it('движение по складу чужого объекта запрещено, даже без projectId во входе', async () => {
    await expect(run(W.foreman, 'movements.create', { materialId: W.m.id, warehouseId: W.w2.id, type: 'issue', quantity: 1 })).rejects.toMatchObject({ status: 403 });
    await expect(run(W.foreman, 'movements.create', { materialId: W.m.id, warehouseId: W.w1.id, type: 'issue', quantity: 1 })).resolves.toMatchObject({ projectId: W.p1.id });
  });

  it('projectId во входе не может «перенести» склад на другой объект', async () => {
    await expect(run(W.foreman, 'movements.create', { materialId: W.m.id, warehouseId: W.w2.id, projectId: W.p1.id, type: 'issue', quantity: 1 })).rejects.toMatchObject({ status: 422 });
  });

  it('работа из другого объекта в движении или бюджете отклоняется', async () => {
    await expect(run(W.director, 'movements.create', { materialId: W.m.id, warehouseId: W.w1.id, taskId: W.t2.id, type: 'issue', quantity: 1 })).rejects.toMatchObject({ status: 422 });
    await expect(run(W.director, 'budgets.create', { projectId: W.p1.id, category: 'Работы', amount: '1.00', taskId: W.t2.id })).rejects.toMatchObject({ status: 422 });
    await expect(run(W.director, 'tasks.create', { projectId: W.p1.id, name: 'Подработа', parentId: W.t2.id })).rejects.toMatchObject({ status: 422 });
  });
});

describe('ссылки на сущности другой организации — «не найдено» (404)', () => {
  it.each([
    ['progress.set', () => ({ taskId: W.tb.id, progress: 5 })],
    ['tasks.create', () => ({ projectId: W.p1.id, name: 'Подработа', parentId: W.tb.id })],
    ['budgets.create', () => ({ projectId: W.p1.id, category: 'Работы', amount: '1.00', taskId: W.tb.id })],
    ['expenses.create', () => ({ projectId: W.p1.id, category: 'Работы', description: 'Расход', amount: '1.00', contractId: W.kb.id })],
    ['expenses.create', () => ({ projectId: W.p1.id, category: 'Работы', description: 'Расход', amount: '1.00', counterpartyId: W.cb.id })],
    ['expenses.create', () => ({ projectId: W.p1.id, category: 'Работы', description: 'Расход', amount: '1.00', taskId: W.tb.id })],
    ['contracts.create', () => ({ number: 'К-1', counterpartyId: W.cb.id, kind: 'supply', amount: '1.00' })],
    ['purchases.create', () => ({ projectId: W.p1.id, materialId: W.m.id, warehouseId: W.wb.id, quantity: 1, unitPrice: '1.00' })],
    ['purchases.create', () => ({ projectId: W.p1.id, materialId: W.m.id, supplierId: W.cb.id, quantity: 1, unitPrice: '1.00' })],
    ['movements.create', () => ({ materialId: W.m.id, warehouseId: W.wb.id, type: 'receipt', quantity: 1 })],
    ['budgets.create', () => ({ projectId: W.pb.id, category: 'Работы', amount: '1.00' })],
  ])('%s', async (name, input) => {
    await expect(run(W.director, name, input())).rejects.toMatchObject({ status: 404 });
  });
});
