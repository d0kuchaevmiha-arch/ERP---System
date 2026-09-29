import { z } from 'zod';
import { approvals, purchases } from '@/db/schema';
import { defineCommand } from '../command';
import { audit, changed, factFields } from '../context';
import { WRITE_ROLES, orgCounterparty, orgMaterial, orgWarehouse, requireProjectWrite, requireSameProject } from '../authz';
import { price, quantity, uuid } from '../schemas';
import { nextCounter, purchaseNumber } from '../counters';

export default defineCommand({
  name: 'purchases.create', offline: 'allowed', roles: WRITE_ROLES,
  schema: z.object({ projectId: uuid, materialId: uuid, warehouseId: uuid.optional(), supplierId: uuid.optional(), quantity, unitPrice: price, dueAt: z.string().optional(), note: z.string().optional(), localRef: z.string().trim().min(1).max(64).optional() }),
  async authorize(tx, ctx, input) {
    const project = await requireProjectWrite(tx, ctx.actor, input.projectId);
    await orgMaterial(tx, ctx.actor, input.materialId);
    if (input.warehouseId) requireSameProject((await orgWarehouse(tx, ctx.actor, input.warehouseId)).projectId, project.id, 'Склад');
    if (input.supplierId) await orgCounterparty(tx, ctx.actor, input.supplierId);
  },
  async execute(tx, ctx, input) {
    // Постоянный номер присваивает сервер; временный номер клиента (офлайн, P4) сохраняется в local_ref.
    const number = purchaseNumber(await nextCounter(tx, ctx.actor.organizationId, 'purchase'), ctx.prov.serverReceivedAt);
    const [row] = await tx.insert(purchases).values({ organizationId: ctx.actor.organizationId, projectId: input.projectId, materialId: input.materialId, warehouseId: input.warehouseId || null, supplierId: input.supplierId || null, number, localRef: input.localRef ?? null, quantity: String(input.quantity), unitPrice: String(input.unitPrice), dueAt: input.dueAt || null, note: input.note, status: 'requested', ...factFields(ctx) }).returning();
    const [approval] = await tx.insert(approvals).values({ organizationId: ctx.actor.organizationId, entityType: 'purchase', entityId: row.id, assignedRole: 'director' }).returning({ id: approvals.id });
    changed(ctx, 'purchases', row.id, row.projectId);
    changed(ctx, 'approvals', approval.id, row.projectId);
    await audit(tx, ctx, 'create', 'purchase', row.id, null, row);
    return row;
  },
});
