// Как агент разговаривает с сервером (§6). HTTP-реализация — http-transport.ts; в тестах — прямой вызов сервиса.

export type ScopeInfo = { available: { id: string; code: string; name: string }[]; defaultScope: string[]; orgWide: boolean; user: { id: string; name: string; role: string; organizationId: string } };
export type SnapshotPage = { entity: string; rows: Record<string, unknown>[]; nextCursor: string | null; snapshotSeq: number; scope: string[] };
export type PullResult = { changes: { seq: number; entity: string; id: string; op: 'upsert' | 'delete'; row: Record<string, unknown> | null }[]; nextSeq: number; hasMore: boolean; scope: string[] };

export interface SyncTransport {
  scope(): Promise<ScopeInfo>;
  snapshot(entity: string, projects: string[] | null, cursor: string | null): Promise<SnapshotPage>;
  pull(since: number, projects: string[] | null): Promise<PullResult>;
}

// Ошибки, по которым агент меняет поведение.
export class SyncHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export const isGone = (e: unknown) => e instanceof SyncHttpError && e.status === 410;
export const isRevoked = (e: unknown) => e instanceof SyncHttpError && e.status === 401;
export const isOutdated = (e: unknown) => e instanceof SyncHttpError && e.status === 426;
