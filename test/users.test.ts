import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditLogs, users } from '@/db/schema';
import { runCommand } from '@/server/domain/registry';
import type { Actor } from '@/server/domain/context';
import { authenticate } from '@/server/auth/login';
import { signSession, verifySessionToken } from '@/server/auth/session';
import { listUsers } from '@/server/read/users';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser, PASSWORD } from './helpers/fixtures';

let t: TestDb;
beforeAll(async () => { t = await createMigratedDb(); });
afterAll(async () => { await t?.drop(); });
const run = <R = Record<string, unknown>>(actor: Actor, name: string, input: unknown) => runCommand({ db: t.db, actor, ip: null, userAgent: 'vitest' }, name, input) as Promise<R>;
const reload = async (id: string) => (await t.db.select().from(users).where(eq(users.id, id)))[0];
type Created = { user: { id: string; email: string; mustChangePassword: boolean }; temporaryPassword: string };

async function org() {
  const o = await createOrg(t.db);
  return { o, director: await createUser(t.db, o.id, 'director'), admin: await createUser(t.db, o.id, 'super_admin') };
}

describe('создание пользователя', () => {
  it('директор создаёт прораба: временный пароль, обязательная смена, вход работает', async () => {
    const { director } = await org();
    const r = await run<Created>(director, 'users.create', { name: 'Иван Прорабов', email: ' Ivan@Test.Local ', role: 'foreman' });
    expect(r.temporaryPassword).toHaveLength(16);
    expect(r.user).toMatchObject({ email: 'ivan@test.local', mustChangePassword: true });
    expect(r.user).not.toHaveProperty('passwordHash');
    const login = await authenticate(t.db, { email: 'ivan@test.local', password: r.temporaryPassword, ip: null });
    expect(login.ok && login.user.mustChangePassword).toBe(true);
    const log = await t.db.select().from(auditLogs).where(eq(auditLogs.entityId, r.user.id));
    expect(JSON.stringify(log)).not.toMatch(/passwordHash|password_hash/);
  });

  it('не-администратор не управляет пользователями', async () => {
    const { o } = await org();
    for (const role of ['project_manager', 'foreman', 'read_only']) {
      const u = await createUser(t.db, o.id, role);
      await expect(run(u, 'users.create', { name: 'Кто-то', email: `x-${role}@t.local`, role: 'foreman' })).rejects.toMatchObject({ status: 403 });
    }
  });

  it('назначить super_admin может только super_admin; email уникален (409)', async () => {
    const { director, admin } = await org();
    await expect(run(director, 'users.create', { name: 'Админ', email: 'a1@t.local', role: 'super_admin' })).rejects.toMatchObject({ status: 403 });
    await expect(run(admin, 'users.create', { name: 'Админ', email: 'a1@t.local', role: 'super_admin' })).resolves.toBeTruthy();
    await expect(run(admin, 'users.create', { name: 'Админ 2', email: 'A1@t.local', role: 'foreman' })).rejects.toMatchObject({ status: 409 });
  });
});

describe('изменение, блокировка, сброс пароля', () => {
  it('пользователь другой организации — «не найден»', async () => {
    const a = await org(); const b = await org();
    const foreignUser = await createUser(t.db, b.o.id, 'foreman');
    await expect(run(a.director, 'users.update', { userId: foreignUser.id, role: 'director' })).rejects.toMatchObject({ status: 404 });
    await expect(run(a.director, 'users.resetPassword', { userId: foreignUser.id })).rejects.toMatchObject({ status: 404 });
  });

  it('блокировка мгновенно рвёт сессию и запрещает вход; разблокировка возвращает вход', async () => {
    const { o, director } = await org();
    const u = await createUser(t.db, o.id, 'foreman');
    const token = signSession(u);
    await run(director, 'users.update', { userId: u.id, isActive: false });
    expect(await verifySessionToken(t.db, token)).toBeNull();
    expect((await authenticate(t.db, { email: u.email, password: PASSWORD, ip: null })).ok).toBe(false);
    await run(director, 'users.update', { userId: u.id, isActive: true });
    expect((await authenticate(t.db, { email: u.email, password: PASSWORD, ip: null })).ok).toBe(true);
  });

  it('нельзя заблокировать себя или сменить себе роль; директор не трогает администратора', async () => {
    const { director, admin } = await org();
    await expect(run(director, 'users.update', { userId: director.id, isActive: false })).rejects.toMatchObject({ status: 403 });
    await expect(run(director, 'users.update', { userId: director.id, role: 'foreman' })).rejects.toMatchObject({ status: 403 });
    await expect(run(director, 'users.update', { userId: director.id, name: 'Новое имя' })).resolves.toMatchObject({ name: 'Новое имя' });
    await expect(run(director, 'users.update', { userId: admin.id, isActive: false })).rejects.toMatchObject({ status: 403 });
  });

  it('сброс пароля: старый не работает, сессии отозваны, новый — временный', async () => {
    const { o, director } = await org();
    const u = await createUser(t.db, o.id, 'foreman');
    const token = signSession(u);
    const r = await run<Created>(director, 'users.resetPassword', { userId: u.id });
    expect(await verifySessionToken(t.db, token)).toBeNull();
    expect((await authenticate(t.db, { email: u.email, password: PASSWORD, ip: null })).ok).toBe(false);
    const login = await authenticate(t.db, { email: u.email, password: r.temporaryPassword, ip: null });
    expect(login.ok && login.user.mustChangePassword).toBe(true);
  });
});

describe('доступ к объектам', () => {
  it('выдача edit открывает запись, view — нет, отзыв закрывает; объект чужой организации — 404', async () => {
    const { o, director } = await org();
    const other = await org();
    const project = await createProject(t.db, o.id);
    const foreign = await createProject(t.db, other.o.id);
    const u = await createUser(t.db, o.id, 'foreman');
    const budget = { projectId: project.id, category: 'Работы', amount: '1.00' };
    await run(director, 'access.set', { userId: u.id, projectId: project.id, permission: 'view' });
    await expect(run(u, 'budgets.create', budget)).rejects.toMatchObject({ status: 403 });
    await run(director, 'access.set', { userId: u.id, projectId: project.id, permission: 'edit' });
    await expect(run(u, 'budgets.create', budget)).resolves.toBeTruthy();
    await run(director, 'access.remove', { userId: u.id, projectId: project.id });
    await expect(run(u, 'budgets.create', budget)).rejects.toMatchObject({ status: 403 });
    await expect(run(director, 'access.set', { userId: u.id, projectId: foreign.id, permission: 'edit' })).rejects.toMatchObject({ status: 404 });
  });

  it('список пользователей — только своей организации, с доступами, без хешей паролей', async () => {
    const { o, director } = await org();
    await org();
    const project = await createProject(t.db, o.id);
    const u = await createUser(t.db, o.id, 'foreman');
    await run(director, 'access.set', { userId: u.id, projectId: project.id, permission: 'edit' });
    const list = await listUsers(t.db, director);
    expect(list.every(x => x.organizationId === o.id)).toBe(true);
    expect(list.find(x => x.id === u.id)?.access).toEqual([{ projectId: project.id, permission: 'edit' }]);
    expect(JSON.stringify(list)).not.toMatch(/passwordHash/);
    await expect(listUsers(t.db, u)).rejects.toMatchObject({ status: 403 });
  });
});

describe('смена пароля', () => {
  it('временный пароль блокирует все операции, кроме смены пароля', async () => {
    const { o, director } = await org();
    const project = await createProject(t.db, o.id);
    const r = await run<Created>(director, 'users.create', { name: 'Новый РП', email: `pm-${project.id}@t.local`, role: 'director' });
    const me = await reload(r.user.id);
    await expect(run(me, 'budgets.create', { projectId: project.id, category: 'Работы', amount: '1.00' })).rejects.toMatchObject({ status: 403 });
    await expect(run(me, 'auth.changePassword', { currentPassword: 'wrong', newPassword: 'new-password-123' })).rejects.toMatchObject({ status: 422 });
    await expect(run(me, 'auth.changePassword', { currentPassword: r.temporaryPassword, newPassword: 'short' })).rejects.toMatchObject({ status: 422 });
    const token = signSession(me);
    const changed = await run(me, 'auth.changePassword', { currentPassword: r.temporaryPassword, newPassword: 'new-password-123' });
    expect(changed).not.toHaveProperty('passwordHash');
    expect((await verifySessionToken(t.db, signSession(changed as { id: string; sessionVersion: number })))?.id).toBe(me.id);
    expect(await verifySessionToken(t.db, token)).toBeNull();
    const after = await reload(me.id);
    expect(after.mustChangePassword).toBe(false);
    expect(after.passwordChangedAt).not.toBeNull();
    await expect(run(after, 'budgets.create', { projectId: project.id, category: 'Работы', amount: '1.00' })).resolves.toBeTruthy();
  });

  it('read_only тоже может сменить свой пароль', async () => {
    const { o } = await org();
    const viewer = await createUser(t.db, o.id, 'read_only');
    await expect(run(viewer, 'auth.changePassword', { currentPassword: PASSWORD, newPassword: 'viewer-password-1' })).resolves.toBeTruthy();
  });
});
