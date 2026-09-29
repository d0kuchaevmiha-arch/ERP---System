import { z } from 'zod';
import { budgetLines } from '@/db/schema';
import { defineCommand } from '../command';
import { audit, changed } from '../context';
import { WRITE_ROLES, requireProjectWrite, requireTaskOfProject } from '../authz';
import { amount, uuid } from '../schemas';

export default defineCommand({
  name: 'budgets.create', offline: 'online_only', roles: WRITE_ROLES,
  schema: z.object({ projectId: uuid, category: z.string().min(2), amount, taskId: uuid.optional(), period: z.string().optional() }),
  async authorize(tx, ctx, input) {
    const project = await requireProjectWrite(tx, ctx.actor, input.projectId);
    await requireTaskOfProject(tx, ctx.actor, input.taskId, project.id);
  },
  async execute(tx, ctx, input) {
    const [row] = await tx.insert(budgetLines).values({ projectId: input.projectId, category: input.category, amount: String(input.amount), taskId: input.taskId || null, period: input.period || null }).returning();
    await audit(tx, ctx, 'create', 'budget', row.id, null, row);
    changed(ctx, 'budget_lines', row.id, row.projectId);
    return row;
  },
});
