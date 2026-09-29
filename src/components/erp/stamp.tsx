'use client';
import { date, dateShort } from './format';
import { deviations } from './derive';
import { Mark } from './marks';
import { Status } from './ui';
import { useErp } from './context';
import type { Project } from './types';

// Основная надпись объекта — единственный «заголовок» страницы объекта.
export function Stamp({ project }: { project: Project }) {
  const { data, today } = useErp();
  const dev = deviations(data, project, today);
  return (
    <section className="stamp" aria-label={`Основная надпись: ${project.name}`}>
      <div className="stamp-cell stamp-code"><small>Шифр</small><b className="disp">{project.code}</b></div>
      <div className="stamp-cell stamp-name"><small>Объект</small><h1 className="disp">{project.name}</h1><span>{project.address || 'Адрес не указан'}</span></div>
      <div className="stamp-cell"><small>Стадия</small><Status status={project.status} /></div>
      <div className="stamp-cell"><small>Готовность</small><b className="num stamp-progress">{project.progress}%</b></div>
      <div className="stamp-cell"><small>Руководитель проекта</small><b>{project.manager}</b></div>
      <div className="stamp-cell"><small>Заказчик</small><b>{project.customer}</b></div>
      <div className="stamp-cell"><small>Сроки</small><b className="num">{dateShort(project.startDate)} — {date(project.endDate)}</b></div>
      <div className="stamp-cell stamp-dev">
        <small>Отклонения</small>
        <ul>
          <li data-tone={dev.schedule.tone}><Mark kind={dev.schedule.mark} /><span><em>срок</em> {dev.schedule.text}</span></li>
          <li data-tone={dev.budget.tone}><Mark kind={dev.budget.mark} /><span><em>бюджет</em> {dev.budget.text}</span></li>
          <li data-tone={dev.supply.tone}><Mark kind={dev.supply.mark} /><span><em>снабжение</em> {dev.supply.text}</span></li>
        </ul>
      </div>
    </section>
  );
}
