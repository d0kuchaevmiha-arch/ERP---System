import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { purchases, stockMovements } from '@/db/schema';
import { defineCommand } from '../command';
import { audit, changed, factFields } from '../context';
import { DECIDE_ROLES, orgPurchase, orgWarehouse, requireProjectWrite, requireSameProject } from '../authz';
import { businessRule } from '../errors';
import { quantity, uuid } from '../schemas';
import { bump, expectedVersion, requireVersion } from '../versions';

export default defineCommand({
  name: 'purchases.receive', offline: 'conflictable', roles: DECIDE_ROLES, deniedMessage: 'Недостаточно прав для согласования или приемки',
  schema: z.object({ purchaseId: uuid, quantity, warehouseId: uuid.optional(), version: expectedVersion, id: uuid.optional() }),
  async authorize(tx, ctx, input) {
    // FOR UPDATE: параллельные приёмки одной заявки идут по очереди.
    const p = await orgPurchase(tx, ctx.actor, input.purchaseId, true);
    await requireProjectWrite(tx, ctx.actor, p.projectId);
    requireVersion(p.version, input.version);
    if (!['ordered', 'partial'].includes(p.status)) throw businessRule('Для приемки нужен согласованный заказ');
    const warehouseId = input.warehouseId || p.warehouseId;
    if (!warehouseId) throw businessRule('Выберите склад');
    const w = await orgWarehouse(tx, ctx.actor, warehouseId);
    requireSameProject(w.projectId, p.projectId, 'Склад');
    return { p, w };
  },
  async execute(tx, ctx, input, { p, w }) {
    // Сумма и сравнение — в NUMERIC на стороне БД, без float.
    const q = String(input.quantity);
    const received = sql`${purchases.receivedQuantity} + ${q}::numeric`;
    const [updated] = await tx.update(purchases)
      .set({ receivedQuantity: received, status: sql`case when ${received} = ${purchases.quantity} then 'received' else 'partial' end`, ...bump(purchases.version) })
      .where(and(eq(purchases.id, p.id), sql`${received} <= ${purchases.quantity}`))
      .returning();
    if (!updated) {
      const [rest] = await tx.select({ rest: sql<string>`${purchases.quantity} - ${purchases.receivedQuantity}` }).from(purchases).where(eq(purchases.id, p.id));
      throw businessRule(`Нельзя принять больше заказа: осталось ${rest.rest}`, 'over_receipt');
    }
    const [movement] = await tx.insert(stockMovements).values({ ...(input.id && { id: input.id }), materialId: p.materialId, warehouseId: w.id, projectId: p.projectId, purchaseId: p.id, type: 'receipt', quantity: q, note: `Приемка ${p.number}`, ...factFields(ctx) }).returning();
    await audit(tx, ctx, 'receive', 'purchase', p.id, p, { receivedQuantity: updated.receivedQuantity, status: updated.status, movementId: movement.id });
    changed(ctx, 'purchases', p.id, p.projectId);
    changed(ctx, 'stock_movements', movement.id, p.projectId);
    return movement;
  },
});
