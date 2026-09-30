import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { approvals, auditLogs, materials, notifications, purchases, stockMovements, taskProgressLog, tasks, warehouses } from '@/db/schema';
import { runCommand } from '@/server/domain/registry';
import type { Actor } from '@/server/domain/context';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser } from './helpers/fixtures';

let t: TestDb;
beforeAll(async () => { t = await createMigratedDb(); });
afterAll(async () => { await t?.drop(); });
const run = (actor: Actor, name: string, input: unknown) => runCommand({ db: t.db, actor, ip: null, userAgent: 'vitest' }, name, input);

async function setup(quantity = '10', status = 'requested') {
  const org = await createOrg(t.db);
  const director = await createUser(t.db, org.id, 'director');
  const director2 = await createUser(t.db, org.id, 'director');
  const project = await createProject(t.db, org.id);
  const [m] = await t.db.insert(materials).values({ organizationId: org.id, sku: 'M', name: 'Кабель', unit: 'м', price: '10.00' }).returning();
  const [w] = await t.db.insert(warehouses).values({ organizationId: org.id, projectId: project.id, name: 'Склад' }).returning();
  const [p] = await t.db.insert(purchases).values({ organizationId: org.id, projectId: project.id, materialId: m.id, warehouseId: w.id, number: 'ЗК-1', quantity, status }).returning();
  await t.db.insert(approvals).values({ organizationId: org.id, entityType: 'purchase', entityId: p.id });
  return { org, director, director2, project, m, w, p };
}
const outcomes = (rs: PromiseSettledResult<unknown>[]) => ({ ok: rs.filter(r => r.status === 'fulfilled').length, failed: rs.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => r.reason) });

describe('гонки (§5.2.4)', () => {
  it('два одновременных согласования → ровно одно; второе — 409 «уже решена ‹кем›»', async () => {
    const s = await setup();
    const rs = await Promise.allSettled([
      run(s.director, 'approvals.decide', { purchaseId: s.p.id, decision: 'approve' }),
      run(s.director2, 'approvals.decide', { purchaseId: s.p.id, decision: 'reject' }),
    ]);
    const { ok, failed } = outcomes(rs);
    expect(ok).toBe(1);
    expect(failed[0]).toMatchObject({ status: 409 });
    expect(String(failed[0].message)).toMatch(/уже решена/);
    const [winner] = await t.db.select().from(approvals).where(eq(approvals.entityId, s.p.id));
    const winnerName = winner.decidedBy === s.director.id ? s.director.name : s.director2.name;
    expect(String(failed[0].message)).toContain(winnerName);
    const log = await t.db.select().from(auditLogs).where(eq(auditLogs.entityId, s.p.id));
    expect(log).toHaveLength(1);
  });

  it('две одновременные приёмки сверх заказа → принято не больше заказа', async () => {
    const s = await setup('10', 'ordered');
    const rs = await Promise.allSettled([6, 6].map(q => run(s.director, 'purchases.receive', { purchaseId: s.p.id, quantity: q })));
    expect(outcomes(rs).ok).toBe(1);
    const [p] = await t.db.select().from(purchases).where(eq(purchases.id, s.p.id));
    expect(p).toMatchObject({ receivedQuantity: '6.000', status: 'partial' });
    const moves = await t.db.select().from(stockMovements).where(eq(stockMovements.purchaseId, s.p.id));
    expect(moves).toHaveLength(1);
  });

  it('приёмка дробными частями считается в NUMERIC: 0.1 + 0.1 + 0.1 = 0.3 → «получено»', async () => {
    const s = await setup('0.3', 'ordered');
    for (let i = 0; i < 3; i++) await run(s.director, 'purchases.receive', { purchaseId: s.p.id, quantity: 0.1 });
    const [p] = await t.db.select().from(purchases).where(eq(purchases.id, s.p.id));
    expect(p).toMatchObject({ receivedQuantity: '0.300', status: 'received' });
  });

  it('два одновременных списания последних 10 ед. → одно успешно', async () => {
    const s = await setup();
    await t.db.insert(stockMovements).values({ materialId: s.m.id, warehouseId: s.w.id, type: 'receipt', quantity: '10' });
    const rs = await Promise.allSettled([1, 2].map(() => run(s.director, 'movements.create', { materialId: s.m.id, warehouseId: s.w.id, type: 'issue', quantity: 10 })));
    expect(outcomes(rs).ok).toBe(1);
    const issued = await t.db.select().from(stockMovements).where(and(eq(stockMovements.warehouseId, s.w.id), eq(stockMovements.type, 'issue')));
    expect(issued).toHaveLength(1);
  });

  it('количество с более чем 3 знаками после запятой отклоняется (422)', async () => {
    const s = await setup('10', 'ordered');
    await expect(run(s.director, 'purchases.receive', { purchaseId: s.p.id, quantity: 0.0001 })).rejects.toMatchObject({ status: 422 });
  });
});

describe('прогресс (§5.2.4–5.2.5)', () => {
  it('фактический объём 0 записывается как 0 (а не остаётся прежним)', async () => {
    const s = await setup();
    const [task] = await t.db.insert(tasks).values({ projectId: s.project.id, name: 'Работа', actualQuantity: '5' }).returning();
    await expect(run(s.director, 'progress.set', { taskId: task.id, progress: 10, actualQuantity: 0 })).resolves.toMatchObject({ actualQuantity: '0.000' });
    await expect(run(s.director, 'progress.set', { taskId: task.id, progress: 20 })).resolves.toMatchObject({ actualQuantity: '0.000', progress: 20 });
  });

  it('параллельные факты прогресса: оба в истории, текущий — самый поздний по времени ввода, ничего не потеряно', async () => {
    const s = await setup();
    const [task] = await t.db.insert(tasks).values({ projectId: s.project.id, name: 'Работа' }).returning();
    await Promise.all([30, 60].map(progress => run(s.director, 'progress.set', { taskId: task.id, progress })));
    // Правило P2 (§5.1): FOR UPDATE упорядочивает применение; факт, введённый раньше, но дошедший вторым, — только в истории.
    const facts = await t.db.select().from(taskProgressLog).where(eq(taskProgressLog.taskId, task.id));
    expect(facts.map(f => f.progress).sort()).toEqual([30, 60]);
    const maxAt = Math.max(...facts.map(f => f.deviceCreatedAt!.getTime()));
    // При равном времени ввода (одна миллисекунда) текущим становится обработанный вторым — любой из самых поздних.
    const candidates = facts.filter(f => f.applied && f.deviceCreatedAt!.getTime() === maxAt).map(f => f.progress);
    const [after] = await t.db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(candidates).toContain(after.progress);
    expect(after.version).toBe(1 + facts.filter(f => f.applied).length);
  });
});

describe('бюджет', () => {
  it('предупреждение о перерасходе сравнивает суммы в NUMERIC (0.10 + 0.20 = бюджет 0.30 → без предупреждения)', async () => {
    const s = await setup();
    await run(s.director, 'budgets.create', { projectId: s.project.id, category: 'Работы', amount: '0.30' });
    await run(s.director, 'expenses.create', { projectId: s.project.id, category: 'Работы', description: 'Первый', amount: '0.10' });
    await expect(run(s.director, 'expenses.create', { projectId: s.project.id, category: 'Работы', description: 'Второй', amount: '0.20' })).resolves.toMatchObject({ budgetWarning: false });
    await expect(run(s.director, 'expenses.create', { projectId: s.project.id, category: 'Работы', description: 'Третий', amount: '0.01' })).resolves.toMatchObject({ budgetWarning: true });
    const n = await t.db.select().from(notifications).where(eq(notifications.userId, s.director.id));
    expect(n).toHaveLength(1);
  });
});
