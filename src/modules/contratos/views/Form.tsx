/**
 * Cadastro/edição do contrato (somente rascunho), em seções: identificação, cliente, itens,
 * condições comerciais e resumo com cronograma previsto. Erros do servidor não apagam o que foi digitado.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, Save, UserCog, RefreshCw, Info, X, Search, ChevronDown } from 'lucide-react';
import { Customer } from '../../../../shared/orcamentos/types';
import { StockItemRow } from '../../../../shared/estoque/types';
import {
  BILLING_FREQUENCY_LABELS,
  BILLING_TIMING_LABELS,
  BillingFrequency,
  CONTRACT_TYPE_LABELS,
  ContractDetail,
  ContractType,
  PERIOD_NOUN,
  RESPONSIBILITY_LABELS,
  RESPONSIBILITY_TOPICS,
  Responsibility,
} from '../../../../shared/contratos/types';
import { buildSchedule, computeTotals, contractCan, lineTotal } from '../../../../shared/contratos/rules';
import { addMonthsISO } from '../../../../shared/financeiro/rules';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { formatDateBR, todayISO, addDaysISO } from '../../../../shared/orcamentos/dates';
import { formatDocument, formatPhone } from '../../../../shared/orcamentos/validators';
import { api, ApiError, qs } from '../../orcamentos/api';
import { Button, Card, Checkbox, ErrorState, Field, Input, Loading, MoneyInput, Notice, PageHeader, Select, Textarea, cx, useDebounced, useToast } from '../../orcamentos/ui';
import { ItemSearch, fmtQty } from '../../estoque/components';
import { useCtr } from '../context';
import { KV } from '../components';

interface Line {
  key: string;
  id?: number;
  item_id: number;
  item_code: string;
  description: string;
  unit: string;
  tracking: 'quantidade' | 'individual';
  rental_enabled: boolean;
  sale_enabled: boolean;
  asset_id: number | null;
  asset_tag: string | null;
  quantity: string;
  modality: 'locacao' | 'venda';
  unit_price: number;
  discount_amount: number;
  notes: string;
  conditions: string;
  prices?: Partial<Record<'diaria' | 'semanal' | 'mensal' | 'personalizado' | 'venda', number | null>>;
  /** último valor digitado em cada modalidade (volta ao alternar) */
  typed?: Partial<Record<'locacao' | 'venda', number>>;
}
let seq = 0;
const k = () => `l${++seq}`;

export const pricesOf = (i: StockItemRow): Line['prices'] => ({ diaria: i.daily_rental_price, semanal: i.weekly_rental_price, mensal: i.monthly_rental_price, personalizado: i.custom_rental_price, venda: i.sale_price });

export const priceFor = (prices: Line['prices'], modality: 'locacao' | 'venda', freq: BillingFrequency) => {
  if (!prices) return 0;
  if (modality === 'venda') return prices.venda || 0;
  if (freq === 'quinzenal') return prices.mensal ? Math.round(prices.mensal / 2) : 0;
  if (freq === 'unico') return prices.mensal || 0;
  return prices[freq as 'diaria'] || 0;
};

const emptyForm = (userId: number, dueDays: number) => ({
  contract_type: 'locacao' as ContractType,
  customer_id: null as number | null,
  customer_contact: '',
  start_date: todayISO(),
  end_date: addMonthsISO(todayISO(), 1) as string | null,
  responsible_user_id: userId,
  approver_user_id: null as number | null,
  delivery_address: '',
  internal_notes: '',
  billing_frequency: 'mensal' as BillingFrequency,
  custom_period_days: 10 as number | null,
  billing_timing: 'antecipado' as 'antecipado' | 'postecipado',
  due_day: null as number | null,
  due_days_after: dueDays,
  proportional_last: true,
  single_charge: true,
  general_discount: 0,
  freight_delivery: 0,
  freight_pickup: 0,
  other_fees: 0,
  other_fees_description: '',
  deposit_amount: 0,
  late_fee_percent: 2,
  interest_month_percent: 1,
  adjustment_index: '',
  adjustment_period_months: null as number | null,
  responsibilities: { transporte: 'a_combinar', combustivel: 'cliente', manutencao: 'locadora', avarias: 'cliente' } as Record<string, Responsibility>,
  payment_terms: '',
  special_conditions: '',
  installments_count: 1,
  first_due_date: null as string | null,
});

type FormState = ReturnType<typeof emptyForm>;

/** Todos os clientes ativos, em páginas de 100 (limite da API). */
const loadAllCustomers = async () => {
  const all: Customer[] = [];
  for (;;) {
    const r = await api.get<{ total: number; rows: Customer[] }>(`/customers${qs({ active: 'true', limit: 100, offset: all.length })}`);
    all.push(...r.rows);
    if (!r.rows.length || all.length >= r.total) return all;
  }
};

/** Seleção do cliente a partir do cadastro existente (não cria cliente aqui): lista suspensa com pesquisa. */
const CustomerPicker: React.FC<{ value: Customer | null; onChange: (c: Customer | null) => void; error?: string }> = ({ value, onChange, error }) => {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<Customer[] | null>(null);
  const [found, setFound] = useState<Customer[] | null>(null);
  const dq = useDebounced(q, 250);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || all) return;
    loadAllCustomers().then(setAll).catch(() => setAll([]));
  }, [open, all]);
  useEffect(() => {
    if (!dq.trim()) return setFound(null);
    api.get<{ rows: Customer[] }>(`/customers${qs({ q: dq, active: 'true', limit: 100 })}`).then((r) => setFound(r.rows)).catch(() => setFound([]));
  }, [dq]);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const rows = q.trim() ? found : all;
  if (value)
    return (
      <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50">
        <div className="text-sm">
          <p className="font-semibold text-slate-800">{value.name}</p>
          <p className="text-xs text-slate-500">{value.document ? formatDocument(value.document) : 'Sem CPF/CNPJ no cadastro'}</p>
        </div>
        <Button size="sm" variant="ghost" icon={X} onClick={() => onChange(null)}>
          Trocar
        </Button>
      </div>
    );
  return (
    <div ref={ref} className="relative">
      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
      <Input
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        placeholder="Selecione ou pesquise por nome, CPF/CNPJ ou telefone"
        className="pl-9 pr-9"
        error={error}
        aria-label="Cliente"
        aria-expanded={open}
      />
      <button type="button" onClick={() => setOpen((o) => !o)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600" aria-label="Mostrar todos os clientes">
        <ChevronDown className={cx('w-4 h-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl max-h-72 overflow-y-auto">
          {rows === null && <p className="px-3 py-3 text-sm text-slate-500">Carregando...</p>}
          {rows?.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">Nenhum cliente ativo encontrado.</p>}
          {rows?.map((c) => (
            <button key={c.id} type="button" onClick={() => (onChange(c), setQ(''), setOpen(false))} className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-50">
              <span className="block text-sm font-semibold text-slate-800">{c.name}</span>
              <span className="text-[11px] text-slate-500">
                {c.document ? formatDocument(c.document) : 'sem documento'} {c.city ? `• ${c.city}/${c.state}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const PAYMENT_TERMS = ['PIX', 'Boleto bancário', 'Transferência / depósito bancário', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro'];

/** Condição de pagamento escolhida na lista; "Outra" libera texto livre. */
const PaymentTermsSelect: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const [otherPicked, setOther] = useState(false);
  // contrato carregado depois da montagem com texto fora da lista também conta como "Outra"
  const other = otherPicked || (!!value && !PAYMENT_TERMS.includes(value));
  return (
    <div className="space-y-2">
      <Select
        value={other ? '__outra' : value}
        onChange={(e) => {
          const v = e.target.value;
          setOther(v === '__outra');
          onChange(v === '__outra' ? '' : v);
        }}
        aria-label="Condição de pagamento"
      >
        <option value="">Selecione...</option>
        {PAYMENT_TERMS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
        <option value="__outra">Outra (digitar)</option>
      </Select>
      {other && <Input autoFocus value={value} onChange={(e) => onChange(e.target.value)} placeholder="Descreva a condição de pagamento" aria-label="Outra condição de pagamento" />}
    </div>
  );
};

/** Patrimônios do item com a situação no período (mesma regra do Estoque). */
export const AssetPicker: React.FC<{ line: Pick<Line, 'item_id' | 'asset_id' | 'asset_tag'>; from: string; to: string; taken: number[]; onPick: (id: number | null, tag: string | null) => void }> = ({ line, from, to, taken, onPick }) => {
  const [rows, setRows] = useState<{ asset_id: number; asset_tag: string; available_in_period: boolean; reason: string | null; location_name: string | null }[] | null>(null);
  useEffect(() => {
    setRows(null);
    api
      .get<{ rows: any[] }>(`/contracts/availability${qs({ item_id: line.item_id, from, to })}`)
      .then((r) => setRows(r.rows.filter((x) => x.asset_id)))
      .catch(() => setRows([]));
  }, [line.item_id, from, to]);
  return (
    <Select value={line.asset_id ?? ''} onChange={(e) => {
      const id = e.target.value ? Number(e.target.value) : null;
      onPick(id, rows?.find((r) => r.asset_id === id)?.asset_tag || null);
    }} aria-label="Patrimônio" className="min-w-[180px]">
      <option value="">{rows === null ? 'Carregando...' : 'Definir depois (antes da reserva)'}</option>
      {line.asset_id && !rows?.some((r) => r.asset_id === line.asset_id) && <option value={line.asset_id}>{line.asset_tag}</option>}
      {rows?.map((r) => (
        <option key={r.asset_id} value={r.asset_id} disabled={(!r.available_in_period && r.asset_id !== line.asset_id) || (taken.includes(r.asset_id) && r.asset_id !== line.asset_id)}>
          {r.asset_tag} — {taken.includes(r.asset_id) && r.asset_id !== line.asset_id ? 'já neste contrato' : r.available_in_period ? `disponível${r.location_name ? ` (${r.location_name})` : ''}` : r.reason}
        </option>
      ))}
    </Select>
  );
};

export const ContratoForm: React.FC<{ id?: number }> = ({ id }) => {
  const { user, users, settings, navigate, openCustomers } = useCtr();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => emptyForm(user.id, settings.default_due_days_after));
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [meta, setMeta] = useState<{ number: string; created_at: string; quotation_number: string | null; source: string; row_version: number } | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [freeQty, setFreeQty] = useState<Record<number, number | null>>({});
  const set = <K extends keyof FormState>(key: K, v: FormState[K]) => setForm((f) => ({ ...f, [key]: v }));
  const isRental = form.contract_type === 'locacao';

  useEffect(() => {
    if (!id) return;
    api
      .get<ContractDetail>(`/contracts/${id}`)
      .then(async (c) => {
        if (c.status !== 'rascunho') {
          setLoadError('Somente contratos em rascunho são editados. Alterações em contratos formalizados são feitas por aditivo.');
          return;
        }
        const { items, ...rest } = c;
        setForm({ ...emptyForm(user.id, 0), ...(Object.fromEntries(Object.keys(emptyForm(user.id, 0)).map((key) => [key, (rest as any)[key] ?? (emptyForm(user.id, 0) as any)[key]])) as FormState) });
        setMeta({ number: c.contract_number, created_at: c.created_at, quotation_number: c.quotation_number, source: c.source, row_version: c.row_version });
        const cu = await api.get<Customer>(`/customers/${c.customer_id}`).catch(() => null);
        setCustomer(cu);
        // preços de tabela e permissões (locação/venda) vêm do cadastro; sem acesso ao Estoque, libera e o servidor valida
        const cat = new Map<number, StockItemRow>();
        await Promise.all([...new Set(items.map((i) => i.item_id))].map((iid) => api.get<StockItemRow>(`/stock/items/${iid}`).then((r) => cat.set(iid, r)).catch(() => {})));
        setLines(
          items.map((i) => {
            const ci = cat.get(i.item_id);
            return {
              key: k(), id: i.id, item_id: i.item_id, item_code: i.item_code, description: i.description, unit: i.unit, tracking: i.tracking, rental_enabled: ci ? ci.rental_enabled : true, sale_enabled: ci ? ci.sale_enabled : true,
              asset_id: i.asset_id, asset_tag: i.asset_tag, quantity: String(i.quantity), modality: i.modality, unit_price: i.unit_price, discount_amount: i.discount_amount, notes: i.notes || '', conditions: i.conditions || '',
              prices: ci && pricesOf(ci),
            };
          })
        );
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const addItem = (i: StockItemRow) => {
    const modality: 'locacao' | 'venda' = isRental && i.rental_enabled ? 'locacao' : 'venda';
    if (modality === 'venda' && !i.sale_enabled) return toast('error', `${i.internal_code} não está habilitado para ${isRental ? 'locação nem para venda' : 'venda'}.`);
    if (modality === 'venda' && i.tracking === 'individual') return toast('error', `${i.internal_code} é patrimônio individual: a venda exige baixa patrimonial no Estoque.`);
    const prices = pricesOf(i);
    setLines((ls) => [
      ...ls,
      { key: k(), item_id: i.id, item_code: i.internal_code, description: i.description, unit: i.unit, tracking: i.tracking, rental_enabled: i.rental_enabled, sale_enabled: i.sale_enabled, asset_id: null, asset_tag: null, quantity: '1', modality, unit_price: priceFor(prices, modality, form.billing_frequency), discount_amount: 0, notes: '', conditions: '', prices },
    ]);
  };
  const upd = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  /** Por que o item não pode ir para a modalidade (null = pode). Mesmas regras do servidor. */
  const blockedReason = (l: Line, m: 'locacao' | 'venda') => {
    if (m === 'locacao') return l.rental_enabled ? null : 'item não habilitado para locação no cadastro.';
    if (l.tracking === 'individual') return 'equipamento com patrimônio individual; a venda exige baixa patrimonial no Estoque.';
    return l.sale_enabled ? null : 'item não habilitado para venda no cadastro (Estoque › item › "Disponível para venda").';
  };
  // trocar a modalidade troca o preço: preço de tabela da nova modalidade, ou o último digitado nela
  const switchModality = (l: Line, m: 'locacao' | 'venda') => {
    if (m === l.modality) return;
    const typed = { ...l.typed, [l.modality]: l.unit_price };
    upd(l.key, { modality: m, typed, unit_price: typed[m] ?? (priceFor(l.prices, m, form.billing_frequency) || 0) });
  };

  const totalsItems = lines.map((l) => ({ quantity: l.tracking === 'individual' ? 1 : Number(l.quantity) || 0, unit_price: l.unit_price, discount_amount: l.discount_amount, modality: l.modality }));
  const terms = { ...form, end_date: isRental ? form.end_date : null, billing_frequency: isRental ? form.billing_frequency : ('unico' as BillingFrequency) };
  const totals = useMemo(() => computeTotals(totalsItems, terms), [JSON.stringify(totalsItems), JSON.stringify(terms)]);
  const schedule = useMemo(() => {
    try {
      return buildSchedule({ ...terms, period_amount: totals.period_amount, sale_total: totals.sale_total, horizon_end: terms.end_date ? undefined : addDaysISO(form.start_date, 90) });
    } catch {
      return [];
    }
  }, [JSON.stringify(terms), totals.period_amount, totals.sale_total]);

  const checkAvailability = async () => {
    const out: Record<number, number | null> = {};
    for (const l of lines.filter((x) => x.tracking === 'quantidade' && x.modality === 'locacao')) {
      const r = await api.get<{ rows: any[] }>(`/contracts/availability${qs({ item_id: l.item_id, from: form.start_date, to: form.end_date || addDaysISO(form.start_date, 365) })}`).catch(() => null);
      out[l.item_id] = r?.rows[0]?.free_qty ?? null;
    }
    setFreeQty(out);
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    const body = {
      ...terms,
      customer_id: customer?.id,
      row_version: meta?.row_version,
      items: lines.map((l) => ({ id: l.id, item_id: l.item_id, asset_id: l.asset_id, quantity: l.tracking === 'individual' ? 1 : Number(l.quantity), modality: l.modality, unit_price: l.unit_price, discount_amount: l.discount_amount, notes: l.notes, conditions: l.conditions })),
    };
    try {
      const c = id ? await api.put<{ id: number }>(`/contracts/${id}`, body) : await api.post<{ id: number }>('/contracts', body);
      toast('success', id ? 'Rascunho salvo.' : 'Contrato criado em rascunho.');
      navigate({ page: 'detalhe', id: c.id });
    } catch (e) {
      const err = e as ApiError;
      setErrors(err.fields || {});
      toast('error', err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (loadError) return <ErrorState message={loadError} onRetry={id ? () => navigate({ page: 'detalhe', id }) : undefined} />;
  const approvers = users.filter((u) => u.role === 'admin' || u.role === 'gestor');
  const noun = PERIOD_NOUN[terms.billing_frequency];

  return (
    <div>
      <PageHeader title={id ? `Editar ${meta?.number}` : 'Novo contrato'} subtitle="O contrato nasce em rascunho: nada é reservado no estoque nem cobrado até a aprovação, a assinatura e a ativação." onBack={() => (id ? navigate({ page: 'detalhe', id }) : navigate({ page: 'painel' }))} />
      {Object.keys(errors).length > 0 && <Notice kind="danger" className="mb-4">Revise os campos destacados. {Object.entries(errors).filter(([key]) => key.startsWith('items')).map(([, v]) => v).join(' ')}</Notice>}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <Card title="1. Identificação">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label="Número do contrato">
                <Input value={meta?.number || 'Gerado automaticamente ao salvar'} disabled />
              </Field>
              <Field label="Tipo de contrato" required hint={isRental ? "Na locação você também pode vender itens: escolha Venda no item." : undefined}>
                <Select value={form.contract_type} disabled={!!id} onChange={(e) => (set('contract_type', e.target.value as ContractType), setLines((ls) => ls.map((l) => ({ ...l, modality: e.target.value === 'venda' ? 'venda' : l.rental_enabled ? 'locacao' : 'venda' }))))}>
                  {(['locacao', 'venda'] as ContractType[]).map((t) => (
                    <option key={t} value={t}>
                      {CONTRACT_TYPE_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Data de criação">
                <Input value={formatDateBR(meta?.created_at || todayISO())} disabled />
              </Field>
              <Field label={isRental ? 'Início da vigência' : 'Data da venda'} required error={errors.start_date}>
                <Input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} error={errors.start_date} />
              </Field>
              {isRental && (
                <Field label="Término previsto (dia da devolução)" error={errors.end_date} hint={form.end_date ? undefined : 'Prazo indeterminado: cobranças geradas até o horizonte configurado.'}>
                  <Input type="date" value={form.end_date || ''} disabled={form.end_date === null} onChange={(e) => set('end_date', e.target.value)} error={errors.end_date} />
                  <div className="mt-1.5">
                    <Checkbox checked={form.end_date === null} onChange={(v) => set('end_date', v ? null : addMonthsISO(form.start_date, 1))} label="Prazo indeterminado" />
                  </div>
                </Field>
              )}
              <Field label="Origem">
                <Input value={meta?.source === 'orcamento' ? `Orçamento ${meta.quotation_number || ''}` : 'Cadastro manual'} disabled />
              </Field>
              <Field label="Responsável comercial" required error={errors.responsible_user_id}>
                <Select value={form.responsible_user_id} disabled={user.role === 'vendedor'} onChange={(e) => set('responsible_user_id', Number(e.target.value))}>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Responsável pela aprovação" error={errors.approver_user_id} hint="Opcional: sem indicação, qualquer gestor aprova.">
                <Select value={form.approver_user_id ?? ''} onChange={(e) => set('approver_user_id', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Qualquer gestor/administrador</option>
                  {approvers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Observações internas" className="sm:col-span-2 lg:col-span-3" hint="Não aparecem no documento do contrato.">
                <Textarea value={form.internal_notes} onChange={(e) => set('internal_notes', e.target.value)} rows={2} />
              </Field>
            </div>
          </Card>

          <Card
            title="2. Cliente"
            actions={
              customer && openCustomers ? (
                <Button size="sm" variant="ghost" icon={UserCog} onClick={openCustomers}>
                  Atualizar cadastro
                </Button>
              ) : undefined
            }
          >
            <CustomerPicker value={customer} onChange={(c) => (setCustomer(c), set('customer_id', c?.id ?? null))} error={errors.customer_id} />
            {customer && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 mt-3">
                <div>
                  <KV label={customer.person_type === 'PJ' ? 'CNPJ' : 'CPF'}>{customer.document ? formatDocument(customer.document) : '—'}</KV>
                  <KV label="Inscrição estadual">{customer.state_registration || '—'}</KV>
                  <KV label="Endereço">{[customer.street, customer.street_number, customer.neighborhood].filter(Boolean).join(', ') || '—'}</KV>
                  <KV label="Cidade/UF">{customer.city ? `${customer.city}/${customer.state}` : '—'}</KV>
                </div>
                <div>
                  <KV label="Telefone">{customer.phone ? formatPhone(customer.phone) : customer.whatsapp ? formatPhone(customer.whatsapp) : '—'}</KV>
                  <KV label="E-mail">{customer.email || '—'}</KV>
                  <Field label="Pessoa de contato" className="mt-2">
                    <Input value={form.customer_contact} onChange={(e) => set('customer_contact', e.target.value)} placeholder="Nome de quem responde pelo contrato" />
                  </Field>
                </div>
                <Field label="Local de entrega / obra" className="md:col-span-2 mt-2">
                  <Input value={form.delivery_address} onChange={(e) => set('delivery_address', e.target.value)} placeholder="Endereço da obra (se diferente do cadastro)" />
                </Field>
              </div>
            )}
          </Card>

          <Card
            title="3. Itens contratados"
            actions={
              isRental && lines.some((l) => l.tracking === 'quantidade' && l.modality === 'locacao') ? (
                <Button size="sm" icon={RefreshCw} onClick={checkAvailability}>
                  Verificar disponibilidade
                </Button>
              ) : undefined
            }
          >
            <ItemSearch onPick={addItem} filter={isRental ? {} : { tracking: 'quantidade' }} placeholder="Adicionar produto ou equipamento (código, nome ou código de barras)" />
            {errors.items && <p className="text-xs text-red-600 mt-1">{errors.items}</p>}
            {lines.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">Nenhum item. Pesquise acima para incluir.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {lines.map((l, idx) => {
                  const err = errors[`items.${idx}`];
                  const free = freeQty[l.item_id];
                  return (
                    <div key={l.key} className={cx('rounded-lg border p-3', err ? 'border-red-300 bg-red-50/40' : 'border-slate-200')}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">
                            <span className="font-mono text-xs text-slate-500 mr-1.5">{l.item_code}</span>
                            {l.description}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {l.tracking === 'individual' ? 'Equipamento individual (patrimônio)' : `Controlado por quantidade (${l.unit})`}
                            {free !== undefined && l.tracking === 'quantidade' && l.modality === 'locacao' && (
                              <span className={cx('ml-2 font-semibold', free !== null && free >= (Number(l.quantity) || 0) ? 'text-emerald-700' : 'text-red-700')}>
                                {free === null ? 'Disponibilidade indisponível' : `Livre no período: ${fmtQty(free, l.unit)}`}
                              </span>
                            )}
                          </p>
                          {isRental && l.modality === 'locacao' && blockedReason(l, 'venda') && <p className="text-[11px] text-slate-500 mt-0.5">Venda indisponível: {blockedReason(l, 'venda')}</p>}
                          {l.modality === 'venda' && <p className="text-[11px] font-semibold text-emerald-700 mt-0.5">Venda: cobrado uma única vez e baixado do estoque na entrega (não volta na devolução).</p>}
                          {err && <p className="text-xs text-red-700 mt-0.5">{err}</p>}
                        </div>
                        <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remover item" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} />
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-2 items-end">
                        {l.tracking === 'individual' ? (
                          <Field label="Patrimônio / série" className="col-span-2">
                            <AssetPicker line={l} from={form.start_date} to={form.end_date || addDaysISO(form.start_date, 365)} taken={lines.filter((x) => x.key !== l.key && x.asset_id).map((x) => x.asset_id!)} onPick={(aid, tag) => upd(l.key, { asset_id: aid, asset_tag: tag })} />
                          </Field>
                        ) : (
                          <Field label={`Quantidade (${l.unit})`}>
                            <Input type="number" min={0} step="any" value={l.quantity} onChange={(e) => upd(l.key, { quantity: e.target.value })} />
                          </Field>
                        )}
                        {isRental && (
                          <Field label="Modalidade" className="col-span-2 md:col-span-1">
                            <div role="group" aria-label="Modalidade do item" className="grid grid-cols-2 rounded-lg border border-slate-300 p-0.5 bg-slate-50">
                              {(['locacao', 'venda'] as const).map((m) => {
                                const why = blockedReason(l, m);
                                return (
                                  <button
                                    key={m}
                                    type="button"
                                    disabled={!!why}
                                    title={why || undefined}
                                    aria-pressed={l.modality === m}
                                    onClick={() => switchModality(l, m)}
                                    className={cx(
                                      'px-2 py-1.5 rounded-md text-xs font-semibold transition',
                                      l.modality === m ? (m === 'venda' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-[#1e3a5f] text-white shadow-xs') : 'text-slate-600 hover:bg-white',
                                      why && 'opacity-40 cursor-not-allowed hover:bg-transparent'
                                    )}
                                  >
                                    {m === 'locacao' ? 'Locação' : 'Venda'}
                                  </button>
                                );
                              })}
                            </div>
                          </Field>
                        )}
                        <Field label={l.modality === 'venda' ? 'Valor unitário' : `Valor por ${noun}`}>
                          <MoneyInput value={l.unit_price} onChange={(v) => upd(l.key, { unit_price: v ?? 0 })} />
                        </Field>
                        <Field label="Desconto (R$)">
                          <MoneyInput value={l.discount_amount} onChange={(v) => upd(l.key, { discount_amount: v ?? 0 })} />
                        </Field>
                        <div className="text-right pb-2">
                          <p className="text-[11px] text-slate-500">Total{l.modality === 'locacao' ? ` / ${noun}` : ''}</p>
                          <p className="font-bold tabular-nums">{formatBRL(lineTotal({ quantity: l.tracking === 'individual' ? 1 : Number(l.quantity) || 0, unit_price: l.unit_price, discount_amount: l.discount_amount }))}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                        <Input value={l.conditions} onChange={(e) => upd(l.key, { conditions: e.target.value })} placeholder="Condições específicas do item (aparecem no contrato)" aria-label="Condições do item" />
                        <Input value={l.notes} onChange={(e) => upd(l.key, { notes: e.target.value })} placeholder="Observações" aria-label="Observações do item" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title="4. Condições comerciais">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {isRental ? (
                <>
                  <Field label="Modalidade de cobrança" required>
                    <Select value={form.billing_frequency} onChange={(e) => set('billing_frequency', e.target.value as BillingFrequency)}>
                      {(Object.keys(BILLING_FREQUENCY_LABELS) as BillingFrequency[]).map((f) => (
                        <option key={f} value={f}>
                          {BILLING_FREQUENCY_LABELS[f]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {form.billing_frequency === 'personalizado' && (
                    <Field label="Duração do período (dias)" required error={errors.custom_period_days}>
                      <Input type="number" min={1} max={365} value={form.custom_period_days ?? ''} onChange={(e) => set('custom_period_days', Number(e.target.value) || null)} />
                    </Field>
                  )}
                  {form.billing_frequency !== 'unico' && (
                    <Field label="Momento da cobrança">
                      <Select value={form.billing_timing} onChange={(e) => set('billing_timing', e.target.value as 'antecipado')}>
                        {(['antecipado', 'postecipado'] as const).map((t) => (
                          <option key={t} value={t}>
                            {BILLING_TIMING_LABELS[t]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  <Field label="Dia fixo de vencimento" hint="Opcional (1 a 31)" error={errors.due_day}>
                    <Input type="number" min={1} max={31} value={form.due_day ?? ''} onChange={(e) => set('due_day', e.target.value ? Number(e.target.value) : null)} />
                  </Field>
                  {!form.due_day && (
                    <Field label="Vencimento (dias após a referência)" error={errors.due_days_after}>
                      <Input type="number" min={0} max={120} value={form.due_days_after} onChange={(e) => set('due_days_after', Number(e.target.value) || 0)} />
                    </Field>
                  )}
                  <div className="sm:col-span-2 lg:col-span-4">
                    <Checkbox checked={form.proportional_last} onChange={(v) => set('proportional_last', v)} label="Último período incompleto cobrado de forma proporcional aos dias" />
                  </div>
                  {form.billing_frequency !== 'unico' && (
                    <p className="sm:col-span-2 lg:col-span-4 text-xs text-slate-500">
                      {form.end_date
                        ? 'O valor total da vigência é cobrado em uma única cobrança, no início.'
                        : 'Com data de término, o valor total da vigência é cobrado em uma única cobrança, no início.'}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <Field label="Parcelas" error={errors.installments_count}>
                    <Input type="number" min={1} max={60} value={form.installments_count} onChange={(e) => set('installments_count', Number(e.target.value) || 1)} />
                  </Field>
                  <Field label="1º vencimento" error={errors.first_due_date}>
                    <Input type="date" value={form.first_due_date || ''} onChange={(e) => set('first_due_date', e.target.value || null)} />
                  </Field>
                </>
              )}
              <Field label={isRental ? `Desconto geral por ${noun}` : 'Desconto geral'} error={errors.general_discount}>
                <MoneyInput value={form.general_discount} onChange={(v) => set('general_discount', v ?? 0)} />
              </Field>
              <Field label="Frete de entrega">
                <MoneyInput value={form.freight_delivery} onChange={(v) => set('freight_delivery', v ?? 0)} />
              </Field>
              {isRental && (
                <Field label="Frete de retirada">
                  <MoneyInput value={form.freight_pickup} onChange={(v) => set('freight_pickup', v ?? 0)} />
                </Field>
              )}
              <Field label="Taxas adicionais">
                <MoneyInput value={form.other_fees} onChange={(v) => set('other_fees', v ?? 0)} />
              </Field>
              <Field label="Descrição das taxas">
                <Input value={form.other_fees_description} onChange={(e) => set('other_fees_description', e.target.value)} placeholder="Ex.: instalação, montagem" />
              </Field>
              {isRental && (
                <Field label="Caução / garantia" hint="Registrada no contrato; não entra no total.">
                  <MoneyInput value={form.deposit_amount} onChange={(v) => set('deposit_amount', v ?? 0)} />
                </Field>
              )}
              <Field label="Multa por atraso (%)" error={errors.late_fee_percent}>
                <Input type="number" min={0} max={100} step="0.01" value={form.late_fee_percent} onChange={(e) => set('late_fee_percent', Number(e.target.value))} />
              </Field>
              <Field label="Juros ao mês (%)" error={errors.interest_month_percent}>
                <Input type="number" min={0} max={100} step="0.01" value={form.interest_month_percent} onChange={(e) => set('interest_month_percent', Number(e.target.value))} />
              </Field>
              {isRental && (
                <>
                  <Field label="Índice de reajuste">
                    <Input value={form.adjustment_index} onChange={(e) => set('adjustment_index', e.target.value)} placeholder="Ex.: IGP-M, IPCA" />
                  </Field>
                  <Field label="Reajuste a cada (meses)" error={errors.adjustment_period_months}>
                    <Input type="number" min={1} max={120} value={form.adjustment_period_months ?? ''} onChange={(e) => set('adjustment_period_months', e.target.value ? Number(e.target.value) : null)} />
                  </Field>
                </>
              )}
            </div>
            {isRental && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
                {RESPONSIBILITY_TOPICS.map((t) => (
                  <Field key={t.key} label={`Responsável: ${t.label.toLowerCase()}`}>
                    <Select value={form.responsibilities[t.key]} onChange={(e) => set('responsibilities', { ...form.responsibilities, [t.key]: e.target.value as Responsibility })}>
                      {(Object.keys(RESPONSIBILITY_LABELS) as Responsibility[]).map((r) => (
                        <option key={r} value={r}>
                          {RESPONSIBILITY_LABELS[r]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ))}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <Field label="Condições de pagamento">
                <PaymentTermsSelect value={form.payment_terms} onChange={(v) => set('payment_terms', v)} />
              </Field>
              <Field label="Condições especiais negociadas">
                <Textarea rows={2} value={form.special_conditions} onChange={(e) => set('special_conditions', e.target.value)} />
              </Field>
            </div>
          </Card>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-[120px]">
          <Card title="Resumo de valores">
            {isRental && (
              <>
                <KV label={`Itens de locação / ${noun}`}>{formatBRL(totals.rental_subtotal)}</KV>
                {form.general_discount > 0 && <KV label="(−) Desconto geral">{formatBRL(form.general_discount)}</KV>}
                <KV label={terms.billing_frequency === 'unico' ? 'Valor da locação' : `Valor por ${noun}`}>
                  <b>{formatBRL(totals.period_amount)}</b>
                </KV>
              </>
            )}
            {totals.sale_subtotal > 0 && <KV label="Itens vendidos">{formatBRL(totals.sale_subtotal)}</KV>}
            {!isRental && form.general_discount > 0 && <KV label="(−) Desconto geral">{formatBRL(form.general_discount)}</KV>}
            {totals.one_time_total > 0 && <KV label="(+) Fretes e taxas">{formatBRL(totals.one_time_total)}</KV>}
            <div className="mt-2 pt-2 border-t border-slate-200">
              <KV label={totals.estimated_total === null ? 'Valor estimado' : 'Valor contratado estimado'}>
                <span className="text-base font-extrabold">{totals.estimated_total === null ? 'indeterminado' : formatBRL(totals.estimated_total)}</span>
              </KV>
              {isRental && totals.monthly_equivalent > 0 && <KV label="Equivalente mensal">{formatBRL(totals.monthly_equivalent)}</KV>}
              {form.deposit_amount > 0 && <KV label="Caução (fora do total)">{formatBRL(form.deposit_amount)}</KV>}
            </div>
          </Card>
          <Card title="Cronograma previsto">
            {schedule.length === 0 ? (
              <p className="text-xs text-slate-500">Inclua itens e datas para ver o cronograma.</p>
            ) : (
              <ul className="text-xs space-y-1">
                {schedule.slice(0, 8).map((l, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="text-slate-600 truncate">
                      {formatDateBR(l.due_date)} — {l.description}
                    </span>
                    <span className="tabular-nums font-semibold shrink-0">{formatBRL(l.amount)}</span>
                  </li>
                ))}
                {schedule.length > 8 && <li className="text-slate-500">+ {schedule.length - 8} cobrança(s)</li>}
              </ul>
            )}
            <p className="flex gap-1.5 text-[11px] text-slate-500 mt-3">
              <Info className="w-3.5 h-3.5 shrink-0 mt-px" /> Prévia: as cobranças só são lançadas no Financeiro após a ativação do contrato.
            </p>
          </Card>
          <div className="flex gap-2 justify-end">
            <Button onClick={() => (id ? navigate({ page: 'detalhe', id }) : navigate({ page: 'painel' }))}>Cancelar</Button>
            <Button variant="primary" icon={Save} loading={busy} disabled={!contractCan.create(user)} onClick={save}>
              Salvar rascunho
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
};
