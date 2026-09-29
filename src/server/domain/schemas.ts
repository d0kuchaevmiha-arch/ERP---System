import { z } from 'zod';

export const uuid = z.string().uuid();
export const amount = z.string().regex(/^(?!0+(?:\.0{1,2})?$)\d{1,16}(?:\.\d{1,2})?$/, 'Укажите положительную сумму с точностью до копеек');
export const price = z.string().regex(/^\d{1,16}(?:\.\d{1,2})?$/);
export const quantity = z.coerce.number().positive().finite();
