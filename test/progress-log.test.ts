import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { changeLog, taskProgressLog, tasks } from '@/db/schema';
import { runCommand } from '@/server/domain/registry';
import type { Actor } from '@/server/domain/context';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser, grant } from './helpers/fixtures';

let t: TestDb;
beforeAll(async () => { t = await createMigratedDb(); });
afterAll(async () => { await t?.drop(); });

const at = (iso: string) => ({ origin: 'offline' as const, deviceId: crypto.randomUUID(), deviceCreatedAt: new Date(iso) });
const run = (actor: Actor, input: unknown, prov?: ReturnType<typeof at>) => runCommand({ db: t.db, actor, ip: null, userAgent: 'vitest', prov }, 'progress.set', input);
const task = async (id: string) => (await t.db.select().from(tasks).where(eq(tasks.id, id)))[0];
const history = (id: string) => t.db.select().from(taskProgressLog).where(eq(taskProgressLog.taskId, id)).orderBy(asc(taskProgressLog.deviceCreatedAt));

async function setup() {
  const org = await createOrg(t.db);
  const director = await createUser(t.db, org.id, 'director');
  const foreman = await createUser(t.db, org.id, 'foreman');
  const project = await createProject(t.db, org.id);
  await grant(t.db, foreman.id, project.id, 'edit');
  const [w] = await t.db.insert(tasks).values({ projectId: project.id, name: 'Кладка', actualQuantity: '5' }).returning();
  return { director, foreman, project, w };
}

describe('история фактов выполнения (§4.1, §5.1 progress.set)', () => {
  it('каждый факт — строка истории с автором и происхождением', async () => {
    const s = await setup();
    await run(s.foreman, { taskId: s.w.id, progress: 20, actualQuantity: 3 });
    const [h] = await history(s.w.id);
    expect(h).toMatchObject({ authorId: s.foreman.id, projectId: s.project.id, progress: 20, actualQuantity: '3.000', applied: true, origin: 'online' });
    expect((await task(s.w.id)).progress).toBe(20);
  });

  it('более ранний по времени устройства факт не перезаписывает текущее значение, но остаётся в истории', async () => {
    const s = await setup();
    await run(s.foreman, { taskId: s.w.id, progress: 60 }, at('2026-09-20T10:00:00Z'));
    await run(s.director, { taskId: s.w.id, progress: 40 }, at('2026-09-19T10:00:00Z'));
    const w = await task(s.w.id);
    expect(w.progress).toBe(60);
    expect(w.progressReportedAt?.toISOString()).toBe('2026-09-20T10:00:00.000Z');
    expect((await history(s.w.id)).map(h => [h.progress, h.applied])).toEqual([[40, false], [60, true]]);
    await run(s.director, { taskId: s.w.id, progress: 80 }, at('2026-09-21T10:00:00Z'));
    expect((await task(s.w.id)).progress).toBe(80);
  });

  it('actualQuantity 0 сохраняется; без actualQuantity остаётся прежний; в истории — то, что ввели', async () => {
    const s = await setup();
    await run(s.foreman, { taskId: s.w.id, progress: 10 });
    expect((await task(s.w.id)).actualQuantity).toBe('5.000');
    await run(s.foreman, { taskId: s.w.id, progress: 15, actualQuantity: 0 });
    expect((await task(s.w.id)).actualQuantity).toBe('0.000');
    expect((await history(s.w.id)).map(h => h.actualQuantity)).toEqual([null, '0.000']);
  });

  it('100% — дата фактического окончания по времени устройства; журнал изменений содержит историю', async () => {
    const s = await setup();
    await run(s.foreman, { taskId: s.w.id, progress: 100 }, at('2026-09-18T22:30:00Z'));
    expect(await task(s.w.id)).toMatchObject({ status: 'done', actualEnd: '2026-09-18' });
    const entities = (await t.db.select().from(changeLog).where(eq(changeLog.projectId, s.project.id))).map(c => c.entity);
    expect(entities).toEqual(expect.arrayContaining(['task_progress_log', 'tasks']));
  });
});
