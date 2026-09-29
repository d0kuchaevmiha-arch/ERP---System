import { sql, type AnyColumn } from 'drizzle-orm';
import { z } from 'zod';
import { conflict } from './errors';

// Оптимистическая блокировка (§4.1). Пример из жизни: два человека правят один документ — кто сохранил вторым
// с устаревшей копией, получает «документ уже изменён», а не молча затирает чужую правку.
export const expectedVersion = z.coerce.number().int().positive().optional();

// Поля для UPDATE изменяемой строки: version + 1, updated_at = сейчас.
export const bump = (version: AnyColumn) => ({ version: sql<number>`${version} + 1`, updatedAt: new Date() });

export function requireVersion(actual: number, expected: number | undefined) {
  if (expected !== undefined && actual !== expected) throw conflict('Запись изменил другой пользователь — обновите данные и повторите');
}
