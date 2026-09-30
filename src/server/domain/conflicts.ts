import { and, eq } from 'drizzle-orm';
import { syncConflicts, syncOps, users } from '@/db/schema';
import type { Tx } from '@/server/db/types';
import type { CommandContext } from './context';
import { CONFLICT_RESOLVERS, requireProjectWrite } from './authz';
import { DomainError, forbidden, notFound } from './errors';

const statusLabel: Record<string, string> = { resolved: 'проведено', discarded: 'отклонено' };

// Открытый конфликт своей организации, который этот пользователь вправе разобрать. FOR UPDATE: два разбора
// одного конфликта идут по очереди, второй получает 409 «уже решено ‹кем›».
export async function openConflict(tx: Tx, ctx: CommandContext, conflictId: string) {
  const [c] = await tx.select().from(syncConflicts).where(and(eq(syncConflicts.id, conflictId), eq(syncConflicts.organizationId, ctx.actor.organizationId))).for('update');
  if (!c) throw notFound('Конфликт не найден');
  if (c.status !== 'open') {
    const [by] = c.resolvedBy ? await tx.select({ name: users.name }).from(users).where(eq(users.id, c.resolvedBy)) : [];
    throw new DomainError(`Уже решено: ${statusLabel[c.status] ?? c.status}${by ? ` — ${by.name}` : ''}`, 409, 'conflict');
  }
  if (!CONFLICT_RESOLVERS[c.kind]?.includes(ctx.actor.role)) throw forbidden('Этот конфликт разбирает другая роль');
  if (c.projectId) await requireProjectWrite(tx, ctx.actor, c.projectId);
  return c;
}

// Итог разбора сохраняется как ответ на исходную офлайн-операцию (sync_ops): повтор push вернёт его же.
export async function settleOp(tx: Tx, opId: string, status: 'applied' | 'rejected', result: unknown) {
  await tx.update(syncOps).set({ status, httpStatus: status === 'applied' ? 201 : 422, result: JSON.parse(JSON.stringify(result ?? null)) }).where(eq(syncOps.opId, opId));
}
