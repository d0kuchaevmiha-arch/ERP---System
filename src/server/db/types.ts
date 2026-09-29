import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

// Доменный код получает подключение параметром: в приложении — общий пул, в тестах — своя БД.
export type Db = NodePgDatabase;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
