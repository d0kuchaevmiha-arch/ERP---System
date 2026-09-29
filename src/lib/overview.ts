import { db } from '@/db';
import type { SessionUser } from '@/server/auth/session';
import { getOverviewFor } from '@/server/read/overview';
import { isClientMode } from '@/client/local/session';
import { localSyncStatus, type SyncStatus } from '@/client/local/status';

export type Overview = Awaited<ReturnType<typeof getOverviewFor>> & { sync: SyncStatus | null };

// Сводка для вошедшего пользователя; анонимному данные не отдаются (§5.2.1–5.2.2).
// В десктопе — из локальной реплики плюс состояние синхронизации для индикатора.
export async function getOverview(user: SessionUser): Promise<Overview> {
  const data = await getOverviewFor(db, user);
  return { ...data, sync: isClientMode() ? await localSyncStatus(db) : null };
}
