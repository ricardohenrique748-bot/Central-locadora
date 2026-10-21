/**
 * Relatórios do módulo: agrupamentos por período, cliente, responsável, modalidade e status,
 * motivos de recusa e propostas vencidas/vencendo. Exportação CSV de cada relatório.
 */

import React, { useState } from 'react';
import { FileSpreadsheet, Info } from 'lucide-react';
import { QuotationStatus } from '../../../../shared/orcamentos/types';
import { STATUS_LABELS } from '../../../../shared/orcamentos/status';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { addDaysISO, formatDateBR, todayISO } from '../../../../shared/orcamentos/dates';
import { api, fetchBlob, qs, saveBlob } from '../api';
import { useModule } from '../context';
import { Button, Card, ErrorState, Loading, PageHeader, StatusBadge, cx, useAsync, useToast } from '../ui';
import { PeriodFilter, PeriodFilters, periodRange } from './PainelView';

interface GroupRow {
  key: string | number;
  label: string;
  count: number;
  value: number;
  won: number;
  won_value: number;
  sent: number;
  won_sent: number;
}
interface ListRow {
  id: number;
  quotation_number: string;
  customer_name: string;
  responsible_name: string;
  expiration_date: string;
  total_amount: number;
  status: QuotationStatus;
}
interface Reports {
  byCustomer: GroupRow[];
  byResponsible: GroupRow[];
  byType: GroupRow[];
  byStatus: { key: QuotationStatus; label: QuotationStatus; count: number; value: number }[];
  byPeriod: GroupRow[];
  refusalReasons: { label: string; count: number; value: number }[];
  expired: ListRow[];
  expiring: ListRow[];
}

const TABS = [
  ['byPeriod', 'Por período'],
  ['byCustomer', 'Por cliente'],
  ['byResponsible', 'Por responsável'],
  ['byType', 'Por modalidade'],
  ['byStatus', 'Por status'],
  ['refusalReasons', 'Motivos de recusa'],
  ['expiring', 'Próximos do vencimento'],
  ['expired', 'Vencidas'],
] as const;
type Tab = (typeof TABS)[number][0];

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—');

export const RelatoriosView: React.FC = () => {
  const { navigate, settings } = useModule();
  const toast = useToast();
  const [period, setPeriod] = useState<PeriodFilter>({ preset: 'ano', from: addDaysISO(todayISO(), -30), to: todayISO() });
  const [type, setType] = useState('');
  const [responsible, setResponsible] = useState('');
  const [tab, setTab] = useState<Tab>('byPeriod');
  const [exporting, setExporting] = useState(false);
  const range = periodRange(period);
  const params = { ...range, type, responsible };

  const { data, error, loading, reload } = useAsync(() => api.get<Reports>(`/reports${qs(params)}`), [range.created_from, range.created_to, type, responsible]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      saveBlob(await fetchBlob(`/reports/export.csv${qs({ ...params, kind: tab })}`), `relatorio-${tab}-${todayISO()}.csv`);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const groupTable = (rows: GroupRow[], labelHead: string, fmt: (r: GroupRow) => string = (r) => r.label) => {
    const totals = rows.reduce((a, r) => ({ count: a.count + r.count, value: a.value + r.value, won: a.won + r.won, won_value: a.won_value + r.won_value, sent: a.sent + r.sent, won_sent: a.won_sent + r.won_sent }), {
      count: 0,
      value: 0,
      won: 0,
      won_value: 0,
      sent: 0,
      won_sent: 0,
    });
    return (
      <table className="w-full text-sm min-w-[720px]">
        <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
          <tr>
            <th className="text-left font-semibold px-4 py-2.5">{labelHead}</th>
            <th className="text-right font-semibold px-4 py-2.5">Orçamentos</th>
            <th className="text-right font-semibold px-4 py-2.5">Valor proposto</th>
            <th className="text-right font-semibold px-4 py-2.5">Aprovados</th>
            <th className="text-right font-semibold px-4 py-2.5">Valor aprovado</th>
            <th className="text-right font-semibold px-4 py-2.5">Enviados</th>
            <th className="text-right font-semibold px-4 py-2.5">Conversão</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-slate-100">
              <td className="px-4 py-2 font-medium text-slate-800">{fmt(r)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.count}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatBRL(r.value)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.won}</td>
              <td className="px-4 py-2 text-right tabular-nums">{formatBRL(r.won_value)}</td>
              <td className="px-4 py-2 text-right tabular-nums">{r.sent}</td>
              <td className="px-4 py-2 text-right tabular-nums font-semibold">{pct(r.won_sent, r.sent)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
            <td className="px-4 py-2">Total</td>
            <td className="px-4 py-2 text-right tabular-nums">{totals.count}</td>
            <td className="px-4 py-2 text-right tabular-nums">{formatBRL(totals.value)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{totals.won}</td>
            <td className="px-4 py-2 text-right tabular-nums">{formatBRL(totals.won_value)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{totals.sent}</td>
            <td className="px-4 py-2 text-right tabular-nums">{pct(totals.won_sent, totals.sent)}</td>
          </tr>
        </tfoot>
      </table>
    );
  };

  const listTable = (rows: ListRow[]) => (
    <table className="w-full text-sm min-w-[720px]">
      <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
        <tr>
          <th className="text-left font-semibold px-4 py-2.5">Número</th>
          <th className="text-left font-semibold px-4 py-2.5">Cliente</th>
          <th className="text-left font-semibold px-4 py-2.5">Responsável</th>
          <th className="text-left font-semibold px-4 py-2.5">Validade</th>
          <th className="text-right font-semibold px-4 py-2.5">Valor</th>
          <th className="text-left font-semibold px-4 py-2.5">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => navigate({ page: 'detalhe', id: r.id })}>
            <td className="px-4 py-2 font-semibold text-[#1e3a5f]">{r.quotation_number}</td>
            <td className="px-4 py-2">{r.customer_name}</td>
            <td className="px-4 py-2 text-slate-600">{r.responsible_name}</td>
            <td className="px-4 py-2">{formatDateBR(r.expiration_date)}</td>
            <td className="px-4 py-2 text-right tabular-nums">{formatBRL(r.total_amount)}</td>
            <td className="px-4 py-2">
              <StatusBadge status={r.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const content = () => {
    if (!data) return null;
    const rows = data[tab] as unknown[];
    if (!rows.length) return <p className="text-sm text-slate-500 text-center py-10">Sem registros para os filtros selecionados.</p>;
    switch (tab) {
      case 'byPeriod':
        return groupTable(data.byPeriod, 'Mês de criação', (r) => `${MONTHS[Number(String(r.label).slice(5, 7)) - 1]}/${String(r.label).slice(0, 4)}`);
      case 'byCustomer':
        return groupTable(data.byCustomer, 'Cliente');
      case 'byResponsible':
        return groupTable(data.byResponsible, 'Responsável');
      case 'byType':
        return groupTable(data.byType, 'Modalidade', (r) => (r.label === 'venda' ? 'Venda' : 'Locação'));
      case 'byStatus':
        return (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Status</th>
                <th className="text-right font-semibold px-4 py-2.5">Quantidade</th>
                <th className="text-right font-semibold px-4 py-2.5">Valor</th>
              </tr>
            </thead>
            <tbody>
              {data.byStatus.map((r) => (
                <tr key={r.key} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    <StatusBadge status={r.key} />
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.count}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatBRL(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'refusalReasons':
        return (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Motivo</th>
                <th className="text-right font-semibold px-4 py-2.5">Quantidade</th>
                <th className="text-right font-semibold px-4 py-2.5">Valor perdido</th>
              </tr>
            </thead>
            <tbody>
              {data.refusalReasons.map((r) => (
                <tr key={r.label} className="border-t border-slate-100">
                  <td className="px-4 py-2">{r.label}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.count}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatBRL(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'expiring':
        return listTable(data.expiring);
      case 'expired':
        return listTable(data.expired);
    }
  };

  return (
    <div>
      <PageHeader title="Relatórios" subtitle="Dados autorizados para o seu perfil, com os filtros abaixo." />
      <PeriodFilters period={period} setPeriod={setPeriod} type={type} setType={setType} responsible={responsible} setResponsible={setResponsible} />
      <div className="flex items-start gap-2 text-xs text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2.5 mb-4">
        <Info className="w-4 h-4 shrink-0 text-slate-400 mt-px" />
        <p>
          <b>Taxa de conversão</b> = propostas aprovadas pelo cliente (ou convertidas) ÷ propostas que chegaram a ser enviadas ao cliente, ambas dentro do mesmo conjunto filtrado (criadas no período). Recusadas, canceladas e expiradas nunca contam como aprovadas. "Próximos do vencimento" considera {settings.expiring_soon_days} dia(s).
        </p>
      </div>
      <Card
        bodyClassName="p-0"
        title={
          <div className="flex gap-1 overflow-x-auto -my-1 pb-1">
            {TABS.map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={cx('px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap', tab === k ? 'bg-[#1e3a5f] text-white' : 'text-slate-600 hover:bg-slate-100')}>
                {l}
              </button>
            ))}
          </div>
        }
        actions={
          <Button size="sm" icon={FileSpreadsheet} loading={exporting} onClick={exportCsv} disabled={!data || !(data[tab] as unknown[]).length}>
            CSV
          </Button>
        }
      >
        {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : <div className={cx('overflow-x-auto', loading && 'opacity-60')}>{content()}</div>}
      </Card>
    </div>
  );
};

