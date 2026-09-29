import { afterAll, beforeAll, expect, it } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpTransport } from '@/client/sync/http-transport';
import { SyncHttpError } from '@/client/sync/transport';

let srv: http.Server; let base = '';
const seen: { url: string; auth?: string; proto?: string }[] = [];
beforeAll(async () => {
  srv = http.createServer((req, res) => {
    seen.push({ url: req.url!, auth: req.headers.authorization, proto: req.headers['x-sync-protocol'] as string });
    if (req.url!.startsWith('/api/sync/pull')) { res.writeHead(410, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Журнал устарел' } })); return; }
    if (req.url!.startsWith('/api/sync/snapshot')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ entity: 'tasks', rows: [], nextCursor: null, snapshotSeq: 5, scope: [] })); return; }
    if (req.url!.startsWith('/api/sync/events')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('retry: 3000\nevent: ready\ndata: {"maxSeq":1}\n\n');
      setTimeout(() => { res.write(': ping\n\nevent: changes\ndata: {"maxSeq":7}\n\n'); res.end(); }, 20);
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(r => srv.close(() => r())));

it('токен и версия протокола в каждом запросе; набор объектов: null — без параметра, [] — пустой', async () => {
  const t = new HttpTransport(base, 'erpd_test');
  await t.snapshot('tasks', null, null);
  await t.snapshot('tasks', [], 'c1');
  expect(seen[0]).toMatchObject({ auth: 'Bearer erpd_test', proto: '1' });
  expect(seen[0].url).toBe('/api/sync/snapshot?entity=tasks');
  expect(seen[1].url).toBe('/api/sync/snapshot?entity=tasks&cursor=c1&projects=');
});

it('ошибка сервера → SyncHttpError с кодом (410 — повторная загрузка)', async () => {
  const t = new HttpTransport(base, 'erpd_test');
  await expect(t.pull(3, null)).rejects.toMatchObject({ status: 410, message: 'Журнал устарел' });
  await expect(t.pull(3, null)).rejects.toBeInstanceOf(SyncHttpError);
});

it('SSE: ready и changes разбираются, комментарии-heartbeat пропускаются, конец потока завершает подписку', async () => {
  const t = new HttpTransport(base, 'erpd_test');
  const got: number[] = [];
  await t.events(s => got.push(s), new AbortController().signal);
  expect(got).toEqual([1, 7]);
});
