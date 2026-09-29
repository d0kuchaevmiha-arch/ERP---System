'use client';
import { createContext, useContext } from 'react';
import type { CreateKind, Data, DrawerRef, Nav, User, ViewKey } from './types';
import type { Ability } from '@/lib/permissions';

export type PostResult = { ok: boolean; message?: string };
export type Density = 'compact' | 'comfortable';
export type Theme = 'light' | 'dark';

export type Erp = {
  data: Data;
  user: User;
  today: string;
  scopeId: string;
  setScope: (id: string) => void;
  nav: Nav;
  go: (view: ViewKey, sub?: string) => void;
  openProject: (id: string) => void;
  drawer: DrawerRef;
  openDrawer: (ref: NonNullable<DrawerRef>) => void;
  closeDrawer: () => void;
  create: (kind: CreateKind, values?: Record<string, string>) => void;
  refresh: () => Promise<void>;
  // POST в API. Успех → данные перезагружены; ошибка → message для показа рядом с действием.
  post: (resource: string, body: Record<string, unknown>) => Promise<PostResult>;
  notify: (message: string, tone?: 'ok' | 'err') => void;
  can: (ability: Ability) => boolean;
  requireLogin: () => boolean;
  openPalette: () => void;
  density: Density;
  setDensity: (d: Density) => void;
  theme: Theme;
  setTheme: (t: Theme) => void;
  logout: () => Promise<void>;
  isPhone: boolean;
};

export const ErpContext = createContext<Erp | null>(null);
export function useErp(): Erp {
  const v = useContext(ErpContext);
  if (!v) throw new Error('useErp вне ErpContext');
  return v;
}
