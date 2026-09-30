import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { syncConflicts } from '@/db/schema';
import { defineCommand } from '../command';
import { audit, changed } from '../context';
import { RESOLVE_ROLES } from '../authz';
import { openConflict, settleOp } from '../conflicts';
import { uuid } from '../schemas';
import { bump } from '../versions';

// «Отклонить» спорную офлайн-операцию: обязательный комментарий — автор увидит его в «Не принято сервером».
export default defineCommand({
  name: 'conflicts.discard', offline: 'online_only', roles: RESOLVE_ROLES, deniedMessage: 'Разбирать конфликты может кладовщик, РП, снабженец или директор',
  schema: z.object({ conflictId: uuid, comment: z.string().trim().min(3, 'Укажите причину').max(500) }),
  authorize: (tx, ctx, input) => openConflict(tx, ctx, input.conflictId),
  async execute(tx, ctx, input, c) {
    const [row] = await tx.update(syncConflicts).set({ status: 'discarded', resolvedBy: ctx.actor.id, resolvedAt: new Date(), resolution: { comment: input.comment }, ...bump(syncConflicts.version) }).where(eq(syncConflicts.id, c.id)).returning();
    await settleOp(tx, c.opId, 'rejected', { code: 'conflict_discarded', message: `Отклонено при разборе: ${input.comment}` });
    await audit(tx, ctx, 'conflict_discard', 'sync_conflict', c.id, c, row);
    changed(ctx, 'sync_conflicts', c.id, c.projectId);
    return row;
  },
});
