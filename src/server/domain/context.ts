import { auditLogs } from '@/db/schema';
import type { SessionUser } from '@/server/auth/session';
import type { Db, Tx } from '@/server/db/types';

export type Actor = SessionUser;

// Происхождение операции (§4.1, §7): откуда и когда пришла. HTTP — online, время устройства = время сервера;
// sync push (P4) передаст offline, устройство и время ввода на ноутбуке.
export type Provenance = {
  origin: 'online' | 'offline';
  deviceId: string | null;
  deviceCreatedAt: Date;
  serverReceivedAt: Date;
  opId: string | null;
};

export type CommandContext = { db: Db; actor: Actor; ip: string | null; userAgent: string | null; prov: Provenance };
// То, что передаёт вызывающий: происхождение необязательно, недостающее заполняет сервер.
export type CommandRequest = Omit<CommandContext, 'prov'> & { prov?: Partial<Omit<Provenance, 'serverReceivedAt'>> };

export function resolveContext(req: CommandRequest, now = new Date()): CommandContext {
  const p = req.prov ?? {};
  return {
    ...req,
    prov: { origin: p.origin ?? 'online', deviceId: p.deviceId ?? null, deviceCreatedAt: p.deviceCreatedAt ?? now, serverReceivedAt: now, opId: p.opId ?? null },
  };
}

// Поля происхождения для строки-факта (expenses, stock_movements, purchases, task_progress_log).
export const factFields = (ctx: CommandContext) => ({ ...ctx.prov });

export function audit(tx: Tx, ctx: CommandContext, action: string, entityType: string, entityId: string, before: unknown, after: unknown) {
  return tx.insert(auditLogs).values({ organizationId: ctx.actor.organizationId, actorId: ctx.actor.id, action, entityType, entityId, before, after, ip: ctx.ip, userAgent: ctx.userAgent, origin: ctx.prov.origin, deviceId: ctx.prov.deviceId, deviceCreatedAt: ctx.prov.deviceCreatedAt });
}
