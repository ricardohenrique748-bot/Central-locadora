/**
 * Relatórios financeiros e DRE gerencial, com período explícito e exportação CSV.
 */

import React, { useState } from 'react';
import { FileSpreadsheet, Info } from 'lucide-react';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { addDaysISO, formatDateBR, todayISO } from '../../../../shared/orcamentos/dates';
import { api, fetchBlob, qs, saveBlob } from '../../orcamentos/api';
import { Button, Card, ErrorState, Field, Input, Loading, PageHeader, Select, cx, useAsync, useToast } from '../../orcamentos/ui';
import { useFin } from '../context';
import { AccountSelect, Amount, Th } from '../components';

const REPORTS: [string, string, boolean][] = [
  ['dre', 'DRE gerencial', true],
  ['pagar_periodo', 'Contas a pagar por período', true],
  ['receber_periodo', 'Contas a receber por período', true],
  ['vencidas', 'Contas vencidas', false],
  ['a_vencer', 'Próximas do vencimento', false],
  ['recebimentos_cliente', 'Recebimentos por cliente', true],
  ['pagamentos_fornecedor', 'Pagamentos por fornecedor', true],
  ['receitas_categoria', 'Receitas por categoria', true],
  ['despesas_categoria', 'Despesas por categoria', true],
  ['receitas_cc', 'Receitas por centro de custo', true],
  ['despesas_cc', 'Despesas por centro de custo', true],
  ['fluxo_realizado', 'Fluxo de caixa realizado', true],
  ['fluxo_projetado', 'Fluxo de caixa projetado (30 dias)', false],
  ['movimentacoes_conta', 'Movimentações por conta', true],
  ['transferencias', 'Transferências entre contas', true],
  ['conciliacao', 'Conciliação bancária', true],
  ['inadimplencia', 'Inadimplência', false],
  ['historico_venda', 'Histórico financeiro por venda', false],
  ['historico_contrato', 'Histórico financeiro por contrato', false],
];

const HEAD: Record<string, string> = {
  entry_number: 'Nº', entry_type: 'Tipo', party_name: 'Favorecido/cliente', description: 'Descrição', category: 'Categoria', number: 'Parc.', due_date: 'Vencimento',
  updated: 'Atualizado', settled_amount: 'Liquidado', pending: 'Pendente', status: 'Situação', label: 'Agrupamento', value: 'Valor', movimentos: 'Mov.',
  bucket: 'Período', saldo_inicial: 'Saldo inicial', entradas: 'Entradas', saidas: 'Saídas', outras_entradas: 'Outras entradas', outras_saidas: 'Outras saídas', saldo_final: 'Saldo final',
  transaction_number: 'Nº', transaction_date: 'Data', account: 'Conta', transaction_type: 'Tipo', amount: 'Valor', conciliada: 'Conciliada', transfer_date: 'Data', origem: 'Origem',
  destino: 'Destino', reference: 'Referência', movimentacao: 'Movimentação', note: 'Obs.', cliente: 'Cliente', mais_antigo: 'Mais antigo', dias: 'Dias', parcelas: 'Parcelas', total: 'Total',
  ate_30: 'Até 30', de_31_60: '31–60', de_61_90: '61–90', acima_90: '+90', linha: 'Linha', valor: 'Valor',
};
const MONEY = /^(updated|settled_amount|pending|value|amount|saldo_inicial|entradas|saidas|outras_entradas|outras_saidas|saldo_final|total|ate_30|de_31_60|de_61_90|acima_90|valor)$/;

export const FinReportsView: React.FC = () => {
  const { costCenters } = useFin();
  const toast = useToast();
  const today = todayISO();
  const [kind, setKind] = useState('dre');
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [regime, setRegime] = useState<'competencia' | 'caixa'>('competencia');
  const [cc, setCc] = useState('');
  const [account, setAccount] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const usesPeriod = REPORTS.find((r) => r[0] === kind)![2];
  const params = { from, to, regime, cost_center_id: cc, account_id: account, q };
  const dreQ = useAsync(() => (kind === 'dre' ? api.get<any>(`/finance/dre${qs(params)}`) : Promise.resolve(null)), [kind, from, to, regime, cc]);
  const rep = useAsync(() => (kind !== 'dre' ? api.get<{ rows: any[] }>(`/finance/reports/${kind}${qs(params)}`) : Promise.resolve({ rows: [] })), [kind, from, to, cc, account, q]);

  const exportCsv = async () => {
    try {
      saveBlob(await fetchBlob(`/finance/reports/${kind}${qs({ ...params, format: 'csv' })}`), `financeiro-${kind}-${today}.csv`);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };
  const rows = rep.data?.rows || [];
  const cols = rows.length ? Object.keys(rows[0]) : [];

  return (
    <div>
      <PageHeader title="Relatórios Financeiros" subtitle="Dados reais do banco, com o período consultado sempre explícito." actions={<Button icon={FileSpreadsheet} onClick={exportCsv}>Exportar CSV</Button>} />
      <div className="flex flex-wrap items-end gap-2 mb-4 p-3 bg-white rounded-xl border border-slate-200">
        <Field label="Relatório" className="w-full sm:w-72">
          <Select value={kind} onChange={(e) => setKind(e.target.value)}>
            {REPORTS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        {usesPeriod && (
          <>
            <Field label="De" className="w-[calc(50%-4px)] sm:w-36">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Até" className="w-[calc(50%-4px)] sm:w-36">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </>
        )}
        {kind === 'dre' && (
          <>
            <Field label="Regime" className="w-full sm:w-44">
              <Select value={regime} onChange={(e) => setRegime(e.target.value as any)}>
                <option value="competencia">Competência</option>
                <option value="caixa">Caixa</option>
              </Select>
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
          </>
        )}
        {['movimentacoes_conta', 'fluxo_realizado'].includes(kind) && (
          <Field label="Conta" className="w-full sm:w-56">
            <AccountSelect value={account} onChange={setAccount} placeholder="Todas" includeInactive />
          </Field>
        )}
        {kind.startsWith('historico') && (
          <Field label="Pesquisar" className="w-full sm:w-56">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === 'historico_venda' ? 'Nº do orçamento ou cliente' : 'Nº do contrato ou cliente'} />
          </Field>
        )}
      </div>

      {kind === 'dre' ? (
        dreQ.loading && !dreQ.data ? (
          <Loading />
        ) : dreQ.error ? (
          <ErrorState message={dreQ.error} onRetry={dreQ.reload} />
        ) : dreQ.data ? (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5 items-start">
            <Card title={`DRE gerencial — ${formatDateBR(dreQ.data.from)} a ${formatDateBR(dreQ.data.to)} (${dreQ.data.regime === 'competencia' ? 'competência' : 'caixa'})`} bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[500px]">
                  <tbody>
                    {dreQ.data.lines.map((l: any) => (
                      <React.Fragment key={l.key}>
                        <tr className={cx('border-t border-slate-100', l.total && 'bg-slate-50 font-bold')}>
                          <td className="px-4 py-2.5">{l.label}</td>
                          <td className="px-4 py-2.5 text-right">
                            <Amount v={l.value} />
                          </td>
                        </tr>
                        {l.detail?.map((d: any) => (
                          <tr key={d.category} className="text-xs text-slate-600">
                            <td className="px-4 py-1 pl-10">{d.category}</td>
                            <td className="px-4 py-1 text-right tabular-nums">{formatBRL(d.value)}</td>
                          </tr>
                        ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <aside className="space-y-4">
              <Card title="Fora do resultado">
                <p className="text-sm">
                  Investimentos em patrimônio: <b className="tabular-nums">{formatBRL(dreQ.data.investimentos.value)}</b>
                </p>
                {dreQ.data.investimentos.detail.map((d: any) => (
                  <p key={d.category} className="text-xs text-slate-600 flex justify-between">
                    <span>{d.category}</span>
                    <span className="tabular-nums">{formatBRL(d.value)}</span>
                  </p>
                ))}
              </Card>
              <div className="flex items-start gap-2 text-xs text-slate-600 bg-white border border-slate-200 rounded-xl px-3 py-2.5">
                <Info className="w-4 h-4 shrink-0 text-slate-400 mt-px" />
                <p>
                  <b>Relatório gerencial, não é demonstração contábil oficial.</b> Competência: valor atualizado dos títulos ativos pela data de competência. Caixa: pagamentos/recebimentos pela data efetiva. Compras de equipamentos para o patrimônio
                  (grupo "Investimento") não são despesa do período — o tratamento contábil (depreciação) depende das regras da empresa. Transferências entre contas não entram.
                </p>
              </div>
            </aside>
          </div>
        ) : null
      ) : (
        <Card bodyClassName="p-0" title={usesPeriod ? `Período: ${formatDateBR(from)} a ${formatDateBR(to)}` : kind === 'a_vencer' ? `Próximos 15 dias (até ${formatDateBR(addDaysISO(today, 15))})` : `Posição em ${formatDateBR(today)}`}>
          {rep.loading && !rep.data ? (
            <Loading />
          ) : rep.error ? (
            <ErrorState message={rep.error} onRetry={rep.reload} />
          ) : !rows.length ? (
            <p className="text-sm text-slate-500 text-center py-10">Sem registros.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    {cols.map((c) => (
                      <Th key={c} right={MONEY.test(c)}>
                        {HEAD[c] || c}
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 500).map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      {cols.map((c) => (
                        <td key={c} className={cx('px-4 py-2', MONEY.test(c) && 'text-right')}>
                          {MONEY.test(c) && typeof r[c] === 'number' ? <Amount v={r[c]} /> : typeof r[c] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r[c]) ? formatDateBR(r[c]) : String(r[c] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 500 && <p className="text-xs text-slate-500 px-4 py-2">Mostrando 500 de {rows.length}. Exporte o CSV para ver tudo.</p>}
            </div>
          )}
        </Card>
      )}
    </div>
  );
};
