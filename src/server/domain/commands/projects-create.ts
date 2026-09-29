import { z } from 'zod';
import { projects } from '@/db/schema';
import { defineCommand } from '../command';
import { audit } from '../context';
import { WRITE_ROLES } from '../authz';
import { amount } from '../schemas';

export default defineCommand({
  name: 'projects.create', offline: 'online_only', roles: WRITE_ROLES,
  schema: z.object({ name: z.string().min(2), code: z.string().min(2), address: z.string().optional(), contractValue: amount.optional(), forecast: amount.optional(), endDate: z.string().optional(), description: z.string().optional() }),
  async authorize() {},
  async execute(tx, ctx, input) {
    const [row] = await tx.insert(projects).values({ organizationId: ctx.actor.organizationId, code: input.code, name: input.name, address: input.address, description: input.description, contractValue: String(input.contractValue || 0), forecast: String(input.forecast || 0), endDate: input.endDate || null, status: 'active' }).returning();
    await audit(tx, ctx, 'create', 'project', row.id, null, row);
    return row;
  },
});
