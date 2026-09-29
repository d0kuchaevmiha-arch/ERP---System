import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { copyDir, removePath } from './fsx';

// Есть ли неприменённые миграции (серверная схема реплики + таблицы клиента).
export async function pendingMigrations(url: string, root: string) {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const count = async (table: string) => {
      const { rows } = await c.query<{ r: string | null }>('select to_regclass($1) as r', [`drizzle.${table}`]);
      if (!rows[0].r) return 0;
      return Number((await c.query(`select count(*)::int as n from drizzle.${table}`)).rows[0].n);
    };
    const server = readMigrationFiles({ migrationsFolder: path.join(root, 'drizzle') }).length - await count('__drizzle_migrations');
    const client = readMigrationFiles({ migrationsFolder: path.join(root, 'drizzle-client') }).length - await count('__drizzle_client_migrations');
    const fresh = (await count('__drizzle_migrations')) === 0;
    return { pending: server + client, fresh };
  } finally { await c.end(); }
}

// «Холодная» копия pgdata перед локальной миграцией (§8): PostgreSQL остановлен; хранятся 5 последних.
export function coldBackup(pgdata: string, backups: string, keep = 5) {
  mkdirSync(backups, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(backups, `pgdata-${stamp}`);
  copyDir(pgdata, target);
  const all = readdirSync(backups).filter(n => n.startsWith('pgdata-')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - keep))) removePath(path.join(backups, old));
  return target;
}

export const hasBackups = (dir: string) => existsSync(dir) && readdirSync(dir).some(n => n.startsWith('pgdata-'));
