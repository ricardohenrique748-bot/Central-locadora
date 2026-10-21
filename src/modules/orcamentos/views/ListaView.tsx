/**
 * Todos os orçamentos: filtros, ordenação, paginação, exportação CSV e ações rápidas.
 */

import React, { useEffect, useState } from 'react';
import { Plus, Search, FileDown, Eye, Pencil, Copy, ChevronDown, ChevronUp, SlidersHorizontal, X, FileSpreadsheet, Trash2 } from 'lucide-react';
import { QuotationListRow, QuotationStatus, modalityLabel } from '../../../../shared/orcamentos/types';
import { ALL_STATUSES, EDITABLE_STATUSES, STATUS_LABELS } from '../../../../shared/orcamentos/status';
import { formatBRL, parseBRL } from '../../../../shared/orcamentos/money';
import { addDaysISO, formatDateBR, formatDateTimeBR, todayISO } from '../../../../shared/orcamentos/dates';
import { formatDocument } from '../../../../shared/orcamentos/validators';
import { canCreateQuotation } from '../../../../shared/orcamentos/permissions';
import { api, ApiError, fetchBlob, qs, saveBlob } from '../api';
import { useModule, UserOption } from '../context';
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, PageHeader, Pagination, Select, StatusBadge, cx, useAsync, useDebounced, useToast } from '../ui';

interface Filters {
  number: string;
  customer: string;
  document: string;
  type: string;
  status: string;
  responsible: string;
  created_from: string;
  created_to: string;
  expires_from: string;
  expires_to: string;
  min_total: string;
  max_total: string;
  sent: string;
}

const EMPTY: Filters = { number: '', customer: '', document: '', type: '', status: '', responsible: '', created_from: '', created_to: '', expires_from: '', expires_to: '', min_total: '', max_total: '', sent: '' };

export const ListaView: React.FC<{ initialStatus?: string; initialFilters?: Record<string, string>; statusLabel?: string }> = ({ initialStatus, initialFilters, statusLabel }) => {
  const { user, navigate, settings } = useModule();
  const toast = useToast();
  const [filters, setFilters] = useState<Filters>({ ...EMPTY, ...initialFilters, status: initialStatus || '' });
  // vindo de um card do painel: mostra os filtros aplicados (período, modalidade...)
  const [showMore, setShowMore] = useState(() => Object.entries(initialFilters || {}).some(([k, v]) => v && k !== 'sent'));
  const [sort, setSort] = useState({ by: 'created_at', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const df = useDebounced(filters, 350);
  const pageSize = 20;

  useEffect(() => {
    api.get<{ rows: UserOption[] }>('/users/options').then((r) => setUsers(r.rows)).catch(() => {});
  }, []);
  useEffect(() => setPage(1), [df, sort]);

  const params = () => {
    const toCents = (v: string) => {
      const c = parseBRL(v);
      return c === null ? '' : c;
    };
    return { ...df, min_total: toCents(df.min_total), max_total: toCents(df.max_total), sort: sort.by, dir: sort.dir };
  };

  const { data, error, loading, reload } = useAsync(
    () => api.get<{ total: number; rows: QuotationListRow[] }>(`/quotations${qs({ ...params(), page, page_size: pageSize })}`),
    [df, sort, page]
  );

  const set = (k: keyof Filters, v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const activeCount = Object.entries(filters).filter(([, v]) => v).length;

  const sortHeader = (key: string, label: string, align = 'left', extra = '') => (
    <th className={cx('font-semibold px-4 py-2.5', align === 'right' ? 'text-right' : 'text-left', extra)}>
      <button onClick={() => setSort((s) => ({ by: key, dir: s.by === key && s.dir === 'desc' ? 'asc' : 'desc' }))} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-800">
        {label}
        {sort.by === key && (sort.dir === 'desc' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}
      </button>
    </th>
  );

  const exportCsv = async () => {
    setBusy('csv');
    try {
      saveBlob(await fetchBlob(`/quotations/export.csv${qs(params())}`), `orcamentos-${todayISO()}.csv`);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pdf = async (r: QuotationListRow) => {
    setBusy(`pdf-${r.id}`);
    try {
      saveBlob(await fetchBlob(`/quotations/${r.id}/pdf`), `${r.quotation_number}-v${r.version}.pdf`);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const duplicate = async (r: QuotationListRow) => {
    setBusy(`dup-${r.id}`);
    try {
      const res = await api.post<{ quotation: { id: number; quotation_number: string }; removed: string[] }>(`/quotations/${r.id}/duplicate`);
      toast('success', `Cópia ${res.quotation.quotation_number} criada.${res.removed.length ? ` Itens inativos removidos: ${res.removed.join(', ')}.` : ''}`);
      navigate({ page: 'editar', id: res.quotation.id });
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const [toDelete, setToDelete] = useState<QuotationListRow | null>(null);
  const remove = async () => {
    if (!toDelete) return;
    setBusy(`del-${toDelete.id}`);
    try {
      await api.del(`/quotations/${toDelete.id}`);
      toast('success', `Orçamento ${toDelete.quotation_number} excluído.`);
      setToDelete(null);
      reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };
  const canEditRow = (r: QuotationListRow) => EDITABLE_STATUSES.includes(r.status) && ['admin', 'gestor', 'vendedor'].includes(user.role) && (user.role !== 'vendedor' || r.responsible_user_id === user.id);
  const today = todayISO();

  return (
    <div>
      <PageHeader
        title="Todos os Orçamentos"
        subtitle={user.role === 'vendedor' ? 'Exibindo somente os orçamentos sob sua responsabilidade.' : undefined}
        actions={
          <>
            <Button icon={FileSpreadsheet} loading={busy === 'csv'} onClick={exportCsv} disabled={!data?.total}>
              Exportar CSV
            </Button>
            {canCreateQuotation(user) && (
              <Button variant="primary" icon={Plus} onClick={() => navigate({ page: 'novo' })}>
                Novo orçamento
              </Button>
            )}
          </>
        }
      />
      <Card bodyClassName="p-0">
        <div className="p-4 border-b border-slate-100 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
            <div className="relative lg:col-span-2">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input value={filters.customer} onChange={(e) => set('customer', e.target.value)} placeholder="Nome do cliente" className="pl-9" aria-label="Cliente" />
            </div>
            <Input value={filters.number} onChange={(e) => set('number', e.target.value)} placeholder="Nº do orçamento" aria-label="Número" />
            <Select value={filters.status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
              <option value="">Todos os status</option>
              {filters.status && !ALL_STATUSES.includes(filters.status as QuotationStatus) && <option value={filters.status}>{statusLabel || 'Seleção do painel'}</option>}
              {ALL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
            <div className="flex gap-2">
              <Button icon={SlidersHorizontal} className="flex-1" onClick={() => setShowMore((s) => !s)}>
                Filtros{activeCount > 0 ? ` (${activeCount})` : ''}
              </Button>
              {activeCount > 0 && <Button variant="ghost" icon={X} onClick={() => setFilters(EMPTY)} aria-label="Limpar filtros" />}
            </div>
          </div>
          {filters.sent === '1' && (
            <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1e3a5f] bg-slate-100 rounded-full pl-3 pr-1 py-1">
              Somente enviados ao cliente
              <button onClick={() => set('sent', '')} className="p-0.5 rounded-full hover:bg-slate-200" aria-label="Remover filtro de enviados">
                <X className="w-3 h-3" />
              </button>
            </p>
          )}
          {showMore && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2">
              <Field label="CPF/CNPJ do cliente">
                <Input value={filters.document} onChange={(e) => set('document', e.target.value)} />
              </Field>
              <Field label="Modalidade">
                <Select value={filters.type} onChange={(e) => set('type', e.target.value)}>
                  <option value="">Venda e locação</option>
                  <option value="venda">Venda</option>
                  <option value="locacao">Locação</option>
                  <option value="manutencao">Manutenção</option>
                </Select>
              </Field>
              {user.role !== 'vendedor' && (
                <Field label="Responsável">
                  <Select value={filters.responsible} onChange={(e) => set('responsible', e.target.value)}>
                    <option value="">Todos</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Valor (R$)">
                <div className="flex gap-2">
                  <Input value={filters.min_total} onChange={(e) => set('min_total', e.target.value)} placeholder="mín." inputMode="decimal" />
                  <Input value={filters.max_total} onChange={(e) => set('max_total', e.target.value)} placeholder="máx." inputMode="decimal" />
                </div>
              </Field>
              <Field label="Criado entre">
                <div className="flex gap-2">
                  <Input type="date" value={filters.created_from} onChange={(e) => set('created_from', e.target.value)} aria-label="Criado a partir de" />
                  <Input type="date" value={filters.created_to} onChange={(e) => set('created_to', e.target.value)} aria-label="Criado até" />
                </div>
              </Field>
              <Field label="Validade entre">
                <div className="flex gap-2">
                  <Input type="date" value={filters.expires_from} onChange={(e) => set('expires_from', e.target.value)} aria-label="Validade a partir de" />
                  <Input type="date" value={filters.expires_to} onChange={(e) => set('expires_to', e.target.value)} aria-label="Validade até" />
                </div>
              </Field>
            </div>
          )}
        </div>

        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.rows.length ? (
          <EmptyState
            title={activeCount ? 'Nenhum orçamento com esses filtros' : 'Nenhum orçamento ainda'}
            text={activeCount ? 'Ajuste ou limpe os filtros.' : 'Crie o primeiro orçamento de venda ou locação.'}
            action={
              !activeCount &&
              canCreateQuotation(user) && (
                <Button variant="primary" icon={Plus} onClick={() => navigate({ page: 'novo' })}>
                  Novo orçamento
                </Button>
              )
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    {sortHeader('number', 'Número')}
                    {sortHeader('created_at', 'Criação')}
                    {sortHeader('customer', 'Cliente')}
                    <th className="text-left font-semibold px-4 py-2.5 uppercase tracking-wide">Modalidade</th>
                    <th className="text-left font-semibold px-4 py-2.5 uppercase tracking-wide hidden xl:table-cell">Responsável</th>
                    {sortHeader('total', 'Valor', 'right')}
                    {sortHeader('expiration', 'Validade')}
                    {sortHeader('status', 'Status')}
                    {sortHeader('updated_at', 'Atualização', 'left', 'hidden 2xl:table-cell')}
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className={cx(loading && 'opacity-60')}>
                  {data.rows.map((r) => {
                    const expSoon = ['enviado', 'em_negociacao', 'aprovado_interno'].includes(r.status) && r.expiration_date >= today && r.expiration_date <= addDaysISO(today, settings.expiring_soon_days);
                    return (
                      <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer" onClick={() => navigate({ page: 'detalhe', id: r.id })}>
                        <td className="px-4 py-2.5 font-semibold text-[#1e3a5f] whitespace-nowrap">
                          {r.quotation_number}
                          {r.version > 1 && <span className="ml-1 text-[10px] text-slate-400">v{r.version}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">{formatDateBR(r.created_at.slice(0, 10))}</td>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-slate-800">{r.customer_name}</p>
                          {r.customer_document && <p className="text-[11px] text-slate-500">{formatDocument(r.customer_document)}</p>}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{modalityLabel(r)}</td>
                        <td className="px-4 py-2.5 text-slate-600 hidden xl:table-cell">{r.responsible_name}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{formatBRL(r.total_amount)}</td>
                        <td className={cx('px-4 py-2.5 whitespace-nowrap', r.status === 'expirado' ? 'text-orange-700' : expSoon ? 'text-amber-700 font-semibold' : 'text-slate-600')}>
                          {formatDateBR(r.expiration_date)}
                          {expSoon && <span className="block text-[10px] font-normal">vence em breve</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={r.status as QuotationStatus} />
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500 whitespace-nowrap hidden 2xl:table-cell">{formatDateTimeBR(r.updated_at)}</td>
                        <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-0.5">
                            <Button size="sm" variant="ghost" icon={Eye} onClick={() => navigate({ page: 'detalhe', id: r.id })} aria-label="Visualizar" title="Visualizar" />
                            {canEditRow(r) && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => navigate({ page: 'editar', id: r.id })} aria-label="Editar" title="Editar" />}
                            <Button size="sm" variant="ghost" icon={FileDown} loading={busy === `pdf-${r.id}`} onClick={() => pdf(r)} aria-label="Baixar PDF" title="Baixar PDF" />
                            {canCreateQuotation(user) && <Button size="sm" variant="ghost" icon={Copy} loading={busy === `dup-${r.id}`} onClick={() => duplicate(r)} aria-label="Duplicar" title="Duplicar" />}
                            {canEditRow(r) && <Button size="sm" variant="ghost" icon={Trash2} className="text-red-600 hover:text-red-700" onClick={() => setToDelete(r)} aria-label="Excluir" title="Excluir" />}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={pageSize} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <Modal
        open={!!toDelete}
        onClose={() => setToDelete(null)}
        title="Excluir orçamento"
        footer={
          <>
            <Button onClick={() => setToDelete(null)}>Voltar</Button>
            <Button variant="danger" icon={Trash2} loading={!!toDelete && busy === `del-${toDelete.id}`} onClick={remove}>
              Excluir definitivamente
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          Excluir o orçamento <b>{toDelete?.quotation_number}</b> de <b>{toDelete?.customer_name}</b>? Itens, versões e histórico dele também serão apagados. Esta ação não pode ser desfeita.
        </p>
        <p className="text-xs text-slate-500 mt-2">Só rascunhos que nunca foram enviados ao cliente podem ser excluídos. Orçamentos já enviados são cancelados, para manter o histórico.</p>
      </Modal>
      <p className="text-[11px] text-slate-500 mt-2">Envio, resposta do cliente, aprovação, renovação, cancelamento e conversão ficam na tela do orçamento, conforme o status e seu perfil.</p>
    </div>
  );
};
