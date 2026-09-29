import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { purchases, stockMovements, warehouses } from '@/db/schema';
import { defineCommand } from '../command';
import { audit } from '../context';
import { DECIDE_ROLES } from '../authz';
import { businessRule } from '../errors';
import { quantity, uuid } from '../schemas';

export default defineCommand({
  name: 'purchases.receive', offline: 'conflictable', roles: DECIDE_ROLES,
  schema: z.object({ purchaseId: uuid, quantity, warehouseId: uuid.optional() }),
  async authorize(tx, ctx, input) {
    const [p] = await tx.select().from(purchases).where(and(eq(purchases.id, input.purchaseId), eq(purchases.organizationId, ctx.actor.organizationId)));
    if (!p || !['ordered', 'partial'].includes(p.status)) throw businessRule('Для приемки нужен согласованный заказ');
    const warehouseId = input.warehouseId || p.warehouseId;
    if (!warehouseId) throw businessRule('Выберите склад');
    const [w] = await tx.select().from(warehouses).where(and(eq(warehouses.id, warehouseId), eq(warehouses.organizationId, ctx.actor.organizationId)));
    if (!w) throw businessRule('Склад не найден');
    return { p, w };
  },
  async execute(tx, ctx, input, { p, w }) {
    if (Number(p.receivedQuantity) + input.quantity > Number(p.quantity)) throw businessRule(`Нельзя принять больше заказа: осталось ${Number(p.quantity) - Number(p.receivedQuantity)}`);
    const [movement] = await tx.insert(stockMovements).values({ materialId: p.materialId, warehouseId: w.id, projectId: p.projectId, purchaseId: p.id, type: 'receipt', quantity: String(input.quantity), note: `Приемка ${p.number}` }).returning();
    const received = Number(p.receivedQuantity) + input.quantity;
    await tx.update(purchases).set({ receivedQuantity: String(received), status: received === Number(p.quantity) ? 'received' : 'partial' }).where(eq(purchases.id, p.id));
    await audit(tx, ctx, 'receive', 'purchase', p.id, p, { receivedQuantity: received, movementId: movement.id });
    return movement;
  },
});
