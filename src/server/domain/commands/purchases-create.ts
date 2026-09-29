import { z } from 'zod';
import { approvals, purchases } from '@/db/schema';
import { defineCommand } from '../command';
import { audit } from '../context';
import { WRITE_ROLES, orgCounterparty, orgMaterial, orgWarehouse, requireProjectWrite, requireSameProject } from '../authz';
import { price, quantity, uuid } from '../schemas';

export default defineCommand({
  name: 'purchases.create', offline: 'allowed', roles: WRITE_ROLES,
  schema: z.object({ projectId: uuid, materialId: uuid, warehouseId: uuid.optional(), supplierId: uuid.optional(), quantity, unitPrice: price, dueAt: z.string().optional(), note: z.string().optional() }),
  async authorize(tx, ctx, input) {
    const project = await requireProjectWrite(tx, ctx.actor, input.projectId);
    await orgMaterial(tx, ctx.actor, input.materialId);
    if (input.warehouseId) requireSameProject((await orgWarehouse(tx, ctx.actor, input.warehouseId)).projectId, project.id, 'Склад');
    if (input.supplierId) await orgCounterparty(tx, ctx.actor, input.supplierId);
  },
  async execute(tx, ctx, input) {
    const [row] = await tx.insert(purchases).values({ organizationId: ctx.actor.organizationId, projectId: input.projectId, materialId: input.materialId, warehouseId: input.warehouseId || null, supplierId: input.supplierId || null, number: `ЗК-${Date.now().toString(36).toUpperCase()}`, quantity: String(input.quantity), unitPrice: String(input.unitPrice), dueAt: input.dueAt || null, note: input.note, status: 'requested' }).returning();
    await tx.insert(approvals).values({ organizationId: ctx.actor.organizationId, entityType: 'purchase', entityId: row.id, assignedRole: 'director' });
    await audit(tx, ctx, 'create', 'purchase', row.id, null, row);
    return row;
  },
});
