import { eq, sql } from 'drizzle-orm';
import { syncState } from '@/client/db/schema';
import type { Db } from '@/server/db/types';
import { AGENT_CHANNEL } from './forward';
import { localMarks, openOutbox, outboxCounts, type OutboxItem } from '@/client/offline/read';

// Состояние синхронизации для индикатора в шапке десктопа (§6.6 п. 4).
// queued/conflict/rejected — счётчики очереди; pendingIds/conflictIds — строки с пометкой «не синхронизировано» / «спорно».
export type SyncStatus = {
  status: string; lastPullAt: string | null; lastPushAt: string | null; lastError: string | null; offlineScope: string[] | null; effectiveScope: string[]; serverUrl: string;
  queued: number; conflict: number; rejected: number; pendingIds: string[]; conflictIds: string[]; outbox: OutboxItem[];
};

export async function localSyncStatus(db: Db): Promise<SyncStatus | null> {
  const [st] = await db.select().from(syncState).where(eq(syncState.id, 1));
  if (!st) return null;
  const [counts, marks, items] = await Promise.all([outboxCounts(db), localMarks(db), openOutbox(db)]);
  return {
    status: st.snapshotRequired ? 'loading' : st.status, lastPullAt: st.lastPullAt?.toISOString() ?? null, lastPushAt: st.lastPushAt?.toISOString() ?? null,
    lastError: st.lastError, offlineScope: st.offlineScope ?? null, effectiveScope: st.effectiveScope, serverUrl: st.serverUrl,
    ...counts, pendingIds: marks.pending, conflictIds: marks.conflict, outbox: items,
  };
}

// «Доступно офлайн»: сохранить выбор и разбудить sync-agent — он загрузит набор заново (§10).
export async function setOfflineScope(db: Db, projects: string[] | null) {
  await db.update(syncState).set({ offlineScope: projects, snapshotRequired: true, updatedAt: new Date() }).where(eq(syncState.id, 1));
  await db.execute(sql`select pg_notify(${AGENT_CHANNEL}, 'snapshot')`);
}

// Объект, созданный в этом десктопе, всегда попадает в набор «Доступно офлайн» (иначе его не видно на ноутбуке).
// Набор по умолчанию у не-директора и так включает все доступные объекты — менять ничего не нужно;
// явный список и пустой набор директора дополняются этим объектом и загружаются заново. true — набор изменён.
export async function includeCreatedProject(db: Db, projectId: string, orgWide: boolean): Promise<boolean> {
  const [st] = await db.select({ offlineScope: syncState.offlineScope }).from(syncState).where(eq(syncState.id, 1));
  if (!st) return false;
  const current = st.offlineScope ?? (orgWide ? [] : null);
  if (current === null || current.includes(projectId)) return false;
  await setOfflineScope(db, [...current, projectId]);
  return true;
}

// Дождаться, пока объект окажется в реплике (после повторной загрузки агентом).
export async function waitForProject(db: Db, projectId: string, waitMs: number) {
  const until = Date.now() + waitMs;
  for (;;) {
    const [st] = await db.select({ effectiveScope: syncState.effectiveScope, snapshotRequired: syncState.snapshotRequired }).from(syncState).where(eq(syncState.id, 1));
    if (st && !st.snapshotRequired && st.effectiveScope.includes(projectId)) return true;
    if (Date.now() > until) return false;
    await new Promise(r => setTimeout(r, 200));
  }
}
