import type { NextRequest } from 'next/server';
import { db } from '@/db';
import { syncUser } from '@/server/http/sync-guard';
import { getScope } from '@/server/sync/service';

export const dynamic = 'force-dynamic';

// Объекты, которые можно взять «Доступно офлайн», и набор по умолчанию (§10).
export async function GET(req: NextRequest) {
  const who = await syncUser(req);
  if (who instanceof Response) return who;
  return Response.json({ ...(await getScope(db, who.user)), user: { id: who.user.id, name: who.user.name, role: who.user.role, organizationId: who.user.organizationId }, deviceId: who.deviceId });
}
