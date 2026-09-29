import { auditLogs } from '@/db/schema';
import type { SessionUser } from '@/server/auth/session';
import type { Db, Tx } from '@/server/db/types';

export type Actor = SessionUser;
export type CommandContext = { db: Db; actor: Actor; ip: string | null; userAgent: string | null };

export function audit(tx: Tx, ctx: CommandContext, action: string, entityType: string, entityId: string, before: unknown, after: unknown) {
  return tx.insert(auditLogs).values({ organizationId: ctx.actor.organizationId, actorId: ctx.actor.id, action, entityType, entityId, before, after, ip: ctx.ip, userAgent: ctx.userAgent });
}
