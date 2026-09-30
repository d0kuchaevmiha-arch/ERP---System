// Что сохранить как набор «Доступно офлайн» (§10): список id или null — набор по умолчанию.
// Отмечены все доступные объекты (не директор) — это и есть набор по умолчанию: сохраняем null, иначе
// объекты, созданные или выданные позже, на ноутбук бы не попадали (ошибка 0.5.0).
export function scopeToSave(chosen: Set<string>, available: { id: string }[], orgWide: boolean): string[] | null {
  if (!orgWide && available.length > 0 && available.every(p => chosen.has(p.id))) return null;
  return [...chosen];
}
