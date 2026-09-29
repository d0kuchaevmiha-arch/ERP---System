import { z } from 'zod';

export const uuid = z.string().uuid();
export const amount = z.string().regex(/^(?!0+(?:\.0{1,2})?$)\d{1,16}(?:\.\d{1,2})?$/, 'Укажите положительную сумму с точностью до копеек');
export const price = z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/);
// Количество хранится как NUMERIC(18,3): больше 3 знаков после запятой молча округлилось бы.
const scale3 = (n: number) => /^\d{1,15}(\.\d{1,3})?$/.test(String(n));
export const quantity = z.coerce.number().positive().finite().refine(scale3, 'Количество — не более 3 знаков после запятой');
export const quantityOrZero = z.coerce.number().min(0).finite().refine(scale3, 'Количество — не более 3 знаков после запятой');
