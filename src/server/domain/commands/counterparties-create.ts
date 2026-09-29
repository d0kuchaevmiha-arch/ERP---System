import { z } from 'zod';
import { counterparties } from '@/db/schema';
import { defineCommand } from '../command';
import { audit } from '../context';
import { WRITE_ROLES } from '../authz';

export default defineCommand({
  name: 'counterparties.create', offline: 'online_only', roles: WRITE_ROLES,
  schema: z.object({ name: z.string().min(2), inn: z.string().optional(), contact: z.string().optional(), kind: z.enum(['supplier', 'customer', 'contractor']).default('supplier') }),
  async authorize() {},
  async execute(tx, ctx, input) {
    const [row] = await tx.insert(counterparties).values({ organizationId: ctx.actor.organizationId, name: input.name, kind: input.kind, inn: input.inn, contact: input.contact }).returning();
    await audit(tx, ctx, 'create', 'counterparty', row.id, null, row);
    return row;
  },
});
