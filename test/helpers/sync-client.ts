import { eq } from 'drizzle-orm';
import * as s from '@/db/schema';
import { runClientMigrations } from '@/client/db/migrate';
import { SyncAgent, initSyncState } from '@/client/sync/agent';
import { REPLICA_TABLES } from '@/client/sync/apply';
import { SyncHttpError, type SyncTransport } from '@/client/sync/transport';
import { writeLocal } from '@/client/offline/write';
import { listOutbox, localMarks } from '@/client/offline/read';
import { DomainError } from '@/server/domain/errors';
import { pushOps } from '@/server/sync/push';
import { getScope, pull, resolveScope, snapshot } from '@/server/sync/service';
import { createEmptyDb, type TestDb } from './db';

type User = typeof s.users.$inferSelect;
// Ответ «как по сети»: JSON туда и обратно (даты → строки).
const json = <T>(v: unknown): T => JSON.parse(JSON.stringify(v));

// Эмулированный десктоп-клиент (§11): своя локальная БД (реплика + outbox), свой sync-agent и транспорт
// без HTTP, но с теми же правилами: каждый вызов заново читает пользователя, ошибки домена → коды HTTP.
// Переключатель online эмулирует пропажу сети; dropNextPushResponse — обрыв после того, как сервер принял пакет.
export class EmulatedClient {
  online = true;
  dropNextPushResponse = false;
  readonly deviceId = crypto.randomUUID();
  agent!: SyncAgent;
  local!: TestDb;

  private constructor(private readonly server: TestDb, readonly userId: string) {}

  static async create(server: TestDb, user: User) {
    const c = new EmulatedClient(server, user.id);
    c.local = await createEmptyDb();
    await runClientMigrations(c.local.pool);
    await server.db.insert(s.devices).values({ id: c.deviceId, userId: user.id, name: 'emulated', appVersion: 'test', tokenHash: crypto.randomUUID() });
    await initSyncState(c.local.db, { serverUrl: 'http://test', deviceId: c.deviceId, userId: user.id, organizationId: user.organizationId, userRole: user.role });
    c.agent = new SyncAgent({ db: c.local.db, transport: c.transport() });
    return c;
  }

  private transport(): SyncTransport {
    const db = this.server.db;
    const me = async () => (await db.select().from(s.users).where(eq(s.users.id, this.userId)))[0];
    const call = async <T>(fn: () => Promise<unknown>): Promise<T> => {
      if (!this.online) throw new TypeError('fetch failed');
      try { return json<T>(await fn()); } catch (e) { if (e instanceof DomainError) throw new SyncHttpError(e.message, e.status); throw e; }
    };
    return {
      scope: () => call(async () => { const u = await me(); return { ...(await getScope(db, u)), user: { id: u.id, name: u.name, role: u.role, organizationId: u.organizationId } }; }),
      snapshot: (entity, projects, cursor) => call(async () => snapshot(db, await resolveScope(db, await me(), projects), { entity, cursor })),
      pull: (since, projects) => call(async () => pull(db, await resolveScope(db, await me(), projects), { since })),
      push: ops => call(async () => {
        const results = await pushOps(db, await me(), this.deviceId, json(ops));
        if (this.dropNextPushResponse) { this.dropNextPushResponse = false; throw new TypeError('fetch failed: connection reset'); }
        return { results };
      }),
    };
  }

  // Пользователь устройства — из реплики, как в локальном Next.
  async me() {
    const [u] = await this.local.db.select().from(s.users).where(eq(s.users.id, this.userId));
    return u;
  }
  async write(command: string, payload: Record<string, unknown>) {
    return writeLocal(this.local.db, await this.me(), command, payload);
  }
  // Один проход агента; ошибки сети не бросаются (как в цикле агента), возвращается успех.
  async sync() {
    try { await this.agent.syncOnce(); return true; } catch { return false; }
  }
  outbox() { return listOutbox(this.local.db); }
  marks() { return localMarks(this.local.db); }
  async ids(entity: string) {
    const t = REPLICA_TABLES[entity];
    return (await this.local.db.select({ id: t.id }).from(t)).map(r => r.id as string);
  }
  async row<T = Record<string, unknown>>(entity: string, id: string): Promise<T | undefined> {
    const t = REPLICA_TABLES[entity];
    const [r] = await this.local.db.select().from(t).where(eq(t.id, id));
    return r as T | undefined;
  }
  drop() { return this.local.drop(); }
}
