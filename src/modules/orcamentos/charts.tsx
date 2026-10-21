/**
 * Gráficos simples (HTML/CSS), com dica ao passar o mouse e alternância para tabela.
 * Cores da paleta categórica validada: série 1 azul #2a78d6, série 2 laranja #eb6834.
 */

import React, { useState } from 'react';
import { Table2, BarChart3 } from 'lucide-react';
import { cx } from './ui';

export const SERIES = ['#2a78d6', '#eb6834'];

export interface BarDatum {
  label: string;
  value: number;
  sub?: string;
}

const TableToggle: React.FC<{ asTable: boolean; onToggle: () => void }> = ({ asTable, onToggle }) => (
  <button onClick={onToggle} className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label={asTable ? 'Ver gráfico' : 'Ver tabela'} title={asTable ? 'Ver gráfico' : 'Ver tabela'}>
    {asTable ? <BarChart3 className="w-4 h-4" /> : <Table2 className="w-4 h-4" />}
  </button>
);

export const ChartCard: React.FC<{ title: string; subtitle?: string; children: (asTable: boolean) => React.ReactNode; empty?: boolean }> = ({ title, subtitle, children, empty }) => {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 min-w-0">
      <header className="flex items-start justify-between gap-2 mb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          {subtitle && <p className="text-[11px] text-slate-500">{subtitle}</p>}
        </div>
        {!empty && <TableToggle asTable={asTable} onToggle={() => setAsTable((v) => !v)} />}
      </header>
      {empty ? <p className="text-sm text-slate-400 py-10 text-center">Sem dados no período.</p> : children(asTable)}
    </section>
  );
};

/** Barras verticais de uma série (sem legenda: o título nomeia a série). */
export const ColumnChart: React.FC<{ data: BarDatum[]; format: (v: number) => string; color?: string; height?: number; asTable: boolean; valueLabel: string }> = ({
  data,
  format,
  color = SERIES[0],
  height = 160,
  asTable,
  valueLabel,
}) => {
  const [hover, setHover] = useState<number | null>(null);
  if (asTable) return <DataTable rows={data.map((d) => [d.label, format(d.value), d.sub || ''])} head={['Período', valueLabel, '']} />;
  const max = Math.max(...data.map((d) => d.value), 1);
  const showEvery = Math.ceil(data.length / 12);
  return (
    <div className="relative">
      <div className="flex items-end gap-[2px] border-b border-slate-200" style={{ height }}>
        {data.map((d, i) => (
          <div
            key={d.label}
            className="flex-1 h-full flex items-end cursor-default"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            role="img"
            aria-label={`${d.label}: ${format(d.value)}`}
          >
            <div
              className="w-full rounded-t-[4px] transition-opacity"
              style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? 2 : 0, background: color, opacity: hover === null || hover === i ? 1 : 0.45 }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-[2px] mt-1">
        {data.map((d, i) => (
          <span key={d.label} className="flex-1 text-[10px] text-slate-500 text-center truncate">
            {i % showEvery === 0 ? d.label : ''}
          </span>
        ))}
      </div>
      {hover !== null && (
        <div className="absolute -top-2 pointer-events-none bg-slate-900 text-white text-xs rounded-md px-2 py-1 shadow-lg whitespace-nowrap" style={{ left: `${((hover + 0.5) / data.length) * 100}%`, transform: 'translate(-50%, -100%)' }}>
          <b>{data[hover].label}</b>: {format(data[hover].value)}
          {data[hover].sub && <span className="text-slate-300"> • {data[hover].sub}</span>}
        </div>
      )}
    </div>
  );
};

/** Barras horizontais de uma série, com rótulo e valor em texto (cor só identifica a barra). */
export const HBarChart: React.FC<{ data: (BarDatum & { color?: string })[]; format: (v: number) => string; asTable: boolean; head: [string, string] }> = ({ data, format, asTable, head }) => {
  if (asTable) return <DataTable rows={data.map((d) => [d.label, format(d.value), d.sub || ''])} head={[head[0], head[1], '']} />;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="space-y-2">
      {data.map((d) => (
        <li key={d.label} className="text-xs" title={`${d.label}: ${format(d.value)}${d.sub ? ` • ${d.sub}` : ''}`}>
          <div className="flex justify-between gap-2 mb-0.5">
            <span className="text-slate-700 truncate">{d.label}</span>
            <span className="text-slate-800 font-semibold tabular-nums">
              {format(d.value)}
              {d.sub && <span className="font-normal text-slate-500"> • {d.sub}</span>}
            </span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: d.color || SERIES[0] }} />
          </div>
        </li>
      ))}
    </ul>
  );
};

export const Legend: React.FC<{ items: { label: string; color: string }[] }> = ({ items }) => (
  <div className="flex flex-wrap gap-3 text-[11px] text-slate-600 mb-2">
    {items.map((i) => (
      <span key={i.label} className="inline-flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-sm" style={{ background: i.color }} /> {i.label}
      </span>
    ))}
  </div>
);

export const DataTable: React.FC<{ head: string[]; rows: (string | number)[][]; className?: string }> = ({ head, rows, className }) => (
  <div className={cx('overflow-x-auto', className)}>
    <table className="w-full text-xs">
      <thead>
        <tr className="text-slate-500">
          {head.map((h, i) => (
            <th key={i} className={cx('font-semibold py-1.5 px-2', i === 0 ? 'text-left' : 'text-right')}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-slate-100">
            {r.map((c, j) => (
              <td key={j} className={cx('py-1.5 px-2 tabular-nums', j === 0 ? 'text-left text-slate-700' : 'text-right text-slate-800')}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** Colunas agrupadas de duas séries (ex.: entradas × saídas), com legenda e dica ao passar o mouse. */
export const GroupedColumnChart: React.FC<{ data: { label: string; a: number; b: number }[]; names: [string, string]; asTable: boolean; height?: number }> = ({ data, names, asTable, height = 160 }) => {
  const [hover, setHover] = useState<number | null>(null);
  if (asTable) return <DataTable head={['Período', names[0], names[1]]} rows={data.map((d) => [d.label, d.a, d.b])} />;
  const max = Math.max(...data.map((d) => Math.max(d.a, d.b)), 1);
  const showEvery = Math.ceil(data.length / 12);
  return (
    <div className="relative">
      <Legend items={[{ label: names[0], color: SERIES[0] }, { label: names[1], color: SERIES[1] }]} />
      <div className="flex items-end gap-1 border-b border-slate-200" style={{ height }}>
        {data.map((d, i) => (
          <div key={d.label} className="flex-1 h-full flex items-end gap-[2px]" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} role="img" aria-label={`${d.label}: ${names[0]} ${d.a}, ${names[1]} ${d.b}`}>
            {[d.a, d.b].map((v, k) => (
              <div key={k} className="flex-1 rounded-t-[4px]" style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0, background: SERIES[k], opacity: hover === null || hover === i ? 1 : 0.45 }} />
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1">
        {data.map((d, i) => (
          <span key={d.label} className="flex-1 text-[10px] text-slate-500 text-center truncate">
            {i % showEvery === 0 ? d.label : ''}
          </span>
        ))}
      </div>
      {hover !== null && (
        <div className="absolute top-6 pointer-events-none bg-slate-900 text-white text-xs rounded-md px-2 py-1 shadow-lg whitespace-nowrap" style={{ left: `${((hover + 0.5) / data.length) * 100}%`, transform: 'translate(-50%, -100%)' }}>
          <b>{data[hover].label}</b>: {names[0]} {data[hover].a} • {names[1]} {data[hover].b}
        </div>
      )}
    </div>
  );
};
