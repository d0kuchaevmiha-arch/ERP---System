// Стоимость количества (до 3 знаков) по цене (до 2 знаков) в целых копейках, без float.
export function costOf(quantity: number, price: string) {
  const q = String(quantity);
  const units = BigInt(q.replace('.', '').padEnd((q.split('.')[0]?.length || 0) + 3, '0'));
  const [rub, kop = ''] = String(price).split('.');
  const priceCents = BigInt(rub) * BigInt(100) + BigInt(kop.padEnd(2, '0').slice(0, 2));
  const cents = units * priceCents / BigInt(1000);
  return `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, '0')}`;
}
