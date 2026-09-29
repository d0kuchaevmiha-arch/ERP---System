import { afterEach, expect, it } from 'vitest';
import { newOpKey } from '@/components/erp/op-key';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const original = crypto.randomUUID;
afterEach(() => { Object.defineProperty(crypto, 'randomUUID', { value: original, configurable: true, writable: true }); });

it('ключ операции — UUID v4 и без crypto.randomUUID (http без TLS)', () => {
  Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true, writable: true });
  const keys = new Set(Array.from({ length: 50 }, newOpKey));
  expect(keys.size).toBe(50);
  for (const k of keys) expect(k).toMatch(UUID_V4);
});
