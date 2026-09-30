import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, SERVER, demoPassword, electronExe, launch, leftoverProcesses, mainWindow, serverLogin, unlock } from './helpers';

// Каталог данных — отдельный на прогон (как %APPDATA%\ERP-Energotech у пользователя), с кириллицей в пути (§13).
const dataDir = path.join(mkdtempSync(path.join(tmpdir(), 'erp-e2e-')), 'Пользователь Иванов', 'ERP-Energotech');
const tag = Date.now().toString(36);

test.describe.configure({ mode: 'serial' });

test('первый запуск: подключение устройства → загрузка реплики → данные объектов видны', async () => {
  const app = await launch(dataDir);
  try {
    const setup = await app.firstWindow();
    await setup.waitForSelector('#server', { timeout: 120_000 });
    await setup.fill('#server', SERVER);
    await setup.fill('#email', 'manager@monolit.local');
    await setup.fill('#password', demoPassword());
    await setup.fill('#device', `E2E ${tag}`);
    await setup.click('#submit');
    // Ошибка подключения показывается на экране — тест падает с её текстом, а не по таймауту.
    const failed = await setup.waitForSelector('#error:not([hidden])', { timeout: 20_000 }).then(() => true, () => false);
    if (failed) throw new Error(`Подключение не удалось: ${await setup.textContent('#error')}`);
    const page = await mainWindow(app);
    await expect(page.locator('body')).toContainText('Северный квартал', { timeout: 60_000 });
    await expect(page.locator('.ctx-sync')).toContainText('синхронизировано');
  } finally { await app.close(); }
});

test('после закрытия не остаётся процессов postgres / Next / sync-agent', async () => {
  await expect.poll(() => leftoverProcesses(dataDir), { timeout: 20_000 }).toEqual([]);
});

test('повторный запуск < 15 с (без учёта ввода пароля); порт 3000 занят сервером — работает; изменения в обе стороны', async () => {
  const started = Date.now();
  const app = await launch(dataDir);
  try {
    const { page, toLogin, toWindow } = await unlock(app, demoPassword(), started);
    await expect(page.locator('body')).toContainText('Северный квартал');
    const seconds = toLogin + toWindow;
    console.log(`повторный запуск: до экрана входа ${toLogin.toFixed(1)} с + после пароля ${toWindow.toFixed(1)} с = ${seconds.toFixed(1)} с`);
    expect(seconds).toBeLessThan(15);

    // Сервер → десктоп: директор в браузере вносит расход — он появляется в десктопе без перезагрузки.
    const director = await serverLogin('director@monolit.local', demoPassword());
    const ov = await (await fetch(`${SERVER}/api/v1/overview`, { headers: { cookie: director } })).json();
    const project = ov.projects.find((p: { code: string }) => p.code === 'PRJ-001');
    const fromServer = `С сервера ${tag}`;
    const r = await fetch(`${SERVER}/api/v1/expenses`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: director }, body: JSON.stringify({ projectId: project.id, category: 'Работы', description: fromServer, amount: '1.00' }) });
    expect(r.status).toBe(201);
    await page.goto(new URL('/?view=money&sub=expenses', page.url()).toString());
    await expect(page.locator('body')).toContainText(fromServer, { timeout: 15_000 });

    // Десктоп → сервер: запись из окна приложения уходит на сервер и сразу видна в реплике.
    const fromDesktop = `С десктопа ${tag}`;
    const res = await page.evaluate(async ([projectId, description]) => {
      const x = await fetch('/api/v1/expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, category: 'Работы', description, amount: '2.00' }) });
      return { status: x.status, text: x.status === 201 ? "" : await x.text(), origin: location.origin, overview: await (await fetch("/api/v1/overview")).json() };
    }, [project.id, fromDesktop]);
    expect(res.status, `${res.text} (${res.origin})`).toBe(201);
    expect(res.overview.expenses.some((e: { description: string }) => e.description === fromDesktop)).toBe(true);
    const onServer = await (await fetch(`${SERVER}/api/v1/overview`, { headers: { cookie: director } })).json();
    const saved = onServer.expenses.find((e: { description: string }) => e.description === fromDesktop);
    expect(saved).toBeTruthy();
    expect(saved.deviceId).toBeTruthy(); // происхождение: устройство записано

    // Второй запуск той же программы не открывает второй экземпляр, а завершается сразу.
    // Как пользователь: второй двойной клик по ярлыку (без отладочных аргументов Playwright).
    const [exe, args] = process.env.E2E_APP ? [process.env.E2E_APP, []] : [electronExe(), [ROOT]];
    const env2: NodeJS.ProcessEnv = { ...process.env, ERP_DATA_DIR: dataDir };
    delete env2.ELECTRON_RUN_AS_NODE; // даже пустое значение запускает electron.exe как Node
    const second = spawn(exe, args, { env: env2, stdio: ['ignore', 'pipe', 'pipe'] });
    let secondOut = ''; second.stdout!.on('data', d => { secondOut += d; }); second.stderr!.on('data', d => { secondOut += d; });
    const t0 = Date.now();
    const code = await new Promise<number | null>(res2 => second.on('exit', res2));
    expect(code, secondOut).toBe(0);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(app.windows().length).toBeGreaterThan(0);
  } finally { await app.close(); }
  await expect.poll(() => leftoverProcesses(dataDir), { timeout: 20_000 }).toEqual([]);
});

test('объект, созданный в десктопе при явном наборе «Доступно офлайн», сразу виден; повторный код — понятный отказ', async () => {
  const app = await launch(dataDir);
  try {
    const { page } = await unlock(app);
    // Явный набор: только PRJ-001 (как после «Сохранить» на экране «Доступно офлайн»).
    const ov = await page.evaluate(async () => (await fetch('/api/v1/overview')).json());
    const p1 = ov.projects.find((p: { code: string }) => p.code === 'PRJ-001');
    const saved = await page.evaluate(async id => (await fetch('/api/client/scope', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projects: [id] }) })).status, p1.id);
    expect(saved).toBe(200);
    await expect.poll(async () => (await page.evaluate(async () => (await fetch('/api/v1/overview')).json())).projects.length, { timeout: 60_000 }).toBe(1);

    const code = `E2E-${tag}`;
    const create = () => page.evaluate(async c => { const r = await fetch('/api/v1/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Объект из десктопа ${c}`, code: c }) }); return { status: r.status, body: await r.json() }; }, code);
    const first = await create();
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const after = await page.evaluate(async () => (await fetch('/api/v1/overview')).json());
    expect(after.projects.map((p: { code: string }) => p.code)).toEqual(expect.arrayContaining(['PRJ-001', code]));
    const again = await create();
    expect(again.status).toBe(409);
    expect(again.body.error.message).toContain(code);
    // Вернуть набор по умолчанию для следующих прогонов.
    await page.evaluate(async () => fetch('/api/client/scope', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projects: null }) }));
  } finally { await app.close(); }
  await expect.poll(() => leftoverProcesses(dataDir), { timeout: 20_000 }).toEqual([]);
});
