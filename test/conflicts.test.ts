import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as s from '@/db/schema';
import { runCommand } from '@/server/domain/registry';
import type { Actor } from '@/server/domain/context';
import { pushOps, type PushOp } from '@/server/sync/push';
import { listConflicts } from '@/server/read/conflicts';
import { resolveScope, snapshot } from '@/server/sync/service';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser, grant } from './helpers/fixtures';

// Разбор спорных офлайн-операций (§5.1, решение P4 №6).
let t: TestDb;
beforeAll(async () => { t = await createMigratedDb(); });
afterAll(async () => { await t?.drop(); });

const run = (actor: Actor, name: string, input: unknown) => runCommand({ db: t.db, actor, ip: null, userAgent: 'vitest' }, name, input) as Promise<Record<string, unknown>>;
const uid = () => crypto.randomUUID();

async function world() {
  const org = await createOrg(t.db);
  const director = await createUser(t.db, org.id, 'director');
  const foreman = await createUser(t.db, org.id, 'foreman');
  const keeper = await createUser(t.db, org.id, 'warehouse_manager');
  const keeperNoAccess = await createUser(t.db, org.id, 'warehouse_manager');
  const accountant = await createUser(t.db, org.id, 'accountant');
  const p1 = await createProject(t.db, org.id);
  for (const u of [foreman, keeper, accountant]) await grant(t.db, u.id, p1.id, 'edit');
  const [w1] = await t.db.insert(s.warehouses).values({ organizationId: org.id, projectId: p1.id, name: 'Склад' }).returning();
  const [w2] = await t.db.insert(s.warehouses).values({ organizationId: org.id, projectId: p1.id, name: 'Склад 2' }).returning();
  const [m1] = await t.db.insert(s.materials).values({ organizationId: org.id, sku: `C-${uid().slice(0, 6)}`, name: 'Щебень', unit: 'т', price: '1200.00' }).returning();
  await run(director, 'movements.create', { materialId: m1.id, warehouseId: w1.id, quantity: 4, type: 'receipt' });
  await run(director, 'movements.create', { materialId: m1.id, warehouseId: w2.id, quantity: 10, type: 'receipt' });
  const [device] = await t.db.insert(s.devices).values({ userId: foreman.id, name: 'н', appVersion: 't', tokenHash: uid() }).returning();
  const entityId = uid();
  const deviceCreatedAt = new Date(Date.now() - 7200_000).toISOString();
  const op: PushOp = { opId: uid(), command: 'movements.create', payload: { id: entityId, materialId: m1.id, warehouseId: w1.id, quantity: 6, type: 'issue' }, deviceCreatedAt };
  const [r] = await pushOps(t.db, foreman, device.id, [op]);
  expect(r.status).toBe('conflict');
  return { org, director, foreman, keeper, keeperNoAccess, accountant, p1, w1, w2, m1, device, op, entityId, conflictId: r.conflictId!, deviceCreatedAt };
}

describe('разбор конфликтов', () => {
  it('видимость: автор и разбирающие с доступом; не видят — чужая роль, нет доступа, другая организация', async () => {
    const w = await world();
    const other = await createOrg(t.db); const stranger = await createUser(t.db, other.id, 'director');
    const ids = async (u: Actor) => (await listConflicts(t.db, u)).map(c => c.id);
    expect(await ids(w.foreman)).toContain(w.conflictId);
    expect(await ids(w.keeper)).toContain(w.conflictId);
    expect(await ids(w.director)).toContain(w.conflictId);
    expect(await ids(w.accountant)).not.toContain(w.conflictId);
    expect(await ids(w.keeperNoAccess)).not.toContain(w.conflictId);
    expect(await ids(stranger)).not.toContain(w.conflictId);
    // Реплика: те же правила.
    const snap = async (u: Actor) => (await snapshot(t.db, await resolveScope(t.db, u, null), { entity: 'sync_conflicts' })).rows.map(r => r.id);
    expect(await snap(w.foreman)).toContain(w.conflictId);
    expect(await snap(w.keeper)).toContain(w.conflictId);
    expect(await snap(w.accountant)).not.toContain(w.conflictId);
  });

  it('права: чужая роль и нет доступа к объекту — отказ; конфликт остаётся открытым', async () => {
    const w = await world();
    await expect(run(w.accountant, 'conflicts.resolve', { conflictId: w.conflictId, quantity: 1 })).rejects.toMatchObject({ status: 403 });
    await expect(run(w.foreman, 'conflicts.discard', { conflictId: w.conflictId, comment: 'сам отменю' })).rejects.toMatchObject({ status: 403 });
    await expect(run(w.keeperNoAccess, 'conflicts.resolve', { conflictId: w.conflictId, quantity: 1 })).rejects.toMatchObject({ status: 403 });
    const [c] = await t.db.select().from(s.syncConflicts).where(eq(s.syncConflicts.id, w.conflictId));
    expect(c.status).toBe('open');
  });

  it('провести с исправлением: тот же id и происхождение, аудит от разбирающего; снова без остатка — отказ, конфликт открыт', async () => {
    const w = await world();
    await expect(run(w.keeper, 'conflicts.resolve', { conflictId: w.conflictId, quantity: 5 })).rejects.toMatchObject({ code: 'insufficient_stock' });
    expect((await listConflicts(t.db, w.keeper)).map(c => c.id)).toContain(w.conflictId);
    // Другой склад объекта, где остаток есть.
    await run(w.keeper, 'conflicts.resolve', { conflictId: w.conflictId, quantity: 6, warehouseId: w.w2.id });
    const [m] = await t.db.select().from(s.stockMovements).where(eq(s.stockMovements.id, w.entityId));
    expect(m).toMatchObject({ quantity: '6.000', warehouseId: w.w2.id, origin: 'offline', deviceId: w.device.id, opId: w.op.opId });
    expect(m.deviceCreatedAt!.toISOString()).toBe(w.deviceCreatedAt);
    const [c] = await t.db.select().from(s.syncConflicts).where(eq(s.syncConflicts.id, w.conflictId));
    expect(c).toMatchObject({ status: 'resolved', resolvedBy: w.keeper.id });
    const audits = await t.db.select().from(s.auditLogs).where(eq(s.auditLogs.entityId, w.conflictId));
    expect(audits.map(a => [a.action, a.actorId])).toEqual([['conflict_resolve', w.keeper.id]]);
    // Повтор исходного push — уже applied с тем же id.
    const [again] = await pushOps(t.db, w.foreman, w.device.id, [w.op]);
    expect(again).toMatchObject({ status: 'applied', entityId: w.entityId });
    // Второй разбор — 409 с именем того, кто уже решил.
    const err = await run(w.director, 'conflicts.discard', { conflictId: w.conflictId, comment: 'нет' }).catch(e => e);
    expect(err).toMatchObject({ status: 409 });
    expect(err.message).toContain(w.keeper.name);
  });

  it('отклонить: комментарий обязателен; повтор push отдаёт conflict_discarded с комментарием', async () => {
    const w = await world();
    await expect(run(w.keeper, 'conflicts.discard', { conflictId: w.conflictId, comment: '' })).rejects.toMatchObject({ status: 422 });
    await run(w.keeper, 'conflicts.discard', { conflictId: w.conflictId, comment: 'Материал ушёл на другой объект' });
    const [again] = await pushOps(t.db, w.foreman, w.device.id, [w.op]);
    expect(again).toMatchObject({ status: 'rejected', error: { code: 'conflict_discarded' } });
    expect(again.error!.message).toContain('Материал ушёл на другой объект');
    expect(await t.db.select().from(s.stockMovements).where(eq(s.stockMovements.id, w.entityId))).toEqual([]);
    expect((await listConflicts(t.db, w.keeper)).map(c => c.id)).not.toContain(w.conflictId);
  });
});
