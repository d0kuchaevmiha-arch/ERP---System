import type { Db } from '@/server/db/types';
import type { SessionUser } from '@/server/auth/session';

// «Требует решения» (§5.1, D6): открытые конфликты, которые пользователь может разобрать, и свои.
export type ConflictItem = { id: string; opId: string; kind: string; command: string; projectId: string | null; reason: string; status: string; authorId: string; payload: unknown };

export async function listConflicts(_db: Db, _user: SessionUser): Promise<ConflictItem[]> {
  throw new Error('listConflicts: not implemented');
}
