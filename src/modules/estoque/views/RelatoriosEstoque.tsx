/**
 * Relatórios do estoque com filtros e exportação CSV.
 */

import React, { useState } from 'react';
import { FileSpreadsheet, Info } from 'lucide-react';
import { ITEM_KIND_LABELS, ItemKind } from '../../../../shared/estoque/types';
import { stockCan } from '../../../../shared/estoque/rules';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { addDaysISO, formatDateBR, formatDateTimeBR, todayISO } from '../../../../shared/orcamentos/dates';
import { api, fetchBlob, qs, saveBlob } from '../../orcamentos/api';
import { Button, Card, Checkbox, ErrorState, Field, Input, Loading, PageHeader, Select, cx, useAsync, useToast } from '../../orcamentos/ui';
import { useStock } from '../context';
import { LocationSelect, OpBadge, RentBadge, Th, fmtQty } from '../components';

const REPORTS = [
  ['posicao', 'Posição de estoque', true],
  ['abaixo_minimo', 'Abaixo do mínimo', false],
  ['patrimonio', 'Patrimônio (equipamentos)', true],
  ['valor_categoria', 'Valor por categoria', true],
  ['utilizacao', 'Utilização de equipamentos', false],
  ['divergencias', 'Divergências de inventário', false],
] as const;
type Kind = (typeof REPORTS)[number][0];

export const RelatoriosEstoque: React.FC = () => {
  const { user, settings } = useStock();
  const toast = useToast();
  const allowed = REPORTS.filter(([, , cost]) => !cost || stockCan.viewCosts(user));
  const [kind, setKind] = useState<Kind>(allowed[0][0]);
  const [category, setCategory] = useState('');
  const [itemKind, setItemKind] = useState('');
  const [location, setLocation] = useState<number | null>(null);
  const [from, setFrom] = useState(addDaysISO(todayISO(), -29));
  const [to, setTo] = useState(todayISO());
  const [withOff, setWithOff] = useState(false);
  const params = { category, kind: itemKind, location_id: location, from, to, include_written_off: withOff ? '1' : '' };
  const { data, error, loading, reload } = useAsync(() => api.get<{ rows: any[] }>(`/stock/reports/${kind}${qs(params)}`), [kind, category, itemKind, location, from, to, withOff]);

  const exportCsv = async () => {
    try {
      saveBlob(await fetchBlob(`/stock/reports/${kind}${qs({ ...params, format: 'csv' })}`), `estoque-${kind}-${todayISO()}.csv`);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const rows = data?.rows || [];
  const table = () => {
    if (!rows.length) return <p className="text-sm text-slate-500 text-center py-10">Sem registros para os filtros selecionados.</p>;
    switch (kind) {
      case 'posicao':
        return (
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-slate-50"><tr><Th>Item</Th><Th>Local</Th><Th right>Físico</Th><Th right>Reserv.</Th><Th right>Indisp.</Th><Th right>Disponível</Th><Th right>Custo unit.</Th><Th right>Custo total</Th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-2"><p className="font-medium">{r.description}</p><p className="text-[11px] text-slate-500">{r.code} • {ITEM_KIND_LABELS[r.kind as ItemKind]}</p></td>
                  <td className="px-4 py-2">{r.location}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtQty(r.quantity, r.unit)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtQty(r.reserved)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtQty(r.unavailable)}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold">{fmtQty(r.available)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatBRL(r.unit_cost)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatBRL(r.total_cost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-bold"><td className="px-4 py-2" colSpan={7}>Total a custo médio</td><td className="px-4 py-2 text-right tabular-nums">{formatBRL(rows.reduce((a, r) => a + (r.total_cost || 0), 0))}</td></tr></tfoot>
          </table>
        );
      case 'abaixo_minimo':
        return (
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><Th>Item</Th><Th right>Mínimo</Th><Th right>Disponível</Th><Th right>Falta</Th><Th>Fornecedor</Th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-2"><p className="font-medium">{r.description}</p><p className="text-[11px] text-slate-500">{r.code}</p></td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtQty(r.min_qty, r.unit)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-amber-700 font-semibold">{fmtQty(r.available)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtQty(r.min_qty - r.available)}</td>
                  <td className="px-4 py-2">{r.supplier || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'patrimonio':
        return (
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-slate-50"><tr><Th>Patrimônio</Th><Th>Equipamento</Th><Th>Local</Th><Th>Estado</Th><Th>Locação</Th><Th>Aquisição</Th><Th right>Custo</Th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-semibold">{r.asset_tag}{r.serial_number && <p className="text-[11px] font-normal text-slate-500">S/N {r.serial_number}</p>}</td>
                  <td className="px-4 py-2"><p>{r.description}</p><p className="text-[11px] text-slate-500">{r.code}</p></td>
                  <td className="px-4 py-2">{r.location || '—'}</td>
                  <td className="px-4 py-2"><OpBadge s={r.operational_status} /></td>
                  <td className="px-4 py-2"><RentBadge s={r.rental_status} /></td>
                  <td className="px-4 py-2">{formatDateBR(r.acquisition_date)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatBRL(r.acquisition_cost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-slate-200 bg-slate-50 font-bold"><td className="px-4 py-2" colSpan={6}>Total a custo de aquisição</td><td className="px-4 py-2 text-right tabular-nums">{formatBRL(rows.filter((r) => r.operational_status !== 'baixado').reduce((a, r) => a + (r.acquisition_cost || 0), 0))}</td></tr></tfoot>
          </table>
        );
      case 'valor_categoria':
        return (
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><Th>Categoria</Th><Th right>Estoque a custo médio</Th><Th right>Patrimônio de locação (custo)</Th><Th right>Valor comercial estimado</Th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium">{r.category}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatBRL(Math.round(r.stock_cost))}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatBRL(Math.round(r.rental_cost))}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-500">{formatBRL(Math.round(r.commercial))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'utilizacao':
        return (
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><Th>Patrimônio</Th><Th>Equipamento</Th><Th right>Dias locado</Th><Th right>Dias no período</Th><Th right>Utilização</Th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-semibold">{r.asset_tag}</td>
                  <td className="px-4 py-2">{r.description}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.rented_days}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.period_days}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-[#2a78d6]" style={{ width: `${r.utilization}%` }} /></div>
                      <span className="tabular-nums w-12">{r.utilization.toLocaleString('pt-BR')}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'divergencias':
        return (
          <table className="w-full text-sm min-w-[820px]">
            <thead className="bg-slate-50"><tr><Th>Inventário</Th><Th>Item</Th><Th>Local</Th><Th right>Sistema</Th><Th right>Contado</Th><Th right>Diferença</Th><Th>Justificativa</Th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-4 py-2"><b>{r.inventory}</b><p className="text-[11px] text-slate-500">{formatDateTimeBR(r.approved_at)}</p></td>
                  <td className="px-4 py-2">{r.code} — {r.description}</td>
                  <td className="px-4 py-2">{r.location}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtQty(r.system_qty)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtQty(r.counted_qty)}</td>
                  <td className={cx('px-4 py-2 text-right tabular-nums font-semibold', r.difference > 0 ? 'text-emerald-700' : 'text-red-700')}>{fmtQty(r.difference)}</td>
                  <td className="px-4 py-2 text-slate-600">{r.justification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
    }
  };

  return (
    <div>
      <PageHeader title="Relatórios de Estoque" subtitle="Consultas diretas ao banco, com exportação CSV." />
      <div className="flex flex-wrap items-end gap-2 mb-4 p-3 bg-white rounded-xl border border-slate-200">
        <Field label="Categoria" className="w-[calc(50%-4px)] sm:w-44">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Todas</option>
            {settings.categories.map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Tipo de item" className="w-[calc(50%-4px)] sm:w-48">
          <Select value={itemKind} onChange={(e) => setItemKind(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(ITEM_KIND_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        {kind === 'posicao' && (
          <Field label="Local" className="w-full sm:w-52">
            <LocationSelect value={location} onChange={setLocation} placeholder="Todos" includeInactive />
          </Field>
        )}
        {kind === 'utilizacao' && (
          <>
            <Field label="De" className="w-[calc(50%-4px)] sm:w-36">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Até" className="w-[calc(50%-4px)] sm:w-36">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </>
        )}
        {kind === 'patrimonio' && <Checkbox checked={withOff} onChange={setWithOff} label="Incluir baixados" />}
      </div>
      {kind === 'valor_categoria' && (
        <div className="flex items-start gap-2 text-xs text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2.5 mb-4">
          <Info className="w-4 h-4 shrink-0 text-slate-400 mt-px" />
          <p>Custo médio (estoque), custo de aquisição (patrimônio, sem depreciação) e preço de venda (estimativa comercial) são grandezas diferentes e não devem ser somadas.</p>
        </div>
      )}
      <Card
        bodyClassName="p-0"
        title={
          <div className="flex gap-1 overflow-x-auto -my-1 pb-1">
            {allowed.map(([k, l]) => (
              <button key={k} onClick={() => setKind(k)} className={cx('px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap', kind === k ? 'bg-[#1e3a5f] text-white' : 'text-slate-600 hover:bg-slate-100')}>
                {l}
              </button>
            ))}
          </div>
        }
        actions={
          <Button size="sm" icon={FileSpreadsheet} onClick={exportCsv} disabled={!rows.length}>
            CSV
          </Button>
        }
      >
        {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : <div className={cx('overflow-x-auto', loading && 'opacity-60')}>{table()}</div>}
      </Card>
    </div>
  );
};
