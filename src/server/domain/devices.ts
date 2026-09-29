import { and, eq, isNull } from 'drizzle-orm';
import { devices } from '@/db/schema';
import type { Tx } from '@/server/db/types';

// Отозвать все действующие устройства пользователя (блокировка, сброс пароля администратором).
export async function revokeUserDevices(tx: Tx, userId: string) {
  await tx.update(devices).set({ revokedAt: new Date() }).where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
}
