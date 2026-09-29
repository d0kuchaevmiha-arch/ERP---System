import { and, asc, eq, gt, inArray, max } from 'drizzle-orm';
import { changeLog, orgCounters, projects } from '@/db/schema';
import type { Db } from '@/server/db/types';
import type { SessionUser } from '@/server/auth/session';
import { isOrgWide } from '@/server/domain/authz';
import { DomainError, invalid } from '@/server/domain/errors';
import { visibleProjectIds } from '@/server/read/overview';
import { SYNC_ENTITIES, type SyncScope } from './entities';

export const PRUNED_COUNTER = 'change_log_pruned_seq';
const SNAPSHOT_PAGE = 500;
const PULL_LIMIT = 1000;

// Офлайн-набор (§10): запрошенные клиентом объекты ∩ доступные. Не указан — по умолчанию все доступные,
// у ролей со всеми объектами организации — пусто (выбирают вручную).
export async function resolveScope(db: Db, user: SessionUser, requested: string[] | null): Promise<SyncScope> {
  const available = await visibleProjectIds(db, user);
  const projectIds = requested === null ? (isOrgWide(user) ? [] : available) : requested.filter(id => available.includes(id));
  return { user, projectIds };
}

export async function getScope(db: Db, user: SessionUser) {
  const ids = await visibleProjectIds(db, user);
  const list = ids.length ? await db.select({ id: projects.id, code: projects.code, name: projects.name }).from(projects).where(inArray(projects.id, ids)).orderBy(asc(projects.code)) : [];
  return { available: list, defaultScope: isOrgWide(user) ? [] : ids, orgWide: isOrgWide(user) };
}

// Текущий номер журнала организации; если журнал очищен целиком — не меньше номера последней очистки.
async function currentSeq(db: Db, orgId: string) {
  const [r] = await db.select({ seq: max(changeLog.seq) }).from(changeLog).where(eq(changeLog.organizationId, orgId));
  const [pruned] = await db.select({ value: orgCounters.value }).from(orgCounters).where(and(eq(orgCounters.organizationId, orgId), eq(orgCounters.name, PRUNED_COUNTER)));
  return Math.max(r.seq ?? 0, pruned?.value ?? 0);
}

function entityOf(name: string) {
  const e = SYNC_ENTITIES[name];
  if (!e) throw invalid(`Неизвестная сущность синхронизации: ${name}`);
  return e;
}
function selectRows(db: Db, name: string, scope: SyncScope) {
  const e = entityOf(name);
  const cols = typeof e.columns === 'function' ? e.columns(scope) : e.columns;
  return cols ? db.select(cols as never).from(e.table) : db.select().from(e.table);
}

// Первичная загрузка одной сущности страницами по id (§6.2). snapshotSeq берётся ДО чтения строк:
// всё, что изменится во время загрузки, клиент потом получит через pull с этого номера.
export async function snapshot(db: Db, scope: SyncScope, params: { entity: string; cursor?: string | null; limit?: number }) {
  const e = entityOf(params.entity);
  const limit = Math.min(Math.max(params.limit ?? SNAPSHOT_PAGE, 1), 2000);
  const snapshotSeq = await currentSeq(db, scope.user.organizationId);
  const where = and(e.visible(scope), params.cursor ? gt(e.table.id, params.cursor) : undefined);
  const rows = await selectRows(db, params.entity, scope).where(where).orderBy(asc(e.table.id)).limit(limit + 1) as { id: string }[];
  const page = rows.slice(0, limit);
  return { entity: params.entity, rows: page, nextCursor: rows.length > limit ? page[page.length - 1].id : null, snapshotSeq, scope: scope.projectIds };
}

export type PullChange = { seq: number; entity: string; id: string; op: 'upsert' | 'delete'; row: unknown };

// Изменения после since (§6.3): текущая версия строки (дедуп по id), только видимое пользователю в офлайн-наборе.
// Строка стала невидимой без удаления (объект убран из набора, доступ отозван) — клиент чистит её по полю scope.
export async function pull(db: Db, scope: SyncScope, params: { since: number; limit?: number }) {
  const org = scope.user.organizationId;
  const limit = Math.min(Math.max(params.limit ?? PULL_LIMIT, 1), 5000);
  // Удалено из журнала больше, чем клиент успел получить (в том числе при since = 0) — только повторная загрузка.
  {
    const [pruned] = await db.select({ value: orgCounters.value }).from(orgCounters).where(and(eq(orgCounters.organizationId, org), eq(orgCounters.name, PRUNED_COUNTER)));
    if (pruned && params.since < pruned.value) throw new DomainError('Журнал изменений устарел — нужна повторная загрузка данных', 410, 'resnapshot');
  }
  const log = await db.select().from(changeLog).where(and(eq(changeLog.organizationId, org), gt(changeLog.seq, params.since))).orderBy(asc(changeLog.seq)).limit(limit);
  const latest = new Map<string, { seq: number; entity: string; id: string; op: string }>();
  for (const c of log) if (SYNC_ENTITIES[c.entity]) latest.set(`${c.entity}:${c.entityId}`, { seq: c.seq, entity: c.entity, id: c.entityId, op: c.op });

  const byEntity = new Map<string, string[]>();
  for (const c of latest.values()) byEntity.set(c.entity, [...(byEntity.get(c.entity) ?? []), c.id]);
  const found = new Map<string, unknown>();
  for (const [name, ids] of byEntity) {
    const e = SYNC_ENTITIES[name];
    const rows = await selectRows(db, name, scope).where(and(e.visible(scope), inArray(e.table.id, ids))) as { id: string }[];
    for (const r of rows) found.set(`${name}:${r.id}`, r);
  }
  const changes: PullChange[] = [];
  for (const [key, c] of [...latest].sort((a, b) => a[1].seq - b[1].seq)) {
    const row = found.get(key);
    if (row) changes.push({ seq: c.seq, entity: c.entity, id: c.id, op: 'upsert', row });
    else if (c.op === 'delete') changes.push({ seq: c.seq, entity: c.entity, id: c.id, op: 'delete', row: null });
  }
  return { changes, nextSeq: log.length ? log[log.length - 1].seq : params.since, hasMore: log.length === limit, scope: scope.projectIds };
}
