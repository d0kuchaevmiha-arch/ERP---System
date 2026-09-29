import { sql } from 'drizzle-orm';
import { changeLog } from '@/db/schema';
import type { Tx } from '@/server/db/types';

export const CHANGES_CHANNEL = 'erp_changes';

// Сущность журнала — имя таблицы (так её будет запрашивать pull в P3).
export type Change = { entity: string; entityId: string; projectId: string | null; op?: 'upsert' | 'delete' };
// Сигнал после commit: только «что-то изменилось здесь», без данных (§6.5). orgWide — изменения без объекта (справочники, люди, доступы).
export type ChangeSignal = { org: string; projectIds: string[]; orgWide: boolean; maxSeq: number };

// Пишет накопленные командой изменения в change_log и ставит NOTIFY в ту же транзакцию:
// PostgreSQL доставит уведомление только после commit, при откате — никогда.
export async function flushChanges(tx: Tx, organizationId: string, changes: Change[]) {
  if (!changes.length) return null;
  const rows = await tx.insert(changeLog)
    .values(changes.map(c => ({ organizationId, projectId: c.projectId, entity: c.entity, entityId: c.entityId, op: c.op ?? 'upsert' })))
    .returning({ seq: changeLog.seq });
  const signal: ChangeSignal = {
    org: organizationId,
    projectIds: [...new Set(changes.map(c => c.projectId).filter((p): p is string => Boolean(p)))],
    orgWide: changes.some(c => !c.projectId),
    maxSeq: Math.max(...rows.map(r => r.seq)),
  };
  await tx.execute(sql`select pg_notify(${CHANGES_CHANNEL}, ${JSON.stringify(signal)})`);
  return signal;
}
