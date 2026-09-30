import { asc, eq, ne } from 'drizzle-orm';
import { outbox, syncState } from '@/client/db/schema';
import type { Db } from '@/server/db/types';

// Экспорт очереди в файл (§8): всё, что ещё не принято сервером (в очереди, спорное, отклонённое — в том числе скрытое).
// Нужен, если устройство отозвано или сервер недоступен долго: данные можно передать администратору.
// В файле нет токена устройства, паролей и верификатора — только введённые данные и их состояние.
export const EXPORT_FORMAT = 'erp-energotech-outbox';

export async function exportOutbox(db: Db, now = new Date()) {
  const [st] = await db.select().from(syncState).where(eq(syncState.id, 1));
  const rows = await db.select().from(outbox).where(ne(outbox.status, 'applied')).orderBy(asc(outbox.seq));
  return {
    format: EXPORT_FORMAT, version: 1, exportedAt: now.toISOString(),
    device: st ? { deviceId: st.deviceId, userId: st.userId, organizationId: st.organizationId, serverUrl: st.serverUrl } : null,
    ops: rows.map(o => ({
      opId: o.opId, seq: o.seq, command: o.command, payload: o.payload, status: o.status, errorCode: o.errorCode, error: o.error,
      conflictId: o.conflictId, dependsOn: o.dependsOn, deviceCreatedAt: o.deviceCreatedAt.toISOString(), settledAt: o.settledAt?.toISOString() ?? null,
    })),
  };
}

export const exportFileName = (now = new Date()) => `ERP-очередь-${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
