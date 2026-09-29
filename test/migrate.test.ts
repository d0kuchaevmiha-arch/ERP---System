import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyDb, type TestDb } from './helpers/db';
import { runMigrations, MIGRATIONS_FOLDER } from '@/server/db/migrate';

const silent = { log: () => {} };
let t: TestDb | undefined;
afterEach(async () => { await t?.drop(); t = undefined; });

// Имитация БД, созданной старым `drizzle-kit push`: схема 0000 есть, журнала миграций нет.
async function createLikePush(db: TestDb) {
  const sqlText = readFileSync(path.join(MIGRATIONS_FOLDER, '0000_baseline.sql'), 'utf8');
  for (const stmt of sqlText.split('--> statement-breakpoint')) if (stmt.trim()) await db.pool.query(stmt);
}
async function journal(db: TestDb) {
  const { rows } = await db.pool.query<{ hash: string }>('select hash from drizzle.__drizzle_migrations order by id');
  return rows;
}
async function tableExists(db: TestDb, name: string) {
  const { rows } = await db.pool.query<{ r: string | null }>('select to_regclass($1) as r', [name]);
  return rows[0].r !== null;
}

describe('версионные миграции', () => {
  it('пустая БД: применяются все миграции, повторный запуск ничего не меняет', async () => {
    t = await createEmptyDb();
    await runMigrations(t.pool, silent);
    expect(await tableExists(t, 'public.organizations')).toBe(true);
    const first = await journal(t);
    expect(first.length).toBeGreaterThan(0);
    await runMigrations(t.pool, silent);
    expect(await journal(t)).toEqual(first);
  });

  it('БД после push: baseline без изменения данных, затем остальные миграции', async () => {
    t = await createEmptyDb();
    await createLikePush(t);
    await t.pool.query(`insert into organizations(name, inn) values ('Орг до миграции', '123')`);
    const log: string[] = [];
    await runMigrations(t.pool, { log: m => log.push(m) });
    const { rows } = await t.pool.query('select name, inn from organizations');
    expect(rows).toEqual([{ name: 'Орг до миграции', inn: '123' }]);
    expect(log.join('\n')).toMatch(/baseline/i);
    const j = await journal(t);
    expect(j.length).toBeGreaterThan(0);
    await runMigrations(t.pool, silent);
    expect(await journal(t)).toEqual(j);
  });

  it('БД с расхождением схемы: ошибка, журнал не создаётся, данные не трогаются', async () => {
    t = await createEmptyDb();
    await createLikePush(t);
    await t.pool.query('alter table projects drop column description');
    await expect(runMigrations(t.pool, silent)).rejects.toThrow(/projects\.description/);
    expect(await tableExists(t, 'drizzle.__drizzle_migrations')).toBe(false);
  });

  it('параллельный запуск двух экземпляров не ломает журнал', async () => {
    t = await createEmptyDb();
    await Promise.all([runMigrations(t.pool, silent), runMigrations(t.pool, silent)]);
    const j = await journal(t);
    expect(new Set(j.map(r => r.hash)).size).toBe(j.length);
  });
});
