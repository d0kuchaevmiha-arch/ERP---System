import { eq, sql } from 'drizzle-orm';
import { syncState } from '@/client/db/schema';
import type { Db } from '@/server/db/types';
import { AGENT_CHANNEL } from './forward';

// Состояние синхронизации для индикатора в шапке десктопа (§6.6 п. 4).
export type SyncStatus = { status: string; lastPullAt: string | null; lastError: string | null; offlineScope: string[] | null; effectiveScope: string[]; serverUrl: string };

export async function localSyncStatus(db: Db): Promise<SyncStatus | null> {
  const [st] = await db.select().from(syncState).where(eq(syncState.id, 1));
  if (!st) return null;
  return { status: st.snapshotRequired ? 'loading' : st.status, lastPullAt: st.lastPullAt?.toISOString() ?? null, lastError: st.lastError, offlineScope: st.offlineScope ?? null, effectiveScope: st.effectiveScope, serverUrl: st.serverUrl };
}

// «Доступно офлайн»: сохранить выбор и разбудить sync-agent — он загрузит набор заново (§10).
export async function setOfflineScope(db: Db, projects: string[] | null) {
  await db.update(syncState).set({ offlineScope: projects, snapshotRequired: true, updatedAt: new Date() }).where(eq(syncState.id, 1));
  await db.execute(sql`select pg_notify(${AGENT_CHANNEL}, 'snapshot')`);
}
