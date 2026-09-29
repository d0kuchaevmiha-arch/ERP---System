import type { NextRequest } from 'next/server';
import { db } from '@/db';
import { requestedProjects, syncError, syncUser } from '@/server/http/sync-guard';
import { resolveScope, snapshot } from '@/server/sync/service';

export const dynamic = 'force-dynamic';

// GET /api/sync/snapshot?entity=<имя>&projects=<ids>&cursor=<c>&limit=<n> → {rows, nextCursor, snapshotSeq, scope} (§6.2)
export async function GET(req: NextRequest) {
  const who = await syncUser(req);
  if (who instanceof Response) return who;
  const q = req.nextUrl.searchParams;
  try {
    const scope = await resolveScope(db, who.user, requestedProjects(req));
    return Response.json(await snapshot(db, scope, { entity: q.get('entity') ?? '', cursor: q.get('cursor'), limit: Number(q.get('limit')) || undefined }));
  } catch (e) { return syncError(e); }
}
