import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const SERVER = process.env.E2E_SERVER ?? 'http://localhost:3000';
export const ROOT = path.resolve(__dirname, '..');

export const electronExe = () => path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

export function demoPassword() {
  if (process.env.DEMO_PASSWORD) return process.env.DEMO_PASSWORD;
  const line = readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).find(l => l.startsWith('DEMO_PASSWORD='));
  if (!line) throw new Error('DEMO_PASSWORD не найден');
  return line.slice('DEMO_PASSWORD='.length);
}

// Запуск приложения: собранный установщиком exe (E2E_APP) или dev-сборка из репозитория.
// dataDir = null — каталог по умолчанию (%APPDATA%\ERP-Energotech), как у пользователя после установки.
export async function launch(dataDir: string | null): Promise<ElectronApplication> {
  const env = { ...process.env } as Record<string, string>;
  if (dataDir) env.ERP_DATA_DIR = dataDir; else delete env.ERP_DATA_DIR;
  delete env.ELECTRON_RUN_AS_NODE;
  return process.env.E2E_APP
    ? electron.launch({ executablePath: process.env.E2E_APP, env })
    : electron.launch({ args: [ROOT], cwd: ROOT, env });
}

// Окно интерфейса после загрузки (адрес локального Next).
export async function mainWindow(app: ElectronApplication, timeout = 180_000): Promise<Page> {
  const page = await app.firstWindow();
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout });
  return page;
}

// Процессы приложения, связанные с каталогом данных/сборкой: postgres (по -D), Next и sync-agent (по пути скрипта).
// Процессы, которые уже работали до тестов (например, у разработчика открыта своя программа), не считаются остатком.
const before = new Set(listProcesses('<нет-такого-каталога>'));
export function leftoverProcesses(dataDir: string) {
  return listProcesses(dataDir).filter(p => !before.has(p));
}
function listProcesses(dataDir: string) {
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine.Contains('${dataDir.replace(/'/g, "''")}') -or $_.CommandLine -match 'desktop.dist.agent\\.js|standalone.server\\.js|resources.app-files') } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`;
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
  return out ? out.split(/\r?\n/) : [];
}

export async function serverLogin(email: string, password: string) {
  const r = await fetch(`${SERVER}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
  return r.headers.get('set-cookie')!.split(';')[0];
}

// Вход при запуске (P4): экран пароля → окно интерфейса. Возвращает время до экрана входа и от пароля до окна.
export async function unlock(app: ElectronApplication, password = demoPassword(), started = Date.now()) {
  const w = await app.firstWindow();
  await w.waitForSelector('#login-password', { timeout: 120_000 });
  const toLogin = (Date.now() - started) / 1000;
  await w.fill('#login-password', password);
  const t = Date.now();
  await w.click('#submit');
  // Что раньше: окно интерфейса или ошибка входа на экране.
  const failed = w.waitForSelector('#error:not([hidden])', { timeout: 90_000 }).then(() => true, () => false);
  const page = await Promise.race([mainWindow(app, 90_000), failed.then(async f => { if (f) throw new Error(`Вход не удался: ${await w.textContent('#error')}`); return mainWindow(app, 90_000); })]);
  return { page, toLogin, toWindow: (Date.now() - t) / 1000 };
}
