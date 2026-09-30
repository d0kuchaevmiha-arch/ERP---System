import { eq, getTableName, sql } from 'drizzle-orm';
import { users } from '@/db/schema';
import type { Db } from '@/server/db/types';
import { isOrgWide } from '@/server/domain/authz';
import { visibleProjectIds } from '@/server/read/overview';
import { SYNC_ENTITIES } from './entities';

// Оценка объёма реплики на пользователя (§10): строки и байты данных по сущностям для его офлайн-набора.
// Для ролей со всеми объектами — худший случай «выбраны все объекты организации».
// Индексы и служебные данные PostgreSQL на ноутбуке — коэффициент INDEX_FACTOR (Допущение: ×2 к объёму строк).
export const INDEX_FACTOR = 2;
export const TARGET_BYTES = 500 * 1024 * 1024; // ориентир §10 (Допущение)

export async function estimateUser(db: Db, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error('Пользователь не найден');
  const projectIds = await visibleProjectIds(db, user);
  const scope = { user, projectIds };
  const entities: { entity: string; rows: number; bytes: number }[] = [];
  for (const [name, e] of Object.entries(SYNC_ENTITIES)) {
    const t = sql.raw(`"${getTableName(e.table)}"`);
    const [r] = await db.select({ rows: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(pg_column_size(${t}.*)), 0)::bigint` }).from(e.table).where(e.visible(scope));
    entities.push({ entity: name, rows: Number(r.rows), bytes: Number(r.bytes) });
  }
  const dataBytes = entities.reduce((n, x) => n + x.bytes, 0);
  return { user: { id: user.id, name: user.name, role: user.role, orgWide: isOrgWide(user) }, projects: projectIds.length, entities, dataBytes, estimatedBytes: dataBytes * INDEX_FACTOR };
}

export async function estimateAll(db: Db) {
  const list = await db.select({ id: users.id }).from(users).where(eq(users.isActive, true));
  const out = [];
  for (const u of list) out.push(await estimateUser(db, u.id));
  return out.sort((a, b) => b.estimatedBytes - a.estimatedBytes);
}
