import { BRAND } from '@/lib/brand';

// Служебный экран (нет БД, требуется вход и т. п.) — без данных организации.
export function SystemScreen({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="sys">
      <section className="stamp sys-stamp" aria-labelledby="sys-title">
        <div className="stamp-cell stamp-code"><small>Система</small><b className="disp">{BRAND.name}</b></div>
        <div className="stamp-cell stamp-name"><small>Состояние</small><h1 id="sys-title" className="disp">{title}</h1><span>{children}</span></div>
      </section>
    </main>
  );
}
