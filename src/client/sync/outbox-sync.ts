import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { syncConflicts, users } from '@/db/schema';
import { localRows, outbox, syncState } from '@/client/db/schema';
import type { Db, Tx } from '@/server/db/types';
import { PUSH_LIMIT, type PushResult } from '@/server/sync/push';
import { applyOptimistic, ACTIVE } from '@/client/offline/write';
import { deleteRows, upsertRows } from './apply';
import type { SyncTransport } from './transport';

// Отправка очереди и разбор ответов сервера (§6.6 п. 1). Пример из жизни: прораб отдаёт в офис стопку
// накладных; принятые офис подшивает, непринятые возвращает с резолюцией, спорные откладывает начальнику.

// Операции «в пути» после сбоя или закрытия приложения снова ждут отправки: повтор безопасен (op_id).
export async function recoverSending(db: Db) {
  await db.update(outbox).set({ status: 'pending' }).where(eq(outbox.status, 'sending'));
}

// Отправить все pending по порядку пакетами ≤ 200. Ошибка сети — операции снова pending, ошибка наверх.
export async function pushPending(db: Db, transport: SyncTransport, onSettled?: () => Promise<void>) {
  await recoverSending(db);
  let sent = 0;
  for (;;) {
    const batch = await db.select().from(outbox).where(eq(outbox.status, 'pending')).orderBy(asc(outbox.seq)).limit(PUSH_LIMIT);
    if (!batch.length) return sent;
    const ids = batch.map(o => o.opId);
    await db.update(outbox).set({ status: 'sending', attempts: sql`${outbox.attempts} + 1`, sentAt: new Date() }).where(inArray(outbox.opId, ids));
    let results: PushResult[];
    try {
      ({ results } = await transport.push(batch.map(o => ({ opId: o.opId, command: o.command, payload: o.payload, deviceCreatedAt: o.deviceCreatedAt.toISOString(), dependsOn: o.dependsOn }))));
    } catch (e) {
      await db.update(outbox).set({ status: 'pending' }).where(and(inArray(outbox.opId, ids), eq(outbox.status, 'sending')));
      throw e;
    }
    await db.transaction(async tx => {
      await tx.execute(sql`set local session_replication_role = replica`);
      for (const r of results) await settle(tx, r);
      // Ответа на операцию нет (сервер обработал не всё) — отправится в следующий раз.
      await tx.update(outbox).set({ status: 'pending' }).where(and(inArray(outbox.opId, ids), eq(outbox.status, 'sending')));
      await tx.update(syncState).set({ lastPushAt: new Date(), updatedAt: new Date() }).where(eq(syncState.id, 1));
    });
    sent += results.length;
    await onSettled?.();
    if (batch.length < PUSH_LIMIT) return sent;
  }
}

async function settle(tx: Tx, r: PushResult) {
  const now = new Date();
  if (r.status === 'applied') {
    // Серверная строка с тем же id заменит оптимистичную при pull.
    await tx.delete(localRows).where(eq(localRows.opId, r.opId));
    await tx.update(outbox).set({ status: 'applied', errorCode: null, error: null, settledAt: now }).where(eq(outbox.opId, r.opId));
  } else if (r.status === 'conflict') {
    await tx.update(outbox).set({ status: 'conflict', conflictId: r.conflictId ?? null, errorCode: r.error?.code ?? 'conflict', error: r.error?.message ?? 'Требует решения' }).where(eq(outbox.opId, r.opId));
  } else {
    await reject(tx, r.opId, r.error?.code ?? 'rejected', r.error?.message ?? 'Сервер не принял операцию');
  }
}

// Отказ: оптимистичные строки откатываются (созданные удаляются, изменённые возвращаются к последней серверной версии),
// сама операция остаётся в очереди со статусом rejected и причиной — «Не принято сервером».
async function reject(tx: Tx, opId: string, code: string, message: string) {
  const rows = await tx.select().from(localRows).where(eq(localRows.opId, opId)).orderBy(desc(localRows.id));
  for (const r of rows) {
    if (r.before) await upsertRows(tx, r.entity, [r.before as Record<string, unknown>]);
    else await deleteRows(tx, r.entity, [r.entityId]);
  }
  await tx.delete(localRows).where(eq(localRows.opId, opId));
  await tx.update(outbox).set({ status: 'rejected', errorCode: code, error: message, settledAt: new Date() }).where(eq(outbox.opId, opId));
}

// Пришла серверная версия строки, которую изменила неотправленная операция: откат должен вернуть именно её.
export async function refreshBefore(tx: Tx, entity: string, row: Record<string, unknown>) {
  await tx.update(localRows).set({ before: row }).where(and(eq(localRows.entity, entity), eq(localRows.entityId, String(row.id)), isNotNull(localRows.before)));
}

// Итог разбора конфликта приезжает через pull (sync_conflicts): провели — строка уже серверная; отклонили — откат.
export async function settleConflicts(tx: Tx) {
  const done = await tx.select({ opId: outbox.opId, status: syncConflicts.status, resolution: syncConflicts.resolution })
    .from(outbox).innerJoin(syncConflicts, eq(syncConflicts.id, outbox.conflictId))
    .where(and(eq(outbox.status, 'conflict'), ne(syncConflicts.status, 'open')));
  for (const c of done) {
    if (c.status === 'resolved') {
      await tx.delete(localRows).where(eq(localRows.opId, c.opId));
      await tx.update(outbox).set({ status: 'applied', errorCode: null, error: null, settledAt: new Date() }).where(eq(outbox.opId, c.opId));
    } else {
      const comment = (c.resolution as { comment?: string } | null)?.comment;
      await reject(tx, c.opId, 'conflict_discarded', `Отклонено при разборе${comment ? `: ${comment}` : ''}`);
    }
  }
  return done.length;
}

// После повторной загрузки реплики (snapshot) неотправленные операции накладываются заново (решение P4 №13):
// реплика = сервер + ещё не принятые операции. Не удалось наложить (например, доступ уже отозван) — операция
// остаётся в очереди, решит сервер.
export async function reapplyActive(tx: Tx, userId: string, deviceId: string, log?: (m: string) => void) {
  const active = await tx.select().from(outbox).where(inArray(outbox.status, [...ACTIVE])).orderBy(asc(outbox.seq));
  if (!active.length) return;
  await tx.delete(localRows).where(inArray(localRows.opId, active.map(o => o.opId)));
  const [user] = await tx.select().from(users).where(eq(users.id, userId));
  if (!user) return;
  for (const o of active) {
    try {
      await tx.transaction(inner => applyOptimistic(inner, user, deviceId, { opId: o.opId, command: o.command, payload: o.payload, deviceCreatedAt: o.deviceCreatedAt }));
    } catch (e) { log?.(`очередь: операция ${o.opId} не наложена на реплику: ${(e as Error).message}`); }
  }
}
