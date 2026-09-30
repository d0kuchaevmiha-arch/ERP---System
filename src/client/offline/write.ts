import type { Db } from '@/server/db/types';
import type { SessionUser } from '@/server/auth/session';

// Офлайн-запись на ноутбуке (§3.1, §6.6): предпроверка по реплике → оптимистичная строка + outbox.
export type LocalWrite = { opId: string; id: string | null; data: unknown };

export async function writeLocal(_db: Db, _user: SessionUser, _command: string, _payload: unknown): Promise<LocalWrite> {
  throw new Error('writeLocal: not implemented');
}
