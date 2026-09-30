import type { Db } from '@/server/db/types';

// Чтение очереди для интерфейса и экспорта (§6.6 п. 4, §8).
export type OutboxItem = {
  opId: string; command: string; payload: unknown; status: 'pending' | 'sending' | 'applied' | 'rejected' | 'conflict';
  entityId: string | null; errorCode: string | null; error: string | null; conflictId: string | null; deviceCreatedAt: string;
};
export type LocalMarks = { pending: string[]; conflict: string[] };

export async function listOutbox(_db: Db): Promise<OutboxItem[]> {
  throw new Error('listOutbox: not implemented');
}
// Id строк реплики, которые ещё не приняты сервером («не синхронизировано») или спорны.
export async function localMarks(_db: Db): Promise<LocalMarks> {
  throw new Error('localMarks: not implemented');
}
