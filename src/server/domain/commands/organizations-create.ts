import { z } from 'zod';
import { organizations } from '@/db/schema';
import { defineCommand } from '../command';
import { audit } from '../context';
import { WRITE_ROLES } from '../authz';
import { businessRule } from '../errors';

export default defineCommand({
  name: 'organizations.create', offline: 'online_only', roles: WRITE_ROLES,
  schema: z.object({ name: z.string().min(2), inn: z.string().optional() }),
  async authorize(_tx, ctx) { if (ctx.actor.role !== 'super_admin') throw businessRule('Недостаточно прав'); },
  async execute(tx, ctx, input) {
    const [row] = await tx.insert(organizations).values({ name: input.name, inn: input.inn }).returning();
    await audit(tx, ctx, 'create', 'organization', row.id, null, row);
    return row;
  },
});
