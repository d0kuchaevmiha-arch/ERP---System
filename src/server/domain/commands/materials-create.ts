import { z } from 'zod';
import { materials } from '@/db/schema';
import { defineCommand } from '../command';
import { audit, changed } from '../context';
import { WRITE_ROLES } from '../authz';
import { price } from '../schemas';

export default defineCommand({
  name: 'materials.create', offline: 'online_only', roles: WRITE_ROLES,
  schema: z.object({ name: z.string().min(2), sku: z.string().min(2), unit: z.string().min(1), category: z.string().optional(), minStock: z.coerce.number().min(0).optional(), price: price.optional() }),
  async authorize() {},
  async execute(tx, ctx, input) {
    const [row] = await tx.insert(materials).values({ organizationId: ctx.actor.organizationId, name: input.name, sku: input.sku, unit: input.unit, category: input.category, minStock: String(input.minStock || 0), price: String(input.price || 0) }).returning();
    await audit(tx, ctx, 'create', 'material', row.id, null, row);
    changed(ctx, 'materials', row.id, null);
    return row;
  },
});
