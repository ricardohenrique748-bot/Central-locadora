/**
 * Painel de entregas e devoluções: indicadores, filtros e tabela de operações.
 */

import React, { useState } from 'react';
import { Truck, Clock, Navigation, CheckCircle2, Undo2, CalendarClock, AlertTriangle, ClipboardCheck, ShieldAlert, ListTodo, Search, FileSpreadsheet, Plus } from 'lucide-react';
import { OP_STATUS_LABELS, OP_TYPE_LABELS, OpRow, OpStatus } from '../../../../shared/logistica/types';
import { logCan } from '../../../../shared/logistica/rules';
import { formatDateTimeBR } from '../../../../shared/orcamentos/dates';
import { api, ApiError, fetchBlob, qs, saveBlob } from '../../orcamentos/api';
import { Button, Card, EmptyState, ErrorState, Input, Loading, PageHeader, Pagination, Select, cx, useAsync, useDebounced, useToast } from '../../orcamentos/ui';
import { Stat } from '../../estoque/components';
import { useLog } from '../context';
import { OpPill, Th } from '../components';

export const LogPainel: React.FC<{ initialStatus?: string; initialType?: string }> = ({ initialStatus, initialType }) => {
  const { user, users, drivers, navigate } = useLog();
  const toast = useToast();
  const [f, setF] = useState({ q: '', status: initialStatus || 'abertas', type: initialType || '', responsible_id: '', driver_id: '', from: '', to: '', sort: 'data', dir: 'asc' });
  const [page, setPage] = useState(1);
  const dq = useDebounced(f.q, 300);
  const dash = useAsync(() => api.get<Record<string, number>>('/logistics/dashboard'), []);
  const list = useAsync(() => api.get<{ total: number; page_size: number; rows: OpRow[] }>(`/logistics/operations${qs({ ...f, q: dq, page })}`), [dq, f.status, f.type, f.responsible_id, f.driver_id, f.from, f.to, f.sort, f.dir, page]);
  const set = (k: keyof typeof f, v: string) => (setF({ ...f, [k]: v }), setPage(1));
  const D = dash.data;
  const sortBy = (k: string) => setF({ ...f, sort: k, dir: f.sort === k && f.dir === 'asc' ? 'desc' : 'asc' });
  return (
    <div>
      <PageHeader
        title="Entregas e Devoluções"
        subtitle="Programação, separação, transporte, recebimento, inspeção e ocorrências dos equipamentos dos contratos."
        actions={
          logCan.create(user) && (
            <>
              <Button icon={Undo2} onClick={() => navigate({ page: 'nova', type: 'retirada' })}>Retirada / devolução</Button>
              <Button variant="primary" icon={Plus} onClick={() => navigate({ page: 'nova', type: 'entrega' })}>Nova entrega</Button>
            </>
          )
        }
      />
      {D && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
          <Stat label="Entregas hoje" value={D.entregas_hoje} icon={CalendarClock} onClick={() => (set('status', 'hoje'), set('type', 'entrega'))} />
          <Stat label="Entregas pendentes" value={D.entregas_pendentes} icon={Clock} onClick={() => setF({ ...f, status: 'rascunho,programada,em_separacao,pronta', type: 'entrega' })} />
          <Stat label="Em transporte" value={D.entregas_andamento} icon={Navigation} tone="text-violet-700 bg-violet-50" onClick={() => setF({ ...f, status: 'em_transporte', type: 'entrega' })} />
          <Stat label="Entregues no mês" value={D.entregas_concluidas} icon={CheckCircle2} tone="text-emerald-700 bg-emerald-50" onClick={() => setF({ ...f, status: 'entregue,entregue_parcialmente', type: 'entrega' })} />
          <Stat label="Retiradas programadas" value={D.retiradas_programadas} icon={Truck} onClick={() => setF({ ...f, status: 'programada,em_andamento', type: 'retorno' })} />
          <Stat label="Devoluções previstas hoje" value={D.devolucoes_hoje} hint="Equipamentos com término hoje" icon={Undo2} />
          <Stat label="Devoluções atrasadas" value={D.devolucoes_atrasadas} hint="Contratos com equipamento após o término" icon={AlertTriangle} tone={D.devolucoes_atrasadas ? 'text-red-700 bg-red-50' : undefined} />
          <Stat label="Aguardando conferência" value={D.aguardando_conferencia} icon={ClipboardCheck} tone={D.aguardando_conferencia ? 'text-amber-700 bg-amber-50' : undefined} onClick={() => setF({ ...f, status: 'recebida,recebida_parcialmente,aguardando_inspecao,em_conferencia', type: 'retorno' })} />
          <Stat label="Avarias em aberto" value={D.avarias} icon={ShieldAlert} tone={D.avarias ? 'text-red-700 bg-red-50' : undefined} onClick={() => navigate({ page: 'ocorrencias' })} />
          <Stat label="Operações com pendências" value={D.pendencias} icon={ListTodo} onClick={() => set('status', 'pendencias')} />
        </div>
      )}
      <Card bodyClassName="p-0">
        <div className="p-4 border-b border-slate-100 flex flex-wrap gap-2 items-center">
          <div className="relative w-full lg:w-72">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Nº, contrato, cliente, endereço, equipamento" className="pl-9" aria-label="Pesquisar operações" />
          </div>
          <Select value={f.type} onChange={(e) => set('type', e.target.value)} className="w-full sm:w-44" aria-label="Tipo">
            <option value="">Todos os tipos</option>
            <option value="entrega">Entregas</option>
            <option value="retorno">Retiradas e devoluções</option>
            <option value="retirada">Só retiradas</option>
            <option value="devolucao">Só devoluções no balcão</option>
          </Select>
          <Select value={f.status} onChange={(e) => set('status', e.target.value)} className="w-full sm:w-48" aria-label="Status">
            <option value="abertas">Em aberto</option>
            <option value="hoje">Programadas para hoje</option>
            <option value="atrasadas">Atrasadas</option>
            <option value="pendencias">Com pendências</option>
            <option value="">Todas</option>
            {(Object.keys(OP_STATUS_LABELS) as OpStatus[]).map((s) => <option key={s} value={s}>{OP_STATUS_LABELS[s]}</option>)}
          </Select>
          <Select value={f.responsible_id} onChange={(e) => set('responsible_id', e.target.value)} className="w-full sm:w-40" aria-label="Responsável">
            <option value="">Responsáveis</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
          <Select value={f.driver_id} onChange={(e) => set('driver_id', e.target.value)} className="w-full sm:w-40" aria-label="Motorista">
            <option value="">Motoristas</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <div className="flex items-center gap-1.5 w-full sm:w-auto">
            <span className="text-xs text-slate-500">De</span>
            <Input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} aria-label="De" className="sm:w-36" />
            <span className="text-xs text-slate-500">até</span>
            <Input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} aria-label="Até" className="sm:w-36" />
          </div>
          {logCan.export(user) && (
            <Button icon={FileSpreadsheet} className="sm:ml-auto" onClick={async () => { try { saveBlob(await fetchBlob(`/logistics/operations/export.csv${qs({ ...f, q: dq })}`), 'operacoes-logisticas.csv'); } catch (e) { toast('error', (e as ApiError).message); } }}>
              Exportar CSV
            </Button>
          )}
        </div>
        {list.loading && !list.data ? (
          <Loading />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data?.rows.length ? (
          <EmptyState title="Nenhuma operação" text={f.status === 'abertas' && !f.q ? 'Programe entregas e retiradas a partir dos contratos ativos.' : 'Ajuste a pesquisa ou os filtros.'} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[1080px]">
                <thead className="bg-slate-50">
                  <tr>
                    <Th><button onClick={() => sortBy('numero')} className="uppercase">Operação</button></Th>
                    <Th>Tipo</Th>
                    <Th><button onClick={() => sortBy('cliente')} className="uppercase">Cliente / contrato</button></Th>
                    <Th>Endereço</Th>
                    <Th><button onClick={() => sortBy('data')} className="uppercase">Programada{f.sort === 'data' ? (f.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></Th>
                    <Th>Responsável</Th>
                    <Th><button onClick={() => sortBy('status')} className="uppercase">Status</button></Th>
                    <Th right>Qtd.</Th>
                    <Th>Pendências</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {list.data.rows.map((o) => (
                    <tr key={o.id} className={cx('border-t border-slate-100 hover:bg-slate-50/60', o.late && 'bg-red-50/40')}>
                      <td className="px-4 py-2.5">
                        <button onClick={() => navigate({ page: 'detalhe', id: o.id })} className="font-semibold text-[#1e3a5f] hover:underline whitespace-nowrap">{o.number}</button>
                      </td>
                      <td className="px-4 py-2.5 text-xs">{OP_TYPE_LABELS[o.op_type]}</td>
                      <td className="px-4 py-2.5 max-w-[220px]">
                        <p className="truncate">{o.customer_name}</p>
                        <p className="text-[11px] text-slate-500">{o.contract_number}</p>
                      </td>
                      <td className="px-4 py-2.5 max-w-[220px] text-xs text-slate-600 truncate" title={o.address || ''}>{o.address || '—'}</td>
                      <td className={cx('px-4 py-2.5 whitespace-nowrap', o.late && 'text-red-700 font-semibold')}>{formatDateTimeBR(o.scheduled_at)}</td>
                      <td className="px-4 py-2.5 text-slate-600">{o.responsible_name || '—'}{o.driver_name && <p className="text-[11px] text-slate-500">Motorista: {o.driver_name}</p>}</td>
                      <td className="px-4 py-2.5"><OpPill s={o.status} /></td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{o.quantity_total.toLocaleString('pt-BR')}<p className="text-[11px] text-slate-500">{o.items_count} item(ns)</p></td>
                      <td className="px-4 py-2.5 text-xs text-amber-700 max-w-[180px]">{o.pending || '—'}</td>
                      <td className="px-4 py-2.5 text-right"><Button size="sm" variant="ghost" onClick={() => navigate({ page: 'detalhe', id: o.id })}>Abrir</Button></td>
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

