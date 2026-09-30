import { expect, test, type Page } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SERVER, demoPassword, launch, leftoverProcesses, mainWindow, serverLogin, unlock } from './helpers';

// P4 (§11, §12): офлайн-ввод на собранном приложении. «Сеть» — TCP-прокси между приложением и сервером docker compose:
// закрыли прокси — связи нет (как пропал VPN), открыли на том же порту — связь вернулась.
const dataDir = path.join(mkdtempSync(path.join(tmpdir(), 'erp-e2e-off-')), 'Прораб', 'ERP-Energotech');
const tag = Date.now().toString(36);
const upstream = new URL(SERVER);

class Link {
  private server: net.Server | null = null;
  private sockets = new Set<net.Socket>();
  constructor(readonly port: number) {}
  static async free() { const s = net.createServer(); await new Promise<void>(r => s.listen(0, '127.0.0.1', r)); const port = (s.address() as net.AddressInfo).port; await new Promise(r => s.close(r)); return new Link(port); }
  get url() { return `http://127.0.0.1:${this.port}`; }
  async up() {
    this.server = net.createServer(client => {
      const to = net.connect(Number(upstream.port || 80), upstream.hostname);
      for (const s of [client, to]) { this.sockets.add(s); s.on('close', () => this.sockets.delete(s)); s.on('error', () => {}); }
      client.pipe(to); to.pipe(client);
    });
    await new Promise<void>(r => this.server!.listen(this.port, '127.0.0.1', r));
  }
  async down() {
    for (const s of this.sockets) s.destroy();
    await new Promise(r => this.server?.close(r));
    this.server = null;
  }
}

const post = (page: Page, resource: string, body: Record<string, unknown>) => page.evaluate(async ([r, b]) => {
  const x = await fetch(`/api/v1/${r}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify(b) });
  return { status: x.status, body: await x.json().catch(() => ({})) };
}, [resource, body] as const);
const overview = (page: Page) => page.evaluate(async () => (await fetch('/api/v1/overview')).json());

test.describe.configure({ mode: 'serial' });
let link: Link;
test.beforeAll(async () => { link = await Link.free(); });

test('подключение через «сеть», затем связь пропадает: ввод всех офлайн-команд, online_only — «нужна связь»', async () => {
  await link.up();
  const app = await launch(dataDir);
  try {
    const setup = await app.firstWindow();
    await setup.waitForSelector('#server', { timeout: 120_000 });
    await setup.fill('#server', link.url);
    await setup.fill('#email', 'manager@monolit.local');
    await setup.fill('#password', demoPassword());
    await setup.fill('#device', `E2E офлайн ${tag}`);
    await setup.click('#submit');
    const page = await mainWindow(app);
    await expect(page.locator('.ctx-sync')).toContainText('синхронизировано', { timeout: 60_000 });

    await link.down();
    const ov = await overview(page);
    const project = ov.projects.find((p: { code: string }) => p.code === 'PRJ-001');
    const task = ov.tasks.find((t: { projectId: string; progress: number }) => t.projectId === project.id && t.progress < 100);
    const warehouse = ov.warehouses.find((w: { projectId: string | null }) => w.projectId === project.id) ?? ov.warehouses[0];
    const material = ov.materials.find((m: { balance: number }) => m.balance >= 2);
    const writes = [
      await post(page, 'expenses', { projectId: project.id, category: 'Прочее', description: `Офлайн ${tag}`, amount: '123.45' }),
      await post(page, 'progress', { taskId: task.id, progress: Math.min(100, task.progress + 5) }),
      await post(page, 'purchases', { projectId: project.id, materialId: material.id, quantity: 1, unitPrice: '10.00' }),
      await post(page, 'movements', { materialId: material.id, warehouseId: warehouse.id, quantity: 1, type: 'receipt' }),
      await post(page, 'movements', { materialId: material.id, warehouseId: warehouse.id, quantity: 1, type: 'issue' }),
    ];
    for (const w of writes) expect(w.status, JSON.stringify(w.body)).toBe(201);
    const onlineOnly = await post(page, 'budgets', { projectId: project.id, category: 'Прочее', amount: '1.00' });
    expect(onlineOnly.status).toBe(503);
    expect(onlineOnly.body.error.message).toContain('Нужна связь');
    await page.reload();
    await expect(page.locator('.ctx-sync')).toContainText(`Офлайн · ${writes.length} изменений в очереди`, { timeout: 60_000 });
    await page.goto(new URL('/?view=money&sub=expenses', page.url()).toString());
    await expect(page.locator('tr', { hasText: `Офлайн ${tag}` })).toContainText('не синхронизировано');
    // Экспорт очереди (§8).
    const exported = await page.evaluate(async () => (await fetch('/api/client/outbox/export')).json());
    expect(exported.ops).toHaveLength(writes.length);
    expect(JSON.stringify(exported)).not.toContain('erpd_');
  } finally { await app.close(); }
  await expect.poll(() => leftoverProcesses(dataDir), { timeout: 20_000 }).toEqual([]);
});

test('запуск без связи: вход по сохранённой проверке; неверный пароль — отказ; очередь на месте', async () => {
  const app = await launch(dataDir);
  try {
    const w = await app.firstWindow();
    await w.waitForSelector('#login-password', { timeout: 120_000 });
    await w.fill('#login-password', 'неверный-пароль');
    await w.click('#submit');
    await expect(w.locator('#error')).toContainText('Неверный пароль', { timeout: 20_000 });
    const { page } = await unlock(app);
    await expect(page.locator('.ctx-sync')).toContainText('в очереди', { timeout: 60_000 });
  } finally { await app.close(); }
  await expect.poll(() => leftoverProcesses(dataDir), { timeout: 20_000 }).toEqual([]);
});

test('связь вернулась: очередь уходит на сервер, данные видны в браузере с происхождением «офлайн»', async () => {
  await link.up();
  const app = await launch(dataDir);
  try {
    const { page } = await unlock(app);
    await expect(page.locator('.ctx-sync')).toContainText('синхронизировано', { timeout: 90_000 });
    expect((await overview(page)).sync.queued).toBe(0);
    const director = await serverLogin('director@monolit.local', demoPassword());
    const srv = await (await fetch(`${SERVER}/api/v1/overview`, { headers: { cookie: director } })).json();
    const e = srv.expenses.find((x: { description: string }) => x.description === `Офлайн ${tag}`);
    expect(e).toMatchObject({ origin: 'offline', amount: '123.45' });
    expect(e.deviceId).toBeTruthy();
    expect(new Date(e.deviceCreatedAt).getTime()).toBeLessThan(new Date(e.serverReceivedAt).getTime());
  } finally { await app.close(); await link.down(); }
  await expect.poll(() => leftoverProcesses(dataDir), { timeout: 20_000 }).toEqual([]);
});
