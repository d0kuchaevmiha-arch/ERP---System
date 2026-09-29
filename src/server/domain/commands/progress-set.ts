import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { taskProgressLog, tasks } from '@/db/schema';
import { defineCommand } from '../command';
import { audit, changed, factFields } from '../context';
import { WRITE_ROLES, orgTask, requireProjectWrite } from '../authz';
import { quantityOrZero, uuid } from '../schemas';
import { bump } from '../versions';

// Каждый факт выполнения — строка task_progress_log (кто, когда, откуда). Текущее значение работы — самый поздний
// по времени устройства факт (§5.1): офлайн-запись, пришедшая после более свежей, остаётся в истории и не откатывает прогресс.
export default defineCommand({
  name: 'progress.set', offline: 'allowed', roles: WRITE_ROLES,
  schema: z.object({ taskId: uuid, progress: z.coerce.number().int().min(0).max(100), actualQuantity: quantityOrZero.optional() }),
  async authorize(tx, ctx, input) {
    // FOR UPDATE: параллельные факты по одной работе применяются по очереди.
    const task = await orgTask(tx, ctx.actor, input.taskId, true);
    await requireProjectWrite(tx, ctx.actor, task.projectId);
    return task;
  },
  async execute(tx, ctx, input, old) {
    const reportedAt = ctx.prov.deviceCreatedAt;
    const applied = !old.progressReportedAt || reportedAt >= old.progressReportedAt;
    const [fact] = await tx.insert(taskProgressLog).values({
      taskId: old.id, projectId: old.projectId, authorId: ctx.actor.id, progress: input.progress,
      actualQuantity: input.actualQuantity === undefined ? null : String(input.actualQuantity), applied, ...factFields(ctx),
    }).returning();
    changed(ctx, 'task_progress_log', fact.id, old.projectId);
    if (!applied) {
      await audit(tx, ctx, 'progress_history', 'task', old.id, null, fact);
      return { ...old, applied, factId: fact.id };
    }
    const [row] = await tx.update(tasks).set({
      progress: input.progress, actualQuantity: String(input.actualQuantity ?? old.actualQuantity),
      status: input.progress === 100 ? 'done' : 'active', actualEnd: input.progress === 100 ? reportedAt.toISOString().slice(0, 10) : null,
      progressReportedAt: reportedAt, ...bump(tasks.version),
    }).where(eq(tasks.id, old.id)).returning();
    await audit(tx, ctx, 'update', 'task', row.id, old, row);
    changed(ctx, 'tasks', row.id, row.projectId);
    return { ...row, applied, factId: fact.id };
  },
});
