'use client';
import { useCallback, useSyncExternalStore } from 'react';

// Настройки вида хранятся в localStorage. Без хранилища (приватный режим, заблокированные данные сайта) всё работает со значениями по умолчанию.
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener('storage', cb);
  return () => { listeners.delete(cb); window.removeEventListener('storage', cb); };
};

export function usePref<T extends string>(key: string, allowed: readonly T[], fallback: () => T, serverFallback: T): [T, (v: T) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      try { const v = window.localStorage.getItem(key) as T | null; if (v && allowed.includes(v)) return v; } catch { /* нет хранилища */ }
      return fallback();
    },
    () => serverFallback,
  );
  const set = useCallback((v: T) => { try { window.localStorage.setItem(key, v); } catch { /* приватный режим */ } emit(); }, [key]);
  return [value, set];
}

const noop = () => () => {};
export function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false);
}
