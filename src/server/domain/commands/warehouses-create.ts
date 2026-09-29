import { z } from 'zod';
import { warehouses } from '@/db/schema';
import { defineCommand } from '../command';
import { audit } from '../context';
import { WRITE_ROLES, requireProjectWrite } from '../authz';
import { uuid } from '../schemas';

export default defineCommand({
  name: 'warehouses.create', offline: 'online_only', roles: WRITE_ROLES,
  schema: z.object({ name: z.string().min(2), projectId: uuid.optional(), location: z.string().optional() }),
  async authorize(tx, ctx, input) { if (input.projectId) await requireProjectWrite(tx, ctx.actor, input.projectId); },
  async execute(tx, ctx, input) {
    const [row] = await tx.insert(warehouses).values({ organizationId: ctx.actor.organizationId, name: input.name, projectId: input.projectId || null, location: input.location }).returning();
    await audit(tx, ctx, 'create', 'warehouse', row.id, null, row);
    return row;
  },
});
