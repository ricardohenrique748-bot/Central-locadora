/**
 * Painel de manutenção: indicadores, preventivas a vencer, filtros e tabela de OS.
 */

import React, { useState } from 'react';
import { Plus, ClipboardList, Clock, Wrench, PackageSearch, Truck, CheckCircle2, AlertTriangle, Ban, Wallet, Timer, Search, FileSpreadsheet, Lock, CalendarClock } from 'lucide-react';
import { ORDER_STATUS_LABELS, OrderListRow, OrderStatus, PRIORITY_LABELS, Priority } from '../../../../shared/os/types';
import { osCan } from '../../../../shared/os/rules';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { formatDateBR } from '../../../../shared/orcamentos/dates';
import { api, ApiError, fetchBlob, qs, saveBlob } from '../../orcamentos/api';
import { Button, Card, EmptyState, ErrorState, Input, Loading, PageHeader, Pagination, Select, cx, useAsync, useDebounced, useToast } from '../../orcamentos/ui';
import { Stat } from '../../estoque/components';
import { useOs } from '../context';
import { OsStatusPill, PriorityPill, Th } from '../components';

interface Dash {
  abertas: number;
  aguardando_atendimento: number;
  em_execucao: number;
  aguardando_pecas: number;
  aguardando_fornecedor: number;
  aguardando_aprovacao: number;
  concluidas_mes: number;
  atrasadas: number;
  indisponiveis: number;
  custo_mes: number | null;
  tempo_medio_h: number | null;
  tempo_execucao_h: number | null;
  preventivas: { plan: string; asset_tag: string; next_due_date: string | null; next_due_meter: number | null; current_meter: number | null; overdue: boolean; open_order: string | null }[];
}

export const OsPainel: React.FC<{ initialStatus?: string }> = ({ initialStatus }) => {
  const { user, users, categories, types, navigate } = useOs();
  const toast = useToast();
  const [f, setF] = useState({ q: '', status: initialStatus || 'abertas', priority: '', order_type: '', responsible_id: '', category: '', from: '', to: '', sort: 'prioridade', dir: 'asc' });
  const [page, setPage] = useState(1);
  const dq = useDebounced(f.q, 300);
  const dash = useAsync(() => api.get<Dash>(`/os/dashboard${qs({ from: f.from, to: f.to })}`), [f.from, f.to]);
  const list = useAsync(() => api.get<{ total: number; page_size: number; rows: OrderListRow[] }>(`/os/orders${qs({ ...f, q: dq, page })}`), [dq, f.status, f.priority, f.order_type, f.responsible_id, f.category, f.from, f.to, f.sort, f.dir, page]);
  const set = (k: keyof typeof f, v: string) => (setF({ ...f, [k]: v }), setPage(1));
  const sortBy = (k: string) => setF({ ...f, sort: k, dir: f.sort === k && f.dir === 'asc' ? 'desc' : 'asc' });
  const D = dash.data;
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
        title="Painel de Manutenção"
        subtitle="Ordens de serviço, peças, mão de obra, custos e disponibilidade dos equipamentos."
        actions={
          osCan.open(user) && (
            <Button variant="primary" icon={Plus} onClick={() => navigate({ page: 'nova' })}>
              Nova OS
            </Button>
          )
        }
      />
      {D && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          <Stat label="OS abertas" value={D.abertas} icon={ClipboardList} onClick={() => set('status', 'abertas')} />
          <Stat label="Aguardando atendimento" value={D.aguardando_atendimento} icon={Clock} onClick={() => set('status', 'atendimento')} />
          <Stat label="Em execução / testes" value={D.em_execucao} icon={Wrench} tone="text-sky-700 bg-sky-50" onClick={() => set('status', 'em_execucao,em_testes')} />
          <Stat label="Aguardando peças" value={D.aguardando_pecas} icon={PackageSearch} tone={D.aguardando_pecas ? 'text-orange-700 bg-orange-50' : undefined} onClick={() => set('status', 'aguardando_pecas')} />
          <Stat label="Aguardando fornecedor" value={D.aguardando_fornecedor} icon={Truck} tone={D.aguardando_fornecedor ? 'text-orange-700 bg-orange-50' : undefined} onClick={() => set('status', 'aguardando_fornecedor')} />
          <Stat label="Concluídas no mês" value={D.concluidas_mes} icon={CheckCircle2} tone="text-emerald-700 bg-emerald-50" onClick={() => set('status', 'concluida')} />
          <Stat label="Atrasadas" value={D.atrasadas} icon={AlertTriangle} tone={D.atrasadas ? 'text-red-700 bg-red-50' : undefined} onClick={() => set('status', 'atrasadas')} />
          <Stat label="Equipamentos indisponíveis" value={D.indisponiveis} hint="Manutenção, avaria ou inspeção" icon={Ban} tone={D.indisponiveis ? 'text-amber-700 bg-amber-50' : undefined} />
          <Stat label="Custo realizado no mês" value={D.custo_mes === null ? '—' : formatBRL(D.custo_mes)} hint="Peças aplicadas, mão de obra, terceiros" icon={Wallet} />
          <Stat label="Tempo médio de manutenção" value={D.tempo_medio_h === null ? '—' : `${D.tempo_medio_h.toLocaleString('pt-BR')} h`} hint={D.tempo_execucao_h === null ? 'Abertura até conclusão' : `Execução: ${D.tempo_execucao_h.toLocaleString('pt-BR')} h`} icon={Timer} />
        </div>
      )}
      {D && D.preventivas.length > 0 && (
        <Card title={<span className="flex items-center gap-1.5"><CalendarClock className="w-4 h-4" /> Preventivas a vencer ou atrasadas</span>} className="mb-5" actions={<Button size="sm" variant="ghost" onClick={() => navigate({ page: 'preventivas' })}>Ver planos</Button>}>
          <ul className="text-sm divide-y divide-slate-50">
            {D.preventivas.slice(0, 8).map((p, i) => (
              <li key={i} className="py-1.5 flex flex-wrap justify-between gap-2">
                <span>
                  <b>{p.asset_tag}</b> — {p.plan}
                </span>
                <span className={cx('text-xs', p.overdue ? 'text-red-700 font-semibold' : 'text-amber-700')}>
                  {p.next_due_date ? `${p.overdue ? 'Atrasada desde' : 'Vence em'} ${formatDateBR(p.next_due_date)}` : `Medidor ${p.current_meter} / ${p.next_due_meter}`}
                  {p.open_order ? ` • ${p.open_order} aberta` : ' • OS será gerada automaticamente'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card bodyClassName="p-0">
        <div className="p-4 border-b border-slate-100 flex flex-wrap gap-2 items-center">
          <div className="relative w-full lg:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Nº da OS, patrimônio, série, equipamento" className="pl-9" aria-label="Pesquisar OS" />
          </div>
          <Select value={f.status} onChange={(e) => set('status', e.target.value)} className="w-full sm:w-48" aria-label="Status">
            <option value="abertas">Todas em aberto</option>
            <option value="atrasadas">Atrasadas</option>
            <option value="">Todas</option>
            {(Object.keys(ORDER_STATUS_LABELS) as OrderStatus[]).map((s) => (
              <option key={s} value={s}>
                {ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select value={f.priority} onChange={(e) => set('priority', e.target.value)} className="w-full sm:w-36" aria-label="Prioridade">
            <option value="">Prioridades</option>
            {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </Select>
          <Select value={f.order_type} onChange={(e) => set('order_type', e.target.value)} className="w-full sm:w-44" aria-label="Tipo">
            <option value="">Todos os tipos</option>
            {types.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
          <Select value={f.category} onChange={(e) => set('category', e.target.value)} className="w-full sm:w-40" aria-label="Categoria">
            <option value="">Categorias</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select value={f.responsible_id} onChange={(e) => set('responsible_id', e.target.value)} className="w-full sm:w-44" aria-label="Responsável">
            <option value="">Responsáveis</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
          <div className="flex items-center gap-1.5 w-full sm:w-auto">
            <span className="text-xs text-slate-500 whitespace-nowrap">Abertas de</span>
            <Input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} aria-label="Abertas a partir de" className="sm:w-36" />
            <span className="text-xs text-slate-500">até</span>
            <Input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} aria-label="Abertas até" className="sm:w-36" />
          </div>
          {osCan.export(user) && (
            <Button
              icon={FileSpreadsheet}
              className="sm:ml-auto"
              onClick={async () => {
                try {
                  saveBlob(await fetchBlob(`/os/orders/export.csv${qs({ ...f, q: dq })}`), 'ordens-de-servico.csv');
                } catch (e) {
                  toast('error', (e as ApiError).message);
                }
              }}
            >
              Exportar CSV
            </Button>
          )}
        </div>
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data?.rows.length ? (
          <EmptyState title="Nenhuma ordem de serviço" text={f.status === 'abertas' && !f.q ? 'Não há OS em aberto. Abra uma OS a partir de um equipamento do estoque.' : 'Ajuste a pesquisa ou os filtros.'} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1040px]">
                <thead className="bg-slate-50">
                  <tr>
                    <SortTh k="numero">OS</SortTh>
                    <Th>Equipamento</Th>
                    <Th>Tipo / serviço</Th>
                    <SortTh k="prioridade">Prioridade</SortTh>
                    <SortTh k="abertura">Abertura</SortTh>
                    <SortTh k="prazo">Prazo</SortTh>
                    <Th>Responsável</Th>
                    <SortTh k="status">Status</SortTh>
                    <SortTh k="custo" right>
                      Custo
                    </SortTh>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.rows.map((o) => (
                    <tr key={o.id} className={cx('border-t border-slate-100 hover:bg-slate-50/60', o.overdue && 'bg-red-50/40')}>
                      <td className="px-4 py-2.5">
                        <button onClick={() => navigate({ page: 'detalhe', id: o.id })} className="font-semibold text-[#1e3a5f] hover:underline whitespace-nowrap">
                          {o.order_number}
                        </button>
                        {o.blocks_equipment && !['concluida', 'cancelada'].includes(o.status) && (
                          <p className="text-[11px] text-red-700 font-semibold flex items-center gap-0.5 whitespace-nowrap">
                            <Lock className="w-3 h-3" /> Bloqueia locação
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2.5 max-w-[220px]">
                        <p className="font-semibold">{o.asset_tag}</p>
                        <p className="text-[11px] text-slate-500 truncate">
                          {o.item_description}
                          {o.serial_number ? ` • S/N ${o.serial_number}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-2.5 max-w-[260px]">
                        <p className="text-xs text-slate-500">{o.order_type}</p>
                        <p className="truncate">{o.title}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <PriorityPill p={o.priority} />
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{formatDateBR(o.opened_at)}</td>
                      <td className={cx('px-4 py-2.5 whitespace-nowrap', o.overdue && 'text-red-700 font-semibold')}>{formatDateBR(o.due_date)}</td>
                      <td className="px-4 py-2.5 text-slate-600">{o.responsible_name || '—'}</td>
                      <td className="px-4 py-2.5">
                        <OsStatusPill s={o.status} />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{osCan.viewCosts(user) ? formatBRL(o.actual_cost) : '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Button size="sm" variant="ghost" onClick={() => navigate({ page: 'detalhe', id: o.id })}>
                          Abrir
                        </Button>
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
    </div>
  );
};
