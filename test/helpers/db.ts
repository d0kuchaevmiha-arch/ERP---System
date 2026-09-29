import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

export const ADMIN_URL = process.env.TEST_ADMIN_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54329/postgres';

export type TestDb = Awaited<ReturnType<typeof createEmptyDb>>;

// Пустая БД с уникальным именем на тестовом сервере; drop() удаляет её вместе с подключениями.
export async function createEmptyDb() {
  const name = `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  admin.on('error', () => {});
  await admin.query(`create database ${name}`);
  const url = new URL(ADMIN_URL); url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 10 });
  // drop() принудительно закрывает соединения к тестовой БД — ошибка простаивающего клиента ожидаема.
  pool.on('error', () => {});
  return {
    name, url: url.toString(), pool, db: drizzle(pool),
    async drop() {
      await pool.end();
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    },
  };
}

// БД со всеми версионными миграциями — основа интеграционных тестов.
export async function createMigratedDb() {
  const { runMigrations } = await import('@/server/db/migrate');
  const t = await createEmptyDb();
  await runMigrations(t.pool, { log: () => {} });
  return t;
}
