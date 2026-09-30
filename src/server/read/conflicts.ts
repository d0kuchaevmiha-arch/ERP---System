import { and, desc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { syncConflicts } from '@/db/schema';
import type { Db } from '@/server/db/types';
import type { SessionUser } from '@/server/auth/session';
import { kindsResolvableBy } from '@/server/domain/authz';
import { visibleProjectIds } from './overview';

// «Требует решения» (§5.1, решение P4 №6): открытые конфликты, которые пользователь вправе разобрать
// (роль + доступ к объекту), и свои спорные операции — автор видит, что его ввод ждёт решения.
export type ConflictItem = typeof syncConflicts.$inferSelect;

// Условие видимости — общее для экрана и для реплики на ноутбуке (src/server/sync/entities.ts).
export function conflictVisibility(user: SessionUser, projectIds: SQL | string[]): SQL {
  const kinds = kindsResolvableBy(user.role);
  const inProjects = Array.isArray(projectIds) ? (projectIds.length ? inArray(syncConflicts.projectId, projectIds) : undefined) : inArray(syncConflicts.projectId, projectIds);
  const resolvable = kinds.length ? and(inArray(syncConflicts.kind, kinds), inProjects ? or(inProjects, isNull(syncConflicts.projectId)) : isNull(syncConflicts.projectId)) : undefined;
  return and(eq(syncConflicts.organizationId, user.organizationId), resolvable ? or(eq(syncConflicts.authorId, user.id), resolvable) : eq(syncConflicts.authorId, user.id))!;
}

export async function listConflicts(db: Db, user: SessionUser, status: 'open' | 'all' = 'open'): Promise<ConflictItem[]> {
  const visible = conflictVisibility(user, await visibleProjectIds(db, user));
  return db.select().from(syncConflicts).where(status === 'open' ? and(visible, eq(syncConflicts.status, 'open')) : visible).orderBy(desc(syncConflicts.createdAt)).limit(500);
}
