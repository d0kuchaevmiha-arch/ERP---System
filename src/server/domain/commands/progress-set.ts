import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { projects, tasks } from '@/db/schema';
import { defineCommand } from '../command';
import { audit } from '../context';
import { WRITE_ROLES } from '../authz';
import { businessRule } from '../errors';
import { uuid } from '../schemas';

export default defineCommand({
  name: 'progress.set', offline: 'allowed', roles: WRITE_ROLES,
  schema: z.object({ taskId: uuid, progress: z.coerce.number().int().min(0).max(100), actualQuantity: z.coerce.number().min(0).optional() }),
  async authorize(tx, ctx, input) {
    const [old] = await tx.select().from(tasks).where(eq(tasks.id, input.taskId));
    if (!old) throw businessRule('Работа не найдена');
    const [p] = await tx.select().from(projects).where(and(eq(projects.id, old.projectId), eq(projects.organizationId, ctx.actor.organizationId)));
    if (!p) throw businessRule('Нет доступа');
    return old;
  },
  async execute(tx, ctx, input, old) {
    const [row] = await tx.update(tasks).set({ progress: input.progress, actualQuantity: String(input.actualQuantity || old.actualQuantity), status: input.progress === 100 ? 'done' : 'active', actualEnd: input.progress === 100 ? new Date().toISOString().slice(0, 10) : null }).where(eq(tasks.id, old.id)).returning();
    await audit(tx, ctx, 'update', 'task', row.id, old, row);
    return row;
  },
});
