import { Client } from 'pg';
import { sql } from 'drizzle-orm';
import type { Db } from '@/server/db/types';
import type { SessionUser } from '@/server/auth/session';
import { isOrgWide } from '@/server/domain/authz';
import { CHANGES_CHANNEL, type ChangeSignal } from '@/server/domain/changes';
import { visibleProjectIds } from '@/server/read/overview';

// Хаб изменений (§6.5): одно LISTEN-соединение на экземпляр приложения раздаёт сигналы подписчикам SSE.
// Пример из жизни: один диспетчер слушает рацию и обзванивает только тех, кого касается сообщение.

export type Subscription = {
  user: SessionUser;
  // Перепроверка сессии (блокировка, смена пароля): null — поток закрывается.
  revalidate: () => Promise<SessionUser | null>;
  send: (signal: { maxSeq: number }) => void;
  close: () => void;
};
type Sub = Subscription & { projects: Set<string> | 'all' };

export const CHANGE_LOG_RETENTION_DAYS = 90; // Допущение §14
const DAY_MS = 86400000;

export class ChangeHub {
  private subs = new Set<Sub>();
  private client: Client | null = null;
  private stopped = false;
  private retryMs = 1000;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private starting: Promise<void> | null = null;

  constructor(private readonly opts: { connectionString: string; db: Db; log?: (m: string) => void }) {}

  start() {
    this.stopped = false;
    this.starting ??= this.connect();
    if (!this.pruneTimer) {
      void this.prune();
      this.pruneTimer = setInterval(() => void this.prune(), DAY_MS);
      this.pruneTimer.unref?.();
    }
    return this.starting;
  }

  async stop() {
    this.stopped = true;
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = null;
    for (const s of this.subs) s.close();
    this.subs.clear();
    const c = this.client; this.client = null; this.starting = null;
    await c?.end().catch(() => {});
  }

  get size() { return this.subs.size; }

  async subscribe(s: Subscription) {
    const sub: Sub = { ...s, projects: await this.projectsOf(s.user) };
    this.subs.add(sub);
    return () => { this.subs.delete(sub); };
  }

  // Удаление записей журнала старше срока хранения (§4.2).
  async prune() {
    try { await this.opts.db.execute(sql`delete from change_log where changed_at < now() - make_interval(days => ${CHANGE_LOG_RETENTION_DAYS})`); }
    catch (e) { this.log(`change_log prune: ${(e as Error).message}`); }
  }

  private async projectsOf(user: SessionUser): Promise<Sub['projects']> {
    return isOrgWide(user) ? 'all' : new Set(await visibleProjectIds(this.opts.db, user));
  }

  private async connect(): Promise<void> {
    const client = new Client({ connectionString: this.opts.connectionString });
    client.on('notification', n => { if (n.channel === CHANGES_CHANNEL && n.payload) void this.dispatch(JSON.parse(n.payload) as ChangeSignal); });
    client.on('error', e => this.log(`LISTEN: ${e.message}`));
    client.on('end', () => { if (this.client === client) { this.client = null; this.reconnect(); } });
    try {
      await client.connect();
      await client.query(`listen ${CHANGES_CHANNEL}`);
      this.client = client;
      this.retryMs = 1000;
    } catch (e) {
      this.log(`LISTEN connect: ${(e as Error).message}`);
      await client.end().catch(() => {});
      this.reconnect();
    }
  }

  // Переподключение с паузой до 30 с; после него подписчики получают сигнал «могло что-то измениться».
  private reconnect() {
    if (this.stopped) return;
    const wait = this.retryMs; this.retryMs = Math.min(this.retryMs * 2, 30000);
    setTimeout(() => {
      if (this.stopped) return;
      this.starting = this.connect().then(() => { if (this.client) for (const s of this.subs) s.send({ maxSeq: -1 }); });
    }, wait).unref?.();
  }

  private async dispatch(signal: ChangeSignal) {
    for (const sub of [...this.subs]) {
      if (sub.user.organizationId !== signal.org) continue;
      try {
        // Изменения уровня организации могли поменять роль, блокировку или доступы — перепроверяем подписчика.
        if (signal.orgWide) {
          const fresh = await sub.revalidate();
          if (!fresh) { this.subs.delete(sub); sub.close(); continue; }
          sub.user = fresh;
          sub.projects = await this.projectsOf(fresh);
          sub.send({ maxSeq: signal.maxSeq });
          continue;
        }
        if (sub.projects === 'all' || signal.projectIds.some(p => (sub.projects as Set<string>).has(p))) sub.send({ maxSeq: signal.maxSeq });
      } catch (e) { this.log(`dispatch: ${(e as Error).message}`); }
    }
  }

  // Для тестов: pid LISTEN-соединения.
  async listenerPid() {
    const r = await this.client?.query<{ pid: number }>('select pg_backend_pid() as pid');
    return r?.rows[0]?.pid;
  }

  private log(m: string) { (this.opts.log ?? console.error)(`[change-hub] ${m}`); }
}
