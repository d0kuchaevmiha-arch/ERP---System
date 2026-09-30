import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import * as s from '@/db/schema';
import { runCommand } from '@/server/domain/registry';
import type { Actor } from '@/server/domain/context';
import { pushOps, type PushOp } from '@/server/sync/push';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser, grant } from './helpers/fixtures';

// POST /api/sync/push (§6.4): правила приёма офлайн-операций на сервере.
let t: TestDb;
beforeAll(async () => { t = await createMigratedDb(); });
afterAll(async () => { await t?.drop(); });

const run = (actor: Actor, name: string, input: unknown) => runCommand({ db: t.db, actor, ip: null, userAgent: 'vitest' }, name, input) as Promise<{ id: string }>;
const uid = () => crypto.randomUUID();
const op = (command: string, payload: Record<string, unknown>, extra: Partial<PushOp> = {}): PushOp => ({ opId: uid(), command, payload, deviceCreatedAt: new Date().toISOString(), ...extra });
const fresh = async (u: Actor) => (await t.db.select().from(s.users).where(eq(s.users.id, u.id)))[0];

async function world() {
  const org = await createOrg(t.db);
  const director = await createUser(t.db, org.id, 'director');
  const foreman = await createUser(t.db, org.id, 'foreman');
  const p1 = await createProject(t.db, org.id); const p2 = await createProject(t.db, org.id);
  await grant(t.db, foreman.id, p1.id, 'edit');
  const [device] = await t.db.insert(s.devices).values({ userId: foreman.id, name: 'ноутбук', appVersion: 'test', tokenHash: uid() }).returning();
  const [w1] = await t.db.insert(s.warehouses).values({ organizationId: org.id, projectId: p1.id, name: 'Склад' }).returning();
  const [m1] = await t.db.insert(s.materials).values({ organizationId: org.id, sku: `S-${uid().slice(0, 6)}`, name: 'Песок', unit: 'т', price: '900.00' }).returning();
  await run(director, 'movements.create', { materialId: m1.id, warehouseId: w1.id, quantity: 5, type: 'receipt' });
  const expense = (extra: Record<string, unknown> = {}) => ({ projectId: p1.id, category: 'Прочее', description: 'Расход', amount: '100.00', ...extra });
  return { org, director, foreman, p1, p2, device, w1, m1, expense };
}

describe('push (§6.4)', () => {
  it('применяет по порядку с id клиента и происхождением; повтор пакета — те же ответы без дублей', async () => {
    const w = await world();
    const id = uid();
    const at = new Date(Date.now() - 3600_000).toISOString();
    const ops = [op('expenses.create', w.expense({ id }), { deviceCreatedAt: at }), op('movements.create', { materialId: w.m1.id, warehouseId: w.w1.id, quantity: 2, type: 'issue' })];
    const first = await pushOps(t.db, w.foreman, w.device.id, ops);
    expect(first.map(r => r.status)).toEqual(['applied', 'applied']);
    expect(first[0].entityId).toBe(id);
    const [row] = await t.db.select().from(s.expenses).where(eq(s.expenses.id, id));
    expect(row).toMatchObject({ origin: 'offline', deviceId: w.device.id, opId: ops[0].opId });
    expect(row.deviceCreatedAt!.toISOString()).toBe(at);
    const [a] = await t.db.select().from(s.auditLogs).where(and(eq(s.auditLogs.entityId, id), eq(s.auditLogs.action, 'create')));
    expect(a).toMatchObject({ origin: 'offline', deviceId: w.device.id });
    const again = await pushOps(t.db, w.foreman, w.device.id, ops);
    expect(again).toEqual(first);
    expect((await t.db.select().from(s.expenses).where(eq(s.expenses.opId, ops[0].opId))).length).toBe(1);
    const [d] = await t.db.select().from(s.devices).where(eq(s.devices.id, w.device.id));
    expect(d.lastSyncAt).toBeTruthy();
  });

  it('нет доступа → no_access; чужая организация → not_found; online_only → rejected; повтор отказа — тот же ответ', async () => {
    const w = await world();
    const other = await createOrg(t.db); const foreign = await createProject(t.db, other.id);
    const ops = [op('expenses.create', w.expense({ projectId: w.p2.id })), op('expenses.create', w.expense({ projectId: foreign.id })), op('budgets.create', { projectId: w.p1.id, category: 'Работы', amount: '10.00' })];
    const r = await pushOps(t.db, w.foreman, w.device.id, ops);
    expect(r.map(x => [x.status, x.error?.code])).toEqual([['rejected', 'no_access'], ['rejected', 'not_found'], ['rejected', 'online_only']]);
    expect(await pushOps(t.db, w.foreman, w.device.id, ops)).toEqual(r);
    expect((await t.db.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, w.p1.id))).length).toBe(0);
  });

  it('нехватка остатка → конфликт в sync_conflicts (один на повтор), в журнале изменений; прочие бизнес-отказы — rejected', async () => {
    const w = await world();
    const issue = op('movements.create', { materialId: w.m1.id, warehouseId: w.w1.id, quantity: 6, type: 'issue' });
    const [r] = await pushOps(t.db, w.foreman, w.device.id, [issue]);
    expect(r).toMatchObject({ status: 'conflict', error: { code: 'insufficient_stock' } });
    expect(r.conflictId).toBeTruthy();
    const [again] = await pushOps(t.db, w.foreman, w.device.id, [issue]);
    expect(again).toEqual(r);
    const conflicts = await t.db.select().from(s.syncConflicts).where(eq(s.syncConflicts.opId, issue.opId));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: 'insufficient_stock', status: 'open', projectId: w.p1.id, authorId: w.foreman.id, deviceId: w.device.id });
    const log = await t.db.select().from(s.changeLog).where(and(eq(s.changeLog.entity, 'sync_conflicts'), eq(s.changeLog.entityId, r.conflictId!)));
    expect(log).toHaveLength(1);
    // Приёмка незаказанной заявки — не конфликт, а обычный отказ.
    const p = await run(w.foreman, 'purchases.create', { projectId: w.p1.id, materialId: w.m1.id, quantity: 1, unitPrice: '1.00' });
    const director = await fresh(w.director);
    const [dev] = await t.db.insert(s.devices).values({ userId: director.id, name: 'd', appVersion: 't', tokenHash: uid() }).returning();
    const [rej] = await pushOps(t.db, director, dev.id, [op('purchases.receive', { purchaseId: p.id, quantity: 1, warehouseId: w.w1.id })]);
    expect(rej).toMatchObject({ status: 'rejected', error: { code: 'business_rule' } });
  });

  it('зависимость от отклонённой → dependency_rejected; id уже занят → duplicate_id; блокировка → user_blocked', async () => {
    const w = await world();
    const bad = op('expenses.create', w.expense({ projectId: w.p2.id }));
    const dep = op('expenses.create', w.expense(), { dependsOn: [bad.opId] });
    const existing = await run(w.foreman, 'expenses.create', w.expense());
    const dup = op('expenses.create', w.expense({ id: existing.id }));
    const r = await pushOps(t.db, w.foreman, w.device.id, [bad, dep, dup]);
    expect(r.map(x => x.error?.code)).toEqual(['no_access', 'dependency_rejected', 'duplicate_id']);

    const beforeBlock = new Date().toISOString();
    await new Promise(res => setTimeout(res, 10));
    await run(w.director, 'users.update', { userId: w.foreman.id, isActive: false });
    const during = new Date().toISOString();
    await new Promise(res => setTimeout(res, 10));
    await run(w.director, 'users.update', { userId: w.foreman.id, isActive: true });
    const u = await fresh(w.foreman);
    expect(u.blockedAt).toBeTruthy(); expect(u.unblockedAt).toBeTruthy();
    const r2 = await pushOps(t.db, u, w.device.id, [op('expenses.create', w.expense(), { deviceCreatedAt: beforeBlock }), op('expenses.create', w.expense(), { deviceCreatedAt: during }), op('expenses.create', w.expense())]);
    expect(r2.map(x => x.error?.code ?? x.status)).toEqual(['applied', 'user_blocked', 'applied']);
  });

  it('формат пакета: больше 200 операций и мусор — ошибка всего пакета; ключ чужого пользователя — отказ', async () => {
    const w = await world();
    await expect(pushOps(t.db, w.foreman, w.device.id, Array.from({ length: 201 }, () => op('expenses.create', w.expense())))).rejects.toMatchObject({ status: 422 });
    await expect(pushOps(t.db, w.foreman, w.device.id, [{ opId: 'x', command: 'expenses.create', payload: {}, deviceCreatedAt: 'вчера' }])).rejects.toMatchObject({ status: 422 });
    const mine = op('expenses.create', w.expense());
    await pushOps(t.db, w.foreman, w.device.id, [mine]);
    const [r] = await pushOps(t.db, await fresh(w.director), w.device.id, [mine]);
    expect(r).toMatchObject({ status: 'rejected', error: { code: 'validation' } });
    expect(Number((await t.db.execute<{ n: string }>(sql`select count(*) as n from expenses where op_id = ${mine.opId}`)).rows[0].n)).toBe(1);
  });
});
