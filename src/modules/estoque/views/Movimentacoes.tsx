/**
 * Movimentações (consulta, rascunhos, estorno, CSV) e Saídas manuais autorizadas.
 * Movimentações confirmadas não são editadas nem apagadas: correção por estorno.
 */

import React, { useEffect, useState } from 'react';
import { Search, FileSpreadsheet, Undo2, CheckCircle2, Trash2, Plus, Info } from 'lucide-react';
import { MOVEMENT_LABELS, Movement, MovementType, StockItemRow } from '../../../../shared/estoque/types';
import { stockCan } from '../../../../shared/estoque/rules';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { formatDateTimeBR, todayISO } from '../../../../shared/orcamentos/dates';
import { api, ApiError, fetchBlob, qs, saveBlob } from '../../orcamentos/api';
import { Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader, Pagination, Select, Textarea, cx, useAsync, useDebounced, useToast } from '../../orcamentos/ui';
import { useStock } from '../context';
import { DocBadge, ItemSearch, LocationSelect, Th, fmtQty } from '../components';

const MovementTable: React.FC<{ rows: Movement[]; onOpen: (m: Movement) => void; dim?: boolean; showCost: boolean }> = ({ rows, onOpen, dim, showCost }) => (
  <div className="overflow-x-auto">
    <table className="w-full text-sm min-w-[880px]">
      <thead className="bg-slate-50">
        <tr>
          <Th>Número / data</Th>
          <Th>Tipo</Th>
          <Th>Item</Th>
          <Th right>Qtd</Th>
          <Th>Origem → destino</Th>
          <Th className="hidden xl:table-cell">Documento / motivo</Th>
          {showCost && <Th right className="hidden lg:table-cell">Custo</Th>}
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody className={cx(dim && 'opacity-60')}>
        {rows.map((m) => (
          <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer" onClick={() => onOpen(m)}>
            <td className="px-4 py-2.5 whitespace-nowrap">
              <p className="font-semibold text-slate-800">{m.number}</p>
              <p className="text-[11px] text-slate-500">{formatDateTimeBR(m.created_at)} • {m.created_by_name}</p>
            </td>
            <td className="px-4 py-2.5 text-slate-700">{MOVEMENT_LABELS[m.movement_type]}</td>
            <td className="px-4 py-2.5">
              <p className="font-medium text-slate-800">{m.item_description}</p>
              <p className="text-[11px] text-slate-500 font-mono">
                {m.item_code}
                {m.asset_tag ? ` / ${m.asset_tag}` : ''}
              </p>
            </td>
            <td className={cx('px-4 py-2.5 text-right tabular-nums font-semibold', m.qty_delta > 0 ? 'text-emerald-700' : m.qty_delta < 0 ? 'text-red-700' : 'text-slate-500')}>
              {m.qty_delta > 0 ? '+' : m.qty_delta < 0 ? '−' : ''}
              {fmtQty(m.quantity)}
              {m.qty_delta === 0 && m.unavailable_delta !== 0 && <span className="block text-[10px] font-normal">{m.unavailable_delta > 0 ? 'p/ indisponível' : 'liberado'}</span>}
            </td>
            <td className="px-4 py-2.5 text-xs text-slate-600">{[m.origin_name, m.dest_name].filter(Boolean).join(' → ') || '—'}</td>
            <td className="px-4 py-2.5 text-xs text-slate-600 hidden xl:table-cell max-w-[220px] truncate">{[m.reference_doc, m.reason].filter(Boolean).join(' • ') || '—'}</td>
            {showCost && <td className="px-4 py-2.5 text-right tabular-nums text-xs hidden lg:table-cell">{formatBRL(m.total_cost)}</td>}
            <td className="px-4 py-2.5">
              <DocBadge s={m.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const MovementModal: React.FC<{ m: Movement | null; onClose: () => void; onChanged: () => void }> = ({ m, onClose, onChanged }) => {
  const { user } = useStock();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setReason(''), [m]);
  if (!m) return null;
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', ok);
      onChanged();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const row = (l: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1.5 border-b border-slate-50 text-sm">
      <dt className="text-slate-500">{l}</dt>
      <dd className="text-right font-medium text-slate-800">{v || '—'}</dd>
    </div>
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={`${m.number} — ${MOVEMENT_LABELS[m.movement_type]}`}
      footer={
        <>
          <Button onClick={onClose}>Fechar</Button>
          {m.status === 'rascunho' && stockCan.operate(user) && (
            <>
              <Button icon={Trash2} loading={busy} onClick={() => act(() => api.del(`/stock/movements/${m.id}`), 'Rascunho descartado.')}>
                Descartar
              </Button>
              <Button variant="primary" icon={CheckCircle2} loading={busy} onClick={() => act(() => api.post(`/stock/movements/${m.id}/confirm`), 'Movimentação confirmada.')}>
                Confirmar
              </Button>
            </>
          )}
          {m.status === 'confirmado' && stockCan.approve(user) && m.movement_type !== 'estorno' && (
            <Button variant="danger" icon={Undo2} loading={busy} disabled={!reason.trim()} onClick={() => act(() => api.post(`/stock/movements/${m.id}/reverse`, { reason }), 'Estorno registrado.')}>
              Estornar
            </Button>
          )}
        </>
      }
    >
      <dl>
        {row('Status', <DocBadge s={m.status} />)}
        {row('Data', formatDateTimeBR(m.created_at))}
        {row('Confirmada em', formatDateTimeBR(m.confirmed_at))}
        {row('Item', `${m.item_code} — ${m.item_description}`)}
        {row('Patrimônio', m.asset_tag)}
        {row('Quantidade', fmtQty(m.quantity))}
        {row('Efeito no saldo físico', m.qty_delta ? `${m.qty_delta > 0 ? '+' : ''}${fmtQty(m.qty_delta)}` : 'nenhum')}
        {m.unavailable_delta !== 0 && row('Efeito no indisponível', `${m.unavailable_delta > 0 ? '+' : ''}${fmtQty(m.unavailable_delta)}`)}
        {row('Origem', m.origin_name)}
        {row('Destino', m.dest_name)}
        {stockCan.viewCosts(user) && row('Custo unitário / total', `${formatBRL(m.unit_cost)} / ${formatBRL(m.total_cost)}`)}
        {row('Documento de referência', m.reference_doc)}
        {row('Motivo', m.reason)}
        {row('Observações', m.notes)}
        {row('Responsável', m.created_by_name)}
      </dl>
      {m.status === 'confirmado' && stockCan.approve(user) && m.movement_type !== 'estorno' && (
        <div className="mt-4 space-y-2">
          <Notice>O estorno cria uma movimentação compensatória com efeito inverso. A original fica marcada como estornada. Transferências, locações e inventários são desfeitos pelo próprio fluxo.</Notice>
          <Field label="Motivo do estorno" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  );
};

export const MovimentacoesView: React.FC = () => {
  const { user } = useStock();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [direction, setDirection] = useState('');
  const [location, setLocation] = useState<number | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<Movement | null>(null);
  const dq = useDebounced(q);
  const filters = { q: dq, type, status, direction, location_id: location, from, to };
  useEffect(() => setPage(1), [dq, type, status, direction, location, from, to]);
  const { data, error, loading, reload } = useAsync(() => api.get<{ total: number; page_size: number; rows: Movement[] }>(`/stock/movements${qs({ ...filters, page })}`), [dq, type, status, direction, location, from, to, page]);

  return (
    <div>
      <PageHeader
        title="Movimentações"
        subtitle="Histórico auditável de tudo que alterou saldo ou situação. Correções somente por estorno."
        actions={
          <Button
            icon={FileSpreadsheet}
            onClick={async () => {
              try {
                saveBlob(await fetchBlob(`/stock/movements/export.csv${qs(filters)}`), `movimentacoes-${todayISO()}.csv`);
              } catch (e) {
                toast('error', (e as Error).message);
              }
            }}
          >
            Exportar CSV
          </Button>
        }
      />
      <Card bodyClassName="p-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2 p-4 border-b border-slate-100">
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nº, item, patrimônio, documento" className="pl-9" aria-label="Pesquisar movimentações" />
          </div>
          <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo">
            <option value="">Todos os tipos</option>
            {Object.entries(MOVEMENT_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Select value={direction} onChange={(e) => setDirection(e.target.value)} aria-label="Sentido">
            <option value="">Entradas e saídas</option>
            <option value="entrada">Somente entradas</option>
            <option value="saida">Somente saídas</option>
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Todos os status</option>
            <option value="rascunho">Rascunho</option>
            <option value="confirmado">Confirmado</option>
            <option value="estornado">Estornado</option>
          </Select>
          <LocationSelect value={location} onChange={setLocation} placeholder="Todos os locais" includeInactive aria-label="Local" />
          <div className="flex gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="De" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Até" />
          </div>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.rows.length ? (
          <EmptyState title="Nenhuma movimentação encontrada" />
        ) : (
          <>
            <MovementTable rows={data.rows} onOpen={setOpen} dim={loading} showCost={stockCan.viewCosts(user)} />
            <Pagination page={page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <MovementModal m={open} onClose={() => setOpen(null)} onChanged={() => (setOpen(null), reload())} />
    </div>
  );
};

// ================================================ SAÍDAS

const EXIT_TYPES: MovementType[] = ['saida_consumo', 'baixa_perda_avaria', 'outra_saida'];

export const SaidasView: React.FC = () => {
  const { user, settings } = useStock();
  const toast = useToast();
  const [item, setItem] = useState<StockItemRow | null>(null);
  const [form, setForm] = useState({ movement_type: 'saida_consumo' as MovementType, quantity: '', location_id: null as number | null, reason: '', reference_doc: '', notes: '', from_unavailable: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<Movement | null>(null);
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useAsync(() => api.get<{ total: number; page_size: number; rows: Movement[] }>(`/stock/movements${qs({ type: EXIT_TYPES.join(','), page, page_size: 15 })}`), [page]);
  const exits = data?.rows || [];

  const submit = async (confirm: boolean) => {
    const e: Record<string, string> = {};
    if (!item) e.item = 'Selecione o item.';
    if (!(Number(form.quantity.replace(',', '.')) > 0)) e.quantity = 'Quantidade inválida.';
    if (!form.location_id) e.location_id = 'Selecione o local de origem.';
    if (!form.reason) e.reason = 'Selecione o motivo.';
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const m = await api.post<Movement>('/stock/exits', { ...form, item_id: item!.id, quantity: Number(form.quantity.replace(',', '.')), confirm });
      toast('success', confirm ? `Saída ${m.number} confirmada.` : `Rascunho ${m.number} salvo (sem efeito no saldo até confirmar).`);
      setItem(null);
      setForm((f) => ({ ...f, quantity: '', reference_doc: '', notes: '', from_unavailable: false }));
      reload();
    } catch (err) {
      toast('error', (err as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Saídas de Estoque" subtitle="Saídas manuais autorizadas. Vendas e locações geram movimentação pelos próprios fluxos — não use esta tela para elas." />
      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5 items-start">
        {stockCan.operate(user) ? (
          <Card title={<span className="flex items-center gap-1.5"><Plus className="w-4 h-4" /> Nova saída</span>}>
            <div className="space-y-3">
              <Field label="Item" required error={errors.item}>
                {item ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 flex justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{item.description}</p>
                      <p className="text-[11px] text-slate-500">
                        {item.internal_code} • disponível {fmtQty(item.qty_available, item.unit)} • indisponível {fmtQty(item.qty_unavailable)}
                      </p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setItem(null)}>
                      Trocar
                    </Button>
                  </div>
                ) : (
                  <ItemSearch onPick={setItem} filter={{ tracking: 'quantidade' }} />
                )}
              </Field>
              <Field label="Tipo de saída" required>
                <Select value={form.movement_type} onChange={(e) => setForm({ ...form, movement_type: e.target.value as MovementType })}>
                  {EXIT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {MOVEMENT_LABELS[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Quantidade${item ? ` (${item.unit})` : ''}`} required error={errors.quantity}>
                  <Input inputMode="decimal" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} error={errors.quantity} />
                </Field>
                <Field label="Local de origem" required error={errors.location_id}>
                  <LocationSelect value={form.location_id} onChange={(v) => setForm({ ...form, location_id: v })} error={errors.location_id} />
                </Field>
              </div>
              <Field label="Motivo" required error={errors.reason}>
                <Select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} error={errors.reason}>
                  <option value="">Selecione...</option>
                  {settings.exit_reasons.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </Select>
              </Field>
              {form.movement_type === 'baixa_perda_avaria' && <Checkbox checked={form.from_unavailable} onChange={(v) => setForm({ ...form, from_unavailable: v })} label="Baixar da quantidade indisponível (avariada/separada)" />}
              <Field label="Documento de referência">
                <Input value={form.reference_doc} onChange={(e) => setForm({ ...form, reference_doc: e.target.value })} placeholder="Requisição, laudo, OS..." />
              </Field>
              <Field label="Observações">
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
              <p className="text-[11px] text-slate-500 flex items-start gap-1">
                <Info className="w-3.5 h-3.5 shrink-0 mt-px" /> Responsável: {user.name}. Equipamentos individuais saem por baixa patrimonial na ficha do equipamento.
              </p>
              <div className="flex justify-end gap-2">
                <Button loading={saving} onClick={() => submit(false)}>
                  Salvar rascunho
                </Button>
                <Button variant="primary" loading={saving} onClick={() => submit(true)}>
                  Confirmar saída
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          <Notice>Seu perfil não registra saídas.</Notice>
        )}
        <Card title="Saídas recentes" bodyClassName="p-0">
          {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !exits.length ? <EmptyState title="Nenhuma saída manual registrada" /> : <MovementTable rows={exits} onOpen={setOpen} showCost={stockCan.viewCosts(user)} />}
          {data && <Pagination page={page} pageSize={data.page_size} total={data.total} onPage={setPage} />}
        </Card>
      </div>
      <MovementModal m={open} onClose={() => setOpen(null)} onChanged={() => (setOpen(null), reload())} />
    </div>
  );
};
