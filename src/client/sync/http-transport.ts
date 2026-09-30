import type { PushOp, PushResult } from '@/server/sync/push';
import { SyncHttpError, type PullResult, type ScopeInfo, type SnapshotPage, type SyncTransport } from './transport';

export const SYNC_PROTOCOL = 1;

// HTTP-транспорт sync-agent: токен устройства + версия протокола (§6). Проверка TLS не отключается никогда.
export class HttpTransport implements SyncTransport {
  constructor(private readonly base: string, private readonly token: string, private readonly timeoutMs = 30_000) {}

  headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.token}`, 'X-Sync-Protocol': String(SYNC_PROTOCOL), ...extra };
  }

  private async get<T>(path: string, params: Record<string, string | null | undefined>): Promise<T> {
    const url = new URL(path, this.base);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
    const r = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(this.timeoutMs) });
    const body = await r.json().catch(() => ({})) as { error?: { message?: string } };
    if (!r.ok) throw new SyncHttpError(body.error?.message ?? `HTTP ${r.status}`, r.status);
    return body as T;
  }

  // projects: null — набор по умолчанию (параметр не передаётся), [] — ни одного объекта.
  private static projects(p: string[] | null) { return p === null ? undefined : p.join(','); }

  scope() { return this.get<ScopeInfo>('/api/sync/scope', {}); }
  snapshot(entity: string, projects: string[] | null, cursor: string | null) {
    return this.get<SnapshotPage>('/api/sync/snapshot', { entity, cursor, projects: HttpTransport.projects(projects) });
  }
  pull(since: number, projects: string[] | null) {
    return this.get<PullResult>('/api/sync/pull', { since: String(since), projects: HttpTransport.projects(projects) });
  }

  // Отправка очереди (§6.4): порядок операций сохраняется, повтор безопасен (op_id).
  async push(ops: PushOp[]) {
    const r = await fetch(new URL('/api/sync/push', this.base), { method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }), body: JSON.stringify({ ops }), signal: AbortSignal.timeout(this.timeoutMs) });
    const body = await r.json().catch(() => ({})) as { results?: PushResult[]; error?: { message?: string } };
    if (!r.ok || !body.results) throw new SyncHttpError(body.error?.message ?? `HTTP ${r.status}`, r.status);
    return { results: body.results };
  }

  // Подписка на сигналы сервера (SSE, §6.5). Завершается, когда сервер закрыл поток или сработал abort.
  async events(onChange: (maxSeq: number) => void, signal: AbortSignal) {
    const r = await fetch(new URL('/api/sync/events', this.base), { headers: this.headers({ Accept: 'text/event-stream' }), signal });
    if (!r.ok || !r.body) throw new SyncHttpError(`SSE: HTTP ${r.status}`, r.status);
    const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      buf += value;
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if ((ev === 'changes' || ev === 'ready') && data) onChange((JSON.parse(data) as { maxSeq: number }).maxSeq);
      }
    }
  }
}
