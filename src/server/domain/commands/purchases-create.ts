import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { approvals, materials, purchases } from '@/db/schema';
import { defineCommand } from '../command';
import { audit } from '../context';
import { WRITE_ROLES, requireProjectWrite } from '../authz';
import { businessRule } from '../errors';
import { price, quantity, uuid } from '../schemas';

export default defineCommand({
  name: 'purchases.create', offline: 'allowed', roles: WRITE_ROLES,
  schema: z.object({ projectId: uuid, materialId: uuid, warehouseId: uuid.optional(), supplierId: uuid.optional(), quantity, unitPrice: price, dueAt: z.string().optional(), note: z.string().optional() }),
  authorize: (tx, ctx, input) => requireProjectWrite(tx, ctx.actor, input.projectId),
  async execute(tx, ctx, input) {
    const [m] = await tx.select().from(materials).where(and(eq(materials.id, input.materialId), eq(materials.organizationId, ctx.actor.organizationId)));
    if (!m) throw businessRule('Материал не найден');
    const [row] = await tx.insert(purchases).values({ organizationId: ctx.actor.organizationId, projectId: input.projectId, materialId: input.materialId, warehouseId: input.warehouseId || null, supplierId: input.supplierId || null, number: `ЗК-${Date.now().toString(36).toUpperCase()}`, quantity: String(input.quantity), unitPrice: String(input.unitPrice), dueAt: input.dueAt || null, note: input.note, status: 'requested' }).returning();
    await tx.insert(approvals).values({ organizationId: ctx.actor.organizationId, entityType: 'purchase', entityId: row.id, assignedRole: 'director' });
    await audit(tx, ctx, 'create', 'purchase', row.id, null, row);
    return row;
  },
});
