/**
 * Painel de orçamentos: indicadores e gráficos calculados no servidor com os filtros aplicados.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { FilePlus2, Clock, Send, Hourglass, CheckCircle2, XCircle, CalendarX, Wallet, BadgeCheck, Percent, AlertTriangle } from 'lucide-react';
import { QuotationStatus } from '../../../../shared/orcamentos/types';
import { ALL_STATUSES, STATUS_LABELS } from '../../../../shared/orcamentos/status';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { addDaysISO, formatDateBR, todayISO } from '../../../../shared/orcamentos/dates';
import { canCreateQuotation } from '../../../../shared/orcamentos/permissions';
import { api, qs } from '../api';
import { useModule, UserOption } from '../context';
import { Button, Card, ErrorState, Field, Input, Loading, PageHeader, Select, StatusBadge, cx, useAsync } from '../ui';
import { ChartCard, ColumnChart, DataTable, HBarChart, Legend, SERIES } from '../charts';

export interface PeriodFilter {
  preset: string;
  from: string;
  to: string;
}

export function periodRange(p: PeriodFilter): { created_from: string; created_to: string } {
  const today = todayISO();
  switch (p.preset) {
    case 'mes':
      return { created_from: today.slice(0, 8) + '01', created_to: today };
    case '30':
      return { created_from: addDaysISO(today, -29), created_to: today };
    case '90':
      return { created_from: addDaysISO(today, -89), created_to: today };
    case 'ano':
      return { created_from: today.slice(0, 4) + '-01-01', created_to: today };
    case 'custom':
      return { created_from: p.from, created_to: p.to };
    default:
      return { created_from: '', created_to: '' };
  }
}

export const PeriodFilters: React.FC<{
  period: PeriodFilter;
  setPeriod: (p: PeriodFilter) => void;
  type: string;
  setType: (v: string) => void;
  responsible: string;
  setResponsible: (v: string) => void;
}> = ({ period, setPeriod, type, setType, responsible, setResponsible }) => {
  const { user } = useModule();
  const [users, setUsers] = useState<UserOption[]>([]);
  useEffect(() => {
    if (user.role !== 'vendedor') api.get<{ rows: UserOption[] }>('/users/options').then((r) => setUsers(r.rows)).catch(() => {});
  }, [user.role]);
  return (
    <div className="flex flex-wrap items-end gap-2 mb-5 p-3 bg-white rounded-xl border border-slate-200">
      <Field label="Período de criação" className="w-full sm:w-44">
        <Select value={period.preset} onChange={(e) => setPeriod({ ...period, preset: e.target.value })}>
          <option value="mes">Este mês</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="ano">Este ano</option>
          <option value="tudo">Todo o período</option>
          <option value="custom">Personalizado</option>
        </Select>
      </Field>
      {period.preset === 'custom' && (
        <>
          <Field label="De" className="w-[calc(50%-4px)] sm:w-40">
            <Input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
          </Field>
          <Field label="Até" className="w-[calc(50%-4px)] sm:w-40">
            <Input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
          </Field>
        </>
      )}
      <Field label="Modalidade" className="w-[calc(50%-4px)] sm:w-40">
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Todas</option>
          <option value="venda">Venda</option>
          <option value="locacao">Locação</option>
        </Select>
      </Field>
      {user.role !== 'vendedor' ? (
        <Field label="Responsável" className="w-[calc(50%-4px)] sm:w-48">
          <Select value={responsible} onChange={(e) => setResponsible(e.target.value)}>
            <option value="">Todos</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <p className="text-xs text-slate-500 self-center">Exibindo apenas seus orçamentos.</p>
      )}
    </div>
  );
};

interface Dashboard {
  kpis: Record<string, number | null>;
  expiring: { id: number; quotation_number: string; customer_name: string; expiration_date: string; total_amount: number; status: QuotationStatus }[];
  byStatus: { status: QuotationStatus; count: number }[];
  byType: { quotation_type: 'venda' | 'locacao'; count: number; value: number; won_value: number }[];
  createdSeries: { bucket: string; count: number; value: number }[];
  approvedSeries: { bucket: string; count: number; value: number }[];
  granularity: 'dia' | 'mes';
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const bucketLabel = (b: string, g: 'dia' | 'mes') => (g === 'dia' ? `${b.slice(8, 10)}/${b.slice(5, 7)}` : `${MONTHS[Number(b.slice(5, 7)) - 1]}/${b.slice(2, 4)}`);

/** Completa os buckets vazios para o eixo não pular dias/meses. */
function fillBuckets(rows: { bucket: string; count: number; value: number }[], g: 'dia' | 'mes', from: string, to: string) {
  if (!rows.length) return [];
  const map = new Map(rows.map((r) => [r.bucket, r]));
  const start = from || rows[0].bucket + (g === 'mes' ? '-01' : '');
  const end = to || todayISO();
  const out: { bucket: string; count: number; value: number }[] = [];
  if (g === 'dia') {
    for (let d = start; d <= end && out.length < 400; d = addDaysISO(d, 1)) out.push(map.get(d) || { bucket: d, count: 0, value: 0 });
  } else {
    let y = Number(start.slice(0, 4));
    let m = Number(start.slice(5, 7));
    const endKey = end.slice(0, 7);
    while (out.length < 120) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      out.push(map.get(key) || { bucket: key, count: 0, value: 0 });
      if (key >= endKey) break;
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
  }
  return out;
}

const Kpi: React.FC<{ icon: React.ElementType; label: string; value: string; hint?: string; tone?: string; onClick?: () => void }> = ({ icon: Icon, label, value, hint, tone = 'text-[#1e3a5f] bg-slate-100', onClick }) => (
  <button onClick={onClick} disabled={!onClick} className={cx('bg-white rounded-xl border border-slate-200 p-3.5 text-left shadow-xs', onClick && 'hover:border-[#1e3a5f]/40 hover:shadow-sm transition')}>
    <div className="flex items-center gap-2">
      <span className={cx('w-7 h-7 rounded-lg flex items-center justify-center', tone)}>
        <Icon className="w-4 h-4" />
      </span>
      <span className="text-xs font-semibold text-slate-500">{label}</span>
    </div>
    <p className="text-xl font-extrabold text-slate-900 mt-2 tabular-nums">{value}</p>
    {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
  </button>
);

export const PainelView: React.FC = () => {
  const { user, navigate, settings } = useModule();
  const [period, setPeriod] = useState<PeriodFilter>({ preset: 'mes', from: addDaysISO(todayISO(), -30), to: todayISO() });
  const [type, setType] = useState('');
  const [responsible, setResponsible] = useState('');
  const range = periodRange(period);

  const { data, error, loading, reload } = useAsync(() => api.get<Dashboard>(`/dashboard${qs({ ...range, type, responsible })}`), [range.created_from, range.created_to, type, responsible]);

  const created = useMemo(() => (data ? fillBuckets(data.createdSeries, data.granularity, range.created_from, range.created_to) : []), [data, range.created_from, range.created_to]);
  const approved = useMemo(() => (data ? fillBuckets(data.approvedSeries, data.granularity, range.created_from, range.created_to) : []), [data, range.created_from, range.created_to]);

  const k = data?.kpis;
  // card → lista com os mesmos filtros do painel, para a contagem bater
  const open = (status = '', extra: Record<string, string> = {}, label?: string) => () => navigate({ page: 'lista', status, label, filters: { ...range, type, responsible, ...extra } });
  const WON = 'aprovado_cliente,convertido';
  const today = todayISO();
  const n = (v: number | null | undefined) => (v ?? 0).toLocaleString('pt-BR');

  return (
    <div>
      <PageHeader
        title="Painel de Orçamentos"
        subtitle="Indicadores calculados com os dados gravados e os filtros abaixo."
        actions={
          canCreateQuotation(user) && (
            <Button variant="primary" icon={FilePlus2} onClick={() => navigate({ page: 'novo' })}>
              Novo orçamento
            </Button>
          )
        }
      />
      <PeriodFilters period={period} setPeriod={setPeriod} type={type} setType={setType} responsible={responsible} setResponsible={setResponsible} />

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : data && k ? (
        <div className={cx('space-y-5', loading && 'opacity-60')}>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
            <Kpi icon={FilePlus2} label="Criados" value={n(k.total)} onClick={open()} />
            <Kpi icon={Clock} label="Em elaboração" value={n(k.elaboracao)} hint={k.aguardando_aprovacao_interna ? `${k.aguardando_aprovacao_interna} aguardando aprovação` : undefined} onClick={open('rascunho,em_revisao,aguardando_aprovacao,aprovado_interno', {}, 'Em elaboração')} />
            <Kpi icon={Send} label="Enviados" value={n(k.enviados)} hint="já enviados ao cliente" onClick={open('', { sent: '1' })} />
            <Kpi icon={Hourglass} label="Aguardando resposta" value={n(k.aguardando)} tone="text-violet-700 bg-violet-50" onClick={open('enviado,em_negociacao', {}, 'Aguardando resposta')} />
            <Kpi icon={CheckCircle2} label="Aprovados" value={n(k.aprovados)} tone="text-emerald-700 bg-emerald-50" onClick={open(WON, {}, 'Aprovados')} />
            <Kpi icon={XCircle} label="Recusados" value={n(k.recusados)} tone="text-red-700 bg-red-50" onClick={open('recusado')} />
            <Kpi icon={CalendarX} label="Expirados" value={n(k.expirados)} tone="text-orange-700 bg-orange-50" onClick={open('expirado')} />
            <Kpi icon={Wallet} label="Valor proposto" value={formatBRL(k.valor_total)} hint="exceto cancelados" onClick={open(ALL_STATUSES.filter((s) => s !== 'cancelado').join(','), {}, 'Exceto cancelados')} />
            <Kpi icon={BadgeCheck} label="Valor aprovado" value={formatBRL(k.valor_aprovado)} tone="text-emerald-700 bg-emerald-50" onClick={open(WON, {}, 'Aprovados')} />
            <Kpi
              icon={Percent}
              label="Taxa de conversão"
              value={k.taxa_conversao === null ? '—' : `${((k.taxa_conversao as number) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
              hint={k.base_conversao ? `aprovados ÷ ${k.base_conversao} enviado(s)` : 'nenhuma proposta enviada'}
              onClick={open('', { sent: '1' })}
            />
            <Kpi icon={AlertTriangle} label="Vencendo" value={n(data.expiring.length)} hint={`nos próximos ${settings.expiring_soon_days} dia(s)`} tone="text-amber-700 bg-amber-50"
              onClick={open('aprovado_interno,enviado,em_negociacao', { expires_from: today, expires_to: addDaysISO(today, settings.expiring_soon_days) }, 'Vencendo')}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <ChartCard title="Orçamentos criados" subtitle={`Quantidade por ${data.granularity === 'dia' ? 'dia' : 'mês'}`} empty={!created.length}>
              {(asTable) => (
                <ColumnChart asTable={asTable} valueLabel="Orçamentos" data={created.map((c) => ({ label: bucketLabel(c.bucket, data.granularity), value: c.count, sub: formatBRL(c.value) }))} format={(v) => `${v} orçamento(s)`} />
              )}
            </ChartCard>
            <ChartCard title="Valores aprovados" subtitle={`Pela data de aprovação do cliente, por ${data.granularity === 'dia' ? 'dia' : 'mês'}`} empty={!data.approvedSeries.length}>
              {(asTable) => (
                <ColumnChart asTable={asTable} valueLabel="Valor aprovado" data={approved.map((c) => ({ label: bucketLabel(c.bucket, data.granularity), value: c.value, sub: `${c.count} proposta(s)` }))} format={formatBRL} />
              )}
            </ChartCard>
            <ChartCard title="Distribuição por status" empty={!data.byStatus.length}>
              {(asTable) => (
                <HBarChart
                  asTable={asTable}
                  head={['Status', 'Quantidade']}
                  data={[...data.byStatus].sort((a, b) => b.count - a.count).map((s) => ({ label: STATUS_LABELS[s.status], value: s.count }))}
                  format={(v) => v.toLocaleString('pt-BR')}
                />
              )}
            </ChartCard>
            <ChartCard title="Venda × Locação" subtitle="Valor proposto e valor aprovado" empty={!data.byType.length}>
              {(asTable) =>
                asTable ? (
                  <DataTable
                    head={['Modalidade', 'Orçamentos', 'Proposto', 'Aprovado']}
                    rows={data.byType.map((t) => [t.quotation_type === 'venda' ? 'Venda' : 'Locação', t.count, formatBRL(t.value), formatBRL(t.won_value)])}
                  />
                ) : (
                  <>
                    <Legend items={[{ label: 'Venda', color: SERIES[0] }, { label: 'Locação', color: SERIES[1] }]} />
                    <div className="space-y-4">
                      {(['value', 'won_value'] as const).map((metric) => {
                        const rows = (['venda', 'locacao'] as const).map((tp) => data.byType.find((t) => t.quotation_type === tp));
                        return (
                          <div key={metric}>
                            <p className="text-xs font-semibold text-slate-600 mb-1.5">{metric === 'value' ? 'Valor proposto' : 'Valor aprovado'}</p>
                            <HBarChart
                              asTable={false}
                              head={['', '']}
                              format={formatBRL}
                              data={rows.map((r, i) => ({
                                label: i === 0 ? 'Venda' : 'Locação',
                                value: r?.[metric] || 0,
                                sub: metric === 'value' ? `${r?.count || 0} orçamento(s)` : undefined,
                                color: SERIES[i],
                              }))}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </>
                )
              }
            </ChartCard>
          </div>

          <Card title={`Próximos do vencimento (até ${settings.expiring_soon_days} dia(s))`} bodyClassName="p-0">
            {data.expiring.length === 0 ? (
              <p className="text-sm text-slate-500 px-4 py-6 text-center">Nenhuma proposta enviada vence nos próximos dias.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.expiring.map((e) => (
                  <li key={e.id}>
                    <button onClick={() => navigate({ page: 'detalhe', id: e.id })} className="w-full flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50 text-left">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800">
                          {e.quotation_number} <span className="font-normal text-slate-500">• {e.customer_name}</span>
                        </p>
                        <p className="text-xs text-slate-500">Vence em {formatDateBR(e.expiration_date)}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-sm font-semibold tabular-nums">{formatBRL(e.total_amount)}</span>
                        <StatusBadge status={e.status} />
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
};
