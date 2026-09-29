import { execFile, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { Client } from 'pg';

const run = promisify(execFile);

// Встроенный PostgreSQL 16 десктопа (§3, §8, решение P3 №3): свои бинарники, данные в %APPDATA%, только 127.0.0.1.
// Управляем процессом сами (initdb / pg_ctl), чтобы гарантированно остановить его при выходе.
export const DB_USER = 'erp';
export const DB_NAME = 'erp';

export class LocalPostgres {
  constructor(readonly opts: { binDir: string; dataDir: string; password: string; log?: (m: string) => void }) {}

  private bin(name: string) { return path.join(this.opts.binDir, `${name}${process.platform === 'win32' ? '.exe' : ''}`); }
  private log(m: string) { this.opts.log?.(`[pg] ${m}`); }
  get initialised() { return existsSync(path.join(this.opts.dataDir, 'PG_VERSION')); }

  // Первый запуск: кластер UTF8/C, пароль из секретов приложения, вход только по паролю (scram-sha-256).
  async initialise() {
    mkdirSync(this.opts.dataDir, { recursive: true });
    const pwfile = path.join(tmpdir(), `erp-pw-${randomBytes(8).toString('hex')}`);
    writeFileSync(pwfile, this.opts.password, { mode: 0o600 });
    try {
      await run(this.bin('initdb'), ['-D', this.opts.dataDir, '-U', DB_USER, `--pwfile=${pwfile}`, '--encoding=UTF8', '--locale=C', '--auth=scram-sha-256'], { windowsHide: true });
    } finally { rmSync(pwfile, { force: true }); }
    this.log('кластер создан');
  }

  // Устаревший postmaster.pid после сбоя (§8): процесс не жив — файл удаляется, иначе pg_ctl откажется стартовать.
  clearStalePid() {
    const file = path.join(this.opts.dataDir, 'postmaster.pid');
    if (!existsSync(file)) return false;
    const pid = Number(readFileSync(file, 'utf8').split('\n')[0]);
    if (pid && isAlive(pid)) return false;
    rmSync(file, { force: true });
    this.log(`удалён устаревший postmaster.pid (${pid})`);
    return true;
  }

  async start(port: number) {
    this.clearStalePid();
    // Сервер наследовал бы потоки вывода pg_ctl и держал их открытыми (execFile не дождался бы конца) —
    // запускаем без потоков, вывод сервера идёт в postgres.log, ждём завершения самого pg_ctl.
    const code = await spawnQuiet(this.bin('pg_ctl'), ['start', '-D', this.opts.dataDir, '-w', '-t', '60', '-l', path.join(this.opts.dataDir, 'postgres.log'),
      '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c max_connections=30`]);
    if (code !== 0) throw new Error(`PostgreSQL не запустился (pg_ctl ${code}); подробности — ${path.join(this.opts.dataDir, 'postgres.log')}`);
    this.log(`запущен на 127.0.0.1:${port}`);
  }

  // Остановка: pg_ctl stop -m fast, при сбое — принудительное завершение дерева процессов (§8).
  async stop() {
    if (!existsSync(path.join(this.opts.dataDir, 'postmaster.pid'))) return;
    try {
      await run(this.bin('pg_ctl'), ['stop', '-D', this.opts.dataDir, '-m', 'fast', '-w', '-t', '30'], { windowsHide: true });
      this.log('остановлен');
    } catch (e) {
      const pid = this.postmasterPid();
      this.log(`pg_ctl stop: ${(e as Error).message}; принудительное завершение ${pid}`);
      if (pid) await killTree(pid);
    }
  }

  postmasterPid() {
    const file = path.join(this.opts.dataDir, 'postmaster.pid');
    return existsSync(file) ? Number(readFileSync(file, 'utf8').split('\n')[0]) || null : null;
  }

  url(port: number, database = DB_NAME) {
    return `postgresql://${DB_USER}:${encodeURIComponent(this.opts.password)}@127.0.0.1:${port}/${database}`;
  }

  async ensureDatabase(port: number) {
    const c = new Client({ connectionString: this.url(port, 'postgres') });
    await c.connect();
    try {
      const { rowCount } = await c.query('select 1 from pg_database where datname = $1', [DB_NAME]);
      if (!rowCount) await c.query(`create database ${DB_NAME} encoding 'UTF8' template template0`);
    } finally { await c.end(); }
  }
}

// PostgreSQL на Windows не создаёт кластер, если путь к его бинарникам (share) содержит не-ASCII символы:
// путь уходит в кодировке cp1251 и ломает UTF8 (проверено тестом, риск §13). Кириллица в пути ДАННЫХ допустима.
// Поэтому при не-ASCII пути установки (например, имя пользователя кириллицей) бинарники один раз копируются
// в ASCII-каталог %ProgramData% (или %PUBLIC%, если туда нельзя писать).
export const isAscii = (p: string) => /^[\x20-\x7e]*$/.test(p);

export function asciiPgHome(pgHome: string, version: string, log?: (m: string) => void, bases = [process.env.ProgramData, process.env.PUBLIC]) {
  if (isAscii(pgHome)) return pgHome;
  for (const base of bases) {
    if (!base || !isAscii(base)) continue;
    const target = path.join(base, 'ERP-Energotech', `pgsql-${version}`);
    const marker = path.join(target, '.complete');
    try {
      if (!existsSync(marker)) {
        rmSync(target, { recursive: true, force: true });
        mkdirSync(target, { recursive: true });
        copyDir(pgHome, target);
        writeFileSync(marker, version);
        log?.(`[pg] бинарники скопированы в ASCII-каталог ${target}`);
      }
      return target;
    } catch (e) { log?.(`[pg] не удалось подготовить ${target}: ${(e as Error).message}`); }
  }
  throw new Error('Путь к PostgreSQL содержит символы не ASCII, и нет доступного ASCII-каталога (ProgramData, PUBLIC)');
}

// fs.cpSync в Node 24 на Windows молча завершает процесс на не-ASCII путях (проверено) — копируем сами.
function copyDir(from: string, to: string) {
  mkdirSync(to, { recursive: true });
  for (const e of readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else copyFileSync(a, b);
  }
}

function spawnQuiet(cmd: string, args: string[]) {
  return new Promise<number | null>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
    p.on('error', reject);
    p.on('exit', code => resolve(code));
  });
}

export function isAlive(pid: number) {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

export async function killTree(pid: number) {
  if (process.platform === 'win32') await run('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
  else { try { process.kill(pid, 'SIGKILL'); } catch { /* уже завершён */ } }
}
