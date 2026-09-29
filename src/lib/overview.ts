import { db } from '@/db';
import type { SessionUser } from '@/server/auth/session';
import { getOverviewFor, type Overview } from '@/server/read/overview';

// Сводка для вошедшего пользователя; анонимному данные не отдаются (§5.2.1–5.2.2).
export function getOverview(user: SessionUser) { return getOverviewFor(db, user); }
export type { Overview };
