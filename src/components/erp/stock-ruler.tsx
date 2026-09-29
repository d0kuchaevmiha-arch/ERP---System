import { rub } from './format';

// «Мерная линейка»: шкала от нуля; засечка — неснижаемый остаток; маркер — текущий остаток.
export function StockRuler({ balance, min, unit, max }: { balance: number; min: number; unit: string; max?: number }) {
  const top = Math.max(max ?? 0, balance, min * 2, 1);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / top) * 100))}%`;
  const low = balance < min;
  const text = `Остаток ${rub(balance)} ${unit}, неснижаемый остаток ${rub(min)} ${unit}${low ? ', ниже минимума' : ''}`;
  return (
    <div className="ruler" data-low={low || undefined} role="img" aria-label={text}>
      <div className="ruler-track">
        <div className="ruler-zone" style={{ width: pct(min) }} />
        <div className="ruler-fill" style={{ width: pct(balance) }} />
        <div className="ruler-min" style={{ left: pct(min) }} />
        <div className="ruler-now" style={{ left: pct(balance) }} />
      </div>
      <div className="ruler-scale" aria-hidden="true">
        {(min / top) > 0.1 && <span>0</span>}
        <span className="ruler-min-label" style={{ left: pct(min) }}>мин. {rub(min)}</span>
        <span className="ruler-end">{rub(top)} {unit}</span>
      </div>
      <div className="ruler-values" aria-hidden="true"><b className="num">{rub(balance)} {unit}</b>{low && <span className="ruler-alert">■ не хватает {rub(min - balance)} {unit}</span>}</div>
    </div>
  );
}
