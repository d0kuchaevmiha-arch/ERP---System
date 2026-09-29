// Название продукта и компании — в одном месте. Меняется переменными окружения при сборке.
export const BRAND = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || 'Монолит',
  product: 'Управление стройкой',
  company: process.env.NEXT_PUBLIC_BRAND_COMPANY || 'ГК «Монолит»',
} as const;
