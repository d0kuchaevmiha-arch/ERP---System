import type { z } from 'zod';
import type { Tx } from '@/server/db/types';
import type { CommandContext } from './context';

// Команда — единственный способ записи (HTTP сейчас, sync push в P4).
// authorize проверяет доступ и возвращает найденный контекст (объект, заявку, склад), execute его использует.
export type Command<I, S, R> = {
  name: string;
  offline: 'allowed' | 'conflictable' | 'online_only';
  roles: readonly string[];
  // Текст отказа, если роль не входит в roles.
  deniedMessage?: string;
  schema: z.ZodType<I>;
  authorize(tx: Tx, ctx: CommandContext, input: I): Promise<S>;
  execute(tx: Tx, ctx: CommandContext, input: I, scope: S): Promise<R>;
};
export const defineCommand = <I, S, R>(c: Command<I, S, R>) => c;
