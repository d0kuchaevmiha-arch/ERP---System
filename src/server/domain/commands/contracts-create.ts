import { z } from 'zod';
import { contracts } from '@/db/schema';
import { defineCommand } from '../command';
import { audit } from '../context';
import { WRITE_ROLES, requireProjectWrite } from '../authz';
import { amount, uuid } from '../schemas';

export default defineCommand({
  name: 'contracts.create', offline: 'online_only', roles: WRITE_ROLES,
  schema: z.object({ number: z.string().min(2), projectId: uuid.optional(), counterpartyId: uuid, kind: z.string().min(2), amount, signedAt: z.string().optional() }),
  async authorize(tx, ctx, input) { if (input.projectId) await requireProjectWrite(tx, ctx.actor, input.projectId); },
  async execute(tx, ctx, input) {
    const [row] = await tx.insert(contracts).values({ organizationId: ctx.actor.organizationId, number: input.number, projectId: input.projectId || null, counterpartyId: input.counterpartyId, kind: input.kind, amount: String(input.amount), signedAt: input.signedAt || null }).returning();
    await audit(tx, ctx, 'create', 'contract', row.id, null, row);
    return row;
  },
});
