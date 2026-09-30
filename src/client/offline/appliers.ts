import { and, eq, sql } from 'drizzle-orm';
import { expenses, materials, purchases, stockMovements, taskProgressLog, tasks } from '@/db/schema';
import { localRows } from '@/client/db/schema';
import type { Tx } from '@/server/db/types';
import type { CommandContext } from '@/server/domain/context';
import { businessRule } from '@/server/domain/errors';
import { insufficientStockMessage, stockBalance } from '@/server/domain/stock';
import { REPLICA_TABLES } from '@/client/sync/apply';

// Оптимистичная запись на ноутбуке (решение P4 №1): только основная строка, с id, который потом получит и сервер.
// Номер заявки, аудит, уведомления, согласование и автоматический расход на списание делает только сервер —
// они приедут через pull. Пример из жизни: прораб пишет в черновик журнала сразу, а номер ставит бухгалтерия.

type Ctx = { tx: Tx; ctx: CommandContext; opId: string };
type Applier = (a: Ctx, input: any, scope: any) => Promise<string>;

const today = (d: Date) => d.toISOString().slice(0, 10);
const prov = (c: CommandContext) => ({ origin: 'offline', deviceId: c.prov.deviceId, deviceCreatedAt: c.prov.deviceCreatedAt, serverReceivedAt: c.prov.deviceCreatedAt, opId: c.prov.opId });

// Строка в формате pull (даты — ISO-строки): так её можно вернуть при откате тем же upsert, что и данные сервера.
export async function snapshotRow(tx: Tx, entity: string, id: string) {
  const t = REPLICA_TABLES[entity];
  const [row] = await tx.select().from(t).where(eq(t.id, id));
  return row ? JSON.parse(JSON.stringify(row)) as Record<string, unknown> : null;
}
async function track(a: Ctx, entity: string, entityId: string, before: Record<string, unknown> | null = null) {
  await a.tx.insert(localRows).values({ opId: a.opId, entity, entityId, before });
}

async function movement(a: Ctx, v: { id: string; materialId: string; warehouseId: string; projectId: string | null; purchaseId?: string | null; taskId?: string | null; type: string; quantity: string; note?: string | null }) {
  await a.tx.insert(stockMovements).values({ ...v, ...prov(a.ctx) });
  await track(a, 'stock_movements', v.id);
}

export const APPLIERS: Record<string, Applier> = {
  async 'expenses.create'(a, input) {
    await a.tx.insert(expenses).values({ id: input.id, projectId: input.projectId, category: input.category, description: input.description, amount: String(input.amount), taskId: input.taskId || null, contractId: input.contractId || null, counterpartyId: input.counterpartyId || null, incurredAt: input.incurredAt || today(a.ctx.prov.deviceCreatedAt), ...prov(a.ctx) });
    await track(a, 'expenses', input.id);
    return input.id;
  },

  async 'purchases.create'(a, input) {
    // Постоянный номер присвоит сервер; до этого в списке виден временный (local_ref).
    await a.tx.insert(purchases).values({ id: input.id, organizationId: a.ctx.actor.organizationId, projectId: input.projectId, materialId: input.materialId, warehouseId: input.warehouseId || null, supplierId: input.supplierId || null, number: input.localRef, localRef: input.localRef, quantity: String(input.quantity), unitPrice: String(input.unitPrice), dueAt: input.dueAt || null, note: input.note, status: 'requested', ...prov(a.ctx) });
    await track(a, 'purchases', input.id);
    return input.id;
  },

  async 'movements.create'(a, input, { m, projectId }: { m: typeof materials.$inferSelect; projectId: string | null }) {
    // Предпроверка по реплике и операциям в очереди (они уже в stock_movements): не хватает — отказ сразу (решение P4 №5).
    if (input.type === 'issue' || input.type === 'writeoff') {
      const b = await stockBalance(a.tx, input.materialId, input.warehouseId, input.quantity);
      if (!b.enough) throw businessRule(insufficientStockMessage(input.quantity, m.unit, m.name, b.total));
    }
    await movement(a, { id: input.id, materialId: input.materialId, warehouseId: input.warehouseId, projectId, taskId: input.taskId || null, type: input.type, quantity: String(input.quantity), note: input.note ?? null });
    return input.id;
  },

  async 'progress.set'(a, input, old: typeof tasks.$inferSelect) {
    const reportedAt = a.ctx.prov.deviceCreatedAt;
    const applied = !old.progressReportedAt || reportedAt >= old.progressReportedAt;
    await a.tx.insert(taskProgressLog).values({ id: input.id, taskId: old.id, projectId: old.projectId, authorId: a.ctx.actor.id, progress: input.progress, actualQuantity: input.actualQuantity === undefined ? null : String(input.actualQuantity), applied, ...prov(a.ctx) });
    await track(a, 'task_progress_log', input.id);
    if (applied) {
      await track(a, 'tasks', old.id, await snapshotRow(a.tx, 'tasks', old.id));
      await a.tx.update(tasks).set({ progress: input.progress, actualQuantity: String(input.actualQuantity ?? old.actualQuantity), status: input.progress === 100 ? 'done' : 'active', actualEnd: input.progress === 100 ? today(reportedAt) : null, progressReportedAt: reportedAt }).where(eq(tasks.id, old.id));
    }
    return input.id;
  },

  async 'purchases.receive'(a, input, { p, w }: { p: typeof purchases.$inferSelect; w: { id: string } }) {
    const q = String(input.quantity);
    const received = sql`${purchases.receivedQuantity} + ${q}::numeric`;
    const before = await snapshotRow(a.tx, 'purchases', p.id);
    const [updated] = await a.tx.update(purchases).set({ receivedQuantity: received, status: sql`case when ${received} = ${purchases.quantity} then 'received' else 'partial' end` })
      .where(and(eq(purchases.id, p.id), sql`${received} <= ${purchases.quantity}`)).returning({ id: purchases.id });
    if (!updated) throw businessRule(`Нельзя принять больше заказа: осталось ${Number(p.quantity) - Number(p.receivedQuantity)}`);
    await track(a, 'purchases', p.id, before);
    await movement(a, { id: input.id, materialId: p.materialId, warehouseId: w.id, projectId: p.projectId, purchaseId: p.id, type: 'receipt', quantity: q, note: `Приемка ${p.number}` });
    return input.id;
  },
};
