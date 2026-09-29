import { z } from 'zod';
import { tasks } from '@/db/schema';
import { defineCommand } from '../command';
import { audit } from '../context';
import { WRITE_ROLES, requireProjectWrite, requireTaskOfProject } from '../authz';
import { amount, uuid } from '../schemas';

export default defineCommand({
  name: 'tasks.create', offline: 'online_only', roles: WRITE_ROLES,
  schema: z.object({ projectId: uuid, name: z.string().min(2), kind: z.enum(['stage', 'section', 'work', 'subtask']).default('work'), parentId: uuid.optional(), startDate: z.string().optional(), endDate: z.string().optional(), plannedCost: amount.optional(), unit: z.string().optional() }),
  async authorize(tx, ctx, input) {
    const project = await requireProjectWrite(tx, ctx.actor, input.projectId);
    await requireTaskOfProject(tx, ctx.actor, input.parentId, project.id);
  },
  async execute(tx, ctx, input) {
    const [row] = await tx.insert(tasks).values({ projectId: input.projectId, name: input.name, kind: input.kind, parentId: input.parentId || null, startDate: input.startDate || null, endDate: input.endDate || null, plannedCost: String(input.plannedCost || 0), unit: input.unit || 'шт' }).returning();
    await audit(tx, ctx, 'create', 'task', row.id, null, row);
    return row;
  },
});
