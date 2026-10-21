/**
 * Fluxo de caixa realizado (movimentações efetivadas) e projetado (títulos pendentes por vencimento).
 */

import React, { useState } from 'react';
import { Info, AlertTriangle } from 'lucide-react';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { addDaysISO, formatDateBR, todayISO } from '../../../../shared/orcamentos/dates';
import { api, qs } from '../../orcamentos/api';
import { Card, ErrorState, Field, Input, Loading, Notice, PageHeader, Select, cx, useAsync } from '../../orcamentos/ui';
import { useFin } from '../context';
import { AccountSelect, Amount, CategorySelect, Th } from '../components';

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export const CashFlowView: React.FC = () => {
  const { costCenters } = useFin();
  const today = todayISO();
  const [mode, setMode] = useState<'realizado' | 'projetado'>('projetado');
  const [from, setFrom] = useState(addDaysISO(today, -29));
  const [to, setTo] = useState(today);
  const [horizon, setHorizon] = useState('30');
  const [account, setAccount] = useState<number | null>(null);
  const [catType, setCatType] = useState<'despesa' | 'receita'>('despesa');
  const [category, setCategory] = useState<number | null>(null);
  const [cc, setCc] = useState('');
  const { data, error, loading, reload } = useAsync(
    () => api.get<any>(`/finance/cashflow${qs({ mode, from, to, horizon, account_id: account, category_id: category, cost_center_id: cc })}`),
    [mode, from, to, horizon, account, category, cc]
  );
  const label = (b: string) => (data?.granularity === 'mes' ? `${MONTHS[Number(b.slice(5, 7)) - 1]}/${b.slice(0, 4)}` : data?.granularity === 'semana' ? `Semana ${b.slice(5)}/${b.slice(0, 4)}` : formatDateBR(b));

  return (
    <div>
      <PageHeader title="Fluxo de Caixa" subtitle="Realizado e projetado em visões separadas — previsões nunca se misturam com valores efetivados." />
      <div className="flex flex-wrap items-end gap-2 mb-4 p-3 bg-white rounded-xl border border-slate-200">
        <Field label="Visão" className="w-full sm:w-40">
          <Select value={mode} onChange={(e) => setMode(e.target.value as any)}>
            <option value="projetado">Projetado</option>
            <option value="realizado">Realizado</option>
          </Select>
        </Field>
        {mode === 'realizado' ? (
          <>
            <Field label="De" className="w-[calc(50%-4px)] sm:w-36">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Até" className="w-[calc(50%-4px)] sm:w-36">
              <Input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </>
        ) : (
          <Field label="Horizonte" className="w-full sm:w-36">
            <Select value={horizon} onChange={(e) => setHorizon(e.target.value)}>
              {[7, 15, 30, 60, 90].map((d) => (
                <option key={d} value={d}>
                  Próximos {d} dias
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Conta" className="w-full sm:w-56">
          <AccountSelect value={account} onChange={setAccount} placeholder="Todas" includeInactive />
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

      <div className="flex items-start gap-2 text-xs text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2.5 mb-4">
        <Info className="w-4 h-4 shrink-0 text-slate-400 mt-px" />
        {mode === 'realizado' ? (
          <p>
            <b>Realizado:</b> pagamentos e recebimentos efetivados, pela data efetiva. "Outras" = transferências entre contas e ajustes de caixa (mudam o saldo da conta, mas não são receita nem despesa). Estornos entram como negativos.
          </p>
        ) : (
          <p>
            <b>Projetado:</b> parte do saldo atual e soma o <b>saldo pendente</b> das parcelas por vencimento (pagamentos parciais projetam só o restante; liquidados não reaparecem). Vencidos não entram na projeção e aparecem à parte.
          </p>
        )}
      </div>

      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : data ? (
        <>
          {data.filtered_by_category && <Notice className="mb-4">Com filtro de categoria/centro de custo, os saldos partem de zero (mostram só a contribuição do filtro).</Notice>}
          {mode === 'projetado' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div className="bg-white rounded-xl border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Menor saldo projetado no horizonte</p>
                <p className={cx('text-lg font-extrabold tabular-nums', data.min_balance < 0 && 'text-red-700')}>{formatBRL(data.min_balance)}</p>
                {data.min_balance < 0 && (
                  <p className="text-[11px] text-red-700 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Risco de liquidez
                  </p>
                )}
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Atrasados a receber (fora da projeção)</p>
                <p className="text-lg font-extrabold tabular-nums text-amber-700">{formatBRL(data.overdue.receber)}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Atrasados a pagar (fora da projeção)</p>
                <p className="text-lg font-extrabold tabular-nums text-red-700">{formatBRL(data.overdue.pagar)}</p>
              </div>
            </div>
          )}
          <Card bodyClassName="p-0">
            {!data.rows.length ? (
              <p className="text-sm text-slate-500 text-center py-10">{mode === 'projetado' ? 'Nenhum vencimento pendente no horizonte.' : 'Sem movimentações no período.'}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[720px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <Th>{mode === 'projetado' ? 'Vencimento' : 'Data'}</Th>
                      <Th right>Saldo inicial</Th>
                      <Th right>Entradas</Th>
                      <Th right>Saídas</Th>
                      {mode === 'realizado' && <Th right>Outras (transf./ajustes)</Th>}
                      <Th right>Saldo final</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r: any) => (
                      <tr key={r.bucket} className={cx('border-t border-slate-100', r.saldo_final < 0 && 'bg-red-50/50')}>
                        <td className="px-4 py-2">{label(r.bucket)}</td>
                        <td className="px-4 py-2 text-right">
                          <Amount v={r.saldo_inicial} />
                        </td>
                        <td className="px-4 py-2 text-right text-emerald-700 tabular-nums">{r.entradas ? formatBRL(r.entradas) : '—'}</td>
                        <td className="px-4 py-2 text-right text-red-700 tabular-nums">{r.saidas ? formatBRL(r.saidas) : '—'}</td>
                        {mode === 'realizado' && <td className="px-4 py-2 text-right tabular-nums text-slate-600">{r.outras_entradas || r.outras_saidas ? `+${formatBRL(r.outras_entradas)} / −${formatBRL(r.outras_saidas)}` : '—'}</td>}
                        <td className="px-4 py-2 text-right font-semibold">
                          <Amount v={r.saldo_final} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
};
