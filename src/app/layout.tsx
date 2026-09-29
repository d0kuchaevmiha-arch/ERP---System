import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import { BRAND } from '@/lib/brand';
import './globals.css';

export const metadata: Metadata = { title: `${BRAND.name} — ${BRAND.product.toLowerCase()}`, description: 'Управленческая ERP для строительной компании' };
export const viewport: Viewport = { themeColor: [{ media: '(prefers-color-scheme: light)', color: '#D8D9D2' }, { media: '(prefers-color-scheme: dark)', color: '#14171A' }], colorScheme: 'light dark', width: 'device-width', initialScale: 1 };

// Шрифты лежат в репозитории (src/fonts, SIL OFL) и подключаются через next/font: без внешних запросов и с кириллицей.
// Каждое начертание разбито по диапазонам символов (latin, latin-ext с ₽, cyrillic), поэтому для одной гарнитуры заведено несколько наборов.
// next/font требует литералы в параметрах, поэтому диапазоны записаны прямо в вызовах.
const sansLat = localFont({ src: [{ path: '../fonts/ibm-plex-sans-latin-400-normal.woff2', weight: '400' }, { path: '../fonts/ibm-plex-sans-latin-500-normal.woff2', weight: '500' }, { path: '../fonts/ibm-plex-sans-latin-600-normal.woff2', weight: '600' }], variable: '--f-sans-lat', display: 'swap', declarations: [{ prop: 'unicode-range', value: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' }] });
const sansLatx = localFont({ src: [{ path: '../fonts/ibm-plex-sans-latin-ext-400-normal.woff2', weight: '400' }, { path: '../fonts/ibm-plex-sans-latin-ext-500-normal.woff2', weight: '500' }, { path: '../fonts/ibm-plex-sans-latin-ext-600-normal.woff2', weight: '600' }], variable: '--f-sans-latx', display: 'swap', declarations: [{ prop: 'unicode-range', value: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' }] });
const sansCyr = localFont({ src: [{ path: '../fonts/ibm-plex-sans-cyrillic-400-normal.woff2', weight: '400' }, { path: '../fonts/ibm-plex-sans-cyrillic-500-normal.woff2', weight: '500' }, { path: '../fonts/ibm-plex-sans-cyrillic-600-normal.woff2', weight: '600' }], variable: '--f-sans-cyr', display: 'swap', declarations: [{ prop: 'unicode-range', value: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' }] });
const monoLat = localFont({ src: [{ path: '../fonts/ibm-plex-mono-latin-400-normal.woff2', weight: '400' }, { path: '../fonts/ibm-plex-mono-latin-500-normal.woff2', weight: '500' }], variable: '--f-mono-lat', display: 'swap', declarations: [{ prop: 'unicode-range', value: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' }] });
const monoLatx = localFont({ src: [{ path: '../fonts/ibm-plex-mono-latin-ext-400-normal.woff2', weight: '400' }, { path: '../fonts/ibm-plex-mono-latin-ext-500-normal.woff2', weight: '500' }], variable: '--f-mono-latx', display: 'swap', declarations: [{ prop: 'unicode-range', value: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' }] });
const monoCyr = localFont({ src: [{ path: '../fonts/ibm-plex-mono-cyrillic-400-normal.woff2', weight: '400' }, { path: '../fonts/ibm-plex-mono-cyrillic-500-normal.woff2', weight: '500' }], variable: '--f-mono-cyr', display: 'swap', declarations: [{ prop: 'unicode-range', value: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' }] });
const dispLat = localFont({ src: '../fonts/geologica-latin-wght-normal.woff2', weight: '100 900', variable: '--f-disp-lat', display: 'swap', declarations: [{ prop: 'unicode-range', value: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' }] });
const dispCyr = localFont({ src: '../fonts/geologica-cyrillic-wght-normal.woff2', weight: '100 900', variable: '--f-disp-cyr', display: 'swap', declarations: [{ prop: 'unicode-range', value: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116' }] });

const fonts = [sansLat, sansLatx, sansCyr, monoLat, monoLatx, monoCyr, dispLat, dispCyr].map(f => f.variable).join(' ');

// Тему и плотность применяем до первой отрисовки, чтобы не было вспышки другой темы.
const boot = `try{var d=document.documentElement,s=localStorage,t=s.getItem('erp.theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';d.dataset.theme=t;d.dataset.density=s.getItem('erp.density')==='comfortable'?'comfortable':'compact'}catch(e){document.documentElement.dataset.theme='light';document.documentElement.dataset.density='compact'}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" className={fonts} data-theme="light" data-density="compact" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: boot }} /></head>
      <body>{children}</body>
    </html>
  );
}
