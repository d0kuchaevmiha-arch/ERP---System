import { db } from '@/db';
import type { SessionUser } from '@/server/auth/session';
import { getOverviewFor } from '@/server/read/overview';
import { isClientMode } from '@/client/local/session';
import { localSyncStatus, type SyncStatus } from '@/client/local/status';
import { listConflicts, type ConflictItem } from '@/server/read/conflicts';

export type Overview = Awaited<ReturnType<typeof getOverviewFor>> & { sync: SyncStatus | null; conflicts: ConflictItem[] };

// Сводка для вошедшего пользователя; анонимному данные не отдаются (§5.2.1–5.2.2).
// В десктопе — из локальной реплики плюс состояние синхронизации для индикатора.
// «Требует решения» — одним правилом и на сервере, и по реплике (там конфликты уже отфильтрованы сервером).
export async function getOverview(user: SessionUser): Promise<Overview> {
  const data = await getOverviewFor(db, user);
  const [sync, conflicts] = await Promise.all([isClientMode() ? localSyncStatus(db) : null, listConflicts(db, user)]);
  return { ...data, sync, conflicts };
}
