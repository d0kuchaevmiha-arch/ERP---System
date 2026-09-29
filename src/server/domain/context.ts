import { auditLogs } from '@/db/schema';
import type { SessionUser } from '@/server/auth/session';
import type { Db, Tx } from '@/server/db/types';
import type { Change } from './changes';

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

// changes — что изменила команда; runCommand пишет их в change_log в конце транзакции (§4.2).
// meta — куда runCommand кладёт номер журнала изменений после commit (клиент ждёт, пока реплика его догонит).
export type CommandContext = { db: Db; actor: Actor; ip: string | null; userAgent: string | null; prov: Provenance; changes: Change[]; meta?: { maxSeq?: number } };
// То, что передаёт вызывающий: происхождение необязательно, недостающее заполняет сервер.
export type CommandRequest = Omit<CommandContext, 'prov' | 'changes'> & { prov?: Partial<Omit<Provenance, 'serverReceivedAt'>> };

export function resolveContext(req: CommandRequest, now = new Date()): CommandContext {
  const p = req.prov ?? {};
  return {
    ...req,
    prov: { origin: p.origin ?? 'online', deviceId: p.deviceId ?? null, deviceCreatedAt: p.deviceCreatedAt ?? now, serverReceivedAt: now, opId: p.opId ?? null },
    changes: [],
  };
}

// Отметить изменённую строку: entity — имя таблицы, projectId — объект (null — изменение уровня организации).
export function changed(ctx: CommandContext, entity: string, entityId: string, projectId: string | null, op: Change['op'] = 'upsert') {
  ctx.changes.push({ entity, entityId, projectId, op });
}

// Поля происхождения для строки-факта (expenses, stock_movements, purchases, task_progress_log).
export const factFields = (ctx: CommandContext) => ({ ...ctx.prov });

export function audit(tx: Tx, ctx: CommandContext, action: string, entityType: string, entityId: string, before: unknown, after: unknown) {
  return tx.insert(auditLogs).values({ organizationId: ctx.actor.organizationId, actorId: ctx.actor.id, action, entityType, entityId, before, after, ip: ctx.ip, userAgent: ctx.userAgent, origin: ctx.prov.origin, deviceId: ctx.prov.deviceId, deviceCreatedAt: ctx.prov.deviceCreatedAt });
}
