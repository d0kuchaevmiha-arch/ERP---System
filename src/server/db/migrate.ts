import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';

export const MIGRATIONS_FOLDER = path.join(process.cwd(), 'drizzle');
// Один и тот же ключ у всех экземпляров приложения: миграции выполняет только один из них.
const LOCK_KEY = 7_345_001;

type Options = { migrationsFolder?: string; log?: (message: string) => void };
type Snapshot = { tables: Record<string, { name: string; schema: string; columns: Record<string, { name: string }> }> };

// Применяет версионные миграции drizzle/. БД, созданную раньше через `drizzle-kit push`,
// сначала сверяет со схемой 0000 и помечает 0000 применённой (baseline) — данные не меняются.
export async function runMigrations(pool: Pool, { migrationsFolder = MIGRATIONS_FOLDER, log = console.log }: Options = {}) {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    await baselineIfNeeded(client, migrationsFolder, log);
    await migrate(drizzle(client), { migrationsFolder });
    log('Миграции применены.');
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
}

async function baselineIfNeeded(client: PoolClient, migrationsFolder: string, log: (m: string) => void) {
  const { rows } = await client.query<{ app: string | null; journal: string | null }>(
    `select to_regclass('public.organizations') as app, to_regclass('drizzle.__drizzle_migrations') as journal`,
  );
  if (!rows[0].app || rows[0].journal) return;

  const [baseline] = readMigrationFiles({ migrationsFolder });
  const snapshot = JSON.parse(readFileSync(path.join(migrationsFolder, 'meta', '0000_snapshot.json'), 'utf8')) as Snapshot;
  const { rows: existing } = await client.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
  );
  const have = new Set(existing.map(r => `${r.table_name}.${r.column_name}`));
  const missing = Object.values(snapshot.tables).flatMap(t => Object.values(t.columns).map(c => `${t.name}.${c.name}`)).filter(k => !have.has(k));
  if (missing.length) {
    throw new Error(`Baseline невозможен: схема существующей БД не совпадает с 0000_baseline (нет: ${missing.join(', ')}). Данные не изменены; нужна ручная сверка.`);
  }

  await client.query('begin');
  try {
    await client.query('create schema if not exists drizzle');
    await client.query('create table if not exists drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)');
    await client.query('insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)', [baseline.hash, baseline.folderMillis]);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
  log('Существующая БД (создана drizzle-kit push) помечена baseline 0000; данные не изменены.');
}
