import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { materials, purchases } from '@/db/schema';
import { runCommand } from '@/server/domain/registry';
import type { Actor } from '@/server/domain/context';
import { createMigratedDb, type TestDb } from './helpers/db';
import { createOrg, createProject, createUser } from './helpers/fixtures';

let t: TestDb;
beforeAll(async () => { t = await createMigratedDb(); });
afterAll(async () => { await t?.drop(); });

async function setup() {
  const org = await createOrg(t.db);
  const director = await createUser(t.db, org.id, 'director');
  const project = await createProject(t.db, org.id);
  const [m] = await t.db.insert(materials).values({ organizationId: org.id, sku: 'M', name: 'Материал' }).returning();
  const create = (extra: Record<string, unknown> = {}) => runCommand({ db: t.db, actor: director as Actor, ip: null, userAgent: 'vitest' }, 'purchases.create', { projectId: project.id, materialId: m.id, quantity: 1, unitPrice: '1.00', ...extra }) as Promise<{ number: string; localRef: string | null }>;
  return { org, project, m, create };
}
const seqOf = (n: string) => Number(n.split('-').at(-1));

describe('номер заявки присваивает сервер (§4.1)', () => {
  it('20 одновременных заявок → 20 разных сквозных номеров ЗК-<год>-<NNNNN>', async () => {
    const s = await setup();
    const rows = await Promise.all(Array.from({ length: 20 }, () => s.create()));
    for (const r of rows) expect(r.number).toMatch(/^ЗК-\d{4}-\d{5}$/);
    expect(rows.map(r => seqOf(r.number)).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('у каждой организации своя нумерация; старые номера не меняются; временный номер клиента сохраняется', async () => {
    const a = await setup(); const b = await setup();
    await t.db.insert(purchases).values({ organizationId: a.org.id, projectId: a.project.id, materialId: a.m.id, number: 'ЗК-2026-041' });
    expect(seqOf((await a.create()).number)).toBe(1);
    expect(seqOf((await b.create()).number)).toBe(1);
    const offline = await a.create({ localRef: 'ноут-7/0003' });
    expect(offline).toMatchObject({ localRef: 'ноут-7/0003' });
    expect(seqOf(offline.number)).toBe(2);
    const old = await t.db.select().from(purchases).where(eq(purchases.number, 'ЗК-2026-041'));
    expect(old).toHaveLength(1);
  });
});
