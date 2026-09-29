import { z } from 'zod';
import { budgetLines } from '@/db/schema';
import { defineCommand } from '../command';
import { audit } from '../context';
import { WRITE_ROLES, requireProjectWrite } from '../authz';
import { amount, uuid } from '../schemas';

export default defineCommand({
  name: 'budgets.create', offline: 'online_only', roles: WRITE_ROLES,
  schema: z.object({ projectId: uuid, category: z.string().min(2), amount, taskId: uuid.optional(), period: z.string().optional() }),
  authorize: (tx, ctx, input) => requireProjectWrite(tx, ctx.actor, input.projectId),
  async execute(tx, ctx, input) {
    const [row] = await tx.insert(budgetLines).values({ projectId: input.projectId, category: input.category, amount: String(input.amount), taskId: input.taskId || null, period: input.period || null }).returning();
    await audit(tx, ctx, 'create', 'budget', row.id, null, row);
    return row;
  },
});
