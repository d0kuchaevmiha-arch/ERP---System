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
export function leftoverProcesses(dataDir: string) {
  const ps = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine.Contains('${dataDir.replace(/'/g, "''")}') -or $_.CommandLine -match 'desktop.dist.agent\\.js|standalone.server\\.js|resources.app-files') } | ForEach-Object { "$($_.ProcessId) $($_.Name)" }`;
  const out = execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).trim();
  return out ? out.split(/\r?\n/) : [];
}

export async function serverLogin(email: string, password: string) {
  const r = await fetch(`${SERVER}/api/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!r.ok) throw new Error(`login ${email}: ${r.status}`);
  return r.headers.get('set-cookie')!.split(';')[0];
}
