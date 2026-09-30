import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as s from '@/db/schema';
import { outbox } from '@/client/db/schema';
import { runCommand } from '@/server/domain/registry';
import type { Actor } from '@/server/domain/context';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser, grant } from './helpers/fixtures';
import { EmulatedClient } from './helpers/sync-client';

// Локальная запись на ноутбуке (решения P4 №1–3, 5, 8): правила сервера по реплике, outbox и зависимости.
let server: TestDb;
const clients: EmulatedClient[] = [];
beforeAll(async () => { server = await createMigratedDb(); });
afterAll(async () => { for (const c of clients) await c.drop(); await server?.drop(); });

async function setup(role = 'foreman', permission: 'view' | 'edit' = 'edit') {
  const org = await createOrg(server.db);
  const director = await createUser(server.db, org.id, 'director');
  const u = await createUser(server.db, org.id, role);
  const p1 = await createProject(server.db, org.id);
  await grant(server.db, u.id, p1.id, permission);
  const [w1] = await server.db.insert(s.warehouses).values({ organizationId: org.id, projectId: p1.id, name: 'Склад' }).returning();
  const [m1] = await server.db.insert(s.materials).values({ organizationId: org.id, sku: `W-${crypto.randomUUID().slice(0, 6)}`, name: 'Гвозди', unit: 'кг', price: '300.00' }).returning();
  const c = await EmulatedClient.create(server, u); clients.push(c);
  expect(await c.sync()).toBe(true);
  c.online = false;
  return { director: director as Actor, u, p1, w1, m1, c };
}

describe('локальная запись', () => {
  it('роль без записи, просмотр объекта и неверные поля — отказ сразу, очередь пуста', async () => {
    const ro = await setup('read_only');
    await expect(ro.c.write('expenses.create', { projectId: ro.p1.id, category: 'Прочее', description: 'x', amount: '1.00' })).rejects.toMatchObject({ status: 403 });
    const view = await setup('foreman', 'view');
    await expect(view.c.write('expenses.create', { projectId: view.p1.id, category: 'Прочее', description: 'Такси', amount: '1.00' })).rejects.toMatchObject({ status: 403 });
    await expect(view.c.write('expenses.create', { projectId: view.p1.id, category: 'Прочее', description: 'Такси', amount: '-5' })).rejects.toMatchObject({ status: 422 });
    expect(await ro.c.outbox()).toEqual([]);
    expect(await view.c.outbox()).toEqual([]);
  });

  it('заявка получает временный номер; приёмка без version; списание зависит от офлайн-прихода', async () => {
    const x = await setup('project_manager');
    const p = await x.c.write('purchases.create', { projectId: x.p1.id, materialId: x.m1.id, quantity: 3, unitPrice: '300.00' });
    const row = await x.c.row<{ number: string; localRef: string; status: string }>('purchases', p.id!);
    expect(row).toMatchObject({ status: 'requested' });
    expect(row!.number).toMatch(/^ЛОК-/);
    expect(row!.localRef).toBe(row!.number);

    const receipt = await x.c.write('movements.create', { materialId: x.m1.id, warehouseId: x.w1.id, quantity: 2, type: 'receipt' });
    const issue = await x.c.write('movements.create', { materialId: x.m1.id, warehouseId: x.w1.id, quantity: 2, type: 'issue' });
    const [o] = await x.c.local.db.select().from(outbox).where(eq(outbox.opId, issue.opId));
    expect(o.dependsOn).toEqual([receipt.opId]);
    expect(o.entityId).toBe(issue.id);

    x.c.online = true; expect(await x.c.sync()).toBe(true);
    const purchase = await runCommand({ db: server.db, actor: x.u, ip: null, userAgent: 't' }, 'purchases.create', { projectId: x.p1.id, materialId: x.m1.id, warehouseId: x.w1.id, quantity: 1, unitPrice: '1.00' }) as { id: string };
    await runCommand({ db: server.db, actor: x.director, ip: null, userAgent: 't' }, 'approvals.decide', { purchaseId: purchase.id, decision: 'approve' });
    expect(await x.c.sync()).toBe(true);
    x.c.online = false;
    const r = await x.c.write('purchases.receive', { purchaseId: purchase.id, quantity: 1, version: 999 });
    const [ro] = await x.c.local.db.select().from(outbox).where(eq(outbox.opId, r.opId));
    expect(ro.payload).not.toHaveProperty('version');
    expect(await x.c.row('purchases', purchase.id)).toMatchObject({ status: 'received' });
  });
});
