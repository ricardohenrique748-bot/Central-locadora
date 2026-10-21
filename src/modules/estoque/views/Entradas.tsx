/**
 * Entradas de estoque: compra, implantação inicial, devolução de venda e outras autorizadas.
 * Rascunho → confirmada (atualiza saldo/custo médio ou incorpora patrimônios). Não gera pagamento (Financeiro futuro).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Search, Trash2, CheckCircle2, Save, Ban, UserPlus } from 'lucide-react';
import { ENTRY_KIND_LABELS, Entry, EntryKind, StockItemRow, Supplier } from '../../../../shared/estoque/types';
import { apportionEntry, stockCan } from '../../../../shared/estoque/rules';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { formatDateBR, todayISO } from '../../../../shared/orcamentos/dates';
import { api, ApiError, qs } from '../../orcamentos/api';
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, MoneyInput, Notice, PageHeader, Select, Textarea, cx, useAsync, useDebounced, useToast } from '../../orcamentos/ui';
import { StockCtx, useStock } from '../context';
import { DocBadge, ItemSearch, LocationSelect, Th } from '../components';
import { SupplierFormModal } from './Fornecedores';

export const EntradasView: React.FC = () => {
  const { navigate, user } = useStock();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useAsync(() => api.get<{ rows: any[] }>(`/stock/entries${qs({ q: dq, status })}`), [dq, status]);
  return (
    <div>
      <PageHeader
        title="Entradas de Estoque"
        subtitle="Compras, implantação inicial, devoluções de venda e outras entradas autorizadas."
        actions={
          stockCan.operate(user) && (
            <Button variant="primary" icon={Plus} onClick={() => navigate({ page: 'entrada' })}>
              Nova entrada
            </Button>
          )
        }
      />
      <Card bodyClassName="p-0">
        <div className="flex flex-col sm:flex-row gap-2 p-4 border-b border-slate-100">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nº, documento de origem, fornecedor" className="pl-9" aria-label="Pesquisar entradas" />
          </div>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-44" aria-label="Status">
            <option value="">Todos os status</option>
            <option value="rascunho">Rascunho</option>
            <option value="confirmada">Confirmada</option>
            <option value="cancelada">Cancelada</option>
          </Select>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.rows.length ? (
          <EmptyState title="Nenhuma entrada registrada" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Número</Th>
                  <Th>Data</Th>
                  <Th>Tipo</Th>
                  <Th>Fornecedor / documento</Th>
                  <Th>Destino</Th>
                  <Th right>Linhas</Th>
                  {stockCan.viewCosts(user) && <Th right>Total</Th>}
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer" onClick={() => navigate({ page: 'entrada', id: e.id })}>
                    <td className="px-4 py-2.5 font-semibold text-[#1e3a5f]">{e.number}</td>
                    <td className="px-4 py-2.5">{formatDateBR(e.entry_date)}</td>
                    <td className="px-4 py-2.5">{ENTRY_KIND_LABELS[e.entry_kind as EntryKind]}</td>
                    <td className="px-4 py-2.5">
                      <p>{e.supplier_name || '—'}</p>
                      {e.origin_document && <p className="text-[11px] text-slate-500">{e.origin_document}</p>}
                    </td>
                    <td className="px-4 py-2.5">{e.location_name}</td>
                    <td className="px-4 py-2.5 text-right">{e.lines}</td>
                    {stockCan.viewCosts(user) && <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(e.total)}</td>}
                    <td className="px-4 py-2.5">
                      <DocBadge s={e.status} />
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

interface Line {
  key: string;
  item: Pick<StockItemRow, 'id' | 'internal_code' | 'description' | 'unit' | 'tracking'>;
  quantity: string;
  unit_cost: number;
  units: { asset_tag: string; serial_number: string }[];
}
let k = 0;

/** Vínculo da compra confirmada com o Contas a Pagar (uma conta por entrada). */
const PayableLink: React.FC<{ stockEntryId: number; openFinance: NonNullable<StockCtx['openFinance']> }> = ({ stockEntryId, openFinance }) => {
  const { data } = useAsync(() => api.get<{ link: { id: number; entry_number: string; status: string } | null }>(`/finance/integrations/stock-entries/${stockEntryId}`), [stockEntryId]);
  if (!data) return null;
  const link = data.link;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-4 px-4 py-3 rounded-xl border border-slate-200 bg-white text-sm">
      {link ? (
        <>
          <span>
            Conta a pagar vinculada: <b>{link.entry_number}</b>
          </span>
          <Button size="sm" onClick={() => openFinance({ entryId: link.id })}>
            Ver no Financeiro
          </Button>
        </>
      ) : (
        <>
          <span className="text-slate-600">Esta compra ainda não tem conta a pagar no Financeiro.</span>
          <Button size="sm" variant="primary" onClick={() => openFinance({ stockEntryId })}>
            Gerar conta a pagar
          </Button>
        </>
      )}
    </div>
  );
};

export const EntradaForm: React.FC<{ id?: number }> = ({ id }) => {
  const { navigate, user, openFinance } = useStock();
  const toast = useToast();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [head, setHead] = useState({ entry_kind: 'compra' as EntryKind, supplier_id: null as number | null, origin_document: '', entry_date: todayISO(), location_id: null as number | null, received_by: user.name, discount: 0, extra_expenses: 0, notes: '' });
  const [lines, setLines] = useState<Line[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [newSupplier, setNewSupplier] = useState(false);
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const readOnly = !!entry && entry.status !== 'rascunho';

  const loadSuppliers = () => api.get<{ rows: Supplier[] }>('/stock/suppliers?active=true').then((r) => setSuppliers(r.rows)).catch(() => {});
  useEffect(() => {
    loadSuppliers();
    if (!id) return;
    api
      .get<Entry>(`/stock/entries/${id}`)
      .then((e) => {
        setEntry(e);
        setHead({ entry_kind: e.entry_kind, supplier_id: e.supplier_id, origin_document: e.origin_document || '', entry_date: e.entry_date, location_id: e.location_id, received_by: e.received_by || '', discount: e.discount, extra_expenses: e.extra_expenses, notes: e.notes || '' });
        setLines(
          e.items.map((i) => ({
            key: `l${++k}`,
            item: { id: i.item_id, internal_code: i.item_code, description: i.item_description, unit: i.unit, tracking: i.tracking },
            quantity: String(i.quantity),
            unit_cost: i.unit_cost,
            units: (i.units || []).map((u) => ({ asset_tag: u.asset_tag || '', serial_number: u.serial_number || '' })),
          }))
        );
      })
      .catch((err) => toast('error', err.message))
      .finally(() => setLoading(false));
  }, [id, toast]);

  const qty = (l: Line) => Number(l.quantity.replace(',', '.')) || 0;
  const app = useMemo(() => apportionEntry(lines.map((l) => ({ quantity: qty(l), unit_cost: l.unit_cost })), head.discount, head.extra_expenses), [lines, head.discount, head.extra_expenses]);
  const itemsTotal = app.reduce((a, l) => a + l.line_total, 0);

  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const setQty = (l: Line, v: string) => {
    const n = Math.max(0, Math.min(100, Math.floor(Number(v) || 0)));
    const units = l.item.tracking === 'individual' ? Array.from({ length: n }, (_, i) => l.units[i] || { asset_tag: '', serial_number: '' }) : [];
    setLine(l.key, { quantity: v, units });
  };

  const payload = () => ({
    ...head,
    items: lines.map((l) => ({ item_id: l.item.id, quantity: qty(l), unit_cost: l.unit_cost, units: l.item.tracking === 'individual' ? l.units.map((u) => ({ asset_tag: u.asset_tag || null, serial_number: u.serial_number || null })) : undefined })),
  });

  const save = async (confirm: boolean) => {
    if (!head.location_id) return toast('error', 'Selecione o local de destino.');
    if (!lines.length) return toast('error', 'Inclua ao menos um item.');
    setBusy(true);
    try {
      let e = entry?.id ? await api.put<Entry>(`/stock/entries/${entry.id}`, payload()) : await api.post<Entry>('/stock/entries', payload());
      if (confirm) e = await api.post<Entry>(`/stock/entries/${e.id}/confirm`);
      toast('success', confirm ? `Entrada ${e.number} confirmada. Saldos atualizados.` : `Rascunho ${e.number} salvo.`);
      navigate({ page: 'entrada', id: e.id });
      setEntry(e);
    } catch (err) {
      toast('error', (err as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!entry || !window.confirm('Cancelar este rascunho de entrada?')) return;
    setBusy(true);
    try {
      setEntry(await api.post<Entry>(`/stock/entries/${entry.id}/cancel`));
      toast('success', 'Entrada cancelada.');
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (!stockCan.operate(user) && !entry) return <Notice kind="warning">Seu perfil não registra entradas.</Notice>;
  const showCost = stockCan.viewCosts(user);

  return (
    <div>
      <PageHeader
        title={entry ? `Entrada ${entry.number}` : 'Nova entrada'}
        subtitle={entry ? `${ENTRY_KIND_LABELS[entry.entry_kind]} • criada por ${entry.created_by_name}` : 'Salve como rascunho para conferir; ao confirmar, os saldos e o patrimônio são atualizados.'}
        onBack={() => navigate({ page: 'entradas' })}
        actions={entry && <DocBadge s={entry.status} />}
      />
      {readOnly && entry?.status === 'confirmada' && <Notice className="mb-4">Entrada confirmada não é editada. Para corrigir, estorne a movimentação em Movimentações (perfil gestor) e lance novamente.</Notice>}
      {entry?.status === 'confirmada' && entry.entry_kind === 'compra' && openFinance && <PayableLink stockEntryId={entry.id} openFinance={openFinance} />}
      <div className="space-y-5 max-w-6xl">
        <Card title="Dados da entrada">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Field label="Tipo de entrada" required>
              <Select value={head.entry_kind} disabled={readOnly} onChange={(e) => setHead({ ...head, entry_kind: e.target.value as EntryKind })}>
                {Object.entries(ENTRY_KIND_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fornecedor" required={head.entry_kind === 'compra'} className="md:col-span-2">
              <div className="flex gap-2">
                <Select value={head.supplier_id ?? ''} disabled={readOnly} onChange={(e) => setHead({ ...head, supplier_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">{head.entry_kind === 'compra' ? 'Selecione...' : '— (opcional)'}</option>
                  {entry?.supplier_id && !suppliers.some((s) => s.id === entry.supplier_id) && <option value={entry.supplier_id}>{entry.supplier_name}</option>}
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                {!readOnly && stockCan.manageSuppliers(user) && <Button icon={UserPlus} onClick={() => setNewSupplier(true)} aria-label="Novo fornecedor" title="Novo fornecedor" />}
              </div>
            </Field>
            <Field label="Documento de origem" hint="NF, pedido, romaneio">
              <Input value={head.origin_document} disabled={readOnly} onChange={(e) => setHead({ ...head, origin_document: e.target.value })} />
            </Field>
            <Field label="Data da entrada" required>
              <Input type="date" max={todayISO()} value={head.entry_date} disabled={readOnly} onChange={(e) => setHead({ ...head, entry_date: e.target.value })} />
            </Field>
            <Field label="Local de destino" required>
              <LocationSelect value={head.location_id} disabled={readOnly} onChange={(v) => setHead({ ...head, location_id: v })} />
            </Field>
            <Field label="Responsável pelo recebimento">
              <Input value={head.received_by} disabled={readOnly} onChange={(e) => setHead({ ...head, received_by: e.target.value })} />
            </Field>
          </div>
        </Card>

        <Card title="Itens" bodyClassName="p-0">
          {!readOnly && (
            <div className="p-4 border-b border-slate-100">
              <ItemSearch
                placeholder="Adicionar item por código, nome ou código de barras"
                onPick={(i) => setLines((ls) => [...ls, { key: `l${++k}`, item: i, quantity: i.tracking === 'individual' ? '1' : '', unit_cost: i.acquisition_cost || 0, units: i.tracking === 'individual' ? [{ asset_tag: '', serial_number: '' }] : [] }])}
              />
            </div>
          )}
          {lines.length === 0 ? (
            <EmptyState title="Nenhum item incluído" />
          ) : (
            <div className="divide-y divide-slate-100">
              {lines.map((l, idx) => (
                <div key={l.key} className="p-4">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex-1 min-w-[200px]">
                      <p className="text-[11px] font-mono text-slate-500">
                        {idx + 1}. {l.item.internal_code} • {l.item.tracking === 'individual' ? 'controle individual' : 'por quantidade'}
                      </p>
                      <p className="font-semibold text-slate-800">{l.item.description}</p>
                    </div>
                    <Field label={`Quantidade (${l.item.unit})`} className="w-32">
                      <Input inputMode="decimal" disabled={readOnly} value={l.quantity} onChange={(e) => (l.item.tracking === 'individual' ? setQty(l, e.target.value) : setLine(l.key, { quantity: e.target.value }))} />
                    </Field>
                    {showCost && (
                      <Field label="Custo unitário" className="w-40">
                        <MoneyInput value={l.unit_cost} disabled={readOnly} onChange={(v) => setLine(l.key, { unit_cost: v ?? 0 })} />
                      </Field>
                    )}
                    {showCost && (
                      <div className="w-36 text-right">
                        <p className="text-[11px] text-slate-500">Total / custo rateado</p>
                        <p className="font-semibold tabular-nums">{formatBRL(app[idx]?.line_total)}</p>
                        <p className="text-[11px] text-slate-500 tabular-nums">{formatBRL(app[idx]?.allocated_unit_cost)} /{l.item.unit}</p>
                      </div>
                    )}
                    {!readOnly && <Button variant="ghost" icon={Trash2} className="text-red-600" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remover linha" />}
                  </div>
                  {l.item.tracking === 'individual' && l.units.length > 0 && (
                    <div className="mt-3 rounded-lg bg-slate-50 border border-slate-200 p-3">
                      <p className="text-xs font-semibold text-slate-600 mb-2">Unidades — patrimônio (vazio = gerado automaticamente) e nº de série (opcional)</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {l.units.map((u, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-[11px] text-slate-400 w-5 text-right">{i + 1}</span>
                            <Input value={u.asset_tag} disabled={readOnly} placeholder="Patrimônio" onChange={(e) => setLine(l.key, { units: l.units.map((x, j) => (j === i ? { ...x, asset_tag: e.target.value.toUpperCase() } : x)) })} />
                            <Input value={u.serial_number} disabled={readOnly} placeholder="Nº de série" onChange={(e) => setLine(l.key, { units: l.units.map((x, j) => (j === i ? { ...x, serial_number: e.target.value } : x)) })} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 items-start">
          <Card title="Observações">
            <Textarea value={head.notes} disabled={readOnly} onChange={(e) => setHead({ ...head, notes: e.target.value })} />
            <p className="text-[11px] text-slate-500 mt-2">O vínculo com contas a pagar será feito pelo módulo Financeiro (fornecedor e documento já ficam registrados aqui).</p>
          </Card>
          {showCost && (
            <Card title="Totais">
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">Itens</span>
                  <span className="tabular-nums">{formatBRL(itemsTotal)}</span>
                </div>
                <Field label="Desconto (rateado nos itens)">
                  <MoneyInput value={head.discount} disabled={readOnly} onChange={(v) => setHead({ ...head, discount: v ?? 0 })} />
                </Field>
                <Field label="Despesas adicionais (frete, seguro...)">
                  <MoneyInput value={head.extra_expenses} disabled={readOnly} onChange={(v) => setHead({ ...head, extra_expenses: v ?? 0 })} />
                </Field>
                <div className={cx('flex justify-between rounded-lg bg-[#1e3a5f] text-white px-3 py-2.5 font-bold')}>
                  <span>Custo total</span>
                  <span className="tabular-nums">{formatBRL(itemsTotal - head.discount + head.extra_expenses)}</span>
                </div>
              </div>
            </Card>
          )}
        </div>

        {!readOnly && stockCan.operate(user) && (
          <div className="flex flex-wrap justify-end gap-2">
            {entry && (
              <Button icon={Ban} loading={busy} onClick={cancel}>
                Cancelar rascunho
              </Button>
            )}
            <Button icon={Save} loading={busy} onClick={() => save(false)}>
              Salvar rascunho
            </Button>
            <Button variant="primary" icon={CheckCircle2} loading={busy} onClick={() => save(true)}>
              Confirmar entrada
            </Button>
          </div>
        )}
        {readOnly && entry && (
          <p className="text-xs text-slate-500">
            {entry.status === 'confirmada' ? `Confirmada em ${formatDateBR(entry.confirmed_at)}. ${lines.reduce((a, l) => a + qty(l), 0).toLocaleString('pt-BR')} unidade(s) lançada(s).` : 'Entrada cancelada.'}
          </p>
        )}
      </div>
      <SupplierFormModal
        open={newSupplier}
        onClose={() => setNewSupplier(false)}
        onSaved={(s) => {
          setNewSupplier(false);
          loadSuppliers();
          setHead((h) => ({ ...h, supplier_id: s.id }));
        }}
      />
    </div>
  );
};
