import { cookies } from 'next/headers';
import { db } from '@/db';
import { SESSION_COOKIE, verifySessionToken } from '@/server/auth/session';

export { hashPassword, verifyPassword } from '@/server/auth/password';
export { signSession } from '@/server/auth/session';

export async function currentUser() {
  return verifySessionToken(db, (await cookies()).get(SESSION_COOKIE)?.value);
}
export const writeRoles = ['super_admin','director','project_manager','construction_manager','foreman','procurement_manager','warehouse_manager','finance_manager','accountant'];
