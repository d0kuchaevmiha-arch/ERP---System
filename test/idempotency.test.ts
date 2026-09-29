import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, changeLog, expenses, materials, stockMovements, syncOps, warehouses } from '@/db/schema';
import { runCommand } from '@/server/domain/registry';
import type { Actor } from '@/server/domain/context';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser } from './helpers/fixtures';

let t: TestDb;
beforeAll(async () => { t = await createMigratedDb(); });
afterAll(async () => { await t?.drop(); });

const run = (actor: Actor, name: string, input: unknown, opId?: string) =>
  runCommand({ db: t.db, actor, ip: null, userAgent: 'vitest', prov: opId ? { opId } : undefined }, name, input) as Promise<{ id: string }>;
const json = <T>(v: T) => JSON.parse(JSON.stringify(v));

async function setup() {
  const org = await createOrg(t.db);
  const director = await createUser(t.db, org.id, 'director');
  const project = await createProject(t.db, org.id);
  const expense = { projectId: project.id, category: 'Работы', description: 'Расход', amount: '7.00' };
  return { org, director, project, expense };
}
const expensesOf = (projectId: string) => t.db.select().from(expenses).where(eq(expenses.projectId, projectId));

describe('идемпотентность (§5, Idempotency-Key)', () => {
  it('повтор с тем же ключом: тот же результат, одна запись, один аудит, один след в журнале', async () => {
    const s = await setup();
    const key = crypto.randomUUID();
    const first = await run(s.director, 'expenses.create', s.expense, key);
    const second = await run(s.director, 'expenses.create', s.expense, key);
    expect(json(second)).toEqual(json(first));
    expect(await expensesOf(s.project.id)).toHaveLength(1);
    expect(await t.db.select().from(auditLogs).where(eq(auditLogs.entityId, first.id))).toHaveLength(1);
    expect(await t.db.select().from(changeLog).where(eq(changeLog.entityId, first.id))).toHaveLength(1);
    const [op] = await t.db.select().from(syncOps).where(eq(syncOps.opId, key));
    expect(op).toMatchObject({ userId: s.director.id, command: 'expenses.create', status: 'applied', httpStatus: 201 });
    const [e] = await expensesOf(s.project.id);
    expect(e.opId).toBe(key);
  });

  it('два одновременных запроса с одним ключом → одна запись, одинаковый ответ', async () => {
    const s = await setup();
    const key = crypto.randomUUID();
    const [a, b] = await Promise.all([run(s.director, 'expenses.create', s.expense, key), run(s.director, 'expenses.create', s.expense, key)]);
    expect(a.id).toBe(b.id);
    expect(await expensesOf(s.project.id)).toHaveLength(1);
  });

  it('тот же ключ с другими данными или другой командой → 422, ничего не создано', async () => {
    const s = await setup();
    const key = crypto.randomUUID();
    await run(s.director, 'expenses.create', s.expense, key);
    await expect(run(s.director, 'expenses.create', { ...s.expense, amount: '8.00' }, key)).rejects.toMatchObject({ status: 422 });
    await expect(run(s.director, 'budgets.create', { projectId: s.project.id, category: 'Работы', amount: '1.00' }, key)).rejects.toMatchObject({ status: 422 });
    expect(await expensesOf(s.project.id)).toHaveLength(1);
  });

  it('ключ другого пользователя не отдаёт чужой результат', async () => {
    const s = await setup();
    const other = await createUser(t.db, s.org.id, 'director');
    const key = crypto.randomUUID();
    await run(s.director, 'expenses.create', s.expense, key);
    await expect(run(other, 'expenses.create', s.expense, key)).rejects.toMatchObject({ status: 422 });
  });

  it('отклонённая операция: повтор ключа возвращает ту же ошибку, даже если условия изменились', async () => {
    const s = await setup();
    const [m] = await t.db.insert(materials).values({ organizationId: s.org.id, sku: 'M', name: 'Материал', price: '1' }).returning();
    const [w] = await t.db.insert(warehouses).values({ organizationId: s.org.id, projectId: s.project.id, name: 'Склад' }).returning();
    const key = crypto.randomUUID();
    const issue = { materialId: m.id, warehouseId: w.id, type: 'issue', quantity: 5 };
    await expect(run(s.director, 'movements.create', issue, key)).rejects.toMatchObject({ status: 400 });
    await t.db.insert(stockMovements).values({ materialId: m.id, warehouseId: w.id, type: 'receipt', quantity: '10' });
    await expect(run(s.director, 'movements.create', issue, key)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/доступно только/) });
    expect(await t.db.select().from(stockMovements).where(eq(stockMovements.type, 'issue'))).toHaveLength(0);
    const [op] = await t.db.select().from(syncOps).where(eq(syncOps.opId, key));
    expect(op).toMatchObject({ status: 'rejected', httpStatus: 400 });
  });

  it('без ключа — обычное поведение (две записи)', async () => {
    const s = await setup();
    await run(s.director, 'expenses.create', s.expense);
    await run(s.director, 'expenses.create', s.expense);
    expect(await expensesOf(s.project.id)).toHaveLength(2);
  });
});
