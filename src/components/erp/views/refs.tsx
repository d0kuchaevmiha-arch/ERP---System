'use client';
import { Download } from 'lucide-react';
import { useErp } from '../context';
import { useActions } from '../actions';
import { Empty, Sheet, Status } from '../ui';
import { Mark } from '../marks';
import { date, exportCSV, money, partyKindLabel, rub } from '../format';

const titles: Record<string, string> = { materials: 'Материалы', counterparties: 'Контрагенты', contracts: 'Договоры', reports: 'Отчёты' };

export function RefsView({ sub }: { sub: string }) {
  const { data, scopeId, create, openDrawer } = useErp();
  const acts = useActions();
  const key = titles[sub] ? sub : 'materials';
  return (
    <div className="page">
      <header className="page-head"><div><h1 className="disp">{titles[key]}</h1><p className="muted">Справочники и выгрузки</p></div></header>
      {key === 'materials' && (
        <Sheet title="Номенклатура" aside={data.materials.length} actions={acts.canWrite ? <button className="btn btn-mark" onClick={() => create('material')}>Создать материал</button> : undefined}>
          {data.materials.length === 0 ? <Empty title="Материалов нет" hint="Добавьте материал, чтобы вести остатки и закупки." action={acts.canWrite ? 'Создать материал' : undefined} onAction={() => create('material')} /> : (
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Таблица, прокручивается по горизонтали"><table className="tbl"><thead><tr><th>Материал</th><th>Артикул</th><th>Категория</th><th className="r">Остаток</th><th className="r">Неснижаемый</th><th className="r">Цена</th><th>Состояние</th></tr></thead>
              <tbody>{data.materials.map(m => <tr key={m.id}><td><button className="link strong" onClick={() => openDrawer({ kind: 'material', id: m.id })}>{m.name}</button></td><td className="num">{m.sku}</td><td>{m.category || '—'}</td><td className="r num">{rub(m.balance)} {m.unit}</td><td className="r num">{rub(Number(m.minStock))} {m.unit}</td><td className="r num">{money(Number(m.price))}</td><td>{m.shortage ? <span className="tag" data-tone="err"><Mark kind="over" />Ниже минимума</span> : <span className="tag" data-tone="ok"><Mark kind="done" />В норме</span>}</td></tr>)}</tbody></table></div>
          )}
        </Sheet>
      )}
      {key === 'counterparties' && (
        <Sheet title="Реестр контрагентов" aside={data.counterparties.length} actions={acts.canWrite ? <button className="btn btn-mark" onClick={() => create('supplier')}>Добавить контрагента</button> : undefined}>
          {data.counterparties.length === 0 ? <Empty title="Контрагентов нет" hint="Добавьте поставщика, заказчика или подрядчика." action={acts.canWrite ? 'Добавить контрагента' : undefined} onAction={() => create('supplier')} /> : (
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Таблица, прокручивается по горизонтали"><table className="tbl"><thead><tr><th>Компания</th><th>Тип</th><th>ИНН</th><th>Контакт</th></tr></thead>
              <tbody>{data.counterparties.map(c => <tr key={c.id}><td><button className="link strong" onClick={() => openDrawer({ kind: 'counterparty', id: c.id })}>{c.name}</button></td><td>{partyKindLabel[c.kind] || c.kind}</td><td className="num">{c.inn || '—'}</td><td>{c.contact || '—'}</td></tr>)}</tbody></table></div>
          )}
        </Sheet>
      )}
      {key === 'contracts' && (
        <Sheet title="Реестр договоров" aside={data.contracts.length} actions={acts.canWrite ? <button className="btn btn-mark" onClick={() => create('contract', scopeId ? { projectId: scopeId } : {})}>Создать договор</button> : undefined}>
          {data.contracts.length === 0 ? <Empty title="Договоров нет" hint="Создайте договор с контрагентом." action={acts.canWrite ? 'Создать договор' : undefined} onAction={() => create('contract')} /> : (
            <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Таблица, прокручивается по горизонтали"><table className="tbl"><thead><tr><th>Номер</th><th>Контрагент</th><th>Вид</th><th>Подписан</th><th>Статус</th><th className="r">Сумма</th></tr></thead>
              <tbody>{data.contracts.filter(c => !scopeId || c.projectId === scopeId).map(c => <tr key={c.id}><td><button className="link strong" onClick={() => openDrawer({ kind: 'contract', id: c.id })}>{c.number}</button></td><td>{data.counterparties.find(p => p.id === c.counterpartyId)?.name || '—'}</td><td>{c.kind}</td><td>{date(c.signedAt)}</td><td><Status status={c.status} /></td><td className="r num">{money(Number(c.amount))}</td></tr>)}</tbody></table></div>
          )}
        </Sheet>
      )}
      {key === 'reports' && (
        <Sheet title="Выгрузки в CSV">
          <ul className="report-list">
            {([['Объекты', 'Готовность, сроки и стоимость', data.projects, 'projects'], ['Расходы', 'Все расходы по объектам', data.expenses, 'expenses'], ['Складские остатки', 'Остаток и неснижаемый запас', data.materials, 'stock'], ['Закупки', 'Заявки и исполнение', data.purchases, 'purchases'], ['Работы', 'Сроки и готовность', data.tasks, 'tasks'], ['Движение материалов', 'Приход, выдача, списания', data.movements, 'movements']] as const).map(([t, d, rows, file]) => (
              <li key={file}><button type="button" onClick={() => exportCSV(rows as unknown as Record<string, unknown>[], file)}><span><b>{t}</b><small>{d} · {rows.length} строк</small></span><Download size={16} aria-hidden="true" /></button></li>
            ))}
          </ul>
        </Sheet>
      )}
    </div>
  );
}
