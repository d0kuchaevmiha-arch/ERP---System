import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { eq, gt, and } from 'drizzle-orm';
import { changeLog } from '@/db/schema';
import { runCommand } from '@/server/domain/registry';
import type { Actor } from '@/server/domain/context';
import { CHANGES_CHANNEL, type ChangeSignal } from '@/server/domain/changes';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser } from './helpers/fixtures';

let t: TestDb;
let listener: Client;
const signals: ChangeSignal[] = [];
beforeAll(async () => {
  t = await createMigratedDb();
  listener = new Client({ connectionString: t.url });
  await listener.connect();
  listener.on('notification', n => { if (n.channel === CHANGES_CHANNEL) signals.push(JSON.parse(n.payload!)); });
  await listener.query(`listen ${CHANGES_CHANNEL}`);
});
afterAll(async () => { await listener?.end(); await t?.drop(); });

const run = <R = { id: string }>(actor: Actor, name: string, input: unknown) => runCommand({ db: t.db, actor, ip: null, userAgent: 'vitest' }, name, input) as Promise<R>;
const waitFor = async <T>(fn: () => T | undefined, ms = 2000): Promise<T> => {
  const until = Date.now() + ms;
  for (;;) { const v = fn(); if (v !== undefined) return v; if (Date.now() > until) throw new Error('timeout'); await new Promise(r => setTimeout(r, 20)); }
};
async function lastSeq() { const rows = await t.db.select({ seq: changeLog.seq }).from(changeLog); return Math.max(0, ...rows.map(r => r.seq)); }

describe('журнал изменений (§4.2)', () => {
  it('команда пишет change_log в той же транзакции: организация, объект, сущность, id', async () => {
    const org = await createOrg(t.db);
    const director = await createUser(t.db, org.id, 'director');
    const project = await createProject(t.db, org.id);
    const since = await lastSeq();
    const row = await run(director, 'budgets.create', { projectId: project.id, category: 'Работы', amount: '5.00' });
    const rows = await t.db.select().from(changeLog).where(gt(changeLog.seq, since));
    expect(rows).toEqual([expect.objectContaining({ organizationId: org.id, projectId: project.id, entity: 'budget_lines', entityId: row.id, op: 'upsert' })]);
  });

  it('отказ команды — ни строк журнала, ни сигнала', async () => {
    const org = await createOrg(t.db);
    const director = await createUser(t.db, org.id, 'director');
    const project = await createProject(t.db, org.id);
    const since = await lastSeq(); const count = signals.length;
    await expect(run(director, 'purchases.create', { projectId: project.id, materialId: crypto.randomUUID(), quantity: 1, unitPrice: '1.00' })).rejects.toBeTruthy();
    await new Promise(r => setTimeout(r, 300));
    expect(await t.db.select().from(changeLog).where(gt(changeLog.seq, since))).toEqual([]);
    expect(signals.length).toBe(count);
  });

  it('после commit приходит сигнал: организация, объекты, maxSeq — без данных', async () => {
    const org = await createOrg(t.db);
    const director = await createUser(t.db, org.id, 'director');
    const project = await createProject(t.db, org.id);
    await run(director, 'tasks.create', { projectId: project.id, name: 'Работа' });
    const signal = await waitFor(() => signals.find(s => s.org === org.id));
    const [max] = await t.db.select({ seq: changeLog.seq }).from(changeLog).where(eq(changeLog.organizationId, org.id));
    expect(signal).toEqual({ org: org.id, projectIds: [project.id], orgWide: false, maxSeq: max.seq });
  });

  it('сквозной сценарий: каждая изменяющая команда оставляет след в журнале', async () => {
    const org = await createOrg(t.db);
    const d = await createUser(t.db, org.id, 'director');
    const since = await lastSeq();
    const project = await run(d, 'projects.create', { name: 'Объект', code: `C-${org.id.slice(0, 6)}` });
    const task = await run(d, 'tasks.create', { projectId: project.id, name: 'Работа' });
    const material = await run(d, 'materials.create', { sku: 'SKU-1', name: 'Материал', unit: 'шт', price: '1.00' });
    const warehouse = await run(d, 'warehouses.create', { name: 'Склад', projectId: project.id });
    const supplier = await run(d, 'counterparties.create', { name: 'Поставщик' });
    await run(d, 'contracts.create', { number: 'Д-1', counterpartyId: supplier.id, projectId: project.id, kind: 'supply', amount: '1.00' });
    const purchase = await run(d, 'purchases.create', { projectId: project.id, materialId: material.id, warehouseId: warehouse.id, quantity: 5, unitPrice: '1.00' });
    await run(d, 'approvals.decide', { purchaseId: purchase.id, decision: 'approve' });
    await run(d, 'purchases.receive', { purchaseId: purchase.id, quantity: 5 });
    await run(d, 'movements.create', { materialId: material.id, warehouseId: warehouse.id, type: 'issue', quantity: 1 });
    await run(d, 'progress.set', { taskId: task.id, progress: 50 });
    await run(d, 'expenses.create', { projectId: project.id, category: 'Работы', description: 'Расход', amount: '1.00' });
    const u = await run<{ user: { id: string } }>(d, 'users.create', { name: 'Прораб', email: `f-${org.id}@t.local`, role: 'foreman' });
    await run(d, 'access.set', { userId: u.user.id, projectId: project.id, permission: 'edit' });
    const entities = new Set((await t.db.select().from(changeLog).where(and(gt(changeLog.seq, since), eq(changeLog.organizationId, org.id)))).map(r => r.entity));
    for (const e of ['projects', 'tasks', 'materials', 'warehouses', 'counterparties', 'contracts', 'purchases', 'approvals', 'stock_movements', 'expenses', 'users', 'project_access'])
      expect(entities, e).toContain(e);
  });
});
