import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { commandResponse } from '@/server/http/command-route';
import { SESSION_COOKIE, SESSION_TTL_MS, signSession } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

// Смена своего пароля. Старые сессии отзываются, текущему окну выдаётся новая cookie.
export async function POST(req: NextRequest) {
  return commandResponse(req, 'auth.changePassword', body => body, async data => {
    const jar = await cookies();
    jar.set(SESSION_COOKIE, signSession(data as { id: string; sessionVersion: number }), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: SESSION_TTL_MS / 1000 });
  });
}
