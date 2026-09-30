import { app, BrowserWindow, dialog, ipcMain, Menu, net, session, shell } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import log from 'electron-log/main';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { runClientMigrations } from '@/client/db/migrate';
import { syncState } from '@/client/db/schema';
import { initSyncState } from '@/client/sync/agent';
import { SYNC_PROTOCOL } from '@/client/sync/http-transport';
import { LocalPostgres, asciiPgHome } from './local-postgres';
import { PG_VERSION, dataPaths, resourcePaths } from './paths';
import { forgetDevice, loadSecrets, saveSecrets, type Device, type Secrets } from './secrets';
import { freePort, startNodeChild, waitHttpOk, type Child } from './children';
import { coldBackup, pendingMigrations } from './migrations';

// Оболочка десктопа (§8): один экземпляр, свои порты, PostgreSQL → миграции → вход устройства → Next + sync-agent → окно.
// Закрытие окна = выход: агент → Next → PostgreSQL. Трея нет.

const DATA = dataPaths();
const RES = resourcePaths();
app.setPath('userData', path.join(DATA.root, 'electron'));
log.transports.file.resolvePathFn = () => path.join(DATA.logs, 'main.log');
log.transports.file.maxSize = 5 * 1024 * 1024;
log.initialize();

let win: BrowserWindow | null = null;
let pg: LocalPostgres | null = null;
let pool: Pool | null = null;
const children: Child[] = [];
let localOrigin = '';
let quitting = false;

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
// Второй запуск фокусирует уже открытое окно (§12, критерий P3).
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });

// Безопасность окна (§7): изоляция, песочница, без Node; навигация — только локальный интерфейс; внешние ссылки — в браузер.
function isInternal(url: string) { return url.startsWith('file://') || (localOrigin !== '' && url.startsWith(localOrigin + '/')) || url === localOrigin; }
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url) && !isInternal(url)) void shell.openExternal(url); return { action: 'deny' }; });
  contents.on('will-navigate', (e, url) => { if (!isInternal(url)) { e.preventDefault(); if (/^https?:\/\//.test(url)) void shell.openExternal(url); } });
});

function status(text: string) { log.info(`[status] ${text}`); win?.webContents.send('status', text); }

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1024, minHeight: 640, show: false, title: 'Энерготех',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => { win = null; });
  void win.loadFile(path.join(RES.ui, 'loading.html'));
}

function readConfig(): { serverUrl?: string; deviceName?: string } {
  try { return JSON.parse(readFileSync(DATA.config, 'utf8')); } catch { return {}; }
}
function writeConfig(c: { serverUrl?: string; deviceName?: string }) { mkdirSync(DATA.root, { recursive: true }); writeFileSync(DATA.config, JSON.stringify(c, null, 2)); }

// Адрес сервера: только HTTPS; http — только localhost для разработки и E2E (Допущение P3).
export function normalizeServerUrl(raw: string) {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new Error('Неверный адрес сервера'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) throw new Error('Адрес сервера должен начинаться с https://');
  return u.origin;
}

async function startDatabase(secrets: Secrets) {
  status('Запуск базы данных…');
  const pgHome = asciiPgHome(RES.pgHome, PG_VERSION, m => log.info(m));
  pg = new LocalPostgres({ binDir: path.join(pgHome, 'bin'), dataDir: DATA.pgdata, password: secrets.dbPassword, log: m => log.info(m) });
  if (!pg.initialised) { status('Первый запуск: подготовка базы данных…'); await pg.initialise(); }
  let port = await freePort();
  await pg.start(port);
  await pg.ensureDatabase(port);
  const url = pg.url(port);
  const { pending, fresh } = await pendingMigrations(url, RES.root);
  if (pending > 0) {
    if (!fresh) {
      // Перед обновлением схемы — «холодная» копия данных (§8): outbox и реплика не теряются при неудачной миграции.
      status('Резервная копия данных перед обновлением…');
      await pg.stop();
      log.info(`backup: ${coldBackup(DATA.pgdata, DATA.backups)}`);
      port = await freePort();
      await pg.start(port);
    }
    status('Обновление структуры базы данных…');
  }
  pool = new Pool({ connectionString: pg.url(port), max: 3 });
  pool.on('error', e => log.warn(`pool: ${e.message}`));
  await runClientMigrations(pool, RES.root);
  return { port, url: pg.url(port) };
}

// Первый запуск: экран «адрес сервера + вход» → регистрация устройства на сервере (§6.1).
function askForDevice(): Promise<Device> {
  return new Promise(resolve => {
    ipcMain.removeHandler('register');
    ipcMain.handle('setup-defaults', () => ({ serverUrl: readConfig().serverUrl ?? '', deviceName: readConfig().deviceName ?? hostname() }));
    ipcMain.handle('register', async (_e, input: { serverUrl: string; email: string; password: string; deviceName: string }) => {
      try {
        const serverUrl = normalizeServerUrl(input.serverUrl);
        // net.fetch — сетевой стек Chromium: доверяет сертификатам из хранилища Windows (корпоративный CA), проверка TLS включена.
        const r = await net.fetch(`${serverUrl}/api/auth/device`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sync-Protocol': String(SYNC_PROTOCOL) },
          body: JSON.stringify({ email: input.email, password: input.password, deviceName: input.deviceName || hostname(), appVersion: app.getVersion() }),
        });
        const body = await r.json().catch(() => ({})) as { error?: { message?: string }; deviceId?: string; token?: string; user?: { id: string; organizationId: string; role: string; name: string } };
        if (!r.ok || !body.token || !body.user || !body.deviceId) return { ok: false, message: body.error?.message ?? `Сервер ответил ${r.status}` };
        writeConfig({ serverUrl, deviceName: input.deviceName });
        resolve({ deviceId: body.deviceId, token: body.token, userId: body.user.id, organizationId: body.user.organizationId, role: body.user.role, name: body.user.name, serverUrl });
        return { ok: true };
      } catch (e) {
        return { ok: false, message: (e as Error).message.includes('ERR_') ? `Сервер недоступен или сертификат HTTPS не доверенный: ${(e as Error).message}` : (e as Error).message };
      }
    });
    void win?.loadFile(path.join(RES.ui, 'setup.html'));
  });
}

async function waitForReplica(db: ReturnType<typeof drizzle>) {
  status('Загрузка данных с сервера…');
  const until = Date.now() + 10 * 60_000;
  for (;;) {
    const [st] = await db.select().from(syncState).where(eq(syncState.id, 1));
    if (!st || !st.snapshotRequired || ['revoked', 'outdated'].includes(st.status)) return;
    if (st.status === 'offline' && st.lastPullAt) return; // есть прежняя реплика — открываем её
    if (Date.now() > until) return;
    await new Promise(r => setTimeout(r, 500));
  }
}

async function boot() {
  createWindow();
  const secrets = loadSecrets(DATA.secrets);
  const db0 = await startDatabase(secrets);
  const db = drizzle(pool!);
  if (!secrets.device) {
    status('Подключение к серверу организации');
    secrets.device = await askForDevice();
    saveSecrets(DATA.secrets, secrets);
    await initSyncState(db, { serverUrl: secrets.device.serverUrl, deviceId: secrets.device.deviceId, userId: secrets.device.userId, organizationId: secrets.device.organizationId, userRole: secrets.device.role });
    void win?.loadFile(path.join(RES.ui, 'loading.html'));
  }
  const d = secrets.device;
  status('Запуск синхронизации…');
  children.push(startNodeChild('agent', RES.agent, { DATABASE_URL: db0.url, ERP_SERVER_URL: d.serverUrl, ERP_DEVICE_TOKEN: d.token }, DATA.logs));
  const nextPort = await freePort();
  const localSecret = randomBytes(32).toString('base64url');
  localOrigin = `http://127.0.0.1:${nextPort}`;
  status('Запуск интерфейса…');
  children.push(startNodeChild('next', RES.nextServer, {
    PORT: String(nextPort), HOSTNAME: '127.0.0.1', DATABASE_URL: db0.url, ERP_MODE: 'client', NEXT_TELEMETRY_DISABLED: '1',
    ERP_SERVER_URL: d.serverUrl, ERP_DEVICE_TOKEN: d.token, ERP_DEVICE_USER_ID: d.userId, ERP_LOCAL_SESSION: localSecret,
    SESSION_SECRET: randomBytes(32).toString('base64url'),
  }, DATA.logs));
  await waitHttpOk(`${localOrigin}/api/health`, 60_000);
  await waitForReplica(db);
  // Секрет окна — только этому окну (cookie на время запуска); другие программы на 127.0.0.1 данных не получат.
  await session.defaultSession.cookies.set({ url: localOrigin, name: 'erp_local', value: localSecret, httpOnly: true, sameSite: 'strict' });
  buildMenu();
  await win?.loadURL(localOrigin);
  log.info(`готово: ${localOrigin}`);
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Файл', submenu: [
      { label: 'Доступно офлайн…', click: () => void win?.loadURL(`${localOrigin}/offline`) },
      { label: 'Отключить устройство…', click: () => void disconnectDevice() },
      { type: 'separator' },
      { label: 'Выход', role: 'quit' },
    ] },
    { label: 'Вид', submenu: [{ role: 'reload', label: 'Обновить' }, { role: 'togglefullscreen', label: 'Во весь экран' }, { role: 'zoomIn', label: 'Крупнее' }, { role: 'zoomOut', label: 'Мельче' }, { role: 'resetZoom', label: 'Обычный размер' }] },
    { label: 'Справка', submenu: [
      { label: 'Открыть папку журналов', click: () => void shell.openPath(DATA.logs) },
      { label: 'О программе', click: () => void about() },
    ] },
  ]));
}

async function about() {
  const [st] = pool ? await drizzle(pool).select().from(syncState).where(eq(syncState.id, 1)).catch(() => []) : [];
  await dialog.showMessageBox(win!, {
    type: 'info', title: 'О программе', message: 'Энерготех — управление стройкой',
    detail: [`Версия приложения: ${app.getVersion()}`, `Версия протокола синхронизации: ${SYNC_PROTOCOL}`, `Сервер: ${st?.serverUrl ?? '—'}`,
      `Последняя синхронизация: ${st?.lastPullAt ? new Date(st.lastPullAt).toLocaleString('ru-RU') : '—'}`, `Состояние: ${st?.status ?? '—'}`, `Данные: ${DATA.root}`].join('\n'),
  });
}

// Отключить устройство: отозвать его на сервере (если есть связь) и забыть токен; реплика удалится при следующем входе.
async function disconnectDevice() {
  const { response } = await dialog.showMessageBox(win!, { type: 'warning', buttons: ['Отключить', 'Отмена'], defaultId: 1, cancelId: 1, title: 'Отключить устройство',
    message: 'Отключить этот компьютер от сервера?', detail: 'Токен устройства будет отозван, при следующем запуске потребуется вход. Данные на сервере не изменятся.' });
  if (response !== 0) return;
  const s = loadSecrets(DATA.secrets);
  if (s.device) await net.fetch(`${s.device.serverUrl}/api/admin/devices/${s.device.deviceId}/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${s.device.token}`, 'X-Sync-Protocol': String(SYNC_PROTOCOL), 'Content-Type': 'application/json' }, body: '{}' }).catch(e => log.warn(`revoke: ${(e as Error).message}`));
  forgetDevice(DATA.secrets);
  app.relaunch();
  app.quit();
}

async function shutdown() {
  for (const c of [...children].reverse()) await c.stop().catch(e => log.warn(`${c.name}: ${(e as Error).message}`));
  await pool?.end().catch(() => {});
  await pg?.stop().catch(e => log.warn(`pg stop: ${(e as Error).message}`));
  log.info('остановлено');
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', e => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  void shutdown().finally(() => app.exit(0));
});

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  return boot();
}).catch(async e => {
  log.error(e);
  // Сначала остановить процессы: модальное окно блокирует, и при принудительном закрытии PostgreSQL остался бы висеть.
  quitting = true;
  await shutdown();
  dialog.showErrorBox('Энерготех не запустился', `${(e as Error).message}\n\nЖурналы: ${DATA.logs}`);
  app.exit(1);
});

