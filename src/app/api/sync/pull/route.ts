import type { NextRequest } from 'next/server';
import { db } from '@/db';
import { requestedProjects, syncError, syncUser } from '@/server/http/sync-guard';
import { pull, resolveScope } from '@/server/sync/service';

export const dynamic = 'force-dynamic';

// GET /api/sync/pull?since=<seq>&limit=<n>&projects=<ids> → {changes, nextSeq, hasMore, scope} (§6.3); 410 — нужен snapshot.
export async function GET(req: NextRequest) {
  const who = await syncUser(req);
  if (who instanceof Response) return who;
  const q = req.nextUrl.searchParams;
  const since = Number(q.get('since'));
  if (!Number.isSafeInteger(since) || since < 0) return Response.json({ error: { message: 'since — неотрицательное целое' } }, { status: 422 });
  try {
    const scope = await resolveScope(db, who.user, requestedProjects(req));
    return Response.json(await pull(db, scope, { since, limit: Number(q.get('limit')) || undefined }));
  } catch (e) { return syncError(e); }
}
