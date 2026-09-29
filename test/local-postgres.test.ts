import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from 'pg';
import { LocalPostgres, asciiPgHome, isAlive, isAscii } from '../desktop/src/local-postgres';

// Встроенный PostgreSQL десктопа на настоящих бинарниках пакета (§8, §13: кириллица в пути профиля).
const root = mkdtempSync(path.join(tmpdir(), 'erp-pg-'));
// Путь к пакету содержит «Энерготех» — ровно случай профиля с кириллицей: бинарники уходят в ASCII-каталог.
const pgHome = path.join(process.cwd(), 'node_modules', '@embedded-postgres', 'windows-x64', 'native');
const asciiBase = path.join(root, 'ascii');
const binDir = path.join(asciiPgHome(pgHome, '16.14', undefined, [asciiBase]), 'bin');
afterAll(() => rmSync(root, { recursive: true, force: true }));

const freePort = () => new Promise<number>(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); }); });

describe.skipIf(process.platform !== 'win32')('локальный PostgreSQL', () => {
  it('путь к бинарникам с кириллицей заменяется ASCII-копией; ASCII-путь используется как есть', () => {
    expect(isAscii(pgHome)).toBe(false);
    expect(isAscii(binDir)).toBe(true);
    expect(asciiPgHome(asciiBase, '16.14')).toBe(asciiBase);
  });

  it('initdb в каталоге с кириллицей и пробелами, UTF8, старт только на 127.0.0.1, остановка без остатка процессов', async () => {
    const dataDir = path.join(root, 'Пользователь Иванов', 'ERP-Energotech', 'pgdata');
    const pg = new LocalPostgres({ binDir, dataDir, password: 'пароль-с-кириллицей!' });
    await pg.initialise();
    expect(pg.initialised).toBe(true);
    const port = await freePort();
    await pg.start(port);
    try {
      await pg.ensureDatabase(port);
      const c = new Client({ connectionString: pg.url(port) });
      await c.connect();
      const { rows } = await c.query(`select current_setting('server_encoding') enc, current_setting('listen_addresses') addr, version() v, 'Энерготех'::text word`);
      await c.end();
      expect(rows[0]).toMatchObject({ enc: 'UTF8', addr: '127.0.0.1', word: 'Энерготех' });
      expect(rows[0].v).toMatch(/PostgreSQL 16\./);
      const wrong = new Client({ connectionString: pg.url(port).replace(encodeURIComponent('пароль-с-кириллицей!'), 'wrong') });
      await expect(wrong.connect()).rejects.toThrow(/password/i);
    } finally {
      const pid = pg.postmasterPid()!;
      await pg.stop();
      expect(isAlive(pid)).toBe(false);
      expect(existsSync(path.join(dataDir, 'postmaster.pid'))).toBe(false);
    }
  }, 120_000);

  it('устаревший postmaster.pid после сбоя удаляется, кластер стартует', async () => {
    const dataDir = path.join(root, 'stale', 'pgdata');
    const pg = new LocalPostgres({ binDir, dataDir, password: 'p' });
    await pg.initialise();
    writeFileSync(path.join(dataDir, 'postmaster.pid'), '999999\n' + dataDir + '\n');
    const port = await freePort();
    await pg.start(port);
    await pg.stop();
  }, 120_000);
});
