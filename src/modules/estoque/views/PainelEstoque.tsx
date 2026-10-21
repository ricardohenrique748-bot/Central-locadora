/**
 * Painel de Estoque: indicadores e gráficos de consultas reais, com filtros de período, categoria, tipo e local.
 */

import React, { useMemo, useState } from 'react';
import { Package, Boxes, Wallet, Landmark, TrendingDown, PackageX, CheckCircle2, Truck, CalendarClock, Wrench, ClipboardCheck, ArrowDownToLine, ArrowUpFromLine, Info } from 'lucide-react';
import { ITEM_KIND_LABELS, MOVEMENT_LABELS, Movement } from '../../../../shared/estoque/types';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { addDaysISO, formatDateTimeBR, todayISO } from '../../../../shared/orcamentos/dates';
import { stockCan } from '../../../../shared/estoque/rules';
import { api, qs } from '../../orcamentos/api';
import { Card, ErrorState, Field, Input, Loading, PageHeader, Select, cx, useAsync } from '../../orcamentos/ui';
import { ChartCard, ColumnChart, GroupedColumnChart, HBarChart, SERIES } from '../../orcamentos/charts';
import { useStock } from '../context';
import { LocationSelect, Stat, fmtQty } from '../components';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const label = (b: string, g: string) => (g === 'dia' ? `${b.slice(8, 10)}/${b.slice(5, 7)}` : `${MONTHS[Number(b.slice(5, 7)) - 1]}/${b.slice(2, 4)}`);

export const PainelEstoque: React.FC = () => {
  const { navigate, settings, user } = useStock();
  const today = todayISO();
  const [preset, setPreset] = useState('30');
  const [custom, setCustom] = useState({ from: addDaysISO(today, -30), to: today });
  const [category, setCategory] = useState('');
  const [kind, setKind] = useState('');
  const [location, setLocation] = useState<number | null>(null);
  const range = preset === 'custom' ? custom : { from: addDaysISO(today, -(Number(preset) - 1)), to: today };

  const { data, error, loading, reload } = useAsync(
    () => api.get<any>(`/stock/dashboard${qs({ ...range, category, kind, location_id: location })}`),
    [range.from, range.to, category, kind, location]
  );
  const k = data?.kpis;
  const showCost = stockCan.viewCosts(user);

  // completa os dias/meses sem movimentação para o eixo não pular períodos
  const flow = useMemo(() => {
    if (!data) return [];
    const g = data.period.granularity;
    const map = new Map(data.flowSeries.map((r: any) => [r.bucket, r]));
    const keys: string[] = [];
    if (g === 'dia') for (let d = data.period.from; d <= data.period.to && keys.length < 400; d = addDaysISO(d, 1)) keys.push(d);
    else {
      let [y, m] = data.period.from.slice(0, 7).split('-').map(Number);
      const end = data.period.to.slice(0, 7);
      for (;;) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        keys.push(key);
        if (key >= end || keys.length > 120) break;
        m = m === 12 ? 1 : m + 1;
        if (m === 1) y++;
      }
    }
    if (!data.flowSeries.length) return [];
    return keys.map((k2) => ({ label: label(k2, g), a: (map.get(k2) as any)?.entradas || 0, b: (map.get(k2) as any)?.saidas || 0 }));
  }, [data]);

  return (
    <div>
      <PageHeader title="Painel de Estoque" subtitle="Indicadores calculados a partir das movimentações e cadastros gravados." />
      <div className="flex flex-wrap items-end gap-2 mb-5 p-3 bg-white rounded-xl border border-slate-200">
        <Field label="Período" className="w-full sm:w-40">
          <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="365">Últimos 12 meses</option>
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
        <Field label="Categoria" className="w-[calc(50%-4px)] sm:w-44">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Todas</option>
            {settings.categories.map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Tipo de item" className="w-[calc(50%-4px)] sm:w-48">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(ITEM_KIND_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Local" className="w-full sm:w-52">
          <LocationSelect value={location} onChange={setLocation} placeholder="Todos os locais" includeInactive />
        </Field>
      </div>

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : data && k ? (
        <div className={cx('space-y-5', loading && 'opacity-60')}>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
            <Stat icon={Package} label="Itens cadastrados" value={k.itens_ativos} hint={`${k.itens_quantidade} por quantidade • ${k.itens_individuais} individuais`} onClick={() => navigate({ page: 'itens' })} />
            <Stat icon={Boxes} label="Equipamentos patrimoniais" value={k.equipamentos_patrimoniais} onClick={() => navigate({ page: 'ativos' })} />
            {showCost && <Stat icon={Wallet} label="Estoque a custo médio" value={formatBRL(k.valor_estoque_custo)} hint="Produtos, peças, consumo" />}
            {showCost && <Stat icon={Landmark} label="Patrimônio de locação" value={formatBRL(k.valor_patrimonio_locacao)} hint="Custo de aquisição (sem depreciação)" />}
            <Stat icon={TrendingDown} label="Abaixo do mínimo" value={k.abaixo_minimo} tone="text-amber-700 bg-amber-50" onClick={() => navigate({ page: 'itens', situation: 'abaixo_minimo' })} />
            <Stat icon={PackageX} label="Sem saldo" value={k.sem_saldo} tone="text-red-700 bg-red-50" onClick={() => navigate({ page: 'itens', situation: 'sem_saldo' })} />
            <Stat icon={CheckCircle2} label="Disponíveis p/ locação" value={k.eq_disponiveis} tone="text-emerald-700 bg-emerald-50" onClick={() => navigate({ page: 'ativos', status: 'disponivel' })} />
            <Stat icon={Truck} label="Alugados" value={k.eq_alugados} tone="text-blue-700 bg-blue-50" onClick={() => navigate({ page: 'ativos', status: 'alugado' })} />
            <Stat icon={CalendarClock} label="Reservados hoje" value={k.eq_reservados} tone="text-indigo-700 bg-indigo-50" onClick={() => navigate({ page: 'ativos', status: 'reservado' })} />
            <Stat icon={Wrench} label="Em manutenção" value={k.eq_manutencao} tone="text-orange-700 bg-orange-50" onClick={() => navigate({ page: 'ativos', status: 'op:em_manutencao' })} />
            <Stat icon={ClipboardCheck} label="Aguardando inspeção" value={k.eq_inspecao} hint={k.eq_danificados ? `${k.eq_danificados} danificado(s)` : undefined} tone="text-amber-700 bg-amber-50" onClick={() => navigate({ page: 'ativos', status: 'op:aguardando_inspecao' })} />
            <Stat icon={ArrowDownToLine} label="Entradas no período" value={k.entradas} hint={showCost ? formatBRL(k.valor_entradas) : undefined} />
            <Stat icon={ArrowUpFromLine} label="Saídas no período" value={k.saidas} hint={showCost ? formatBRL(k.valor_saidas) : undefined} />
          </div>

          {showCost && (
            <div className="flex items-start gap-2 text-xs text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2.5">
              <Info className="w-4 h-4 shrink-0 text-slate-400 mt-px" />
              <p>
                <b>Estoque a custo médio</b>: saldo × custo médio ponderado de compra. <b>Patrimônio de locação</b>: custo de aquisição dos equipamentos próprios, sem depreciação (valor contábil dependerá do Financeiro).{' '}
                <b>Valor comercial estimado</b> dos itens vendáveis (saldo × preço de venda): {formatBRL(k.valor_comercial_estimado)} — estimativa, não custo. Os três nunca são somados.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <ChartCard title="Movimentações por período" subtitle="Quantidade de lançamentos (sem transferências e sem entrega/retorno de locação)" empty={!flow.length}>
              {(asTable) => <GroupedColumnChart asTable={asTable} data={flow} names={['Entradas', 'Saídas']} />}
            </ChartCard>
            <ChartCard title="Situação dos equipamentos para locação" empty={!k.equipamentos_patrimoniais}>
              {(asTable) => (
                <HBarChart
                  asTable={asTable}
                  head={['Situação', 'Equipamentos']}
                  format={(v) => String(v)}
                  data={[
                    { label: 'Disponíveis', value: k.eq_disponiveis },
                    { label: 'Alugados', value: k.eq_alugados },
                    { label: 'Reservados hoje', value: k.eq_reservados },
                    { label: 'Em trânsito', value: k.eq_transito },
                    { label: 'Em manutenção', value: k.eq_manutencao },
                    { label: 'Aguardando inspeção', value: k.eq_inspecao },
                    { label: 'Danificados', value: k.eq_danificados },
                  ]}
                />
              )}
            </ChartCard>
            {showCost && (
              <ChartCard title="Distribuição por categoria" subtitle="Valor a custo (estoque + patrimônio)" empty={!data.byCategory.length}>
                {(asTable) => <HBarChart asTable={asTable} head={['Categoria', 'Valor a custo']} format={formatBRL} data={data.byCategory.map((c: any) => ({ label: c.label, value: Math.round(c.value), sub: `${c.items} item(ns)` }))} />}
              </ChartCard>
            )}
            {showCost && (
              <ChartCard title="Evolução do valor movimentado" subtitle="Acumulado a custo (soma de entradas − saídas × custo registrado)" empty={!data.evolution.length}>
                {(asTable) => <ColumnChart asTable={asTable} valueLabel="Valor acumulado" color={SERIES[0]} data={data.evolution.map((e: any) => ({ label: label(e.bucket, data.period.granularity), value: Math.max(0, Math.round(e.value)) }))} format={formatBRL} />}
              </ChartCard>
            )}
            <ChartCard title="Produtos com maior movimentação" subtitle="Quantidade movimentada no período" empty={!data.topMoved.length}>
              {(asTable) => <HBarChart asTable={asTable} head={['Item', 'Quantidade']} format={(v) => v.toLocaleString('pt-BR')} data={data.topMoved.map((t: any) => ({ label: `${t.code} — ${t.label}`, value: t.qty, sub: `${t.movements} lanç.` }))} />}
            </ChartCard>
            <Card title="Movimentações recentes" bodyClassName="p-0">
              {data.recent.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8">Nenhuma movimentação ainda.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.recent.map((m: Movement) => (
                    <li key={m.id} className="px-4 py-2 flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800 truncate">
                          {MOVEMENT_LABELS[m.movement_type]} <span className="font-normal text-slate-500">• {m.item_code}{m.asset_tag ? ` / ${m.asset_tag}` : ''}</span>
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {m.number} • {formatDateTimeBR(m.created_at)} • {m.created_by_name}
                        </p>
                      </div>
                      <span className={cx('tabular-nums font-semibold shrink-0', m.qty_delta > 0 ? 'text-emerald-700' : m.qty_delta < 0 ? 'text-red-700' : 'text-slate-500')}>
                        {m.qty_delta > 0 ? '+' : m.qty_delta < 0 ? '−' : ''}
                        {fmtQty(m.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  );
};
