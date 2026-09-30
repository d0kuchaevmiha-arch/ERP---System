import type { NextRequest } from 'next/server';
import { db } from '@/db';
import { syncError, syncUser } from '@/server/http/sync-guard';
import { pushOps, type PushOp } from '@/server/sync/push';

export const dynamic = 'force-dynamic';

// POST /api/sync/push {ops:[{opId, command, payload, deviceCreatedAt, dependsOn}]} → {results} (§6.4).
// Только токен устройства: устройство берётся из токена, а не из тела запроса.
export async function POST(req: NextRequest) {
  const who = await syncUser(req);
  if (who instanceof Response) return who;
  const body = await req.json().catch(() => null) as { ops?: PushOp[] } | null;
  if (!body || !Array.isArray(body.ops)) return Response.json({ error: { message: 'Ожидается {ops: [...]}' } }, { status: 422 });
  try {
    return Response.json({ results: await pushOps(db, who.user, who.deviceId!, body.ops) });
  } catch (e) { return syncError(e); }
}
