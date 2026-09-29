import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, budgetLines, contracts, counterparties, expenses, materials, notifications, purchases, stockMovements, tasks, warehouses } from '@/db/schema';
import { getOverviewFor } from '@/server/read/overview';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser, grant } from './helpers/fixtures';

let t: TestDb;
// Организация A: объекты P1 (прорабу дан view) и P2; организация B — полностью чужая.
async function world() {
  const a = await createOrg(t.db); const b = await createOrg(t.db);
  const [p1, p2, pb] = [await createProject(t.db, a.id), await createProject(t.db, a.id), await createProject(t.db, b.id)];
  const director = await createUser(t.db, a.id, 'director');
  const foreman = await createUser(t.db, a.id, 'foreman');
  const accountant = await createUser(t.db, a.id, 'accountant');
  const directorB = await createUser(t.db, b.id, 'director');
  await grant(t.db, foreman.id, p1.id, 'view');
  for (const p of [p1, p2, pb]) {
    await t.db.insert(tasks).values({ projectId: p.id, name: `Работа ${p.code}` });
    await t.db.insert(budgetLines).values({ projectId: p.id, category: 'Работы', amount: '100' });
    await t.db.insert(expenses).values({ projectId: p.id, category: 'Работы', description: 'Расход', amount: '10', incurredAt: '2026-09-01' });
  }
  const [m] = await t.db.insert(materials).values({ organizationId: a.id, sku: 'M', name: 'Материал A' }).returning();
  await t.db.insert(materials).values({ organizationId: b.id, sku: 'M', name: 'Материал B' });
  const [w1, w2] = await t.db.insert(warehouses).values([{ organizationId: a.id, projectId: p1.id, name: 'Склад P1' }, { organizationId: a.id, projectId: p2.id, name: 'Склад P2' }]).returning();
  await t.db.insert(stockMovements).values([
    { materialId: m.id, warehouseId: w1.id, projectId: p1.id, type: 'receipt', quantity: '5' },
    { materialId: m.id, warehouseId: w2.id, projectId: p2.id, type: 'receipt', quantity: '7' },
  ]);
  const [ca] = await t.db.insert(counterparties).values({ organizationId: a.id, name: 'Контрагент A' }).returning();
  await t.db.insert(counterparties).values({ organizationId: b.id, name: 'Контрагент B' });
  await t.db.insert(contracts).values([
    { organizationId: a.id, counterpartyId: ca.id, number: 'ОРГ-1', kind: 'service' },
    { organizationId: a.id, counterpartyId: ca.id, projectId: p1.id, number: 'P1-1', kind: 'supply' },
    { organizationId: a.id, counterpartyId: ca.id, projectId: p2.id, number: 'P2-1', kind: 'supply' },
  ]);
  await t.db.insert(purchases).values([p1, p2].map((p, i) => ({ organizationId: a.id, projectId: p.id, materialId: m.id, number: `ЗК-${i}` })));
  await t.db.insert(notifications).values([{ userId: director.id, title: 'Директору' }, { userId: foreman.id, title: 'Прорабу' }]);
  await t.db.insert(auditLogs).values([
    { organizationId: a.id, actorId: director.id, action: 'create', entityType: 'project' },
    { organizationId: a.id, actorId: foreman.id, action: 'update', entityType: 'task' },
    { organizationId: b.id, actorId: directorB.id, action: 'create', entityType: 'project' },
  ]);
  return { a, b, p1, p2, pb, director, foreman, accountant, directorB };
}
let W: Awaited<ReturnType<typeof world>>;
beforeAll(async () => { t = await createMigratedDb(); W = await world(); });
afterAll(async () => { await t?.drop(); });

const ids = (rows: { projectId?: string | null }[]) => [...new Set(rows.map(r => r.projectId))].sort();

describe('изоляция чтения (§5.2.1)', () => {
  it('директор видит все объекты своей организации и ничего из чужой', async () => {
    const o = await getOverviewFor(t.db, W.director);
    expect(o.projects.map(p => p.id).sort()).toEqual([W.p1.id, W.p2.id].sort());
    for (const rows of [o.tasks, o.budgets, o.expenses, o.purchases]) expect(ids(rows)).toEqual([W.p1.id, W.p2.id].sort());
    expect(o.materials.map(m => m.name)).toEqual(['Материал A']);
    expect(o.counterparties.map(c => c.name)).toEqual(['Контрагент A']);
    expect(o.people.every(p => p.organizationId === W.a.id)).toBe(true);
    expect(o.audit.every(r => r.organizationId === W.a.id)).toBe(true);
    expect(o.audit).toHaveLength(2);
  });

  it('пользователь организации B не видит ничего из A', async () => {
    const o = await getOverviewFor(t.db, W.directorB);
    expect(o.projects.map(p => p.id)).toEqual([W.pb.id]);
    expect(o.people.map(p => p.id)).toEqual([W.directorB.id]);
    expect(o.materials.map(m => m.name)).toEqual(['Материал B']);
    expect(o.warehouses).toEqual([]);
    expect(o.contracts).toEqual([]);
  });

  it('прораб видит только объекты из project_access', async () => {
    const o = await getOverviewFor(t.db, W.foreman);
    expect(o.projects.map(p => p.id)).toEqual([W.p1.id]);
    for (const rows of [o.tasks, o.budgets, o.expenses, o.purchases, o.movements]) expect(ids(rows)).toEqual([W.p1.id]);
    expect(o.contracts.map(c => c.number)).toEqual(['P1-1']);
    expect(o.metrics.budget).toBe(100);
  });

  it('остаток материала считается по всем складам организации (Допущение)', async () => {
    const o = await getOverviewFor(t.db, W.foreman);
    expect(o.materials.find(m => m.name === 'Материал A')?.balance).toBe(12);
  });

  it('уведомления — только свои; аудит у не-директора — только свои действия', async () => {
    const o = await getOverviewFor(t.db, W.foreman);
    expect(o.notifications.map(n => n.title)).toEqual(['Прорабу']);
    expect(o.audit.map(r => r.actorId)).toEqual([W.foreman.id]);
  });

  it('договоры без объекта видны бухгалтеру, но не прорабу', async () => {
    const acc = await getOverviewFor(t.db, W.accountant);
    expect(acc.contracts.map(c => c.number)).toEqual(['ОРГ-1']);
  });

  it('пользователь без доступа к объектам получает пустую сводку', async () => {
    const lonely = await createUser(t.db, W.a.id, 'foreman');
    const o = await getOverviewFor(t.db, lonely);
    expect(o.projects).toEqual([]);
    expect(o.tasks).toEqual([]);
    expect(o.metrics.budget).toBe(0);
  });
});
