'use client';
import { useErp } from '../context';
import { useActions } from '../actions';
import { Empty, Sheet } from '../ui';
import { StockRuler } from '../stock-ruler';
import { date, exportCSV, isIncoming, movementLabel, plural, rub } from '../format';

export function WarehouseView() {
  const { data, openDrawer, create } = useErp();
  const acts = useActions();
  // Критически низкие остатки — вверху, дальше по названию.
  const mats = [...data.materials].sort((a, b) => Number(b.shortage) - Number(a.shortage) || (a.balance / Math.max(1, Number(a.minStock))) - (b.balance / Math.max(1, Number(b.minStock))));
  const low = mats.filter(m => m.shortage).length;
  return (
    <div className="page">
      <header className="page-head">
        <div><h1 className="disp">Склад</h1><p className="muted">{data.warehouses.length} {plural(data.warehouses.length, 'склад', 'склада', 'складов')} · {mats.length} позиций · {low ? `${low} ниже неснижаемого остатка` : 'все остатки в норме'}</p></div>
        <div className="head-actions">
          {acts.canDecide && <button className="btn" onClick={() => create('receive')}>Принять поставку</button>}
          {acts.canWrite && <button className="btn btn-mark" onClick={() => create('movement')}>Внести движение</button>}
        </div>
      </header>
      <Sheet title="Остатки материалов" aside={mats.length}>
        {mats.length === 0 ? <Empty title="Материалов нет" hint="Создайте материал в справочнике, чтобы вести остатки." action={acts.canWrite ? 'Создать материал' : undefined} onAction={() => create('material')} /> : (
          <ul className="rulers">
            {mats.map(m => (
              <li key={m.id} data-low={m.shortage || undefined}>
                <div className="rulers-name"><button className="link strong" onClick={() => openDrawer({ kind: 'material', id: m.id })}>{m.name}</button><small className="num">{m.sku}{m.category ? ` · ${m.category}` : ''}</small></div>
                <StockRuler balance={m.balance} min={Number(m.minStock)} unit={m.unit} />
                <div className="rulers-act">{m.shortage && acts.canWrite && <button className="btn btn-mark" onClick={() => create('purchase', { materialId: m.id, unitPrice: String(Number(m.price) || '') })}>Создать заявку</button>}</div>
              </li>
            ))}
          </ul>
        )}
      </Sheet>
      <Sheet title="Последние движения" aside={Math.min(15, data.movements.length)} actions={<button className="btn" onClick={() => exportCSV(data.movements, 'stock-movements')}>Экспортировать CSV</button>}>
        {data.movements.length === 0 ? <Empty title="Движений нет" hint="Приход, выдача и списания появятся здесь." /> : (
          <div className="tbl-wrap" tabIndex={0} role="region" aria-label="Таблица, прокручивается по горизонтали"><table className="tbl">
            <thead><tr><th>Дата</th><th>Материал</th><th>Операция</th><th className="r">Количество</th><th>Основание</th></tr></thead>
            <tbody>{data.movements.slice(0, 15).map(m => { const mat = data.materials.find(x => x.id === m.materialId); return (
              <tr key={m.id}><td>{date(new Date(m.createdAt).toISOString().slice(0, 10))}</td><td>{mat?.name}</td><td>{movementLabel[m.type] || m.type}</td><td className="r num">{isIncoming(m.type) ? '+' : '−'}{rub(Number(m.quantity))} {mat?.unit}</td><td className="muted">{m.note || '—'}</td></tr>); })}</tbody>
          </table></div>
        )}
      </Sheet>
    </div>
  );
}
