import type { SyncAgent } from './agent';
import type { HttpTransport } from './http-transport';
import { isOutdated, isRevoked } from './transport';

// Цикл sync-agent (§6.6 п. 2–3): pull → ждать сигнал SSE или 30 с; при ошибках — пауза с удвоением до 5 мин.
// Отозванное устройство и устаревшая версия протокола — редкие проверки раз в 5 мин (статус виден в интерфейсе).
export function startSyncLoop(opts: { agent: SyncAgent; transport: HttpTransport; log: (m: string) => void; pollMs?: number }) {
  const pollMs = opts.pollMs ?? 30_000;
  const stop = new AbortController();
  let wake: (() => void) | null = null;
  const sleep = (ms: number) => new Promise<void>(res => {
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); wake = null; res(); }
    wake = done;
    stop.signal.addEventListener('abort', done, { once: true });
  });

  // Сигналы сервера будят цикл сразу; поток переподключается сам.
  const events = (async () => {
    while (!stop.signal.aborted) {
      try { await opts.transport.events(() => wake?.(), stop.signal); }
      catch (e) { if (!stop.signal.aborted) opts.log(`SSE: ${(e as Error).message}`); }
      if (!stop.signal.aborted) await new Promise(r => setTimeout(r, 5000));
    }
  })();

  const main = (async () => {
    let backoff = 5000;
    while (!stop.signal.aborted) {
      try {
        const n = await opts.agent.syncOnce();
        if (n) opts.log(`pull: применено изменений ${n}`);
        backoff = 5000;
        await sleep(pollMs);
      } catch (e) {
        opts.log(`sync: ${(e as Error).message}`);
        if (isRevoked(e) || isOutdated(e)) await sleep(300_000);
        else { await sleep(backoff); backoff = Math.min(backoff * 2, 300_000); }
      }
    }
  })();

  return {
    // Разбудить немедленно (например, после записи с этого же устройства).
    nudge: () => wake?.(),
    async stop() { stop.abort(); await Promise.allSettled([events, main]); },
  };
}
