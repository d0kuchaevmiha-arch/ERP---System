import { expect, test } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, SERVER, demoPassword, launch, leftoverProcesses, mainWindow, unlock } from './helpers';
import { removePath } from '../desktop/src/fsx';

// Установщик на этой машине (§12: установка, данные переживают переустановку). Ставит программу в профиль пользователя
// и использует %APPDATA%\ERP-Energotech — запускается только явно: E2E_INSTALLER=1 npx playwright test e2e/installed.spec.ts
// В конце удаляет программу, ярлыки, данные прогона и ключи реестра программы.
const enabled = process.env.E2E_INSTALLER === '1';
const setupExe = path.join(ROOT, 'dist-desktop', 'ERP-Энерготех-Setup.exe');
const installDir = path.join(process.env.LOCALAPPDATA!, 'Programs', 'erp-energotech'); // имя пакета из package.json
const appExe = path.join(installDir, 'ERP-Energotech.exe');
const uninstaller = path.join(installDir, 'Uninstall ERP-Energotech.exe');
const dataDir = path.join(process.env.APPDATA!, 'ERP-Energotech');
const shortcut = path.join(process.env.USERPROFILE!, 'Desktop', 'Энерготех.lnk');
const APP_GUID = '937706b7-27bb-5ea8-ae1c-98d268bb34e7'; // electron-builder: из appId ru.energotech.erp

const ps = (cmd: string) => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim();
// Пути реестра — конкатенацией: в String.raw последовательность \${ экранирует подстановку.
const UNINSTALL_KEY = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\' + APP_GUID;
const INSTALL_KEY = 'HKCU:\\Software\\' + APP_GUID;
const registered = () => ps(`Test-Path '${UNINSTALL_KEY}'`) === 'True';

async function waitFor(check: () => boolean, ms: number) {
  const until = Date.now() + ms;
  while (!check()) { if (Date.now() > until) throw new Error('timeout'); await new Promise(r => setTimeout(r, 500)); }
}
// Установщик и деинсталлятор NSIS доделывают работу в дочернем процессе — ждём результата, а не выхода exe.
async function install() {
  expect(spawnSync(setupExe, ['/S'], { timeout: 180_000 }).status).toBe(0);
  await waitFor(() => existsSync(appExe) && existsSync(uninstaller) && existsSync(shortcut) && registered(), 180_000);
}
async function uninstall() {
  spawnSync(uninstaller, ['/S'], { timeout: 180_000 });
  await waitFor(() => !existsSync(appExe) && !existsSync(shortcut) && !registered(), 180_000);
}

test.describe.configure({ mode: 'serial' });
test.skip(!enabled, 'только по E2E_INSTALLER=1');

test.beforeAll(() => {
  expect(existsSync(setupExe), 'сначала npm run dist').toBe(true);
  expect(existsSync(installDir), 'программа уже установлена').toBe(false);
  expect(existsSync(dataDir), `${dataDir} уже существует — тест не будет его трогать`).toBe(false);
  process.env.E2E_APP = appExe;
});

test('тихая установка: программа в профиле пользователя, ярлык «Энерготех» ведёт на неё, программа сама не запускается', async () => {
  await install();
  expect(ps(`(New-Object -ComObject WScript.Shell).CreateShortcut('${shortcut}').TargetPath`).toLowerCase()).toBe(appExe.toLowerCase());
  await new Promise(r => setTimeout(r, 3000));
  expect(existsSync(dataDir), 'после установки программа не должна запускаться сама').toBe(false);
});

test('первый запуск: подключение, данные в %APPDATA%\\ERP-Energotech', async () => {
  const app = await launch(null);
  try {
    const setup = await app.firstWindow();
    await setup.waitForSelector('#server', { timeout: 120_000 });
    await setup.fill('#server', SERVER);
    await setup.fill('#email', 'manager@monolit.local');
    await setup.fill('#password', demoPassword());
    await setup.fill('#device', 'E2E установщик');
    await setup.click('#submit');
    const page = await mainWindow(app);
    await expect(page.locator('body')).toContainText('Северный квартал', { timeout: 60_000 });
  } finally { await app.close(); }
  expect(existsSync(path.join(dataDir, 'pgdata', 'PG_VERSION'))).toBe(true);
  expect(existsSync(path.join(dataDir, 'secrets.bin'))).toBe(true);
  await expect.poll(() => leftoverProcesses(dataDir), { timeout: 20_000 }).toEqual([]);
});

test('удаление сохраняет данные; после повторной установки — без повторного подключения, с данными, < 15 с', async () => {
  await uninstall();
  expect(existsSync(path.join(dataDir, 'pgdata', 'PG_VERSION')), 'данные пропали после удаления').toBe(true);
  expect(existsSync(path.join(dataDir, 'secrets.bin'))).toBe(true);
  await install();
  // Первый запуск свежеустановленных файлов — «холодный» (проверка антивирусом, пустой кэш): время в отчёт с разбивкой.
  const measure = async () => {
    const started = Date.now();
    const app = await launch(null);
    try {
      // P4: при каждом запуске — пароль; время ввода пароля пользователем не считается.
      const { page, toLogin, toWindow } = await unlock(app, demoPassword(), started);
      await expect(page.locator('body')).toContainText('Северный квартал');
      return toLogin + toWindow;
    } finally { await app.close(); }
  };
  const cold = await measure();
  const log = readFileSync(path.join(dataDir, 'logs', 'main.log'), 'utf8').split(/\r?\n/).filter(l => l.includes('[status]') || l.includes('готово')).slice(-8);
  console.log(`первый запуск после переустановки: ${cold.toFixed(1)} с\n${log.join('\n')}`);
  await expect.poll(() => leftoverProcesses(dataDir), { timeout: 20_000 }).toEqual([]);
  // §12: повторный запуск < 15 с.
  const warm = await measure();
  console.log(`повторный запуск установленной программы: ${warm.toFixed(1)} с`);
  expect(warm).toBeLessThan(15);
  await expect.poll(() => leftoverProcesses(dataDir), { timeout: 20_000 }).toEqual([]);
});

test.afterAll(async () => {
  if (!enabled) return;
  if (existsSync(uninstaller)) await uninstall().catch(() => {});
  removePath(dataDir);
  ps(`if (Test-Path '${INSTALL_KEY}') { Remove-Item -LiteralPath '${INSTALL_KEY}' -Recurse }`);
});
