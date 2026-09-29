import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, expenses, materials, purchases, stockMovements, warehouses } from '@/db/schema';
import { runCommand } from '@/server/domain/registry';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser } from './helpers/fixtures';

let t: TestDb;
beforeAll(async () => { t = await createMigratedDb(); });
afterAll(async () => { await t?.drop(); });

async function setup() {
  const org = await createOrg(t.db);
  const director = await createUser(t.db, org.id, 'director');
  const project = await createProject(t.db, org.id);
  const [m] = await t.db.insert(materials).values({ organizationId: org.id, sku: 'M', name: 'Материал', price: '10.00' }).returning();
  const [w] = await t.db.insert(warehouses).values({ organizationId: org.id, projectId: project.id, name: 'Склад' }).returning();
  await t.db.insert(stockMovements).values({ materialId: m.id, warehouseId: w.id, type: 'receipt', quantity: '100' });
  return { director, project, m, w };
}

describe('происхождение фактов (§4.1)', () => {
  it('онлайн-факт: origin=online, время устройства = время приёма сервером, аудит с тем же происхождением', async () => {
    const s = await setup();
    const before = Date.now();
    const row = await runCommand({ db: t.db, actor: s.director, ip: null, userAgent: 'vitest' }, 'expenses.create', { projectId: s.project.id, category: 'Работы', description: 'Онлайн', amount: '1.00' }) as { id: string };
    const [e] = await t.db.select().from(expenses).where(eq(expenses.id, row.id));
    expect(e.origin).toBe('online');
    expect(e.deviceId).toBeNull();
    expect(e.deviceCreatedAt?.getTime()).toBe(e.serverReceivedAt.getTime());
    expect(e.serverReceivedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const [a] = await t.db.select().from(auditLogs).where(eq(auditLogs.entityId, row.id));
    expect(a).toMatchObject({ origin: 'online', deviceId: null });
  });

  it('офлайн-факт (как пришлёт sync в P4): время устройства и устройство сохраняются, сервер ставит своё время приёма', async () => {
    const s = await setup();
    const deviceId = crypto.randomUUID();
    const opId = crypto.randomUUID();
    const deviceCreatedAt = new Date('2026-09-01T06:30:00Z');
    const ctx = { db: t.db, actor: s.director, ip: null, userAgent: 'vitest', prov: { origin: 'offline' as const, deviceId, deviceCreatedAt, opId } };
    const move = await runCommand(ctx, 'movements.create', { materialId: s.m.id, warehouseId: s.w.id, type: 'issue', quantity: 2 }) as { id: string };
    const [mv] = await t.db.select().from(stockMovements).where(eq(stockMovements.id, move.id));
    expect(mv).toMatchObject({ origin: 'offline', deviceId, opId });
    expect(mv.deviceCreatedAt?.toISOString()).toBe(deviceCreatedAt.toISOString());
    expect(mv.serverReceivedAt.getTime()).toBeGreaterThan(deviceCreatedAt.getTime());
    // Стоимость списания — тоже факт, с тем же происхождением.
    const [cost] = await t.db.select().from(expenses).where(eq(expenses.projectId, s.project.id));
    expect(cost).toMatchObject({ origin: 'offline', deviceId, opId });
    const [a] = await t.db.select().from(auditLogs).where(eq(auditLogs.entityId, move.id));
    expect(a).toMatchObject({ origin: 'offline', deviceId });
    expect(a.deviceCreatedAt?.toISOString()).toBe(deviceCreatedAt.toISOString());
  });

  it('заявка несёт происхождение', async () => {
    const s = await setup();
    const p = await runCommand({ db: t.db, actor: s.director, ip: null, userAgent: 'vitest' }, 'purchases.create', { projectId: s.project.id, materialId: s.m.id, quantity: 1, unitPrice: '1.00' }) as { id: string };
    const [row] = await t.db.select().from(purchases).where(eq(purchases.id, p.id));
    expect(row.origin).toBe('online');
    expect(row.deviceCreatedAt).not.toBeNull();
  });
});
