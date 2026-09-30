import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as s from '@/db/schema';
import { syncState } from '@/client/db/schema';
import { includeCreatedProject } from '@/client/local/status';
import { scopeToSave } from '@/lib/offline-scope';
import { runCommand } from '@/server/domain/registry';
import type { Actor } from '@/server/domain/context';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser, grant } from './helpers/fixtures';
import { EmulatedClient } from './helpers/sync-client';

// Ошибка из эксплуатации (0.5.0): в десктопе создали объект — на сервере он есть, на ноутбуке не виден,
// повторное создание — «уже существует». Причина: сохранённый явный набор «Доступно офлайн» не включал новый объект.
let server: TestDb;
const clients: EmulatedClient[] = [];
beforeAll(async () => { server = await createMigratedDb(); });
afterAll(async () => { for (const c of clients) await c.drop(); await server?.drop(); });

const run = (actor: Actor, name: string, input: unknown) => runCommand({ db: server.db, actor, ip: null, userAgent: 't' }, name, input) as Promise<{ id: string }>;
const client = async (u: Actor) => { const c = await EmulatedClient.create(server, u); clients.push(c); expect(await c.sync()).toBe(true); return c; };
const scopeOf = async (c: EmulatedClient) => (await c.local.db.select().from(syncState).where(eq(syncState.id, 1)))[0].offlineScope;

describe('новый объект, созданный в десктопе, появляется на ноутбуке', () => {
  it('явный набор «Доступно офлайн» (РП): созданный объект добавляется в набор и загружается', async () => {
    const org = await createOrg(server.db);
    const pm = await createUser(server.db, org.id, 'project_manager');
    const p1 = await createProject(server.db, org.id);
    await grant(server.db, pm.id, p1.id, 'edit');
    const c = await client(pm);
    await c.agent.setOfflineScope([p1.id]);
    expect(await c.sync()).toBe(true);

    const created = await run(pm, 'projects.create', { name: 'Блюхеро', code: `B-${crypto.randomUUID().slice(0, 6)}` });
    expect(await includeCreatedProject(c.local.db, created.id, false)).toBe(true);
    expect(await scopeOf(c)).toEqual([p1.id, created.id]);
    expect(await c.sync()).toBe(true);
    expect(await c.ids('projects')).toEqual(expect.arrayContaining([p1.id, created.id]));
  });

  it('директор (набор по умолчанию пуст): созданный объект попадает в набор', async () => {
    const org = await createOrg(server.db);
    const director = await createUser(server.db, org.id, 'director');
    const c = await client(director);
    const created = await run(director, 'projects.create', { name: 'Новый', code: `N-${crypto.randomUUID().slice(0, 6)}` });
    expect(await includeCreatedProject(c.local.db, created.id, true)).toBe(true);
    expect(await c.sync()).toBe(true);
    expect(await c.ids('projects')).toContain(created.id);
  });

  it('набор по умолчанию (не директор) — ничего менять не нужно: объект приезжает сам', async () => {
    const org = await createOrg(server.db);
    const pm = await createUser(server.db, org.id, 'project_manager');
    const c = await client(pm);
    const created = await run(pm, 'projects.create', { name: 'Сам', code: `S-${crypto.randomUUID().slice(0, 6)}` });
    expect(await includeCreatedProject(c.local.db, created.id, false)).toBe(false);
    expect(await scopeOf(c)).toBeNull();
    expect(await c.sync()).toBe(true);
    expect(await c.ids('projects')).toContain(created.id);
  });
});

describe('экран «Доступно офлайн»', () => {
  it('отмечены все доступные (не директор) — сохраняется набор по умолчанию, чтобы новые объекты приезжали сами', () => {
    const all = [{ id: 'a' }, { id: 'b' }];
    expect(scopeToSave(new Set(['a', 'b']), all, false)).toBeNull();
    expect(scopeToSave(new Set(['a']), all, false)).toEqual(['a']);
    // Директору по умолчанию — пусто, поэтому явный список сохраняется всегда.
    expect(scopeToSave(new Set(['a', 'b']), all, true)).toEqual(['a', 'b']);
  });
});

describe('повторный код объекта', () => {
  it('понятный отказ с кодом объекта, а не общий текст', async () => {
    const org = await createOrg(server.db);
    const director = await createUser(server.db, org.id, 'director');
    const code = `D-${crypto.randomUUID().slice(0, 6)}`;
    await run(director, 'projects.create', { name: 'Первый', code });
    const err = await run(director, 'projects.create', { name: 'Второй', code }).catch(e => e);
    expect(err).toMatchObject({ status: 409 });
    expect(err.message).toContain(code);
    expect((await server.db.select().from(s.projects).where(eq(s.projects.code, code))).length).toBe(1);
  });
});
