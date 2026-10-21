/**
 * Contas a pagar e a receber: listagem com filtros, formulário (parcelamento, rateio, recorrência)
 * e detalhe (parcelas, liquidação parcial, encargos, estorno, anexos, comprovante, histórico).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, FileSpreadsheet, Pencil, XCircle, Ban, Wallet, Undo2, Paperclip, Download, Receipt, Repeat, Trash2, ShieldCheck, Send, Info, FileText } from 'lucide-react';
import { Customer } from '../../../../shared/orcamentos/types';
import { DISPLAY_LABELS, EntryDetail, EntryType, Installment, ORIGIN_LABELS, ReceivableOrigin, Recurrence, SOURCE_LABELS } from '../../../../shared/financeiro/types';
import { Supplier } from '../../../../shared/estoque/types';
import { buildInstallments, validateCostCenterSplit } from '../../../../shared/financeiro/rules';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { addDaysISO, formatDateBR, formatDateTimeBR, todayISO } from '../../../../shared/orcamentos/dates';
import { formatDocument } from '../../../../shared/orcamentos/validators';
import { api, ApiError, fetchBlob, qs, saveBlob } from '../../orcamentos/api';
import { Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Loading, Modal, MoneyInput, Notice, PageHeader, Pagination, Select, Textarea, cx, useAsync, useDebounced, useToast } from '../../orcamentos/ui';
import { newIdempotencyKey, useFin } from '../context';
import { AccountSelect, Amount, CategorySelect, PAYMENT_METHODS, StatusPill, Th } from '../components';
import { financeCan } from '../../../../shared/financeiro/rules';
import { openChargePdf } from './Invoices';

// ================================================ LISTAGEM

export const EntriesList: React.FC<{ type: EntryType; initialStatus?: string }> = ({ type, initialStatus }) => {
  const { user, navigate, costCenters } = useFin();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(initialStatus || 'pendente');
  const [category, setCategory] = useState<number | null>(null);
  const [cc, setCc] = useState('');
  const [origin, setOrigin] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<'titulos' | 'recorrencias'>('titulos');
  const dq = useDebounced(q);
  const filters = { q: dq, status, category_id: category, cost_center_id: cc, origin, due_from: dueFrom, due_to: dueTo };
  useEffect(() => setPage(1), [dq, status, category, cc, origin, dueFrom, dueTo]);
  const { data, error, loading, reload } = useAsync(
    () => api.get<{ total: number; page_size: number; rows: any[]; totals: { updated: number; settled: number; pending: number } }>(`/finance/entries/${type}${qs({ ...filters, page })}`),
    [type, dq, status, category, cc, origin, dueFrom, dueTo, page]
  );
  const isPay = type === 'pagar';
  const labels = DISPLAY_LABELS[type];

  return (
    <div>
      <PageHeader
        title={isPay ? 'Contas a Pagar' : 'Contas a Receber'}
        subtitle={isPay ? 'Obrigações financeiras. Pagamento só altera o saldo quando confirmado.' : 'Valores a receber. Cobrança criada não é dinheiro recebido.'}
        actions={
          <>
            <Button
              icon={FileSpreadsheet}
              onClick={async () => {
                try {
                  saveBlob(await fetchBlob(`/finance/entries/${type}/export.csv${qs(filters)}`), `contas-a-${type}-${todayISO()}.csv`);
                } catch (e) {
                  toast('error', (e as Error).message);
                }
              }}
            >
              CSV
            </Button>
            {financeCan.operate(user) && (
              <Button variant="primary" icon={Plus} onClick={() => navigate({ page: 'novo', type })}>
                {isPay ? 'Nova conta a pagar' : 'Nova conta a receber'}
              </Button>
            )}
          </>
        }
      />
      <div className="flex gap-1 mb-3">
        {(
          [
            ['titulos', 'Lançamentos'],
            ['recorrencias', 'Recorrências'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('px-3 py-1.5 rounded-lg text-sm font-semibold', tab === k ? 'bg-[#1e3a5f] text-white' : 'bg-white border border-slate-200 text-slate-600')}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'recorrencias' ? (
        <RecurrencesPanel type={type} />
      ) : (
        <>
          {data && (
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="bg-white rounded-xl border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Valor atualizado (filtro)</p>
                <p className="text-lg font-extrabold tabular-nums">{formatBRL(data.totals.updated)}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-3">
                <p className="text-xs text-slate-500">{isPay ? 'Pago' : 'Recebido'}</p>
                <p className="text-lg font-extrabold tabular-nums text-emerald-700">{formatBRL(data.totals.settled)}</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-3">
                <p className="text-xs text-slate-500">Saldo pendente</p>
                <p className="text-lg font-extrabold tabular-nums text-amber-700">{formatBRL(data.totals.pending)}</p>
              </div>
            </div>
          )}
          <Card bodyClassName="p-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2 p-4 border-b border-slate-100">
              <div className="relative sm:col-span-2 lg:col-span-3 xl:col-span-2">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={isPay ? 'Nº, fornecedor, descrição, documento' : 'Nº, cliente, descrição, documento'} className="pl-9" aria-label="Pesquisar" />
              </div>
              <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Situação">
                <option value="pendente">Pendentes (em aberto)</option>
                <option value="vencido">{labels.vencido}</option>
                <option value="aberto">{labels.aberto}</option>
                <option value="parcial">{labels.parcial}</option>
                <option value="liquidado">{labels.liquidado}</option>
                <option value="aguardando_aprovacao">{labels.aguardando_aprovacao}</option>
                <option value="rascunho">{labels.rascunho}</option>
                <option value="cancelado">{labels.cancelado}</option>
                <option value="">Todas</option>
              </Select>
              <CategorySelect type={isPay ? 'despesa' : 'receita'} value={category} onChange={setCategory} includeInactive placeholder="Todas as categorias" />
              {isPay ? (
                <Select value={cc} onChange={(e) => setCc(e.target.value)} aria-label="Centro de custo">
                  <option value="">Todos os centros</option>
                  {costCenters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <Select value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Origem">
                  <option value="">Todas as origens</option>
                  {Object.entries(ORIGIN_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              )}
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
              <EmptyState title="Nenhum lançamento encontrado" />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead className="bg-slate-50">
                      <tr>
                        <Th>Nº / descrição</Th>
                        <Th>{isPay ? 'Favorecido' : 'Cliente'}</Th>
                        <Th>Categoria</Th>
                        <Th>Próx. vencimento</Th>
                        <Th right>Atualizado</Th>
                        <Th right>Pendente</Th>
                        <Th>Situação</Th>
                      </tr>
                    </thead>
                    <tbody className={cx(loading && 'opacity-60')}>
                      {data.rows.map((e) => (
                        <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer" onClick={() => navigate({ page: 'titulo', id: e.id })}>
                          <td className="px-4 py-2.5">
                            <p className="font-semibold text-[#1e3a5f]">{e.entry_number}</p>
                            <p className="text-xs text-slate-600 truncate max-w-[260px]">{e.description}</p>
                            {e.source_type !== 'manual' && <p className="text-[10px] text-slate-400">{SOURCE_LABELS[e.source_type as keyof typeof SOURCE_LABELS]}{e.source_ref ? ` • ${e.source_ref}` : ''}</p>}
                          </td>
                          <td className="px-4 py-2.5">
                            <p>{e.party_name}</p>
                            {e.party_document && <p className="text-[11px] text-slate-500">{formatDocument(e.party_document)}</p>}
                          </td>
                          <td className="px-4 py-2.5 text-slate-600">{e.category_name}</td>
                          <td className={cx('px-4 py-2.5 whitespace-nowrap', e.display_status === 'vencido' ? 'text-red-700 font-semibold' : '')}>
                            {formatDateBR(e.next_due_date)}
                            {e.installments_count > 1 && <span className="block text-[10px] text-slate-400">{e.installments_count} parcelas</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(e.updated_amount)}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{formatBRL(e.pending_amount)}</td>
                          <td className="px-4 py-2.5">
                            <StatusPill s={e.display_status} type={type} />
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
        </>
      )}
    </div>
  );
};

const RecurrencesPanel: React.FC<{ type: EntryType }> = ({ type }) => {
  const { user, navigate } = useFin();
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api.get<{ rows: Recurrence[] }>(`/finance/recurrences?type=${type}`), [type]);
  return (
    <Card bodyClassName="p-0" title="Lançamentos recorrentes" actions={financeCan.operate(user) && <Button size="sm" icon={Plus} onClick={() => navigate({ page: 'novo', type })}>Nova (marque "recorrente")</Button>}>
      <p className="px-4 py-2 text-xs text-slate-500 border-b border-slate-100">Os lançamentos de cada ocorrência são gerados automaticamente até o horizonte configurado (sem duplicar). Desativar não apaga os já gerados.</p>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data?.rows.length ? (
        <EmptyState title="Nenhuma recorrência" />
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <Th>Descrição</Th>
              <Th>Frequência</Th>
              <Th right>Valor</Th>
              <Th>Próxima</Th>
              <Th right>Gerados</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="px-4 py-2.5">
                  <p className="font-semibold">{r.description}</p>
                  <p className="text-xs text-slate-500">
                    {r.party_name} • {r.category_name}
                  </p>
                </td>
                <td className="px-4 py-2.5 capitalize">{r.frequency}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(r.amount)}</td>
                <td className="px-4 py-2.5">{r.active ? formatDateBR(r.next_date) : <span className="text-slate-400">Desativada</span>}</td>
                <td className="px-4 py-2.5 text-right">{r.generated}</td>
                <td className="px-4 py-2.5 text-right">
                  {financeCan.operate(user) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await api.post(`/finance/recurrences/${r.id}/${r.active ? 'desativar' : 'ativar'}`);
                          reload();
                        } catch (e) {
                          toast('error', (e as Error).message);
                        }
                      }}
                    >
                      {r.active ? 'Desativar' : 'Ativar'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
};

// ================================================ FORMULÁRIO

interface FormState {
  description: string;
  party_type: 'fornecedor' | 'cliente' | 'outro';
  supplier_id: number | null;
  customer_id: number | null;
  party_name: string;
  party_document: string;
  category_id: number | null;
  origin: ReceivableOrigin;
  document_ref: string;
  issue_date: string;
  competence_date: string;
  original_amount: number;
  payment_method: string;
  planned_account_id: number | null;
  notes: string;
  count: number;
  first_due: string;
  interval: 'mensal' | 'quinzenal' | 'semanal' | 'dias';
  interval_days: number;
  customDues: boolean;
  custom: { due_date: string; amount: number }[];
  cc: { cost_center_id: number | null; amount: number }[];
  recurring: boolean;
  frequency: 'mensal' | 'semanal' | 'anual';
  end_date: string;
}

export const EntryForm: React.FC<{ type?: EntryType; id?: number; stockEntryId?: number }> = ({ type: typeProp, id, stockEntryId }) => {
  const { navigate, costCenters, settings } = useFin();
  const toast = useToast();
  const [type, setType] = useState<EntryType>(typeProp || 'pagar');
  const [entry, setEntry] = useState<EntryDetail | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [custQ, setCustQ] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [stockEntry, setStockEntry] = useState<any>(null);
  const [loading, setLoading] = useState(!!id || !!stockEntryId);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dc = useDebounced(custQ, 250);
  const [f, setF] = useState<FormState>({
    description: '', party_type: (typeProp || 'pagar') === 'pagar' ? 'fornecedor' : 'cliente', supplier_id: null, customer_id: null, party_name: '', party_document: '',
    category_id: null, origin: 'outras', document_ref: '', issue_date: todayISO(), competence_date: todayISO(), original_amount: 0, payment_method: '',
    planned_account_id: null, notes: '', count: 1, first_due: addDaysISO(todayISO(), (typeProp || 'pagar') === 'receber' ? settings.default_receivable_days : 30),
    interval: 'mensal', interval_days: 30, customDues: false, custom: [], cc: [], recurring: false, frequency: 'mensal', end_date: '',
  });
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    api.get<{ rows: Supplier[] }>('/stock/suppliers?active=true').then((r) => setSuppliers(r.rows)).catch(() => {});
    if (id) {
      api
        .get<EntryDetail>(`/finance/entry/${id}`)
        .then((e) => {
          setEntry(e);
          setType(e.entry_type);
          setF((x) => ({
            ...x, description: e.description, party_type: e.party_type, supplier_id: e.supplier_id, customer_id: e.customer_id, party_name: e.party_name, party_document: e.party_document || '',
            category_id: e.category_id, origin: e.origin || 'outras', document_ref: e.document_ref || '', issue_date: e.issue_date, competence_date: e.competence_date,
            original_amount: e.original_amount, payment_method: e.payment_method || '', planned_account_id: e.planned_account_id, notes: e.notes || '',
            count: e.installments.length, first_due: e.installments[0]?.due_date || x.first_due, customDues: true,
            custom: e.installments.map((i) => ({ due_date: i.due_date, amount: i.original_amount })), cc: e.cost_centers.map((c) => ({ cost_center_id: c.cost_center_id, amount: c.amount })),
          }));
          if (e.party_type === 'cliente') setCustQ('');
        })
        .catch((err) => toast('error', err.message))
        .finally(() => setLoading(false));
    }
    if (stockEntryId) {
      api
        .get<any>(`/stock/entries/${stockEntryId}`)
        .then((se) => {
          setStockEntry(se);
          setF((x) => ({ ...x, description: `Compra ${se.number}${se.origin_document ? ` — ${se.origin_document}` : ''}`, party_type: 'fornecedor', supplier_id: se.supplier_id, original_amount: se.total, document_ref: se.origin_document || '', issue_date: se.entry_date, competence_date: se.entry_date }));
        })
        .catch((err) => toast('error', err.message))
        .finally(() => setLoading(false));
    }
  }, [id, stockEntryId, toast]);

  useEffect(() => {
    if (dc.trim().length < 2) return setCustomers([]);
    api.get<{ rows: Customer[] }>(`/customers${qs({ q: dc, limit: 6 })}`).then((r) => setCustomers(r.rows)).catch(() => setCustomers([]));
  }, [dc]);

  const preview = useMemo(() => {
    try {
      if (f.customDues) return { rows: buildInstallments({ total: f.original_amount, count: f.custom.length, first_due: f.first_due, interval: 'mensal', custom: f.custom }), error: null };
      return { rows: buildInstallments({ total: f.original_amount, count: f.count, first_due: f.first_due, interval: f.interval, interval_days: f.interval_days }), error: null };
    } catch (e: any) {
      return { rows: [], error: f.original_amount > 0 ? e.message : null };
    }
  }, [f.original_amount, f.count, f.first_due, f.interval, f.interval_days, f.customDues, f.custom]);

  const ccSplit = f.cc.filter((c) => c.cost_center_id).map((c) => ({ cost_center_id: c.cost_center_id!, amount: c.amount }));
  const ccError = ccSplit.length ? validateCostCenterSplit(f.original_amount, ccSplit) : null;

  const payload = (draft = false) => ({
    description: f.description,
    party_type: f.party_type,
    supplier_id: f.supplier_id,
    customer_id: f.customer_id,
    party_name: f.party_name,
    party_document: f.party_document,
    category_id: f.category_id,
    origin: f.origin,
    document_ref: f.document_ref,
    issue_date: f.issue_date,
    competence_date: f.competence_date,
    original_amount: f.original_amount,
    payment_method: f.payment_method,
    planned_account_id: f.planned_account_id,
    notes: f.notes,
    cost_centers: ccSplit,
    plan: f.customDues ? { total: f.original_amount, count: f.custom.length, first_due: f.custom[0]?.due_date, custom: f.custom } : { total: f.original_amount, count: f.count, first_due: f.first_due, interval: f.interval, interval_days: f.interval_days },
    draft,
    row_version: entry?.row_version,
  });

  const save = async (draft = false) => {
    setSaving(true);
    setErrors({});
    try {
      let target: number;
      if (f.recurring && !id) {
        await api.post(`/finance/recurrences/${type}`, { ...payload(), frequency: f.frequency, start_date: f.first_due, end_date: f.end_date || null });
        toast('success', 'Recorrência criada. Os lançamentos do período foram gerados.');
        navigate({ page: type });
        return;
      }
      if (stockEntryId) {
        const e = await api.post<EntryDetail>(`/finance/integrations/stock-entries/${stockEntryId}/payable`, payload());
        target = e.id;
      } else if (id) {
        target = (await api.put<EntryDetail>(`/finance/entry/${id}`, payload(draft))).id;
      } else {
        target = (await api.post<EntryDetail>(`/finance/entries/${type}`, payload(draft))).id;
      }
      toast('success', 'Lançamento salvo.');
      navigate({ page: 'titulo', id: target });
    } catch (e) {
      const err = e as ApiError;
      if (err.fields) setErrors(err.fields);
      toast('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;
  const isPay = type === 'pagar';

  return (
    <div>
      <PageHeader
        title={id ? `Editar ${entry?.entry_number}` : stockEntryId ? 'Conta a pagar da entrada de estoque' : isPay ? 'Nova conta a pagar' : 'Nova conta a receber'}
        subtitle="Salvar não movimenta dinheiro: o saldo só muda ao registrar o pagamento/recebimento."
        onBack={() => navigate(id ? { page: 'titulo', id } : { page: type })}
      />
      {stockEntry && <Notice className="mb-4">Vinculada à entrada {stockEntry.number} ({stockEntry.supplier_name}). Valor e fornecedor vêm da entrada; cada entrada gera uma única conta a pagar.</Notice>}
      <div className="space-y-5 max-w-5xl">
        <Card title="Identificação">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <Field label="Descrição" required error={errors.description} className="md:col-span-4">
              <Input value={f.description} onChange={(e) => set('description', e.target.value)} error={errors.description} />
            </Field>
            <Field label="Documento de origem" className="md:col-span-2" hint="NF, boleto, contrato...">
              <Input value={f.document_ref} disabled={!!stockEntryId} onChange={(e) => set('document_ref', e.target.value)} />
            </Field>
            <Field label={isPay ? 'Favorecido' : 'Cliente'} className="md:col-span-2">
              <Select value={f.party_type} disabled={!!stockEntryId} onChange={(e) => set('party_type', e.target.value as any)}>
                {isPay ? <option value="fornecedor">Fornecedor cadastrado</option> : <option value="cliente">Cliente cadastrado</option>}
                {isPay ? <option value="cliente">Cliente cadastrado</option> : <option value="fornecedor">Fornecedor cadastrado</option>}
                <option value="outro">Outro (informar nome)</option>
              </Select>
            </Field>
            <div className="md:col-span-4">
              {f.party_type === 'fornecedor' && (
                <Field label="Fornecedor" required error={errors.supplier_id}>
                  <Select value={f.supplier_id ?? ''} disabled={!!stockEntryId} onChange={(e) => set('supplier_id', Number(e.target.value) || null)} error={errors.supplier_id}>
                    <option value="">Selecione...</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.document ? ` — ${formatDocument(s.document)}` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {f.party_type === 'cliente' && (
                <Field label="Cliente" required error={errors.customer_id}>
                  {f.customer_id ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 flex justify-between gap-2 text-sm">
                      <span className="font-semibold">{f.party_name || entry?.party_name || `Cliente #${f.customer_id}`}</span>
                      <Button size="sm" variant="ghost" onClick={() => setF((x) => ({ ...x, customer_id: null, party_name: '' }))}>
                        Trocar
                      </Button>
                    </div>
                  ) : (
                    <div className="relative">
                      <Input value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder="Pesquisar cliente por nome, documento ou telefone" error={errors.customer_id} />
                      {customers.length > 0 && (
                        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl">
                          {customers.map((c) => (
                            <button key={c.id} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50" onClick={() => (setF((x) => ({ ...x, customer_id: c.id, party_name: c.name })), setCustQ(''), setCustomers([]))}>
                              {c.name} <span className="text-slate-500">{formatDocument(c.document)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </Field>
              )}
              {f.party_type === 'outro' && (
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Nome" required error={errors.party_name} className="col-span-2">
                    <Input value={f.party_name} onChange={(e) => set('party_name', e.target.value)} error={errors.party_name} />
                  </Field>
                  <Field label="CPF/CNPJ">
                    <Input value={f.party_document} onChange={(e) => set('party_document', e.target.value)} />
                  </Field>
                </div>
              )}
            </div>
            <Field label="Categoria financeira" required error={errors.category_id} className="md:col-span-3">
              <CategorySelect type={isPay ? 'despesa' : 'receita'} value={f.category_id} onChange={(v) => set('category_id', v)} error={errors.category_id} />
            </Field>
            {!isPay && (
              <Field label="Origem da cobrança" className="md:col-span-3">
                <Select value={f.origin} onChange={(e) => set('origin', e.target.value as ReceivableOrigin)}>
                  {Object.entries(ORIGIN_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Data de emissão" className="md:col-span-2">
              <Input type="date" value={f.issue_date} disabled={!!stockEntryId} onChange={(e) => set('issue_date', e.target.value)} />
            </Field>
            <Field label="Competência" hint="Usada na DRE" className="md:col-span-2">
              <Input type="date" value={f.competence_date} onChange={(e) => set('competence_date', e.target.value)} />
            </Field>
            <Field label={isPay ? 'Forma de pagamento prevista' : 'Forma de recebimento prevista'} className="md:col-span-2">
              <Select value={f.payment_method} onChange={(e) => set('payment_method', e.target.value)}>
                <option value="">—</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            </Field>
            <Field label={isPay ? 'Conta prevista' : 'Conta de destino prevista'} className="md:col-span-3">
              <AccountSelect value={f.planned_account_id} onChange={(v) => set('planned_account_id', v)} placeholder="—" />
            </Field>
          </div>
        </Card>

        <Card title="Valor e vencimentos">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Field label="Valor total" required error={errors.plan}>
              <MoneyInput value={f.original_amount} disabled={!!stockEntryId} onChange={(v) => set('original_amount', v ?? 0)} error={errors.plan} />
            </Field>
            {!f.customDues && !f.recurring && (
              <>
                <Field label="Parcelas">
                  <Input type="number" min={1} max={360} value={f.count} onChange={(e) => set('count', Math.max(1, Number(e.target.value) || 1))} />
                </Field>
                <Field label="Intervalo">
                  <Select value={f.interval} onChange={(e) => set('interval', e.target.value as any)}>
                    <option value="mensal">Mensal</option>
                    <option value="quinzenal">Quinzenal</option>
                    <option value="semanal">Semanal</option>
                    <option value="dias">A cada N dias</option>
                  </Select>
                </Field>
              </>
            )}
            <Field label={f.recurring ? 'Primeira ocorrência' : '1º vencimento'} required>
              <Input type="date" value={f.first_due} onChange={(e) => set('first_due', e.target.value)} />
            </Field>
            {f.interval === 'dias' && !f.customDues && !f.recurring && (
              <Field label="N dias">
                <Input type="number" min={1} value={f.interval_days} onChange={(e) => set('interval_days', Number(e.target.value) || 30)} />
              </Field>
            )}
          </div>
          <div className="flex flex-wrap gap-4 mt-3">
            {!id && !stockEntryId && <Checkbox checked={f.recurring} onChange={(v) => setF((x) => ({ ...x, recurring: v, customDues: false }))} label={<span className="flex items-center gap-1"><Repeat className="w-3.5 h-3.5" /> Lançamento recorrente</span>} />}
            {!f.recurring && (
              <Checkbox
                checked={f.customDues}
                onChange={(v) => setF((x) => ({ ...x, customDues: v, custom: v ? preview.rows.map((r) => ({ due_date: r.due_date, amount: r.amount })) : x.custom }))}
                label="Personalizar vencimentos e valores"
              />
            )}
          </div>
          {f.recurring && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
              <Field label="Frequência">
                <Select value={f.frequency} onChange={(e) => set('frequency', e.target.value as any)}>
                  <option value="mensal">Mensal</option>
                  <option value="semanal">Semanal</option>
                  <option value="anual">Anual</option>
                </Select>
              </Field>
              <Field label="Até (opcional)">
                <Input type="date" value={f.end_date} onChange={(e) => set('end_date', e.target.value)} />
              </Field>
              <p className="text-xs text-slate-500 self-end pb-2">Cada ocorrência vira um lançamento de {formatBRL(f.original_amount)}, gerado automaticamente até {settings.recurrence_horizon_days} dias à frente.</p>
            </div>
          )}
          {!f.recurring && (
            <div className="mt-4">
              {preview.error && <p className="text-xs text-red-600 mb-2">{preview.error}</p>}
              {f.customDues ? (
                <div className="space-y-2">
                  {f.custom.map((c, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-slate-500 w-14">Parc. {i + 1}</span>
                      <Input type="date" className="w-44" value={c.due_date} onChange={(e) => set('custom', f.custom.map((x, j) => (j === i ? { ...x, due_date: e.target.value } : x)))} />
                      <div className="w-44">
                        <MoneyInput value={c.amount} onChange={(v) => set('custom', f.custom.map((x, j) => (j === i ? { ...x, amount: v ?? 0 } : x)))} />
                      </div>
                      <Button variant="ghost" icon={Trash2} onClick={() => set('custom', f.custom.filter((_, j) => j !== i))} aria-label="Remover parcela" disabled={f.custom.length <= 1} />
                    </div>
                  ))}
                  <div className="flex items-center gap-3">
                    <Button size="sm" icon={Plus} onClick={() => set('custom', [...f.custom, { due_date: addDaysISO(f.custom.at(-1)?.due_date || f.first_due, 30), amount: 0 }])}>
                      Parcela
                    </Button>
                    <span className={cx('text-xs', f.custom.reduce((a, c) => a + c.amount, 0) === f.original_amount ? 'text-emerald-700' : 'text-red-600')}>
                      Soma {formatBRL(f.custom.reduce((a, c) => a + c.amount, 0))} de {formatBRL(f.original_amount)}
                    </span>
                  </div>
                </div>
              ) : (
                preview.rows.length > 1 && (
                  <div className="flex flex-wrap gap-2">
                    {preview.rows.map((r) => (
                      <span key={r.number} className="text-xs bg-slate-100 rounded px-2 py-1 tabular-nums">
                        {r.number}ª {formatDateBR(r.due_date)} • {formatBRL(r.amount)}
                      </span>
                    ))}
                  </div>
                )
              )}
            </div>
          )}
        </Card>

        <Card title="Centros de custo (opcional)">
          <p className="text-xs text-slate-500 mb-3">Categoria diz "o quê"; centro de custo diz "onde". Para ratear entre vários centros, a soma deve fechar o valor total.</p>
          <div className="space-y-2">
            {f.cc.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select className="w-64" value={c.cost_center_id ?? ''} onChange={(e) => set('cc', f.cc.map((x, j) => (j === i ? { ...x, cost_center_id: Number(e.target.value) || null } : x)))}>
                  <option value="">Centro de custo...</option>
                  {costCenters.filter((x) => x.active).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.code} — {x.name}
                    </option>
                  ))}
                </Select>
                <div className="w-44">
                  <MoneyInput value={c.amount} onChange={(v) => set('cc', f.cc.map((x, j) => (j === i ? { ...x, amount: v ?? 0 } : x)))} />
                </div>
                <Button variant="ghost" icon={Trash2} onClick={() => set('cc', f.cc.filter((_, j) => j !== i))} aria-label="Remover centro" />
              </div>
            ))}
            <div className="flex items-center gap-3">
              <Button size="sm" icon={Plus} onClick={() => set('cc', [...f.cc, { cost_center_id: null, amount: f.cc.length ? 0 : f.original_amount }])}>
                Centro de custo
              </Button>
              {(ccError || errors.cost_centers) && <span className="text-xs text-red-600">{ccError || errors.cost_centers}</span>}
            </div>
          </div>
        </Card>

        <Card title="Observações">
          <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          {isPay && settings.payment_approval_limit > 0 && f.original_amount > settings.payment_approval_limit && (
            <Notice kind="warning" className="mt-3">Acima da alçada de {formatBRL(settings.payment_approval_limit)}: o lançamento ficará aguardando aprovação de gestor/administrador antes do pagamento.</Notice>
          )}
        </Card>

        <div className="flex justify-end gap-2">
          <Button onClick={() => navigate(id ? { page: 'titulo', id } : { page: type })}>Cancelar</Button>
          {!f.recurring && !stockEntryId && (!entry || entry.status === 'rascunho') && (
            <Button loading={saving} onClick={() => save(true)}>
              Salvar rascunho
            </Button>
          )}
          <Button variant="primary" loading={saving} onClick={() => save(false)} disabled={!!ccError}>
            {f.recurring ? 'Criar recorrência' : 'Lançar'}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ================================================ DETALHE

export const EntryDetailView: React.FC<{ id: number }> = ({ id }) => {
  const { navigate, user, accounts, reload: reloadCtx } = useFin();
  const toast = useToast();
  const { data: e, error, loading, reload, setData } = useAsync(() => api.get<EntryDetail>(`/finance/entry/${id}`), [id]);
  const [settleOpen, setSettleOpen] = useState(false);
  const [adj, setAdj] = useState<Installment | null>(null);
  const [action, setAction] = useState<'cancelar' | 'rejeitar' | null>(null);
  const [reverse, setReverse] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'parcelas' | 'pagamentos' | 'anexos' | 'historico'>('parcelas');

  if (loading && !e) return <Loading />;
  if (error || !e) return <ErrorState message={error || 'Lançamento não encontrado.'} onRetry={reload} />;
  const isPay = e.entry_type === 'pagar';

  const run = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r && r.id === id && r.installments) setData(r);
      else reload();
      reloadCtx();
      toast('success', ok);
      return true;
    } catch (err) {
      toast('error', (err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > 1_400_000) return toast('error', 'Arquivo muito grande (máx. ~1,4 MB).');
    const data = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(new Error('Falha ao ler.'));
      r.readAsDataURL(file);
    });
    run(() => api.post(`/finance/entry/${id}/attachments`, { name: file.name, data }), 'Anexo adicionado.');
  };

  return (
    <div>
      <PageHeader
        title={`${e.entry_number} — ${e.description}`}
        subtitle={`${isPay ? 'Conta a pagar' : 'Conta a receber'} • ${e.party_name} • ${e.category_name}`}
        onBack={() => navigate({ page: e.entry_type })}
        actions={
          <>
            <StatusPill s={e.display_status} type={e.entry_type} />
            {e.source_type === 'contrato' && e.source_id && e.status !== 'cancelado' && (
              <Button
                icon={FileText}
                onClick={() => {
                  const [contractId, chargeId] = e.source_id!.split(':').map(Number);
                  openChargePdf(contractId, chargeId, 'invoice', `Fatura ${e.entry_number}.pdf`).catch((err) => toast('error', (err as Error).message));
                }}
              >
                Fatura
              </Button>
            )}
            {e.allowed.settle && (
              <Button variant="primary" icon={Wallet} onClick={() => setSettleOpen(true)}>
                {isPay ? 'Registrar pagamento' : 'Registrar recebimento'}
              </Button>
            )}
            {e.allowed.edit && (
              <Button icon={Pencil} onClick={() => navigate({ page: 'editar', id })}>
                Editar
              </Button>
            )}
          </>
        }
      />

      {e.status === 'rascunho' && financeCan.operate(user) && (
        <Notice className="mb-4">
          <span className="flex flex-wrap items-center gap-2">
            Rascunho: ainda não entra em contas a pagar/receber nem no fluxo projetado.
            <Button size="sm" variant="primary" icon={Send} loading={busy} onClick={() => run(() => api.post(`/finance/entry/${id}/action/lancar`), 'Lançado.')}>
              Lançar
            </Button>
          </span>
        </Notice>
      )}
      {e.status === 'aguardando_aprovacao' && (
        <Notice kind="warning" className="mb-4">
          <span className="flex flex-wrap items-center gap-2">
            Valor acima da alçada: aguardando aprovação de gestor ou administrador.
            {e.allowed.approve && (
              <>
                <Button size="sm" variant="success" icon={ShieldCheck} loading={busy} onClick={() => run(() => api.post(`/finance/entry/${id}/action/aprovar`), 'Aprovado.')}>
                  Aprovar
                </Button>
                <Button size="sm" icon={XCircle} onClick={() => (setAction('rejeitar'), setReason(''))}>
                  Rejeitar
                </Button>
              </>
            )}
          </span>
        </Notice>
      )}
      {e.status === 'cancelado' && <Notice kind="warning" className="mb-4">Cancelado: {e.cancel_reason}</Notice>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          ['Valor original', e.original_amount],
          ['Valor atualizado', e.updated_amount],
          [isPay ? 'Pago' : 'Recebido', e.settled_amount],
          ['Saldo pendente', e.pending_amount],
        ].map(([l, v]) => (
          <div key={l as string} className="bg-white rounded-xl border border-slate-200 p-3">
            <p className="text-xs text-slate-500">{l}</p>
            <p className={cx('text-lg font-extrabold tabular-nums', l === 'Saldo pendente' && (v as number) > 0 && 'text-amber-700')}>{formatBRL(v as number)}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5 items-start">
        <Card
          bodyClassName="p-0"
          title={
            <span className="flex gap-1 flex-wrap">
              {(
                [
                  ['parcelas', `Parcelas (${e.installments.length})`],
                  ['pagamentos', `${isPay ? 'Pagamentos' : 'Recebimentos'} (${e.payments.filter((p) => !p.is_reversal).length})`],
                  ['anexos', `Anexos (${e.attachments.length})`],
                  ['historico', 'Histórico'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} onClick={() => setTab(k)} className={cx('px-2.5 py-1 rounded-md text-xs font-semibold', tab === k ? 'bg-[#1e3a5f] text-white' : 'text-slate-600 hover:bg-slate-100')}>
                  {l}
                </button>
              ))}
            </span>
          }
        >
          {tab === 'parcelas' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Parc.</Th>
                    <Th>Vencimento</Th>
                    <Th right>Original</Th>
                    <Th right>Desc./encargos</Th>
                    <Th right>Atualizado</Th>
                    <Th right>{isPay ? 'Pago' : 'Recebido'}</Th>
                    <Th right>Pendente</Th>
                    <Th>Situação</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {e.installments.map((i) => (
                    <tr key={i.id} className="border-t border-slate-100">
                      <td className="px-4 py-2">{i.number}</td>
                      <td className={cx('px-4 py-2 whitespace-nowrap', i.display_status === 'vencido' && 'text-red-700 font-semibold')}>
                        {formatDateBR(i.due_date)}
                        {i.days_overdue > 0 && <span className="block text-[10px]">{i.days_overdue} dia(s) em atraso</span>}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatBRL(i.original_amount)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-600">
                        {i.discount ? `−${formatBRL(i.discount)} ` : ''}
                        {i.interest + i.penalty + i.additional ? `+${formatBRL(i.interest + i.penalty + i.additional)}` : ''}
                        {!i.discount && !(i.interest + i.penalty + i.additional) && '—'}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatBRL(i.updated_amount)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-emerald-700">{formatBRL(i.settled_amount)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatBRL(i.pending_amount)}</td>
                      <td className="px-4 py-2">
                        <StatusPill s={i.display_status} type={e.entry_type} />
                      </td>
                      <td className="px-4 py-2 text-right">
                        {e.status === 'ativo' && ['aberto', 'parcial'].includes(i.status) && financeCan.operate(user) && (
                          <Button size="sm" variant="ghost" onClick={() => setAdj(i)}>
                            Encargos
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tab === 'pagamentos' &&
            (e.payments.length === 0 ? (
              <EmptyState title={`Nenhum ${isPay ? 'pagamento' : 'recebimento'} registrado`} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <Th>Movimentação</Th>
                      <Th>Data</Th>
                      <Th>Conta</Th>
                      <Th>Parc.</Th>
                      <Th right>Valor</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {e.payments.map((p) => (
                      <tr key={p.allocation_id} className={cx('border-t border-slate-100', (p.reversed || p.is_reversal) && 'text-slate-400')}>
                        <td className="px-4 py-2">
                          <p className="font-semibold">{p.transaction_number}</p>
                          <p className="text-[11px]">
                            {p.is_reversal ? 'Estorno' : p.method || '—'} • {p.performed_by_name}
                            {p.reversed && ' • estornado'}
                          </p>
                        </td>
                        <td className="px-4 py-2">{formatDateBR(p.transaction_date)}</td>
                        <td className="px-4 py-2">{p.account_name}</td>
                        <td className="px-4 py-2">{p.installment_number}</td>
                        <td className="px-4 py-2 text-right">
                          <Amount v={p.amount} />
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {!isPay && !p.is_reversal && (
                            <Button size="sm" variant="ghost" icon={Receipt} onClick={async () => window.open(URL.createObjectURL(await fetchBlob(`/finance/transactions/${p.transaction_id}/receipt`)), '_blank')} title="Comprovante" aria-label="Comprovante" />
                          )}
                          {e.allowed.reverse && !p.reversed && !p.is_reversal && (
                            <Button size="sm" variant="ghost" icon={Undo2} className="text-red-700" onClick={() => (setReverse(p.transaction_id), setReason(''))} title="Estornar" aria-label="Estornar" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          {tab === 'anexos' && (
            <div className="p-4 space-y-2">
              {financeCan.operate(user) && (
                <label className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer">
                  <Paperclip className="w-4 h-4" /> Anexar nota, boleto ou comprovante
                  <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,text/xml,application/xml" className="hidden" onChange={(ev) => (upload(ev.target.files?.[0]), (ev.target.value = ''))} />
                </label>
              )}
              {e.attachments.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 text-sm border border-slate-200 rounded-lg px-3 py-2">
                  <span className="truncate">
                    {a.name} <span className="text-[11px] text-slate-400">{Math.round(a.size / 1024)} KB • {a.uploaded_by_name} • {formatDateBR(a.created_at)}</span>
                  </span>
                  <Button size="sm" variant="ghost" icon={Download} onClick={async () => saveBlob(await fetchBlob(`/finance/attachments/${a.id}?download=1`), a.name)} aria-label="Baixar" />
                </div>
              ))}
              {!e.attachments.length && <p className="text-sm text-slate-500">Nenhum anexo.</p>}
            </div>
          )}
          {tab === 'historico' && (
            <ol className="p-4 space-y-3">
              {e.history.map((h) => (
                <li key={h.id} className="text-sm">
                  <p className="font-semibold text-slate-800 capitalize">{h.action.replace(/_/g, ' ')}</p>
                  {h.data && <p className="text-[11px] text-slate-500 break-all">{h.data.slice(0, 220)}</p>}
                  <p className="text-[11px] text-slate-400">
                    {formatDateTimeBR(h.created_at)} • {h.user_name}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <aside className="space-y-4">
          <Card title="Dados">
            <dl className="text-sm space-y-1.5">
              {[
                ['Favorecido/cliente', e.party_name],
                ['CPF/CNPJ', formatDocument(e.party_document)],
                ['Categoria', e.category_name],
                ['Origem', e.origin ? ORIGIN_LABELS[e.origin] : null],
                ['Gerado por', SOURCE_LABELS[e.source_type] + (e.source_ref ? ` — ${e.source_ref}` : '')],
                ['Documento', e.document_ref],
                ['Emissão', formatDateBR(e.issue_date)],
                ['Competência', formatDateBR(e.competence_date)],
                ['Forma prevista', e.payment_method],
                ['Conta prevista', e.planned_account_name],
                ['Lançado por', e.created_by_name],
              ].map(([l, v]) => (
                <div key={l as string} className="flex justify-between gap-3">
                  <dt className="text-slate-500">{l}</dt>
                  <dd className="text-right font-medium">{v || '—'}</dd>
                </div>
              ))}
            </dl>
            {e.cost_centers.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100 text-sm">
                <p className="text-xs font-bold text-slate-500 mb-1">Centros de custo</p>
                {e.cost_centers.map((c) => (
                  <p key={c.cost_center_id} className="flex justify-between">
                    <span>{c.cost_center_name}</span>
                    <span className="tabular-nums">{formatBRL(c.amount)}</span>
                  </p>
                ))}
              </div>
            )}
            {e.quotation_id && (
              <p className="mt-3 text-xs text-slate-500 flex items-center gap-1">
                <Info className="w-3.5 h-3.5" /> Vinculado ao orçamento de origem ({e.source_ref}).
              </p>
            )}
            {e.notes && <p className="mt-3 text-xs text-slate-600 whitespace-pre-line">{e.notes}</p>}
          </Card>
          {e.allowed.cancel && (
            <Button icon={Ban} className="w-full text-red-700" onClick={() => (setAction('cancelar'), setReason(''))}>
              Cancelar lançamento
            </Button>
          )}
        </aside>
      </div>

      {settleOpen && <SettleModal entry={e} accounts={accounts} onClose={() => setSettleOpen(false)} onDone={(x) => (setSettleOpen(false), setData(x), reloadCtx())} />}

      <AdjustModal inst={adj} onClose={() => setAdj(null)} onDone={(x) => (setAdj(null), setData(x))} />

      <Modal
        open={!!action}
        onClose={() => setAction(null)}
        title={action === 'cancelar' ? 'Cancelar lançamento' : 'Rejeitar lançamento'}
        size="sm"
        footer={
          <>
            <Button onClick={() => setAction(null)}>Voltar</Button>
            <Button variant="danger" loading={busy} onClick={async () => (await run(() => api.post(`/finance/entry/${id}/action/${action}`, { reason }), action === 'cancelar' ? 'Cancelado.' : 'Devolvido para rascunho.')) && setAction(null)}>
              Confirmar
            </Button>
          </>
        }
      >
        <Field label="Motivo" required>
          <Textarea value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={reverse !== null}
        onClose={() => setReverse(null)}
        title="Estornar movimentação"
        size="sm"
        footer={
          <>
            <Button onClick={() => setReverse(null)}>Voltar</Button>
            <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={async () => (await run(() => api.post(`/finance/transactions/${reverse}/reverse`, { reason }), 'Estorno registrado.')) && setReverse(null)}>
              Estornar
            </Button>
          </>
        }
      >
        <Notice className="mb-3">Cria uma movimentação inversa na conta e devolve o saldo à parcela. O registro original é mantido.</Notice>
        <Field label="Motivo do estorno" required>
          <Textarea value={reason} onChange={(ev) => setReason(ev.target.value)} />
        </Field>
      </Modal>
    </div>
  );
};

const SettleModal: React.FC<{ entry: EntryDetail; accounts: { id: number; name: string; balance: number; active: boolean }[]; onClose: () => void; onDone: (e: EntryDetail) => void }> = ({ entry, onClose, onDone }) => {
  const toast = useToast();
  const open = entry.installments.filter((i) => ['aberto', 'parcial'].includes(i.status));
  const [account, setAccount] = useState<number | null>(entry.planned_account_id);
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState(entry.payment_method || '');
  const [notes, setNotes] = useState('');
  const [amounts, setAmounts] = useState<Record<number, number>>(() => Object.fromEntries(open.map((i, k) => [i.id, k === 0 ? i.pending_amount : 0])));
  const [extra, setExtra] = useState<Record<number, { discount: number; interest: number; penalty: number }>>({});
  const [key] = useState(newIdempotencyKey);
  const [busy, setBusy] = useState(false);
  const isPay = entry.entry_type === 'pagar';
  const pendingWith = (i: Installment) => i.pending_amount - (extra[i.id]?.discount || 0) + (extra[i.id]?.interest || 0) + (extra[i.id]?.penalty || 0);
  const total = Object.values(amounts).reduce((a, v) => a + v, 0);
  const over = open.find((i) => (amounts[i.id] || 0) > pendingWith(i));

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ entry: EntryDetail; duplicate: boolean }>(`/finance/entry/${entry.id}/settle`, {
        account_id: account,
        date,
        method,
        notes,
        idempotency_key: key,
        allocations: Object.entries(amounts).filter(([, v]) => v > 0).map(([k, v]) => ({ installment_id: Number(k), amount: v })),
        adjustments: Object.entries(extra).map(([k, v]) => ({ installment_id: Number(k), ...v })),
      });
      toast(r.duplicate ? 'info' : 'success', r.duplicate ? 'Esta operação já tinha sido registrada (reenvio ignorado).' : `${isPay ? 'Pagamento' : 'Recebimento'} registrado.`);
      onDone(r.entry);
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${isPay ? 'Registrar pagamento' : 'Registrar recebimento'} — ${entry.entry_number}`}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={busy} disabled={!account || total <= 0 || !!over} onClick={submit}>
            Confirmar {formatBRL(total)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label={isPay ? 'Conta de saída' : 'Conta de entrada'} required>
            <AccountSelect value={account} onChange={setAccount} />
          </Field>
          <Field label="Data efetiva" required>
            <Input type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Forma">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">—</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[620px]">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="text-left py-1">Parcela</th>
                <th className="text-right py-1">Pendente</th>
                <th className="text-right py-1">Desconto</th>
                <th className="text-right py-1">Juros</th>
                <th className="text-right py-1">Multa</th>
                <th className="text-right py-1">Valor desta baixa</th>
              </tr>
            </thead>
            <tbody>
              {open.map((i) => (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="py-1.5">
                    {i.number}ª • {formatDateBR(i.due_date)}
                    {i.days_overdue > 0 && <span className="block text-[10px] text-red-700">{i.days_overdue} dia(s) em atraso</span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{formatBRL(pendingWith(i))}</td>
                  {(['discount', 'interest', 'penalty'] as const).map((k) => (
                    <td key={k} className="py-1.5 pl-2 w-28">
                      <MoneyInput value={extra[i.id]?.[k] || 0} onChange={(v) => setExtra({ ...extra, [i.id]: { ...{ discount: 0, interest: 0, penalty: 0 }, ...extra[i.id], [k]: v ?? 0 } })} />
                    </td>
                  ))}
                  <td className="py-1.5 pl-2 w-36">
                    <MoneyInput value={amounts[i.id] || 0} onChange={(v) => setAmounts({ ...amounts, [i.id]: v ?? 0 })} error={(amounts[i.id] || 0) > pendingWith(i) ? 'acima' : undefined} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setAmounts(Object.fromEntries(open.map((i) => [i.id, pendingWith(i)])))}>
            Liquidar tudo
          </Button>
          <Button size="sm" onClick={() => setAmounts(Object.fromEntries(open.map((i, k) => [i.id, k === 0 ? pendingWith(i) : 0])))}>
            Só a próxima parcela
          </Button>
        </div>
        {over && <Notice kind="danger">Parcela {over.number}: valor acima do pendente. Pagamento a maior/adiantamento não é permitido.</Notice>}
        <Field label="Observação">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <p className="text-[11px] text-slate-500">A confirmação gera a movimentação na conta e atualiza o saldo na mesma operação. Clique duplo ou reenvio não duplica.</p>
      </div>
    </Modal>
  );
};

const AdjustModal: React.FC<{ inst: Installment | null; onClose: () => void; onDone: (e: EntryDetail) => void }> = ({ inst, onClose, onDone }) => {
  const toast = useToast();
  const [v, setV] = useState({ discount: 0, interest: 0, penalty: 0, additional: 0, reason: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (inst) setV({ discount: inst.discount, interest: inst.interest, penalty: inst.penalty, additional: inst.additional, reason: '' });
  }, [inst]);
  if (!inst) return null;
  const upd = inst.original_amount - v.discount + v.interest + v.penalty + v.additional;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Encargos e desconto — parcela ${inst.number}`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                onDone(await api.put<EntryDetail>(`/finance/installment/${inst.id}/adjust`, { ...v, row_version: inst.row_version }));
                toast('success', 'Parcela ajustada.');
              } catch (e) {
                toast('error', (e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Desconto autorizado">
          <MoneyInput value={v.discount} onChange={(x) => setV({ ...v, discount: x ?? 0 })} />
        </Field>
        <Field label="Juros">
          <MoneyInput value={v.interest} onChange={(x) => setV({ ...v, interest: x ?? 0 })} />
        </Field>
        <Field label="Multa">
          <MoneyInput value={v.penalty} onChange={(x) => setV({ ...v, penalty: x ?? 0 })} />
        </Field>
        <Field label="Acréscimos">
          <MoneyInput value={v.additional} onChange={(x) => setV({ ...v, additional: x ?? 0 })} />
        </Field>
        <p className="col-span-2 text-sm">
          Valor atualizado: <b className="tabular-nums">{formatBRL(upd)}</b> (original {formatBRL(inst.original_amount)}, já liquidado {formatBRL(inst.settled_amount)})
        </p>
        <Field label="Motivo" required className="col-span-2">
          <Textarea value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
};

