import { asc, eq, inArray } from 'drizzle-orm';
import { localRows, outbox } from '@/client/db/schema';
import type { Db } from '@/server/db/types';

// Чтение очереди для интерфейса и экспорта (§6.6 п. 4, §8).
export type OutboxItem = {
  opId: string; command: string; payload: unknown; status: 'pending' | 'sending' | 'applied' | 'rejected' | 'conflict';
  entityId: string | null; errorCode: string | null; error: string | null; conflictId: string | null; deviceCreatedAt: string;
  settledAt: string | null; hidden: boolean;
};
export type LocalMarks = { pending: string[]; conflict: string[] };

export async function listOutbox(db: Db): Promise<OutboxItem[]> {
  const rows = await db.select().from(outbox).orderBy(asc(outbox.seq));
  return rows.map(r => ({
    opId: r.opId, command: r.command, payload: r.payload, status: r.status as OutboxItem['status'], entityId: r.entityId,
    errorCode: r.errorCode, error: r.error, conflictId: r.conflictId, deviceCreatedAt: r.deviceCreatedAt.toISOString(),
    settledAt: r.settledAt?.toISOString() ?? null, hidden: r.hidden,
  }));
}

// Id строк реплики, которые ещё не приняты сервером («не синхронизировано») или спорны («требует решения»).
export async function localMarks(db: Db): Promise<LocalMarks> {
  const rows = await db.select({ entityId: localRows.entityId, status: outbox.status }).from(localRows)
    .innerJoin(outbox, eq(outbox.opId, localRows.opId)).where(inArray(outbox.status, ['pending', 'sending', 'conflict']));
  const pick = (f: (s: string) => boolean) => [...new Set(rows.filter(r => f(r.status)).map(r => r.entityId))];
  return { pending: pick(s => s !== 'conflict'), conflict: pick(s => s === 'conflict') };
}

// Счётчики для индикатора в шапке.
export async function outboxCounts(db: Db) {
  const rows = await db.select({ status: outbox.status, hidden: outbox.hidden }).from(outbox).where(inArray(outbox.status, ['pending', 'sending', 'conflict', 'rejected']));
  return {
    queued: rows.filter(r => r.status === 'pending' || r.status === 'sending').length,
    conflict: rows.filter(r => r.status === 'conflict').length,
    rejected: rows.filter(r => r.status === 'rejected' && !r.hidden).length,
  };
}
