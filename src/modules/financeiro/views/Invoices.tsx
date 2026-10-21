/**
 * Faturas de locação e boletins de medição: cobranças dos contratos de locação com a situação do Financeiro.
 * Os PDFs (fatura e medição) são gerados na hora pelo módulo de Contratos.
 */

import React, { useEffect, useState } from 'react';
import { Search, FileSpreadsheet, FileText, Ruler, ExternalLink } from 'lucide-react';
import { CHARGE_KIND_LABELS, CHARGE_STATUS_LABELS, ChargeDisplayStatus, ChargeKind } from '../../../../shared/contratos/types';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { formatDateBR, todayISO } from '../../../../shared/orcamentos/dates';
import { api, fetchBlob, qs, saveBlob } from '../../orcamentos/api';
import { Button, Card, EmptyState, ErrorState, Input, Loading, PageHeader, Pagination, Select, cx, useAsync, useDebounced, useToast } from '../../orcamentos/ui';
import { ChargePill } from '../../contratos/components';
import { useFin } from '../context';
import { Th } from '../components';

interface InvoiceRow {
  id: number;
  contract_id: number;
  kind: ChargeKind;
  description: string;
  period_start: string;
  period_end: string;
  financial_entry_id: number | null;
  contract_number: string;
  customer_name: string;
  entry_number: string | null;
  due_date: string;
  updated_amount: number;
  settled_amount: number;
  display_status: ChargeDisplayStatus;
  measurable: boolean;
}

/** Abre o PDF em nova aba; se o navegador bloquear, baixa o arquivo. */
export async function openChargePdf(contractId: number, chargeId: number, doc: 'invoice' | 'measurement', name: string) {
  const blob = await fetchBlob(`/contracts/${contractId}/charges/${chargeId}/${doc}`);
  if (!window.open(URL.createObjectURL(blob), '_blank')) saveBlob(blob, name);
}

export const InvoicesView: React.FC = () => {
  const { navigate } = useFin();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('pendente');
  const [kind, setKind] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const filters = { q: dq, status, kind, due_from: dueFrom, due_to: dueTo };
  useEffect(() => setPage(1), [dq, status, kind, dueFrom, dueTo]);
  const { data, error, loading, reload } = useAsync(
    () => api.get<{ total: number; page_size: number; rows: InvoiceRow[]; totals: { updated: number; settled: number; pending: number } }>(`/finance/invoices${qs({ ...filters, page })}`),
    [dq, status, kind, dueFrom, dueTo, page]
  );

  const pdf = async (r: InvoiceRow, doc: 'invoice' | 'measurement') => {
    try {
      await openChargePdf(r.contract_id, r.id, doc, doc === 'invoice' ? `Fatura ${r.entry_number || r.id}.pdf` : `Medição ${r.contract_number}.pdf`);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <div>
      <PageHeader
        title="Faturas e Medições"
        subtitle="Cobranças dos contratos de locação. A fatura e o boletim de medição são gerados em PDF com os dados atuais do contrato e do Financeiro."
        actions={
          <Button
            icon={FileSpreadsheet}
            onClick={async () => {
              try {
                saveBlob(await fetchBlob(`/finance/invoices/export.csv${qs(filters)}`), `faturas-de-locacao-${todayISO()}.csv`);
              } catch (e) {
                toast('error', (e as Error).message);
              }
            }}
          >
            CSV
          </Button>
        }
      />
      {data && (
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div className="bg-white rounded-xl border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Faturado (filtro)</p>
            <p className="text-lg font-extrabold tabular-nums">{formatBRL(data.totals.updated)}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-3">
            <p className="text-xs text-slate-500">Recebido</p>
            <p className="text-lg font-extrabold tabular-nums text-emerald-700">{formatBRL(data.totals.settled)}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-3">
            <p className="text-xs text-slate-500">A receber</p>
            <p className="text-lg font-extrabold tabular-nums text-amber-700">{formatBRL(data.totals.pending)}</p>
          </div>
        </div>
      )}
      <Card bodyClassName="p-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 p-4 border-b border-slate-100">
          <div className="relative sm:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nº da fatura, contrato, cliente" className="pl-9" aria-label="Pesquisar" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
            <option value="pendente">Pendentes (em aberto)</option>
            {(['em_aberto', 'vencido', 'parcial', 'pago', 'cancelado'] as ChargeDisplayStatus[]).map((s) => (
              <option key={s} value={s}>
                {CHARGE_STATUS_LABELS[s]}
              </option>
            ))}
            <option value="">Todas</option>
          </Select>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo">
            <option value="">Todos os tipos</option>
            <option value="medicao">Períodos de locação (com medição)</option>
            <option value="outras">Fretes, taxas e extras</option>
          </Select>
          <div className="flex gap-2 min-w-0">
            <Input type="date" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} aria-label="Vencimento de" title="Vencimento de" className="text-xs px-2" />
            <Input type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)} aria-label="Vencimento até" title="Vencimento até" className="text-xs px-2" />
          </div>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.rows.length ? (
          <EmptyState title="Nenhuma fatura encontrada" text="As faturas aparecem quando o contrato de locação gera as cobranças no Financeiro." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[980px]">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Fatura</Th>
                    <Th>Contrato / cliente</Th>
                    <Th>Período</Th>
                    <Th>Vencimento</Th>
                    <Th right>Valor</Th>
                    <Th right>Recebido</Th>
                    <Th>Situação</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className={cx(loading && 'opacity-60')}>
                  {data.rows.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-[#1e3a5f]">{r.entry_number || '—'}</p>
                        <p className="text-xs text-slate-600 truncate max-w-[240px]">{r.description}</p>
                        <p className="text-[10px] text-slate-400">{CHARGE_KIND_LABELS[r.kind]}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-semibold">{r.contract_number}</p>
                        <p className="text-xs text-slate-600">{r.customer_name}</p>
                      </td>
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap">{r.period_start === r.period_end ? formatDateBR(r.period_start) : `${formatDateBR(r.period_start)} a ${formatDateBR(r.period_end)}`}</td>
                      <td className={cx('px-4 py-2.5 whitespace-nowrap', r.display_status === 'vencido' && 'text-red-700 font-semibold')}>{formatDateBR(r.due_date)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(r.updated_amount)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(r.settled_amount)}</td>
                      <td className="px-4 py-2.5">
                        <ChargePill s={r.display_status} />
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {r.financial_entry_id && r.display_status !== 'cancelado' && (
                          <Button size="sm" variant="ghost" icon={FileText} onClick={() => pdf(r, 'invoice')}>
                            Fatura
                          </Button>
                        )}
                        {r.measurable && r.display_status !== 'cancelado' && (
                          <Button size="sm" variant="ghost" icon={Ruler} onClick={() => pdf(r, 'measurement')}>
                            Medição
                          </Button>
                        )}
                        {r.financial_entry_id && (
                          <Button size="sm" variant="ghost" icon={ExternalLink} title="Abrir lançamento" aria-label="Abrir lançamento" onClick={() => navigate({ page: 'titulo', id: r.financial_entry_id! })} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
};
