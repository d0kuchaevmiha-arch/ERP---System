import { and, eq, sql } from 'drizzle-orm';
import { stockMovements } from '@/db/schema';
import type { Tx } from '@/server/db/types';

// Остаток материала на складе и хватает ли его на need — в NUMERIC на стороне БД (без float).
// Общий для сервера (movements.create) и предпроверки на ноутбуке (реплика той же схемы).
export async function stockBalance(tx: Tx, materialId: string, warehouseId: string, need: number | string) {
  const total = sql<string>`coalesce(sum(case when ${stockMovements.type} in ('receipt','return','transfer_in') then ${stockMovements.quantity} else -${stockMovements.quantity} end),0)`;
  const [r] = await tx.select({ total, enough: sql<boolean>`${total} >= ${String(need)}::numeric` }).from(stockMovements).where(and(eq(stockMovements.materialId, materialId), eq(stockMovements.warehouseId, warehouseId)));
  return r;
}

export const insufficientStockMessage = (q: number | string, unit: string, name: string, total: string) =>
  `Невозможно списать ${q} ${unit} материала «${name}»: доступно только ${total} ${unit}.`;
