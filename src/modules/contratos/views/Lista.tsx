/**
 * Tela principal: indicadores, pesquisa, filtros, tabela paginada, exportação e geração a partir de orçamento.
 */

import React, { useRef, useState } from 'react';
import { Plus, FileInput, FileSpreadsheet, FileText, Clock, PenLine, CheckCircle2, AlertTriangle, CalendarX2, Archive, Wallet, Search, Eye, Pencil, Printer, Trash2 } from 'lucide-react';
import { CONTRACT_STATUS_LABELS, CONTRACT_TYPE_LABELS, ContractListRow, ContractStatus, PERIOD_NOUN } from '../../../../shared/contratos/types';
import { contractCan } from '../../../../shared/contratos/rules';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { formatDateBR } from '../../../../shared/orcamentos/dates';
import { formatDocument } from '../../../../shared/orcamentos/validators';
import { api, ApiError, fetchBlob, qs, saveBlob } from '../../orcamentos/api';
import { Button, Card, EmptyState, ErrorState, Input, Loading, PageHeader, Pagination, Select, cx, useAsync, useDebounced, useToast } from '../../orcamentos/ui';
import { Stat } from '../../estoque/components';
import { useCtr } from '../context';
import { Money, StatusPill, Th } from '../components';
import { DeleteContractModal, canDeleteContract } from '../DeleteContract';

interface Dash {
  total: number;
  em_elaboracao: number;
  aguardando_assinatura: number;
  ativos: number;
  vencendo: number;
  vencidos: number;
  encerrados: number;
  valor_mensal_ativo: number | null;
  alert_horizon_days: number;
}

export const ContratosLista: React.FC<{ initialStatus?: string }> = ({ initialStatus }) => {
  const { user, users, navigate } = useCtr();
  const toast = useToast();
  const [f, setF] = useState({ q: '', status: initialStatus || '', type: '', responsible_id: '', from: '', to: '', sort: '', dir: 'desc' });
  const [page, setPage] = useState(1);
  const dq = useDebounced(f.q, 300);
  const dash = useAsync(() => api.get<Dash>('/contracts/dashboard'), []);
  const [toDelete, setToDelete] = useState<ContractListRow | null>(null);
  const list = useAsync(() => api.get<{ total: number; page_size: number; rows: ContractListRow[] }>(`/contracts${qs({ ...f, q: dq, page })}`), [dq, f.status, f.type, f.responsible_id, f.from, f.to, f.sort, f.dir, page]);
  const set = (k: keyof typeof f, v: string) => (setF({ ...f, [k]: v }), setPage(1));
  const listRef = useRef<HTMLDivElement>(null);
  // card do painel = atalho de filtro: aplica status (e modalidade) e leva até a lista
  const card = (status: string, type = '') => ({
    active: f.status === status && f.type === type,
    onClick: () => {
      setF({ ...f, status, type });
      setPage(1);
      listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  });
  const sortBy = (k: string) => setF({ ...f, sort: k, dir: f.sort === k && f.dir === 'asc' ? 'desc' : 'asc' });
  const D = dash.data;

  const exportCsv = async () => {
    try {
      saveBlob(await fetchBlob(`/contracts/export.csv${qs({ ...f, q: dq })}`), 'contratos.csv');
    } catch (e) {
      toast('error', (e as ApiError).message);
    }
  };
  const SortTh: React.FC<{ k: string; children: React.ReactNode; right?: boolean; className?: string }> = ({ k, children, right, className }) => (
    <Th right={right} className={className}>
      <button onClick={() => sortBy(k)} className="uppercase hover:text-slate-800">
        {children}
        {f.sort === k ? (f.dir === 'asc' ? ' ↑' : ' ↓') : ''}
      </button>
    </Th>
  );

  return (
    <div>
      <PageHeader
        title="Contratos"
        subtitle="Locação e venda: da formalização à entrega, cobrança, devolução e encerramento."
        actions={
          <>
            {contractCan.create(user) && (
              <>
                <Button icon={FileInput} onClick={() => navigate({ page: 'orcamento' })}>
                  Gerar a partir de orçamento
                </Button>
                <Button variant="primary" icon={Plus} onClick={() => navigate({ page: 'novo' })}>
                  Novo contrato
                </Button>
              </>
            )}
          </>
        }
      />
      {D && (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-5">
          <Stat label="Total" value={D.total} icon={FileText} {...card('', '')} />
          <Stat label="Em elaboração" value={D.em_elaboracao} icon={Clock} {...card('em_elaboracao')} />
          <Stat label="Aguardando assinatura" value={D.aguardando_assinatura} icon={PenLine} tone={D.aguardando_assinatura ? 'text-amber-700 bg-amber-50' : undefined} {...card('aguardando_assinatura')} />
          <Stat label="Ativos" value={D.ativos} icon={CheckCircle2} tone="text-emerald-700 bg-emerald-50" {...card('ativo,agendado')} />
          <Stat label="Próximos do vencimento" value={D.vencendo} hint={`Até ${D.alert_horizon_days} dias`} icon={AlertTriangle} tone={D.vencendo ? 'text-amber-700 bg-amber-50' : undefined} {...card('vencendo')} />
          <Stat label="Vencidos" value={D.vencidos} hint="Incl. pendentes de devolução" icon={CalendarX2} tone={D.vencidos ? 'text-red-700 bg-red-50' : undefined} {...card('vencido,pendente_devolucao')} />
          <Stat label="Encerrados" value={D.encerrados} icon={Archive} {...card('encerrado')} />
          <Stat label="Locações ativas / mês" value={D.valor_mensal_ativo === null ? '—' : formatBRL(D.valor_mensal_ativo)} hint="Equivalente mensal contratado" icon={Wallet} {...card('ativo,vencido,pendente_devolucao', 'locacao')} />
        </div>
      )}
      <div ref={listRef} className="scroll-mt-4" />
      <Card bodyClassName="p-0">
        <div className="p-4 border-b border-slate-100 flex flex-wrap gap-2 items-center">
          <div className="relative w-full lg:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Número, cliente, CNPJ/CPF ou equipamento" className="pl-9" aria-label="Pesquisar contratos" />
          </div>
          <Select value={f.status} onChange={(e) => set('status', e.target.value)} className="w-full sm:w-52" aria-label="Status">
            <option value="">Todos os status</option>
            <option value="atencao">Exigem atenção</option>
            <option value="vencendo">Próximos do vencimento</option>
            {(Object.keys(CONTRACT_STATUS_LABELS) as ContractStatus[]).map((s) => (
              <option key={s} value={s}>
                {CONTRACT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select value={f.type} onChange={(e) => set('type', e.target.value)} className="w-full sm:w-44" aria-label="Modalidade">
            <option value="">Locação e venda</option>
            <option value="locacao">Locação</option>
            <option value="venda">Venda</option>
          </Select>
          <Select value={f.responsible_id} onChange={(e) => set('responsible_id', e.target.value)} className="w-full sm:w-44" aria-label="Responsável">
            <option value="">Todos os responsáveis</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-1.5 w-full sm:w-auto">
            <span className="text-xs text-slate-500 whitespace-nowrap">Vigente de</span>
            <Input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} aria-label="Vigente a partir de" className="sm:w-36" />
            <span className="text-xs text-slate-500">até</span>
            <Input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} aria-label="Vigente até" className="sm:w-36" />
          </div>
          {contractCan.export(user) && (
            <Button icon={FileSpreadsheet} onClick={exportCsv} className="sm:ml-auto">
              Exportar CSV
            </Button>
          )}
        </div>
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data?.rows.length ? (
          <EmptyState
            title={f.q || f.status ? 'Nenhum contrato encontrado' : 'Nenhum contrato cadastrado'}
            text={f.q || f.status ? 'Ajuste a pesquisa ou os filtros.' : 'Crie um contrato manualmente ou gere a partir de um orçamento de locação aprovado pelo cliente.'}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[920px]">
                <thead className="bg-slate-50">
                  <tr>
                    <SortTh k="numero">Número</SortTh>
                    <SortTh k="cliente">Cliente</SortTh>
                    <Th>Tipo</Th>
                    <SortTh k="inicio">Início</SortTh>
                    <SortTh k="termino">Término</SortTh>
                    <SortTh k="valor" right>
                      Valor
                    </SortTh>
                    <SortTh k="status">Status</SortTh>
                    <Th className="hidden xl:table-cell">Responsável</Th>
                    <Th right>Ações</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.rows.map((c) => (
                    <tr key={c.id} className={cx('border-t border-slate-100 hover:bg-slate-50/60', c.attention && 'bg-amber-50/40')}>
                      <td className="px-4 py-2.5">
                        <button onClick={() => navigate({ page: 'detalhe', id: c.id })} className="font-semibold text-[#1e3a5f] hover:underline">
                          {c.contract_number}
                        </button>
                        {c.attention && <p className={cx('text-[11px] font-semibold', /atrasada|vencido/i.test(c.attention) ? 'text-red-700' : 'text-amber-700')}>{c.attention}</p>}
                      </td>
                      <td className="px-4 py-2.5 max-w-[240px]">
                        <p className="truncate">{c.customer_name}</p>
                        {c.customer_document && <p className="text-[11px] text-slate-500">{formatDocument(c.customer_document)}</p>}
                      </td>
                      <td className="px-4 py-2.5">{CONTRACT_TYPE_LABELS[c.contract_type]}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{formatDateBR(c.start_date)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{c.contract_type === 'venda' ? '—' : c.end_date ? formatDateBR(c.end_date) : <span className="text-slate-500">Indeterminado</span>}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <Money v={c.period_amount} className="font-semibold" />
                        <p className="text-[11px] text-slate-500">{c.contract_type === 'venda' ? 'total da venda' : c.billing_frequency === 'unico' ? 'valor único' : `por ${PERIOD_NOUN[c.billing_frequency]}`}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <StatusPill s={c.status} />
                      </td>
                      <td className="px-4 py-2.5 hidden xl:table-cell text-slate-600">{c.responsible_name}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" icon={Eye} aria-label="Visualizar" title="Visualizar" onClick={() => navigate({ page: 'detalhe', id: c.id })} />
                        {c.status === 'rascunho' && contractCan.edit(user) && <Button size="sm" variant="ghost" icon={Pencil} aria-label="Editar" title="Editar" onClick={() => navigate({ page: 'editar', id: c.id })} />}
                        <Button size="sm" variant="ghost" icon={Printer} aria-label="Documentos" title="Documentos e impressão" onClick={() => navigate({ page: 'detalhe', id: c.id, tab: 'documentos' })} />
                        {canDeleteContract(user, c.status) && <Button size="sm" variant="ghost" icon={Trash2} className="text-red-600 hover:text-red-700" aria-label="Excluir" title="Excluir" onClick={() => setToDelete(c)} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={list.data.page_size} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <DeleteContractModal contract={toDelete} onClose={() => setToDelete(null)} onDeleted={() => (setToDelete(null), list.reload(), dash.reload())} />
    </div>
  );
};

export const FromQuotationView: React.FC = () => {
  const { navigate } = useCtr();
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(
    () => api.get<{ rows: { id: number; quotation_number: string; customer_name: string; start_date: string | null; end_date: string | null; total_amount: number; responsible_name: string }[] }>('/contracts/quotations-available'),
    []
  );
  const [busy, setBusy] = useState<number | null>(null);
  const generate = async (id: number) => {
    setBusy(id);
    try {
      const r = await api.post<{ id: number; contract_number: string; already: boolean }>(`/contracts/from-quotation/${id}`);
      toast('success', r.already ? `O orçamento já tinha gerado o contrato ${r.contract_number}.` : `Contrato ${r.contract_number} criado em rascunho.`);
      navigate({ page: 'detalhe', id: r.id });
    } catch (e) {
      toast('error', (e as ApiError).message);
      reload();
    } finally {
      setBusy(null);
    }
  };
  return (
    <div>
      <PageHeader title="Gerar contrato a partir de orçamento" subtitle="Orçamentos de locação aprovados pelo cliente e ainda não convertidos. O contrato nasce em rascunho: nada é reservado nem cobrado até a aprovação, assinatura e ativação." onBack={() => navigate({ page: 'painel' })} />
      <Card bodyClassName="p-0">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.rows.length ? (
          <EmptyState title="Nenhum orçamento disponível" text="Só aparecem orçamentos de LOCAÇÃO com status “aprovado pelo cliente”. Orçamentos de venda são convertidos pelo próprio módulo de Orçamentos (gera a venda e a conta a receber)." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Orçamento</Th>
                  <Th>Cliente</Th>
                  <Th>Período</Th>
                  <Th right>Valor</Th>
                  <Th>Responsável</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((q) => (
                  <tr key={q.id} className="border-t border-slate-100">
                    <td className="px-4 py-2.5 font-semibold">{q.quotation_number}</td>
                    <td className="px-4 py-2.5">{q.customer_name}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      {formatDateBR(q.start_date)} a {formatDateBR(q.end_date)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Money v={q.total_amount} />
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{q.responsible_name}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="sm" variant="primary" loading={busy === q.id} onClick={() => generate(q.id)}>
                        Gerar contrato
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
};
