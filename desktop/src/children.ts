import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, type WriteStream } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { killTree } from './local-postgres';

// Дочерние Node-процессы десктопа (Next standalone, sync-agent) через тот же electron.exe (ELECTRON_RUN_AS_NODE, §8).
const LOG_LIMIT = 5 * 1024 * 1024;

export function freePort() {
  return new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
  });
}

// Журнал процесса с простой ротацией: >5 МБ → <имя>.1.log (хранится один предыдущий).
export function logStream(dir: string, name: string): WriteStream {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.log`);
  if (existsSync(file) && statSync(file).size > LOG_LIMIT) renameSync(file, path.join(dir, `${name}.1.log`));
  return createWriteStream(file, { flags: 'a' });
}

export type Child = { name: string; proc: ChildProcess; stop: () => Promise<void> };

export function startNodeChild(name: string, script: string, env: Record<string, string>, logs: string, onExit?: (code: number | null) => void): Child {
  const out = logStream(logs, name);
  const proc = spawn(process.execPath, [script], {
    cwd: path.dirname(script),
    env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', NODE_USE_SYSTEM_CA: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const stamp = (chunk: Buffer) => out.write(`[${new Date().toISOString()}] ${chunk.toString()}`);
  proc.stdout?.on('data', stamp);
  proc.stderr?.on('data', stamp);
  proc.on('exit', code => { out.write(`[${new Date().toISOString()}] завершён с кодом ${code}\n`); onExit?.(code); });
  return {
    name, proc,
    // Мягкая остановка, через 5 с — принудительное завершение дерева процессов.
    async stop() {
      if (proc.exitCode !== null || proc.pid === undefined) return;
      const exited = new Promise<void>(r => proc.once('exit', () => r()));
      proc.kill();
      const timedOut = await Promise.race([exited.then(() => false), new Promise<boolean>(r => setTimeout(() => r(true), 5000))]);
      if (timedOut) await killTree(proc.pid);
      out.end();
    },
  };
}

export async function waitHttpOk(url: string, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (r.ok) return; } catch { /* ещё не готов */ }
    if (Date.now() > until) throw new Error(`Не дождались ${url}`);
    await new Promise(r => setTimeout(r, 250));
  }
}
