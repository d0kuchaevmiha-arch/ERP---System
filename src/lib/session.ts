import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

export function hashPassword(password: string) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
export function verifyPassword(password: string, stored: string) { try { const [salt, hash] = stored.split(':'); return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 64)); } catch { return false; } }
function secret() { return process.env.SESSION_SECRET || process.env.DEMO_PASSWORD || (process.env.NODE_ENV === 'production' ? '' : 'development-only-secret'); }
export function signSession(userId: string) { const expires = Date.now() + 7 * 86400000; const payload = `${userId}.${expires}`; return `${payload}.${createHmac('sha256', secret()).update(payload).digest('hex')}`; }
export async function currentUser() {
  const token = (await cookies()).get('erp_session')?.value;
  if (!token || !secret()) return null;
  const parts = token.split('.'); if (parts.length !== 3 || Number(parts[1]) < Date.now()) return null;
  const payload = `${parts[0]}.${parts[1]}`;
  const sig = createHmac('sha256', secret()).update(payload).digest('hex');
  if (sig.length !== parts[2].length || !timingSafeEqual(Buffer.from(sig), Buffer.from(parts[2]))) return null;
  const [user] = await db.select().from(users).where(eq(users.id, parts[0])).limit(1);
  return user || null;
}
export const writeRoles = ['super_admin','director','project_manager','construction_manager','foreman','procurement_manager','warehouse_manager','finance_manager','accountant'];
