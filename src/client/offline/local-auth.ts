import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Офлайн-вход в десктоп (§7, решение P4 №11). После успешной проверки пароля на сервере сохраняется scrypt-верификатор
// (сам пароль — никогда); без связи вход разрешён ≤ 7 дней с последней онлайн-проверки. Хранится в secrets.bin (DPAPI).
// Пример из жизни: сторож знает вас в лицо неделю после того, как отдел кадров подтвердил пропуск; потом — снова в отдел кадров.
// Часы ноутбука, переведённые назад, окно не продлевают: «сейчас» не меньше последнего увиденного времени.

export const OFFLINE_WINDOW_DAYS = 7;
export const MAX_FAILURES = 5;
export const LOCK_MS = 60_000;
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export type Verifier = {
  email: string; salt: string; hash: string;
  lastOnlineAuthAt: string; // последняя успешная проверка на сервере (время сервера)
  lastSeenAt: string;       // наибольшее известное время (сервер или ноутбук) — защита от перевода часов назад
  failures: number; lockedUntil: string | null;
};

const derive = (password: string, salt: Buffer) => scryptSync(password.normalize('NFKC'), salt, 32, PARAMS);

export function makeVerifier(email: string, password: string, serverTime: Date, now = new Date()): Verifier {
  const salt = randomBytes(16);
  const seen = serverTime > now ? serverTime : now;
  return { email: email.toLowerCase(), salt: salt.toString('base64'), hash: derive(password, salt).toString('base64'), lastOnlineAuthAt: serverTime.toISOString(), lastSeenAt: seen.toISOString(), failures: 0, lockedUntil: null };
}

export type OfflineCheck =
  | { ok: true; verifier: Verifier; daysLeft: number }
  | { ok: false; verifier: Verifier | null; reason: 'none' | 'locked' | 'expired' | 'bad_password'; message: string };

// Только сверка пароля (например, для экспорта очереди с отозванного устройства): окно 7 дней не проверяется.
export function passwordMatches(v: Verifier, password: string) {
  const expected = Buffer.from(v.hash, 'base64');
  const got = derive(password, Buffer.from(v.salt, 'base64'));
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export function checkOffline(v: Verifier | null, password: string, now = new Date()): OfflineCheck {
  if (!v) return { ok: false, verifier: null, reason: 'none', message: 'Нет связи с сервером, а на этом компьютере ещё не было входа — подключитесь к сети' };
  const seen = new Date(Math.max(now.getTime(), Date.parse(v.lastSeenAt)));
  const touched = { ...v, lastSeenAt: seen.toISOString() };
  if (v.lockedUntil && Date.parse(v.lockedUntil) > seen.getTime()) return { ok: false, verifier: touched, reason: 'locked', message: 'Слишком много неверных попыток — подождите минуту' };
  const expiresAt = Date.parse(v.lastOnlineAuthAt) + OFFLINE_WINDOW_DAYS * 86_400_000;
  if (seen.getTime() > expiresAt) return { ok: false, verifier: touched, reason: 'expired', message: `Без связи можно входить ${OFFLINE_WINDOW_DAYS} дней после последнего входа по сети — подключитесь к сети` };
  if (!passwordMatches(v, password)) {
    const failures = v.failures + 1;
    const lock = failures >= MAX_FAILURES;
    return { ok: false, verifier: { ...touched, failures: lock ? 0 : failures, lockedUntil: lock ? new Date(seen.getTime() + LOCK_MS).toISOString() : v.lockedUntil }, reason: 'bad_password', message: 'Неверный пароль' };
  }
  return { ok: true, verifier: { ...touched, failures: 0, lockedUntil: null }, daysLeft: Math.max(0, Math.ceil((expiresAt - seen.getTime()) / 86_400_000)) };
}
