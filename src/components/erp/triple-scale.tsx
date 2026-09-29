import { short } from './format';

type Props = {
  plan: number;
  fact: number;
  forecast?: number;
  limit?: number;
  limitLabel?: string;
  // Общий максимум шкалы, чтобы строки одного реестра были сравнимы между собой.
  max?: number;
  format?: (n: number) => string;
  label?: string;
  values?: boolean;
  size?: 'sm' | 'md';
};

// «Тройная шкала»: штриховка — план, заливка — факт, пунктир со стрелкой — прогноз, засечка — лимит.
// Одна и та же форма для денег, сроков и снабжения.
export function TripleScale({ plan, fact, forecast, limit, limitLabel = 'лимит', max, format = short, label, values = true, size = 'md' }: Props) {
  const top = Math.max(max ?? 0, plan, fact, forecast ?? 0, limit ?? 0, 1) * 1.04;
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / top) * 100))}%`;
  const factIn = Math.min(fact, plan);
  const factOver = Math.max(0, fact - plan);
  const showForecast = forecast !== undefined && forecast > fact;
  const summary = [`план ${format(plan)}`, `факт ${format(fact)}`, forecast !== undefined ? `прогноз ${format(forecast)}` : '', limit ? `${limitLabel} ${format(limit)}` : '', factOver > 0 ? 'факт выше плана' : ''].filter(Boolean).join(', ');
  return (
    <div className={`ts ts-${size}`} role="img" aria-label={label ? `${label}: ${summary}` : summary}>
      <div className="ts-track">
        <div className="ts-plan" style={{ width: pct(plan) }} />
        <div className="ts-fact" style={{ width: pct(factIn) }} />
        {factOver > 0 && <div className="ts-over" style={{ left: pct(plan), width: pct(factOver) }} />}
        {showForecast && <div className="ts-forecast" style={{ left: pct(fact), width: `calc(${pct(forecast as number)} - ${pct(fact)})` }} />}
        {limit !== undefined && limit > 0 && <div className="ts-limit" style={{ left: pct(limit) }} title={`${limitLabel}: ${format(limit)}`} />}
      </div>
      {values && (
        <div className="ts-values" aria-hidden="true">
          <span><i className="k-plan" />план <b>{format(plan)}</b></span>
          <span><i className="k-fact" />факт <b className={factOver > 0 ? 'is-over' : ''}>{format(fact)}</b></span>
          {forecast !== undefined && <span><i className="k-fc" />прогноз <b>{format(forecast)}</b></span>}
          {limit ? <span><i className="k-limit" />{limitLabel} <b>{format(limit)}</b></span> : null}
        </div>
      )}
    </div>
  );
}

export function ScaleLegend({ limit = true }: { limit?: boolean }) {
  return (
    <div className="ts-legend" aria-label="Обозначения шкалы">
      <span><i className="k-plan" />план</span>
      <span><i className="k-fact" />факт</span>
      <span><i className="k-over" />факт выше плана</span>
      <span><i className="k-fc" />прогноз</span>
      {limit && <span><i className="k-limit" />договор</span>}
    </div>
  );
}
