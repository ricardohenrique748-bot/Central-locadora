/**
 * Formulário de orçamento (criar/editar) em seções:
 * A — Identificação, B — Itens.
 * O resumo ao lado usa o mesmo cálculo do servidor; o servidor recalcula ao salvar.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Plus, Search, Trash2, UserPlus, FileText, Save, PackagePlus, Lock, Wrench } from 'lucide-react';
import {
  BILLING_PERIOD_LABELS,
  BillingPeriod,
  CatalogItem,
  Customer,
  DiscountType,
  QuotationDetail,
  QuotationInput,
  QuotationItemInput,
  EquipmentInfo,
} from '../../../../shared/orcamentos/types';
import { calculateQuotation, catalogPrice } from '../../../../shared/orcamentos/calc';
import { formatBRL, formatNumber } from '../../../../shared/orcamentos/money';
import { addDaysISO, formatDateTimeBR, todayISO } from '../../../../shared/orcamentos/dates';
import { formatDocument, formatPhone, missingDefinitiveData } from '../../../../shared/orcamentos/validators';
import { canChangePrice, canPerform, discountLimit } from '../../../../shared/orcamentos/permissions';
import { EDITABLE_STATUSES, STATUS_LABELS } from '../../../../shared/orcamentos/status';
import { api, ApiError, qs } from '../api';
import { useModule } from '../context';
import { CustomerFormModal } from './ClientesView';
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, MoneyInput, Notice, PageHeader, Select, StatusBadge, Textarea, cx, useDebounced, useToast } from '../ui';

type FormItem = QuotationItemInput & { _key: string };
type FormState = Omit<QuotationInput, 'items'> & { items: FormItem[] };

let keySeq = 0;
const newKey = () => `k${++keySeq}`;

const EMPTY_EQUIPMENT: EquipmentInfo = { description: '', brand: null, model: null, serial_number: null, reported_defect: null, diagnosis: null };
type Mode = 'venda' | 'locacao' | 'manutencao';
const MODE_LABELS: Record<Mode, string> = { venda: 'Venda', locacao: 'Locação', manutencao: 'Manutenção' };

const emptyForm = (validityDays: number, mode: Mode = 'venda'): FormState => ({
  customer_id: 0,
  quotation_type: mode === 'locacao' ? 'locacao' : 'venda',
  category: mode === 'manutencao' ? 'manutencao' : 'comercial',
  equipment_info: mode === 'manutencao' ? { ...EMPTY_EQUIPMENT } : null,
  expiration_date: addDaysISO(todayISO(), validityDays),
  client_reference: null,
  start_date: null,
  end_date: null,
  rental_billing_period: 'diaria',
  custom_periods: null,
  custom_period_label: null,
  availability_status: 'nao_verificada',
  general_discount_type: 'percent',
  general_discount_value: 0,
  additional_charges: 0,
  freight_amount: 0,
  pickup_freight_amount: 0,
  installation_amount: 0,
  other_services_amount: 0,
  deposit_amount: 0,
  payment_terms: null,
  delivery_terms: null,
  warranty_terms: null,
  pickup_delivery_terms: null,
  customer_responsibilities: null,
  return_conditions: null,
  included_accessories: null,
  complementary_description: null,
  specific_conditions: null,
  commercial_notes: null,
  internal_notes: null,
  items: [],
});

// ------------------------------------------------ seleção de cliente

const CustomerPicker: React.FC<{ customer: Customer | null; onSelect: (c: Customer) => void; error?: string; locked?: boolean }> = ({ customer, onSelect, error, locked }) => {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dq = useDebounced(q, 250);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .get<{ rows: Customer[] }>(`/customers${qs({ q: dq, active: 'true', limit: 8 })}`)
      .then((r) => setResults(r.rows))
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [dq, open]);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const missing = customer ? missingDefinitiveData(customer) : [];

  return (
    <div ref={ref} className="space-y-2">
      {customer ? (
        <div className={cx('rounded-lg border p-3 flex items-start justify-between gap-3', error ? 'border-red-400' : 'border-slate-200 bg-slate-50')}>
          <div className="min-w-0">
            <p className="font-semibold text-slate-800">{customer.name}</p>
            <p className="text-xs text-slate-500">
              {[formatDocument(customer.document), formatPhone(customer.phone || customer.whatsapp), customer.email].filter(Boolean).join(' • ') || 'Sem documento/contato'}
            </p>
            {missing.length > 0 && <p className="text-[11px] text-amber-700 mt-1">Para enviar a proposta definitiva, complete: {missing.join(', ')}.</p>}
            {!customer.active && <p className="text-[11px] text-red-600 mt-1">Cliente inativo (mantido por já estar vinculado a este orçamento).</p>}
          </div>
          {!locked && (
            <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
              Trocar
            </Button>
          )}
        </div>
      ) : null}
      {(!customer || open) && !locked && (
        <div className="relative">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input value={q} onFocus={() => setOpen(true)} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar cliente por nome, CPF/CNPJ ou telefone" className="pl-9" error={error} aria-label="Pesquisar cliente" />
            </div>
            <Button icon={UserPlus} onClick={() => setNewOpen(true)}>
              <span className="hidden sm:inline">Novo cliente</span>
            </Button>
          </div>
          {open && (
            <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl max-h-72 overflow-y-auto">
              {loading && <p className="px-3 py-3 text-sm text-slate-500">Pesquisando...</p>}
              {!loading && results.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">Nenhum cliente ativo encontrado.</p>}
              {results.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    onSelect(c);
                    setOpen(false);
                    setQ('');
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-50"
                >
                  <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                  <p className="text-xs text-slate-500">{[formatDocument(c.document), formatPhone(c.phone || c.whatsapp)].filter(Boolean).join(' • ')}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <CustomerFormModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onSaved={(c) => {
          setNewOpen(false);
          setOpen(false);
          onSelect(c);
        }}
      />
    </div>
  );
};

// ------------------------------------------------ catálogo

const CatalogPicker: React.FC<{ open: boolean; type: Mode; onClose: () => void; onPick: (i: CatalogItem) => void }> = ({ open, type, onClose, onPick }) => {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [rows, setRows] = useState<CatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    api
      .get<{ rows: CatalogItem[] }>(`/catalog${qs({ q: dq, modality: type, active: 'true', limit: 30 })}`)
      .then((r) => setRows(r.rows))
      .catch((e) => setError(e.message));
  }, [dq, open, type]);
  return (
    <Modal open={open} onClose={onClose} title={`Adicionar item — ${MODE_LABELS[type].toLowerCase()}`} size="lg">
      <div className="space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código ou descrição" className="pl-9" aria-label="Pesquisar catálogo" />
        </div>
        <p className="text-[11px] text-slate-500">{type === 'manutencao' ? 'Peças, insumos, acessórios e produtos ativos. Mão de obra entra pelo botão “Mão de obra / serviço”.' : `Somente itens ativos e habilitados para ${type === 'venda' ? 'venda' : 'locação'}.`}</p>
        {error ? (
          <ErrorState message={error} />
        ) : !rows ? (
          <Loading />
        ) : rows.length === 0 ? (
          <EmptyState title="Nenhum item encontrado" />
        ) : (
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
            {rows.map((i) => (
              <button key={i.id} onClick={() => onPick(i)} className="w-full text-left px-3 py-2.5 hover:bg-slate-50 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">
                    <span className="font-mono text-xs text-slate-500 mr-2">{i.internal_code}</span>
                    {i.description}
                  </p>
                  <p className="text-xs text-slate-500">{[i.category, i.brand, i.unit].filter(Boolean).join(' • ')}</p>
                </div>
                <div className="text-right text-xs tabular-nums text-slate-600 shrink-0">
                  {type === 'venda' ? (
                    formatBRL(i.sale_price)
                  ) : (
                    <>
                      <p>{formatBRL(i.daily_rental_price)}/dia</p>
                      {i.monthly_rental_price !== null && <p className="text-slate-400">{formatBRL(i.monthly_rental_price)}/mês</p>}
                    </>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};

// ------------------------------------------------ formulário

const Section: React.FC<{ letter: string; title: string; children: React.ReactNode; id: string }> = ({ letter, title, children, id }) => (
  <Card
    title={
      <span id={id} className="flex items-center gap-2 scroll-mt-28">
        <span className="w-6 h-6 rounded-md bg-[#1e3a5f] text-white text-xs font-bold flex items-center justify-center">{letter}</span>
        {title}
      </span>
    }
  >
    {children}
  </Card>
);

export const FormView: React.FC<{ id?: number; initialMode?: Mode }> = ({ id, initialMode }) => {
  const { user, settings, navigate } = useModule();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(() => emptyForm(settings.default_validity_days, initialMode));
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [existing, setExisting] = useState<QuotationDetail | null>(null);
  const [catalogCache, setCatalogCache] = useState<Record<number, CatalogItem>>({});
  const [loading, setLoading] = useState(!!id);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showIssues, setShowIssues] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  const mayChangePrice = canChangePrice(user, settings);
  const limit = discountLimit(user, settings);
  const isRental = form.quotation_type === 'locacao';
  const isMaint = form.category === 'manutencao';
  const mode: Mode = isMaint ? 'manutencao' : form.quotation_type;
  const setEquip = (patch: Partial<EquipmentInfo>) => update({ equipment_info: { ...(form.equipment_info || EMPTY_EQUIPMENT), ...patch } });

  const load = () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    api
      .get<QuotationDetail>(`/quotations/${id}`)
      .then(async (q) => {
        setExisting(q);
        const { history, versions, approvals, activities, allowed_actions, items, ...rest } = q;
        setForm({ ...(rest as unknown as FormState), items: items.map((i) => ({ ...i, _key: newKey() })) });
        const c = await api.get<Customer>(`/customers/${q.customer_id}`).catch(() => null);
        setCustomer(c);
        // preços atuais do catálogo (para trocar período sem perder referência)
        const ids = [...new Set(items.map((i) => i.catalog_item_id).filter(Boolean) as number[])];
        const fetched = await Promise.all(ids.map((cid) => api.get<CatalogItem>(`/catalog/${cid}`).catch(() => null)));
        setCatalogCache(Object.fromEntries(fetched.filter(Boolean).map((c) => [c!.id, c!])));
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, [id]);

  // aviso ao sair com alterações não salvas
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const update = (patch: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) => update({ [k]: v } as Partial<FormState>);
  const updateItem = (key: string, patch: Partial<FormItem>) => {
    setForm((f) => ({ ...f, items: f.items.map((i) => (i._key === key ? { ...i, ...patch } : i)) }));
    setDirty(true);
  };

  const calc = useMemo(() => calculateQuotation(form as QuotationInput, settings.rental_policy), [form, settings.rental_policy]);
  const issues = calc.issues;

  // ------------------------------------------------ itens
  const priceFor = (catalogId: number | null, billing: BillingPeriod | null, type = form.quotation_type) => {
    const c = catalogId ? catalogCache[catalogId] : null;
    return c ? catalogPrice(c, type, type === 'locacao' ? billing || form.rental_billing_period : null) : null;
  };

  const addCatalogItem = (c: CatalogItem) => {
    setCatalogCache((m) => ({ ...m, [c.id]: c }));
    const price = catalogPrice(c, form.quotation_type, isRental ? form.rental_billing_period : null);
    const item: FormItem = {
      _key: newKey(),
      catalog_item_id: c.id,
      item_code_snapshot: c.internal_code,
      description_snapshot: c.description.toLocaleUpperCase('pt-BR'),
      item_type_snapshot: c.item_type,
      unit: c.unit,
      quantity: 1,
      unit_price: price ?? 0,
      reference_price: price,
      billing_period: null,
      discount_type: 'percent',
      discount_value: 0,
      notes: null,
    };
    update({ items: [...form.items, item] });
    setPickerOpen(false);
    if (price === null) toast('info', `${c.internal_code} não tem preço cadastrado para este período. Informe o valor.`);
  };

  const addFreeItem = (labor = false) => {
    update({
      items: [
        ...form.items,
        {
          _key: newKey(),
          catalog_item_id: null,
          item_code_snapshot: labor ? 'SERVICO' : 'AVULSO',
          description_snapshot: labor ? 'Mão de obra' : '',
          item_type_snapshot: 'produto',
          unit: labor ? 'h' : 'un',
          quantity: 1,
          unit_price: 0,
          reference_price: null,
          billing_period: null,
          discount_type: 'percent',
          discount_value: 0,
          notes: null,
        },
      ],
    });
  };

  const moveItem = (index: number, dir: -1 | 1) => {
    const items = [...form.items];
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    [items[index], items[j]] = [items[j], items[index]];
    update({ items });
  };

  const changeQuoteBilling = (b: BillingPeriod) => {
    // itens que seguem o período do orçamento passam a usar o preço de tabela do novo período
    const items = form.items.map((i) => {
      if (i.billing_period || !i.catalog_item_id) return i;
      const p = priceFor(i.catalog_item_id, b, 'locacao');
      return p !== null ? { ...i, unit_price: p, reference_price: p } : i;
    });
    update({ rental_billing_period: b, items });
  };

  const changeType = (m: Mode) => {
    if (m === mode) return;
    if (form.items.length && !window.confirm('Trocar a modalidade remove os itens já incluídos. Continuar?')) return;
    update({ quotation_type: m === 'locacao' ? 'locacao' : 'venda', category: m === 'manutencao' ? 'manutencao' : 'comercial', equipment_info: m === 'manutencao' ? form.equipment_info || { ...EMPTY_EQUIPMENT } : null, items: [] });
  };

  // ------------------------------------------------ salvar
  const save = async () => {
    setShowIssues(true);
    if (!form.customer_id) {
      setErrors({ customer_id: 'Selecione o cliente.' });
      toast('error', 'Selecione o cliente.');
      return;
    }
    if (issues.length) {
      toast('error', issues[0].message);
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      const payload = { ...form, items: form.items.map(({ _key, ...i }) => i), row_version: existing?.row_version };
      const saved = id ? await api.put<{ id: number }>(`/quotations/${id}`, payload) : await api.post<{ id: number; quotation_number: string }>('/quotations', payload);
      setDirty(false);
      toast('success', id ? 'Orçamento salvo.' : `Orçamento ${(saved as any).quotation_number} criado.`);
      navigate({ page: 'detalhe', id: saved.id });
    } catch (e) {
      const err = e as ApiError;
      if (err.fields) setErrors(err.fields);
      toast('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading />;
  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (existing && (!EDITABLE_STATUSES.includes(existing.status) || !canPerform(user, 'editar', existing, settings))) {
    return (
      <div>
        <PageHeader title={`Orçamento ${existing.quotation_number}`} onBack={() => navigate({ page: 'detalhe', id: existing.id })} />
        <Notice kind="warning">
          Este orçamento está como <b>{STATUS_LABELS[existing.status]}</b> e não pode ser editado diretamente{!canPerform(user, 'editar', existing, settings) && EDITABLE_STATUSES.includes(existing.status) ? ' pelo seu perfil' : ''}.
          {['aprovado_interno', 'enviado', 'em_negociacao', 'aguardando_aprovacao'].includes(existing.status) && ' Use "Criar nova versão" na tela do orçamento.'}
        </Notice>
      </div>
    );
  }

  const fieldErr = (k: string) => errors[k] || (showIssues ? issues.find((i) => i.field === k)?.message : undefined);
  const t = calc.totals;
  const overLimit = t.effective_discount_percent > limit + 1e-9;
  return (
    <div>
      <PageHeader
        title={existing ? `Editar ${existing.quotation_number}` : 'Novo orçamento'}
        subtitle={existing ? `Versão ${existing.version} • criado em ${formatDateTimeBR(existing.created_at)} por ${existing.responsible_name}` : 'Preencha as seções. Você pode salvar como rascunho e completar depois.'}
        onBack={() => {
          if (dirty && !window.confirm('Descartar as alterações não salvas?')) return;
          navigate(existing ? { page: 'detalhe', id: existing.id } : { page: 'lista' });
        }}
        actions={existing && <StatusBadge status={existing.status} />}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          {/* ------------------------------------------------ A */}
          <Section letter="A" title="Identificação" id="sec-a">
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
              <Field label="Número" className="md:col-span-2">
                <Input value={existing?.quotation_number || 'Gerado ao salvar'} disabled />
              </Field>
              <Field label="Responsável" className="md:col-span-2">
                <Input value={existing?.responsible_name || user.name} disabled />
              </Field>
              <Field label="Status" className="md:col-span-2">
                <div className="h-[38px] flex items-center">{existing ? <StatusBadge status={existing.status} /> : <StatusBadge status="rascunho" />}</div>
              </Field>
              <Field label="Cliente" required className="md:col-span-6">
                <CustomerPicker
                  customer={customer}
                  error={fieldErr('customer_id')}
                  onSelect={(c) => {
                    setCustomer(c);
                    setField('customer_id', c.id);
                    setErrors((e) => ({ ...e, customer_id: '' }));
                  }}
                />
              </Field>
              <Field label="Modalidade" required className="md:col-span-2">
                <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-lg">
                  {(['venda', 'locacao', 'manutencao'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      disabled={!!existing}
                      onClick={() => changeType(m)}
                      className={cx('py-1.5 rounded-md text-sm font-semibold transition-colors', mode === m ? 'bg-white shadow-xs text-[#1e3a5f]' : 'text-slate-500', existing && 'cursor-not-allowed')}
                    >
                      {MODE_LABELS[m]}
                    </button>
                  ))}
                </div>
                {existing && <p className="text-[11px] text-slate-500">Para outra modalidade, duplique o orçamento.</p>}
              </Field>
              <Field label="Validade da proposta" required error={fieldErr('expiration_date')} className="md:col-span-2">
                <Input type="date" min={todayISO()} value={form.expiration_date} onChange={(e) => setField('expiration_date', e.target.value)} error={fieldErr('expiration_date')} />
              </Field>
              <Field label="Referência do cliente" hint="Nº de solicitação, pedido ou obra" className="md:col-span-2">
                <Input value={form.client_reference || ''} onChange={(e) => setField('client_reference', e.target.value || null)} maxLength={80} />
              </Field>
            </div>

            {isMaint && (
              <div className="mt-5 pt-4 border-t border-slate-100">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Equipamento do cliente</p>
                <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                  <Field label="Equipamento" required error={fieldErr('equipment_info.description')} className="md:col-span-3">
                    <Input value={form.equipment_info?.description || ''} onChange={(e) => setEquip({ description: e.target.value })} placeholder="Ex.: Betoneira 400 L" maxLength={200} error={fieldErr('equipment_info.description')} />
                  </Field>
                  <Field label="Marca">
                    <Input value={form.equipment_info?.brand || ''} onChange={(e) => setEquip({ brand: e.target.value || null })} maxLength={80} />
                  </Field>
                  <Field label="Modelo">
                    <Input value={form.equipment_info?.model || ''} onChange={(e) => setEquip({ model: e.target.value || null })} maxLength={80} />
                  </Field>
                  <Field label="Nº de série">
                    <Input value={form.equipment_info?.serial_number || ''} onChange={(e) => setEquip({ serial_number: e.target.value || null })} maxLength={80} />
                  </Field>
                  <Field label="Defeito relatado pelo cliente" className="md:col-span-3">
                    <Textarea rows={3} value={form.equipment_info?.reported_defect || ''} onChange={(e) => setEquip({ reported_defect: e.target.value || null })} maxLength={2000} />
                  </Field>
                  <Field label="Diagnóstico / serviço a executar" className="md:col-span-3">
                    <Textarea rows={3} value={form.equipment_info?.diagnosis || ''} onChange={(e) => setEquip({ diagnosis: e.target.value || null })} maxLength={2000} />
                  </Field>
                </div>
              </div>
            )}

            {isRental && (
              <div className="mt-5 pt-4 border-t border-slate-100">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Período da locação</p>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Field label="Início previsto" required>
                    <Input type="date" value={form.start_date || ''} onChange={(e) => setField('start_date', e.target.value || null)} />
                  </Field>
                  <Field label="Término previsto" required error={fieldErr('end_date')}>
                    <Input type="date" min={form.start_date || undefined} value={form.end_date || ''} onChange={(e) => setField('end_date', e.target.value || null)} error={fieldErr('end_date')} />
                  </Field>
                  <Field label="Cobrança" required error={fieldErr('rental_billing_period')}>
                    <Select value={form.rental_billing_period || ''} onChange={(e) => changeQuoteBilling(e.target.value as BillingPeriod)}>
                      {Object.entries(BILLING_PERIOD_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Duração calculada">
                    <div className="h-[38px] flex items-center text-sm font-bold text-slate-800">{calc.rental_days !== null ? `${calc.rental_days} dia(s)` : '—'}</div>
                  </Field>
                  {(form.rental_billing_period === 'personalizado' || form.items.some((i) => i.billing_period === 'personalizado')) && (
                    <>
                      <Field label="Nº de períodos personalizados" required error={fieldErr('custom_periods')}>
                        <Input type="number" min={0.01} step={0.01} value={form.custom_periods ?? ''} onChange={(e) => setField('custom_periods', e.target.value ? Number(e.target.value) : null)} error={fieldErr('custom_periods')} />
                      </Field>
                      <Field label="Nome do período" hint="Ex.: Quinzena, Fim de semana">
                        <Input value={form.custom_period_label || ''} onChange={(e) => setField('custom_period_label', e.target.value || null)} maxLength={40} />
                      </Field>
                    </>
                  )}
                </div>
                {calc.rental_days !== null && (
                  <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-700 space-y-1">
                    <p className="font-semibold text-slate-800">Memória de cálculo do período</p>
                    <p>
                      Contagem: {settings.rental_policy.day_count_mode === 'exclusive' ? 'término − início' : 'inclui início e término'} = <b>{calc.rental_days} dia(s)</b>.
                      {' '}Cobrança {settings.rental_policy.proportional ? 'proporcional (períodos fracionados)' : 'por período fechado'}.
                    </p>
                    {[...new Map(calc.items.filter((i) => i.period_memo).map((i) => [i.billing_period, i])).values()].map((i) => (
                      <p key={i.billing_period || ''} className={cx(i.period_rounded && 'text-amber-800 font-semibold')}>
                        {BILLING_PERIOD_LABELS[i.billing_period!]}: {i.period_memo}
                      </p>
                    ))}
                  </div>
                )}
                <Notice kind="warning" className="mt-3">
                  <b>Disponibilidade:</b> depois de salvar, use “Verificar disponibilidade” na tela do orçamento para consultar o Estoque no período. A consulta não reserva equipamentos — a reserva é feita no Estoque, com validação de conflitos. Alterar o orçamento zera a verificação.
                </Notice>
              </div>
            )}
          </Section>

          {/* ------------------------------------------------ B */}
          <Section letter="B" title={isRental ? 'Equipamentos e itens' : isMaint ? 'Peças e serviços' : 'Itens do orçamento'} id="sec-b">
            {form.items.length === 0 ? (
              <EmptyState
                title="Nenhum item incluído"
                text={isMaint ? 'Inclua as peças do catálogo e a mão de obra / serviços.' : `Adicione ${isRental ? 'equipamentos' : 'produtos ou equipamentos'} do catálogo.`}
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button variant="primary" icon={Plus} onClick={() => setPickerOpen(true)}>
                      {isMaint ? 'Adicionar peça' : 'Adicionar do catálogo'}
                    </Button>
                    {isMaint && mayChangePrice && (
                      <Button icon={Wrench} onClick={() => addFreeItem(true)}>
                        Mão de obra / serviço
                      </Button>
                    )}
                  </div>
                }
              />
            ) : (
              <div className="space-y-3">
                {form.items.map((item, idx) => {
                  const ci = calc.items[idx];
                  const err = (f: string) => fieldErr(`items.${idx}.${f}`) || (f === 'unit_price' ? errors[`items.${idx}`] : undefined);
                  const priceChanged = item.reference_price !== null && item.unit_price !== item.reference_price;
                  return (
                    <div key={item._key} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-mono text-slate-500">
                            {idx + 1}. {item.item_code_snapshot}
                          </p>
                          {item.catalog_item_id ? (
                            <Input value={item.description_snapshot.toLocaleUpperCase('pt-BR')} onChange={(e) => updateItem(item._key, { description_snapshot: e.target.value.toLocaleUpperCase('pt-BR') })} className="mt-1 font-semibold" aria-label="Descrição" error={err('description_snapshot')} />
                          ) : (
                            <Input value={item.description_snapshot.toLocaleUpperCase('pt-BR')} placeholder="Descrição do item avulso" onChange={(e) => updateItem(item._key, { description_snapshot: e.target.value.toLocaleUpperCase('pt-BR') })} className="mt-1 font-semibold" aria-label="Descrição" error={err('description_snapshot')} />
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0 pt-4">
                          <Button size="sm" variant="ghost" icon={ArrowUp} disabled={idx === 0} onClick={() => moveItem(idx, -1)} aria-label="Mover para cima" />
                          <Button size="sm" variant="ghost" icon={ArrowDown} disabled={idx === form.items.length - 1} onClick={() => moveItem(idx, 1)} aria-label="Mover para baixo" />
                          <Button size="sm" variant="ghost" icon={Copy} onClick={() => update({ items: [...form.items.slice(0, idx + 1), { ...item, _key: newKey() }, ...form.items.slice(idx + 1)] })} aria-label="Duplicar item" />
                          <Button size="sm" variant="ghost" icon={Trash2} onClick={() => update({ items: form.items.filter((i) => i._key !== item._key) })} aria-label="Remover item" className="text-red-600 hover:bg-red-50" />
                        </div>
                      </div>
                      <div className={cx('grid grid-cols-2 gap-3', isRental ? 'md:grid-cols-6' : 'md:grid-cols-5')}>
                        <Field label={`Quantidade (${item.unit})`} error={err('quantity')}>
                          <Input type="number" min={0.001} step="any" value={Number.isFinite(item.quantity) ? item.quantity : ''} onChange={(e) => updateItem(item._key, { quantity: e.target.value === '' ? NaN : Number(e.target.value) })} error={err('quantity')} />
                        </Field>
                        {isRental && (
                          <Field label="Período">
                            <Select
                              value={item.billing_period || ''}
                              onChange={(e) => {
                                const b = (e.target.value || null) as BillingPeriod | null;
                                const p = priceFor(item.catalog_item_id, b);
                                updateItem(item._key, { billing_period: b, ...(p !== null ? { unit_price: p, reference_price: p } : {}) });
                              }}
                            >
                              <option value="">Padrão</option>
                              {Object.entries(BILLING_PERIOD_LABELS).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v}
                                </option>
                              ))}
                            </Select>
                          </Field>
                        )}
                        <Field label={isRental ? 'Valor por período' : 'Valor unitário'} error={err('unit_price')} hint={priceChanged ? `Tabela: ${formatBRL(item.reference_price)}` : undefined}>
                          <div className="relative">
                            <MoneyInput value={item.unit_price} onChange={(v) => updateItem(item._key, { unit_price: v ?? 0 })} disabled={!mayChangePrice && item.reference_price !== null} error={err('unit_price')} />
                            {!mayChangePrice && item.reference_price !== null && <Lock className="w-3 h-3 text-slate-400 absolute -top-4 right-0" aria-label="Preço de tabela bloqueado" />}
                          </div>
                        </Field>
                        <Field label="Desconto" error={err('discount_value')}>
                          <div className="flex">
                            <select
                              value={item.discount_type}
                              onChange={(e) => updateItem(item._key, { discount_type: e.target.value as DiscountType, discount_value: 0 })}
                              className="rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-2 text-xs"
                              aria-label="Tipo de desconto"
                            >
                              <option value="percent">%</option>
                              <option value="fixed">R$</option>
                            </select>
                            {item.discount_type === 'percent' ? (
                              <Input type="number" min={0} max={100} step={0.01} value={item.discount_value || ''} placeholder="0" onChange={(e) => updateItem(item._key, { discount_value: Number(e.target.value) || 0 })} className="rounded-l-none" error={err('discount_value')} />
                            ) : (
                              <div className="flex-1 [&_input]:rounded-l-none">
                                <MoneyInput value={item.discount_value} onChange={(v) => updateItem(item._key, { discount_value: v ?? 0 })} error={err('discount_value')} />
                              </div>
                            )}
                          </div>
                        </Field>
                        <Field label="Subtotal bruto">
                          <div className="h-[38px] flex items-center justify-end text-sm tabular-nums text-slate-600">
                            {formatBRL(ci?.gross_total)}
                            {isRental && ci && <span className="text-[10px] text-slate-400 ml-1">({formatNumber(ci.periods, 2)}×)</span>}
                          </div>
                        </Field>
                        <Field label="Total do item">
                          <div className="h-[38px] flex items-center justify-end text-sm font-bold tabular-nums text-slate-900">{formatBRL(ci?.line_total)}</div>
                        </Field>
                      </div>
                      <Input value={item.notes || ''} onChange={(e) => updateItem(item._key, { notes: e.target.value || null })} placeholder="Observações do item (aparecem na proposta)" className="mt-3 text-xs" aria-label="Observações do item" />
                    </div>
                  );
                })}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex gap-2">
                    <Button icon={Plus} onClick={() => setPickerOpen(true)}>
                      {isMaint ? 'Adicionar peça' : 'Adicionar do catálogo'}
                    </Button>
                    {isMaint && mayChangePrice && (
                      <Button icon={Wrench} onClick={() => addFreeItem(true)}>
                        Mão de obra / serviço
                      </Button>
                    )}
                    {mayChangePrice && (
                      <Button variant="ghost" icon={PackagePlus} onClick={() => addFreeItem()}>
                        Item avulso
                      </Button>
                    )}
                  </div>
                  <p className="text-sm text-slate-600">
                    Subtotal dos itens: <b className="text-slate-900 tabular-nums">{formatBRL(t.subtotal)}</b>
                  </p>
                </div>
              </div>
            )}
          </Section>
        </div>

        {/* ------------------------------------------------ resumo */}
        <aside className="xl:sticky xl:top-[120px] space-y-3">
          <Card title="Resumo">
            <dl className="space-y-1.5 text-sm">
              {[
                ['Itens (bruto)', t.items_gross_total],
                ['Descontos nos itens', -t.item_discount_total],
                ['Subtotal', t.subtotal],
                ['Desconto geral', -t.general_discount],
                ['Acréscimos', t.additional_charges],
                [isRental ? 'Frete de entrega' : 'Frete', t.freight_amount],
                ...(isRental ? [['Frete de retirada', t.pickup_freight_amount] as [string, number]] : []),
                ['Montagem/instalação', t.installation_amount],
                [isRental ? 'Serviços adicionais' : 'Outros serviços', t.other_services_amount],
              ].map(([label, v]) => (
                <div key={label as string} className={cx('flex justify-between gap-2', label === 'Subtotal' && 'font-semibold border-t border-slate-100 pt-1.5')}>
                  <dt className="text-slate-600">{label}</dt>
                  <dd className={cx('tabular-nums', (v as number) < 0 ? 'text-red-600' : 'text-slate-800')}>{(v as number) < 0 ? `− ${formatBRL(-(v as number))}` : formatBRL(v as number)}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-3 rounded-lg bg-[#1e3a5f] text-white px-3 py-2.5 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide">{isRental ? 'Total previsto' : 'Valor total'}</span>
              <span className="text-lg font-extrabold tabular-nums">{formatBRL(t.total_amount)}</span>
            </div>
            {isRental && t.deposit_amount > 0 && <p className="text-xs text-slate-600 mt-2">+ Caução (separada): <b>{formatBRL(t.deposit_amount)}</b></p>}
            <div className={cx('mt-3 text-xs rounded-lg px-3 py-2', overLimit ? 'bg-amber-50 text-amber-900 border border-amber-200' : 'bg-slate-50 text-slate-600')}>
              Desconto efetivo: <b>{t.effective_discount_percent.toLocaleString('pt-BR')}%</b> (sua alçada: {limit}%)
              {overLimit && <p className="mt-1">Acima da sua alçada — será necessário solicitar aprovação de um gestor.</p>}
              {t.price_reduction_total > 0 && <p className="mt-1">Inclui {formatBRL(t.price_reduction_total)} de redução sobre o preço de tabela.</p>}
            </div>
          </Card>
          {showIssues && issues.length > 0 && (
            <Notice kind="danger">
              <p className="font-semibold mb-1">Corrija antes de salvar:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {issues.slice(0, 6).map((i) => (
                  <li key={i.field + i.message}>{i.message}</li>
                ))}
              </ul>
            </Notice>
          )}
          <Button variant="primary" icon={Save} loading={saving} onClick={save} className="w-full py-2.5">
            {existing ? 'Salvar alterações' : 'Salvar rascunho'}
          </Button>
          {existing && (
            <Button icon={FileText} className="w-full" onClick={() => navigate({ page: 'detalhe', id: existing.id })}>
              Ver orçamento
            </Button>
          )}
        </aside>
      </div>

      <CatalogPicker open={pickerOpen} type={mode} onClose={() => setPickerOpen(false)} onPick={addCatalogItem} />
    </div>
  );
};
