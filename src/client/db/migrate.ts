import path from 'node:path';
import type { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

// Локальная БД десктопа: те же миграции, что на сервере (реплика), плюс таблицы только клиента со своим журналом.
export async function runClientMigrations(pool: Pool, root = process.cwd()) {
  const client = await pool.connect();
  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: path.join(root, 'drizzle') });
    await migrate(db, { migrationsFolder: path.join(root, 'drizzle-client'), migrationsTable: '__drizzle_client_migrations' });
  } finally { client.release(); }
}
