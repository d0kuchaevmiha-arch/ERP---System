import { expect, it } from 'vitest';
import { foreignOrigin } from '@/server/http/command-route';

const req = (h: Record<string, string>) => ({ headers: new Headers(h) });

it('CSRF-проверка Origin: свой хост — разрешено, чужой — нет; учитывается адрес, который видит браузер', () => {
  expect(foreignOrigin(req({}))).toBe(false); // без Origin (серверные клиенты, curl) — не браузерный CSRF
  expect(foreignOrigin(req({ origin: 'http://127.0.0.1:51270', host: '127.0.0.1:51270' }))).toBe(false); // десктоп
  expect(foreignOrigin(req({ origin: 'https://erp.company.ru', host: 'app:3000', 'x-forwarded-host': 'erp.company.ru' }))).toBe(false); // за прокси
  expect(foreignOrigin(req({ origin: 'https://evil.example', host: 'erp.company.ru' }))).toBe(true);
  expect(foreignOrigin(req({ origin: 'null', host: 'erp.company.ru' }))).toBe(true);
});
