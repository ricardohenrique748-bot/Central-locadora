/**
 * Dashboard financeiro: indicadores e gráficos de dados reais, com a data usada em cada indicador explicada.
 */

import React, { useState } from 'react';
import { Info, Wallet, Landmark, TrendingUp, TrendingDown, Scale, ArrowDownCircle, ArrowUpCircle, AlertTriangle, CalendarClock, ShoppingCart, KeyRound, Settings2, Boxes } from 'lucide-react';
import { ORIGIN_LABELS, ReceivableOrigin } from '../../../../shared/financeiro/types';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { addDaysISO, formatDateBR, todayISO } from '../../../../shared/orcamentos/dates';
import { api, qs } from '../../orcamentos/api';
import { ErrorState, Field, Input, Loading, PageHeader, Select, cx, useAsync } from '../../orcamentos/ui';
import { ChartCard, ColumnChart, DataTable, GroupedColumnChart, HBarChart, Legend, SERIES } from '../../orcamentos/charts';
import { useFin } from '../context';
import { AccountSelect, CategorySelect } from '../components';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const lbl = (b: string, g: string) => (g === 'dia' ? `${b.slice(8, 10)}/${b.slice(5, 7)}` : `${MONTHS[Number(b.slice(5, 7)) - 1]}/${b.slice(2, 4)}`);

const Kpi: React.FC<{ icon: React.ElementType; label: string; value: number; hint?: string; tone?: string; onClick?: () => void; negativeRed?: boolean }> = ({ icon: Icon, label, value, hint, tone = 'text-[#1e3a5f] bg-slate-100', onClick, negativeRed = true }) => (
  <button onClick={onClick} disabled={!onClick} className={cx('bg-white rounded-xl border border-slate-200 p-3.5 text-left shadow-xs', onClick && 'hover:border-[#1e3a5f]/40 hover:shadow-sm transition')}>
    <div className="flex items-center gap-2">
      <span className={cx('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', tone)}>
        <Icon className="w-4 h-4" />
      </span>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
    </div>
    <p className={cx('text-lg font-extrabold mt-2 tabular-nums', negativeRed && value < 0 ? 'text-red-700' : 'text-slate-900')}>{formatBRL(value)}</p>
    {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
  </button>
);

export const DashboardFin: React.FC = () => {
  const { navigate, costCenters } = useFin();
  const today = todayISO();
  const [preset, setPreset] = useState('mes');
  const [custom, setCustom] = useState({ from: addDaysISO(today, -30), to: today });
  const [account, setAccount] = useState<number | null>(null);
  const [category, setCategory] = useState<number | null>(null);
  const [catType, setCatType] = useState<'despesa' | 'receita'>('despesa');
  const [cc, setCc] = useState('');
  const range =
    preset === 'mes' ? { from: `${today.slice(0, 8)}01`, to: today } : preset === 'custom' ? custom : preset === 'ano' ? { from: `${today.slice(0, 4)}-01-01`, to: today } : { from: addDaysISO(today, -(Number(preset) - 1)), to: today };
  const { data, error, loading, reload } = useAsync(() => api.get<any>(`/finance/dashboard${qs({ ...range, account_id: account, category_id: category, cost_center_id: cc })}`), [range.from, range.to, account, category, cc]);
  const k = data?.kpis;
  const g = data?.period?.granularity;

  return (
    <div>
      <PageHeader title="Dashboard Financeiro" subtitle="Valores realizados (dinheiro que entrou/saiu) separados de previstos (títulos em aberto)." />
      <div className="flex flex-wrap items-end gap-2 mb-5 p-3 bg-white rounded-xl border border-slate-200">
        <Field label="Período" className="w-full sm:w-40">
          <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
            <option value="mes">Este mês</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="ano">Este ano</option>
            <option value="custom">Personalizado</option>
          </Select>
        </Field>
        {preset === 'custom' && (
          <>
            <Field label="De" className="w-[calc(50%-4px)] sm:w-36">
              <Input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            </Field>
            <Field label="Até" className="w-[calc(50%-4px)] sm:w-36">
              <Input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            </Field>
          </>
        )}
        <Field label="Conta" className="w-full sm:w-56">
          <AccountSelect value={account} onChange={setAccount} placeholder="Todas as contas" includeInactive />
        </Field>
        <Field label="Categoria" className="w-full sm:w-64">
          <div className="flex gap-1">
            <Select value={catType} onChange={(e) => (setCatType(e.target.value as any), setCategory(null))} className="w-28">
              <option value="despesa">Despesa</option>
              <option value="receita">Receita</option>
            </Select>
            <CategorySelect type={catType} value={category} onChange={setCategory} includeInactive placeholder="Todas" />
          </div>
        </Field>
        <Field label="Centro de custo" className="w-full sm:w-48">
          <Select value={cc} onChange={(e) => setCc(e.target.value)}>
            <option value="">Todos</option>
            {costCenters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : k ? (
        <div className={cx('space-y-5', loading && 'opacity-60')}>
          <p className="text-xs text-slate-500">
            Período: <b>{formatDateBR(data.period.from)}</b> a <b>{formatDateBR(data.period.to)}</b>
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
            <Kpi icon={Wallet} label="Saldo inicial do período" value={k.saldo_inicial} hint={`Em ${formatDateBR(addDaysISO(data.period.from, -1))}`} />
            <Kpi icon={Landmark} label="Saldo atual" value={k.saldo_atual} hint="Inicial + movimentações efetivadas" onClick={() => navigate({ page: 'contas' })} />
            <Kpi icon={TrendingUp} label="Receitas realizadas" value={k.receitas_realizadas} tone="text-emerald-700 bg-emerald-50" hint="Pela data do recebimento" />
            <Kpi icon={TrendingDown} label="Despesas realizadas" value={k.despesas_realizadas} tone="text-red-700 bg-red-50" hint="Pela data do pagamento" />
            <Kpi icon={Scale} label="Resultado do período" value={k.resultado} hint="Realizado (caixa), sem transferências" />
            <Kpi icon={ArrowDownCircle} label="A receber em aberto" value={k.a_receber_aberto} tone="text-sky-700 bg-sky-50" hint="Não somado ao saldo" onClick={() => navigate({ page: 'receber' })} />
            <Kpi icon={ArrowUpCircle} label="A pagar em aberto" value={k.a_pagar_aberto} tone="text-amber-700 bg-amber-50" onClick={() => navigate({ page: 'pagar' })} />
            <Kpi icon={AlertTriangle} label="Vencido a receber" value={k.vencido_receber} tone="text-red-700 bg-red-50" onClick={() => navigate({ page: 'inadimplencia' })} />
            <Kpi icon={AlertTriangle} label="Vencido a pagar" value={k.vencido_pagar} tone="text-red-700 bg-red-50" onClick={() => navigate({ page: 'pagar', status: 'vencido' })} />
            <Kpi icon={CalendarClock} label="Recebimentos previstos" value={k.recebimentos_previstos} hint="Vencimentos no período (a partir de hoje)" />
            <Kpi icon={CalendarClock} label="Pagamentos previstos" value={k.pagamentos_previstos} hint="Vencimentos no período (a partir de hoje)" />
            <Kpi icon={ShoppingCart} label="Receitas de vendas" value={k.receitas_vendas} />
            <Kpi icon={KeyRound} label="Receitas de locação" value={k.receitas_locacao} />
            <Kpi icon={Settings2} label="Despesas operacionais" value={k.despesas_operacionais} hint="Custos, operacionais e administrativas" />
            <Kpi icon={Boxes} label="Compras e estoque" value={k.despesas_compras_estoque} hint="Inclui investimento em patrimônio" />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-bold text-slate-800 mb-2">Saldo projetado</p>
            <div className="grid grid-cols-3 gap-3">
              {[
                ['7 dias', k.projetado_7],
                ['15 dias', k.projetado_15],
                ['30 dias', k.projetado_30],
              ].map(([l, v]) => (
                <div key={l as string}>
                  <p className="text-xs text-slate-500">Em {l}</p>
                  <p className={cx('text-lg font-extrabold tabular-nums', (v as number) < 0 && 'text-red-700')}>{formatBRL(v as number)}</p>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 mt-2 flex items-start gap-1">
              <Info className="w-3.5 h-3.5 shrink-0 mt-px" /> Saldo atual + a receber − a pagar com vencimento de hoje até a data. Valores já vencidos ({formatBRL(k.vencido_receber)} a receber / {formatBRL(k.vencido_pagar)} a pagar) não entram — risco de inadimplência.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <ChartCard title="Receitas × despesas realizadas" subtitle={`Por ${g === 'dia' ? 'dia' : 'mês'}, pela data do pagamento/recebimento`} empty={!data.series.some((s: any) => s.receitas || s.despesas)}>
              {(asTable) =>
                asTable ? (
                  <DataTable head={['Período', 'Receitas', 'Despesas']} rows={data.series.map((s: any) => [lbl(s.bucket, g), formatBRL(s.receitas), formatBRL(s.despesas)])} />
                ) : (
                  <GroupedColumnChart asTable={false} names={['Receitas (R$)', 'Despesas (R$)']} data={data.series.map((s: any) => ({ label: lbl(s.bucket, g), a: Math.round(s.receitas / 100), b: Math.round(s.despesas / 100) }))} />
                )
              }
            </ChartCard>
            <ChartCard title="Evolução do saldo" subtitle="Saldo de fechamento de cada período (contas selecionadas)" empty={!data.balanceSeries.length}>
              {(asTable) => <ColumnChart asTable={asTable} valueLabel="Saldo" data={data.balanceSeries.map((s: any) => ({ label: lbl(s.bucket, g), value: Math.max(0, s.saldo), sub: s.saldo < 0 ? `negativo: ${formatBRL(s.saldo)}` : undefined }))} format={formatBRL} />}
            </ChartCard>
            <ChartCard title="Fluxo realizado × projetado" subtitle="Resultado líquido por semana: 4 passadas (realizado) e 5 futuras (previsto)" empty={!data.flowWeeks.some((w: any) => w.realizado || w.projetado)}>
              {(asTable) =>
                asTable ? (
                  <DataTable head={['Semana de', 'Realizado', 'Projetado']} rows={data.flowWeeks.map((w: any) => [formatDateBR(w.label), w.realizado === null ? '—' : formatBRL(w.realizado), w.projetado === null ? '—' : formatBRL(w.projetado)])} />
                ) : (
                  <div>
                    <Legend items={[{ label: 'Realizado (dinheiro movimentado)', color: SERIES[0] }, { label: 'Projetado (títulos em aberto)', color: SERIES[1] }]} />
                    <ul className="space-y-1.5">
                      {data.flowWeeks.map((w: any) => {
                        const v = w.realizado ?? w.projetado ?? 0;
                        const max = Math.max(...data.flowWeeks.map((x: any) => Math.abs(x.realizado ?? x.projetado ?? 0)), 1);
                        return (
                          <li key={w.label} className="flex items-center gap-2 text-xs">
                            <span className="w-14 text-slate-500 tabular-nums">{formatDateBR(w.label).slice(0, 5)}</span>
                            <div className="flex-1 h-3 bg-slate-100 rounded-full relative overflow-hidden">
                              <div className="absolute top-0 bottom-0 rounded-full" style={{ left: v >= 0 ? '50%' : `${50 - (Math.abs(v) / max) * 50}%`, width: `${(Math.abs(v) / max) * 50}%`, background: w.realizado !== null ? SERIES[0] : SERIES[1] }} />
                              <div className="absolute top-0 bottom-0 left-1/2 w-px bg-slate-300" />
                            </div>
                            <span className={cx('w-28 text-right tabular-nums', v < 0 ? 'text-red-700' : 'text-slate-800')}>{formatBRL(v)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )
              }
            </ChartCard>
            <ChartCard title="Despesas por categoria" subtitle="Realizadas no período" empty={!data.expByCat.length}>
              {(asTable) => <HBarChart asTable={asTable} head={['Categoria', 'Valor']} format={formatBRL} data={data.expByCat.slice(0, 10)} />}
            </ChartCard>
            <ChartCard title="Receitas por origem" subtitle="Realizadas no período" empty={!data.revByOrigin.length}>
              {(asTable) => <HBarChart asTable={asTable} head={['Origem', 'Valor']} format={formatBRL} data={data.revByOrigin.map((r: any) => ({ label: ORIGIN_LABELS[r.label as ReceivableOrigin] || r.label, value: r.value }))} />}
            </ChartCard>
            <ChartCard title="Inadimplência ao longo do tempo" subtitle="Valor a receber vencido e não pago no fim de cada mês" empty={!data.delinquency.some((d: any) => d.value)}>
              {(asTable) => <ColumnChart asTable={asTable} valueLabel="Vencido em aberto" color={SERIES[1]} data={data.delinquency.map((d: any) => ({ label: lbl(d.bucket, 'mes'), value: d.value }))} format={formatBRL} />}
            </ChartCard>
          </div>
        </div>
      ) : null}
    </div>
  );
};
