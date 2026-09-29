// Route handler Next не видит адрес сокета, поэтому IP берём только из заголовка доверенного прокси (§5.2.7).
// TRUSTED_PROXY=1 означает: приложение доступно только через наш прокси, и он дописывает X-Forwarded-For.
// Крайний правый адрес добавил наш прокси; всё левее мог подставить клиент.
export function clientIp(headers: Headers): string | null {
  const trusted = process.env.TRUSTED_PROXY;
  if (trusted !== '1' && trusted !== 'true') return null;
  const parts = (headers.get('x-forwarded-for') || '').split(',').map(s => s.trim()).filter(Boolean);
  return parts.at(-1) || headers.get('x-real-ip') || null;
}
