import type { Db } from '@/server/db/types';
import type { SessionUser } from '@/server/auth/session';

// Приём очереди команд с ноутбука (§6.4). Каждая операция — своя транзакция через тот же реестр команд.
export type PushOp = { opId: string; command: string; payload: unknown; deviceCreatedAt: string; dependsOn?: string[] };
export type PushResult = {
  opId: string;
  status: 'applied' | 'rejected' | 'conflict';
  entityId?: string | null;
  error?: { code: string; message: string };
  conflictId?: string;
};
export const PUSH_LIMIT = 200;

export async function pushOps(_db: Db, _user: SessionUser, _deviceId: string, _ops: PushOp[]): Promise<PushResult[]> {
  throw new Error('pushOps: not implemented');
}
