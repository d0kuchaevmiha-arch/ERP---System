import { eq, sql } from 'drizzle-orm';
import { syncState } from '@/client/db/schema';
import type { Db } from '@/server/db/types';
import { CHANGES_CHANNEL } from '@/server/domain/changes';
import { SYNC_ENTITY_NAMES } from '@/server/sync/entities';
import { clearReplica, deleteRows, purgeOutsideScope, replicaSession, upsertRows } from './apply';
import { pushPending, reapplyActive, refreshBefore, settleConflicts } from './outbox-sync';
import { isGone, isOutdated, isRevoked, type SyncTransport } from './transport';

// Sync-agent десктопа (§6.6): отправка очереди (push), первичная загрузка, затем pull до конца, применение к реплике,
// локальный сигнал интерфейсу. Пример из жизни: курьер, который приносит в филиал копии всех новых документов.

export type SyncState = typeof syncState.$inferSelect;
export type Progress = { phase: 'snapshot' | 'pull'; entity?: string; rows: number };

export class SyncAgent {
  constructor(private readonly opts: { db: Db; transport: SyncTransport; log?: (m: string) => void; onProgress?: (p: Progress) => void }) {}

  async state() {
    const [st] = await this.opts.db.select().from(syncState).where(eq(syncState.id, 1));
    if (!st) throw new Error('Устройство не зарегистрировано: нет sync_state');
    return st;
  }

  // Один проход: push очереди, при необходимости snapshot, затем pull до hasMore=false. Возвращает число применённых изменений.
  async syncOnce(retried = false): Promise<number> {
    try {
      let st = await this.state();
      if (!retried) await pushPending(this.opts.db, this.opts.transport, () => notifyLocal(this.opts.db, st.organizationId, st.lastSeq));
      if (st.snapshotRequired) { await this.fullSnapshot(st); st = await this.state(); }
      let applied = 0;
      for (;;) {
        const r = await this.opts.transport.pull(st.lastSeq, st.offlineScope ?? null);
        // Новые объекты в наборе (выбраны или выдан доступ): их прошлых строк в журнале нет — загружаем заново.
        if (r.scope.some(id => !st.effectiveScope.includes(id))) { await this.fullSnapshot(st); st = await this.state(); continue; }
        applied += r.changes.length;
        await this.opts.db.transaction(async tx => {
          await replicaSession(tx);
          for (const c of r.changes) {
            if (c.op === 'delete') await deleteRows(tx, c.entity, [c.id]);
            else { await upsertRows(tx, c.entity, [c.row!]); await refreshBefore(tx, c.entity, c.row!); }
          }
          await settleConflicts(tx);
          if (r.scope.length < st.effectiveScope.length) await purgeOutsideScope(tx, r.scope);
          const self = r.changes.find(c => c.entity === 'users' && c.id === st.userId && c.row);
          const roleChanged = self && (self.row as { role: string }).role !== st.userRole;
          await tx.update(syncState).set({ lastSeq: r.nextSeq, effectiveScope: r.scope, lastPullAt: new Date(), status: 'ok', lastError: null, snapshotRequired: Boolean(roleChanged), updatedAt: new Date() }).where(eq(syncState.id, 1));
          if (r.changes.length || r.scope.length < st.effectiveScope.length) await notifyLocal(tx, st.organizationId, r.nextSeq);
        });
        st = await this.state();
        this.opts.onProgress?.({ phase: 'pull', rows: applied });
        if (st.snapshotRequired) { await this.fullSnapshot(st); st = await this.state(); continue; }
        if (!r.hasMore) return applied;
      }
    } catch (e) {
      // 410 — журнал на сервере очищен дальше, чем отстал клиент: одна повторная загрузка, без зацикливания.
      if (isGone(e) && !retried) { await this.setState({ snapshotRequired: true }); return this.syncOnce(true); }
      await this.setState({ status: isRevoked(e) ? 'revoked' : isOutdated(e) ? 'outdated' : 'offline', lastError: (e as Error).message });
      throw e;
    }
  }

  // Первичная (или повторная) загрузка всех сущностей в одной транзакции: интерфейс не видит полупустую реплику.
  async fullSnapshot(st: SyncState) {
    const pages: { entity: string; rows: Record<string, unknown>[] }[] = [];
    let seq = Number.MAX_SAFE_INTEGER; let scope: string[] = [];
    let total = 0;
    for (const entity of SYNC_ENTITY_NAMES) {
      let cursor: string | null = null;
      do {
        const page = await this.opts.transport.snapshot(entity, st.offlineScope ?? null, cursor);
        if (!cursor) { seq = Math.min(seq, page.snapshotSeq); scope = page.scope; }
        pages.push({ entity, rows: page.rows });
        total += page.rows.length;
        this.opts.onProgress?.({ phase: 'snapshot', entity, rows: total });
        cursor = page.nextCursor;
      } while (cursor);
    }
    await this.opts.db.transaction(async tx => {
      await replicaSession(tx);
      await clearReplica(tx);
      for (const p of pages) await upsertRows(tx, p.entity, p.rows);
      await reapplyActive(tx, st.userId, st.deviceId, this.opts.log);
      await settleConflicts(tx);
      const self = pages.find(p => p.entity === 'users')?.rows.find(r => r.id === st.userId) as { role?: string } | undefined;
      await tx.update(syncState).set({ lastSeq: seq, effectiveScope: scope, snapshotRequired: false, userRole: self?.role ?? st.userRole, lastPullAt: new Date(), status: 'ok', lastError: null, updatedAt: new Date() }).where(eq(syncState.id, 1));
      await notifyLocal(tx, st.organizationId, seq);
    });
    this.opts.log?.(`snapshot: ${total} строк, seq ${seq}`);
  }

  // Выбор «Доступно офлайн» (null — набор по умолчанию): следующая синхронизация загрузит данные заново.
  async setOfflineScope(projectIds: string[] | null) {
    await this.setState({ offlineScope: projectIds, snapshotRequired: true });
  }

  private async setState(patch: Partial<SyncState>) {
    await this.opts.db.update(syncState).set({ ...patch, updatedAt: new Date() }).where(eq(syncState.id, 1));
  }
}

// Сигнал локальному хабу (тот же канал, что на сервере): интерфейс десктопа перечитает данные из реплики.
async function notifyLocal(tx: { execute: Db['execute'] }, org: string, maxSeq: number) {
  await tx.execute(sql`select pg_notify(${CHANGES_CHANNEL}, ${JSON.stringify({ org, projectIds: [], orgWide: true, maxSeq })})`);
}

// Начальное состояние после регистрации устройства.
export async function initSyncState(db: Db, v: { serverUrl: string; deviceId: string; userId: string; organizationId: string; userRole: string }) {
  await db.insert(syncState).values({ id: 1, ...v, snapshotRequired: true })
    .onConflictDoUpdate({ target: syncState.id, set: { ...v, lastSeq: 0, snapshotRequired: true, effectiveScope: [], status: 'ok', lastError: null, updatedAt: new Date() } });
}
