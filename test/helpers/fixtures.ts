import { randomUUID } from 'node:crypto';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { organizations, users, projects, projectAccess } from '@/db/schema';
import { hashPassword } from '@/server/auth/password';

type Db = NodePgDatabase;
export const PASSWORD = 'correct-horse-battery';
// Хеш считаем один раз: scrypt медленный намеренно.
let cachedHash: string | undefined;
const hash = () => (cachedHash ??= hashPassword(PASSWORD));
const tag = () => randomUUID().slice(0, 8);

export async function createOrg(db: Db, name = `Орг ${tag()}`) {
  const [row] = await db.insert(organizations).values({ name }).returning();
  return row;
}
export async function createUser(db: Db, organizationId: string, role: string, extra: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await db.insert(users).values({ organizationId, role, name: `${role} ${tag()}`, email: `${role}-${tag()}@test.local`, passwordHash: hash(), ...extra }).returning();
  return row;
}
export async function createProject(db: Db, organizationId: string, extra: Partial<typeof projects.$inferInsert> = {}) {
  const [row] = await db.insert(projects).values({ organizationId, code: `P-${tag()}`, name: `Объект ${tag()}`, ...extra }).returning();
  return row;
}
export async function grant(db: Db, userId: string, projectId: string, permission: 'view' | 'edit' = 'edit') {
  await db.insert(projectAccess).values({ userId, projectId, permission });
}
