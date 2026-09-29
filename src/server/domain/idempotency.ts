import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { syncOps } from '@/db/schema';
import type { Db, Tx } from '@/server/db/types';
import type { CommandContext } from './context';
import { DomainError, invalid } from './errors';

// Идемпотентность по ключу операции (HTTP Idempotency-Key, op_id sync push в P4): результат хранится в sync_ops.
// Пример из жизни: кнопку «Оплатить» нажали дважды — списание одно, второй раз показывается тот же чек.

type Op = typeof syncOps.$inferSelect;

// Сигнал «ключ уже занят параллельным запросом»: транзакция откатывается, отвечаем сохранённым результатом.
export class OpTaken extends Error {}

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map(k => [k, stable((v as Record<string, unknown>)[k])]));
  return v;
}
export const payloadHash = (command: string, raw: unknown) => createHash('sha256').update(command + '\n' + JSON.stringify(stable(raw) ?? null)).digest('hex');

export async function findOp(db: Db, opId: string) {
  const [op] = await db.select().from(syncOps).where(eq(syncOps.opId, opId));
  return op;
}

// Повтор ключа: только тот же пользователь, та же команда, те же данные — иначе это ошибка клиента.
export function replay(op: Op, ctx: CommandContext, command: string, hash: string): unknown {
  if (op.userId !== ctx.actor.id || op.command !== command || op.payloadHash !== hash) throw invalid('Ключ операции уже использован для другой операции');
  if (op.status === 'applied') return op.result;
  const stored = (op.result ?? {}) as { message?: string; code?: string };
  throw new DomainError(stored.message ?? 'Операция отклонена', op.httpStatus as DomainError['status'], stored.code ?? 'rejected');
}

// Первая запись в транзакции команды: занимает ключ. Параллельный запрос с тем же ключом ждёт commit и получает OpTaken.
export async function claimOp(tx: Tx, ctx: CommandContext, command: string, hash: string) {
  const rows = await tx.insert(syncOps).values({ opId: ctx.prov.opId!, deviceId: ctx.prov.deviceId, userId: ctx.actor.id, command, payloadHash: hash, status: 'applied', httpStatus: 201, deviceCreatedAt: ctx.prov.deviceCreatedAt })
    .onConflictDoNothing().returning({ opId: syncOps.opId });
  if (!rows.length) throw new OpTaken();
}
export async function storeResult(tx: Tx, opId: string, result: unknown) {
  await tx.update(syncOps).set({ result: JSON.parse(JSON.stringify(result ?? null)) }).where(eq(syncOps.opId, opId));
}
// Отказ сохраняется отдельной записью (транзакция команды уже откатилась); false — ключ успел занять параллельный запрос.
export async function storeRejection(db: Db, ctx: CommandContext, command: string, hash: string, e: DomainError) {
  const rows = await db.insert(syncOps).values({ opId: ctx.prov.opId!, deviceId: ctx.prov.deviceId, userId: ctx.actor.id, command, payloadHash: hash, status: 'rejected', httpStatus: e.status, result: { message: e.message, code: e.code }, deviceCreatedAt: ctx.prov.deviceCreatedAt })
    .onConflictDoNothing().returning({ opId: syncOps.opId });
  return rows.length > 0;
}
