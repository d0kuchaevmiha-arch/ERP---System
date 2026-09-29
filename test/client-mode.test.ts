import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { syncState } from '@/client/db/schema';
import { runClientMigrations } from '@/client/db/migrate';
import { initSyncState } from '@/client/sync/agent';
import { forwardCommand } from '@/client/local/forward';
import { localUser } from '@/client/local/session';
import { createEmptyDb, type TestDb } from './helpers/db';
import { createOrg, createUser } from './helpers/fixtures';
import { users } from '@/db/schema';

let local: TestDb; let srv: http.Server; let base = '';
const got: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
let userId = ''; let orgId = '';

beforeAll(async () => {
  local = await createEmptyDb();
  await runClientMigrations(local.pool);
  const org = await createOrg(local.db); orgId = org.id;
  userId = (await createUser(local.db, org.id, 'foreman')).id;
  await initSyncState(local.db, { serverUrl: 'http://x', deviceId: crypto.randomUUID(), userId, organizationId: orgId, userRole: 'foreman' });
  await local.db.update(syncState).set({ lastSeq: 10, snapshotRequired: false });
  srv = http.createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; });
    req.on('end', () => {
      got.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      if (req.url === '/api/v1/fail') { res.writeHead(422, { 'content-type': 'application/json' }); res.end('{"error":{"message":"Проверьте поля"}}'); return; }
      if (req.url === '/api/v1/revoked') { res.writeHead(401); res.end('{}'); return; }
      res.writeHead(201, { 'content-type': 'application/json', 'x-change-seq': '12' }); res.end('{"data":{"id":"x"}}');
    });
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>(r => srv.close(() => r())); await local?.drop(); });

describe('десктоп: запись через сервер (P3)', () => {
  it('команда уходит на сервер с токеном, версией протокола и ключом; ответ — после того, как реплика догнала X-Change-Seq', async () => {
    setTimeout(() => { local.db.update(syncState).set({ lastSeq: 12 }).where(eq(syncState.id, 1)).then(() => {}, () => {}); }, 300);
    const started = Date.now();
    const r = await forwardCommand({ db: local.db, serverUrl: base, token: 'erpd_t', method: 'POST', path: '/api/v1/expenses', body: '{"amount":"1.00"}', idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    expect(r.status).toBe(201);
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(250);
    expect(waited).toBeLessThan(2000); // дождались реплику, а не таймаут 5 с
    const req = got.at(-1)!;
    expect(req).toMatchObject({ method: 'POST', url: '/api/v1/expenses', body: '{"amount":"1.00"}' });
    expect(req.headers).toMatchObject({ authorization: 'Bearer erpd_t', 'x-sync-protocol': '1', 'idempotency-key': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  });

  it('без ключа от окна — ключ всё равно генерируется; ошибки сервера передаются как есть', async () => {
    const r = await forwardCommand({ db: local.db, serverUrl: base, token: 'erpd_t', method: 'POST', path: '/api/v1/fail', body: '{}' });
    expect(r).toMatchObject({ status: 422 });
    expect(JSON.parse(r.body).error.message).toBe('Проверьте поля');
    expect(got.at(-1)!.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('нет связи → 503 с понятным текстом; отозванное устройство → 401 с подсказкой', async () => {
    const off = await forwardCommand({ db: local.db, serverUrl: 'http://127.0.0.1:1', token: 'erpd_t', method: 'POST', path: '/api/v1/expenses', body: '{}', timeoutMs: 2000 });
    expect(off.status).toBe(503);
    expect(JSON.parse(off.body).error.message).toMatch(/Нет связи с сервером/);
    const rev = await forwardCommand({ db: local.db, serverUrl: base, token: 'erpd_t', method: 'POST', path: '/api/v1/revoked', body: '{}' });
    expect(rev.status).toBe(401);
    expect(JSON.parse(rev.body).error.message).toMatch(/подключите устройство заново/);
  });
});

describe('десктоп: локальная сессия', () => {
  const secret = 's'.repeat(40);
  it('только с cookie окна приложения; заблокированный в реплике пользователь — нет', async () => {
    expect((await localUser(local.db, secret, { secret, userId }))?.id).toBe(userId);
    expect(await localUser(local.db, undefined, { secret, userId })).toBeNull();
    expect(await localUser(local.db, 'x'.repeat(40), { secret, userId })).toBeNull();
    await local.db.update(users).set({ isActive: false }).where(eq(users.id, userId));
    expect(await localUser(local.db, secret, { secret, userId })).toBeNull();
  });
});
