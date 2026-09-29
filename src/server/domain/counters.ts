import { sql } from 'drizzle-orm';
import { orgCounters } from '@/db/schema';
import type { Tx } from '@/server/db/types';

// Следующее значение сквозного счётчика организации. UPSERT … RETURNING блокирует строку счётчика до конца
// транзакции, поэтому одновременные заявки получают разные номера, а откат не «съедает» номер у других.
export async function nextCounter(tx: Tx, organizationId: string, name: string) {
  const [row] = await tx.insert(orgCounters).values({ organizationId, name, value: 1 })
    .onConflictDoUpdate({ target: [orgCounters.organizationId, orgCounters.name], set: { value: sql`${orgCounters.value} + 1` } })
    .returning({ value: orgCounters.value });
  return row.value;
}

// Номер заявки: ЗК-<год приёма сервером>-<сквозной номер организации, 5 знаков> (Допущение, §14).
export const purchaseNumber = (seq: number, at: Date) => `ЗК-${at.getUTCFullYear()}-${String(seq).padStart(5, '0')}`;
