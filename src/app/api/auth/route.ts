import { NextRequest } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { currentUser, signSession, verifyPassword } from '@/lib/session';
import { cookies } from 'next/headers';

export async function GET() { const user = await currentUser(); return Response.json({user:user ? {id:user.id,name:user.name,role:user.role,email:user.email}:null}); }
const attempts = new Map<string,{count:number;until:number}>();
export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin'); if(origin && origin !== req.nextUrl.origin) return Response.json({error:{message:'Недопустимый источник запроса'}},{status:403});
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] || 'local'; const now = Date.now(); const entry = attempts.get(ip);
  if(entry && entry.until > now && entry.count >= 10) return Response.json({error:{message:'Слишком много попыток. Попробуйте позже.'}},{status:429});
  const { email, password } = await req.json();
  if(typeof email !== 'string' || typeof password !== 'string') return Response.json({error:{message:'Введите email и пароль'}},{status:400});
  const [user] = await db.select().from(users).where(eq(users.email,email.toLowerCase().trim())).limit(1);
  if(!user || !verifyPassword(password,user.passwordHash)) { attempts.set(ip,{count:(entry?.until && entry.until>now?entry.count:0)+1,until:now+15*60*1000}); return Response.json({error:{message:'Неверный email или пароль'}},{status:401}); }
  attempts.delete(ip);
  const jar = await cookies(); jar.set('erp_session',signSession(user.id),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:7*86400});
  return Response.json({user:{id:user.id,name:user.name,role:user.role,email:user.email}});
}
export async function DELETE() { (await cookies()).delete('erp_session'); return Response.json({ok:true}); }
