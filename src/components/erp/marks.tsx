import type { Tone } from './format';

// Фигуры-маркировка: смысл читается по форме, цвет вторичен.
export type MarkKind = 'behind' | 'over' | 'done' | 'wait' | 'blocked' | 'active' | 'transit' | 'planned';

export function Mark({ kind, size = 14 }: { kind: MarkKind; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true as const, focusable: false as const, className: 'mark' };
  switch (kind) {
    case 'behind': return <svg {...common}><path d="M8 2 15 14H1Z" fill="currentColor" /></svg>;
    case 'over': return <svg {...common}><rect x="2.5" y="2.5" width="11" height="11" fill="currentColor" /></svg>;
    case 'done': return <svg {...common}><circle cx="8" cy="8" r="5.5" fill="currentColor" /></svg>;
    case 'wait': return <svg {...common}><path d="M8 1.8 14.2 8 8 14.2 1.8 8Z" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>;
    case 'blocked': return <svg {...common}><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M4 12 12 4" stroke="currentColor" strokeWidth="1.8" /></svg>;
    case 'active': return <svg {...common}><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="8" cy="8" r="2" fill="currentColor" /></svg>;
    case 'transit': return <svg {...common}><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M8 2.5a5.5 5.5 0 0 1 0 11Z" fill="currentColor" /></svg>;
    case 'planned': return <svg {...common}><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.4 2.2" /></svg>;
  }
}

export function Tag({ mark, tone, children }: { mark: MarkKind; tone: Tone; children: React.ReactNode }) {
  return <span className="tag" data-tone={tone}><Mark kind={mark} />{children}</span>;
}
