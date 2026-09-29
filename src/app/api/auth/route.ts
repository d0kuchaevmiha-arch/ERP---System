import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { db } from '@/db';
import { currentUser } from '@/lib/session';
import { authenticate } from '@/server/auth/login';
import { SESSION_COOKIE, SESSION_TTL_MS, signSession } from '@/server/auth/session';
import { clientIp } from '@/server/http/client-ip';
import { isClientMode } from '@/client/local/session';

// В десктопе вход и выход — через приложение (подключение устройства), а не через эту форму.
const desktopOnly = () => Response.json({error:{message:'В приложении вход выполняется при подключении устройства; выйти — через меню «Файл → Отключить устройство»'}},{status:409});

export async function GET() { const user = await currentUser(); return Response.json({user:user ? {id:user.id,name:user.name,role:user.role,email:user.email,mustChangePassword:user.mustChangePassword}:null}); }
export async function POST(req: NextRequest) {
  if (isClientMode()) return desktopOnly();
  const origin = req.headers.get('origin'); if(origin && origin !== req.nextUrl.origin) return Response.json({error:{message:'Недопустимый источник запроса'}},{status:403});
  const { email, password } = await req.json().catch(() => ({}));
  if(typeof email !== 'string' || typeof password !== 'string') return Response.json({error:{message:'Введите email и пароль'}},{status:400});
  const result = await authenticate(db, { email, password, ip: clientIp(req.headers) });
  if (!result.ok) return Response.json({error:{message:result.message}},{status:result.status});
  const { user } = result;
  const jar = await cookies(); jar.set(SESSION_COOKIE,signSession(user),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:SESSION_TTL_MS/1000});
  return Response.json({user:{id:user.id,name:user.name,role:user.role,email:user.email,mustChangePassword:user.mustChangePassword}});
}
export async function DELETE() { if (isClientMode()) return desktopOnly(); (await cookies()).delete(SESSION_COOKIE); return Response.json({ok:true}); }
