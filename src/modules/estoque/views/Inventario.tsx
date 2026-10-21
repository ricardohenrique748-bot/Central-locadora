/**
 * Inventário físico: abertura por escopo, contagem, conferência, aprovação (gestor) e ajustes automáticos.
 */

import React, { useEffect, useState } from 'react';
import { Plus, Save, Send, CheckCircle2, Ban, Undo2, AlertTriangle } from 'lucide-react';
import { ITEM_KIND_LABELS, Inventory, InventoryScope, StockItemRow } from '../../../../shared/estoque/types';
import { stockCan } from '../../../../shared/estoque/rules';
import { formatDateTimeBR } from '../../../../shared/orcamentos/dates';
import { api, ApiError } from '../../orcamentos/api';
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader, Select, Textarea, cx, useAsync, useToast } from '../../orcamentos/ui';
import { useStock } from '../context';
import { InvBadge, ItemSearch, LocationSelect, Th, fmtQty } from '../components';

export const InventarioView: React.FC = () => {
  const { navigate, user, settings } = useStock();
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api.get<{ rows: any[] }>('/stock/inventories'), []);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ scope: 'local' as InventoryScope, location_id: null as number | null, category: '', kind: '', notes: '' });
  const [items, setItems] = useState<StockItemRow[]>([]);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    try {
      const inv = await api.post<Inventory>('/stock/inventories', { ...form, item_ids: items.map((i) => i.id) });
      toast('success', `Inventário ${inv.number} aberto com ${inv.lines.length} linha(s).`);
      navigate({ page: 'inventario_det', id: inv.id });
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Inventário"
        subtitle="Contagem física com referência temporal. Ajustes só após aprovação e sempre por movimentação auditável."
        actions={
          stockCan.operate(user) && (
            <Button variant="primary" icon={Plus} onClick={() => setOpen(true)}>
              Iniciar inventário
            </Button>
          )
        }
      />
      <Card bodyClassName="p-0">
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.rows.length ? (
          <EmptyState title="Nenhum inventário" text="Inicie uma contagem por local, categoria, tipo ou itens específicos." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Número</Th>
                  <Th>Escopo</Th>
                  <Th>Aberto em</Th>
                  <Th right>Linhas</Th>
                  <Th right>Divergências</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((v) => (
                  <tr key={v.id} className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer" onClick={() => navigate({ page: 'inventario_det', id: v.id })}>
                    <td className="px-4 py-2.5 font-semibold text-[#1e3a5f]">{v.number}</td>
                    <td className="px-4 py-2.5">
                      {v.scope_label}
                      {v.location_name && <span className="text-slate-500"> • {v.location_name}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {formatDateTimeBR(v.opened_at)} • {v.opened_by_name}
                    </td>
                    <td className="px-4 py-2.5 text-right">{v.lines}</td>
                    <td className={cx('px-4 py-2.5 text-right', v.divergences ? 'text-amber-700 font-semibold' : '')}>{v.divergences}</td>
                    <td className="px-4 py-2.5">
                      <InvBadge s={v.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Iniciar inventário"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancelar</Button>
            <Button variant="primary" loading={busy} onClick={start}>
              Abrir inventário
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Inventariar por">
            <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as InventoryScope })}>
              <option value="local">Localização</option>
              <option value="categoria">Categoria</option>
              <option value="tipo">Tipo de item</option>
              <option value="itens">Itens específicos</option>
              <option value="geral">Inventário geral (todos os locais)</option>
            </Select>
          </Field>
          {form.scope !== 'geral' && (
            <Field label={form.scope === 'local' || form.scope === 'itens' ? 'Local inventariado' : 'Local (opcional — vazio = todos)'} required={form.scope === 'local' || form.scope === 'itens'}>
              <LocationSelect value={form.location_id} onChange={(v) => setForm({ ...form, location_id: v })} placeholder="Todos os locais" />
            </Field>
          )}
          {form.scope === 'categoria' && (
            <Field label="Categoria" required>
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                <option value="">Selecione...</option>
                {settings.categories.map((c) => (
                  <option key={c.name}>{c.name}</option>
                ))}
              </Select>
            </Field>
          )}
          {form.scope === 'tipo' && (
            <Field label="Tipo de item" required>
              <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="">Selecione...</option>
                {Object.entries(ITEM_KIND_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {form.scope === 'itens' && (
            <Field label="Itens">
              <ItemSearch onPick={(i) => setItems((x) => (x.some((y) => y.id === i.id) ? x : [...x, i]))} />
              <div className="flex flex-wrap gap-1 mt-2">
                {items.map((i) => (
                  <button key={i.id} onClick={() => setItems((x) => x.filter((y) => y.id !== i.id))} className="text-xs bg-slate-100 rounded px-2 py-1 hover:bg-red-50" title="Remover">
                    {i.internal_code} ×
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Field label="Observações">
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
          <Notice>O saldo do sistema de cada linha é fotografado na abertura. Movimentações feitas durante a contagem continuam valendo e são sinalizadas na aprovação.</Notice>
        </div>
      </Modal>
    </div>
  );
};

export const InventarioDetalhe: React.FC<{ id: number }> = ({ id }) => {
  const { navigate, user } = useStock();
  const toast = useToast();
  const { data: inv, error, loading, reload, setData } = useAsync(() => api.get<Inventory>(`/stock/inventories/${id}`), [id]);
  const [counts, setCounts] = useState<Record<number, { counted: string; justification: string }>>({});
  const [busy, setBusy] = useState(false);
  const [reasonFor, setReasonFor] = useState<'cancelar' | 'devolver' | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (inv) setCounts(Object.fromEntries(inv.lines.map((l) => [l.id, { counted: l.counted_qty === null ? '' : String(l.counted_qty), justification: l.justification || '' }])));
  }, [inv?.id, inv?.status]);

  if (loading && !inv) return <Loading />;
  if (error || !inv) return <ErrorState message={error || 'Inventário não encontrado.'} onRetry={reload} />;
  const counting = ['em_andamento', 'aguardando_conferencia'].includes(inv.status) && stockCan.operate(user);

  const saveCounts = async () => {
    const lines = inv.lines.map((l) => ({ id: l.id, counted_qty: counts[l.id]?.counted === '' ? null : Number(counts[l.id]?.counted.replace(',', '.')), justification: counts[l.id]?.justification || null }));
    const x = await api.put<Inventory>(`/stock/inventories/${id}/counts`, { lines });
    setData(x);
    return x;
  };
  const act = async (action: string, body: any = {}, ok = 'Inventário atualizado.') => {
    setBusy(true);
    try {
      if (counting) await saveCounts();
      setData(await api.post<Inventory>(`/stock/inventories/${id}/${action}`, body));
      toast('success', ok);
      return true;
    } catch (e) {
      toast('error', (e as ApiError).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const diffOf = (l: Inventory['lines'][number]) => {
    const c = counts[l.id]?.counted;
    if (c === undefined || c === '') return null;
    const n = Number(c.replace(',', '.'));
    return Number.isFinite(n) ? Math.round((n - l.system_qty) * 1000) / 1000 : null;
  };
  const divergences = inv.lines.filter((l) => (diffOf(l) ?? 0) !== 0).length;
  const counted = inv.lines.filter((l) => counts[l.id]?.counted !== '' && counts[l.id]?.counted !== undefined).length;
  const moved = inv.lines.filter((l) => l.moved_since_snapshot !== 0);

  return (
    <div>
      <PageHeader title={`Inventário ${inv.number}`} subtitle={`${inv.scope_label}${inv.location_name ? ` • ${inv.location_name}` : ''} • aberto em ${formatDateTimeBR(inv.opened_at)} por ${inv.opened_by_name}`} onBack={() => navigate({ page: 'inventario' })} actions={<InvBadge s={inv.status} />} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-500">Linhas</p><p className="text-xl font-extrabold">{inv.lines.length}</p></div>
        <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-500">Contadas</p><p className="text-xl font-extrabold">{counted}</p></div>
        <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-500">Divergências</p><p className={cx('text-xl font-extrabold', divergences > 0 && 'text-amber-700')}>{divergences}</p></div>
        <div className="bg-white rounded-xl border border-slate-200 p-3"><p className="text-xs text-slate-500">Aprovação</p><p className="text-sm font-semibold mt-1">{inv.approved_by_name ? `${inv.approved_by_name} • ${formatDateTimeBR(inv.approved_at)}` : '—'}</p></div>
      </div>
      {moved.length > 0 && inv.status !== 'finalizado' && (
        <Notice kind="warning" className="mb-4">
          {moved.length} linha(s) tiveram movimentação depois da abertura. O ajuste considera a contagem como retrato do momento da abertura (contado − saldo na abertura) e é aplicado sobre o saldo atual — confira essas linhas antes de aprovar.
        </Notice>
      )}
      {inv.notes && <Notice className="mb-4"><span className="whitespace-pre-line">{inv.notes}</span></Notice>}
      <Card bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead className="bg-slate-50">
              <tr>
                <Th>Item</Th>
                <Th>Local</Th>
                <Th right>Sistema (abertura)</Th>
                <Th right>Contado</Th>
                <Th right>Diferença</Th>
                <Th>Justificativa</Th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l) => {
                const d = diffOf(l);
                return (
                  <tr key={l.id} className={cx('border-t border-slate-100 align-top', !!d && 'bg-amber-50/40')}>
                    <td className="px-4 py-2">
                      <p className="font-semibold text-slate-800">{l.item_description}</p>
                      <p className="text-[11px] font-mono text-slate-500">
                        {l.item_code}
                        {l.tracking === 'individual' && ' • patrimônio (sem ajuste automático)'}
                      </p>
                      {l.moved_since_snapshot !== 0 && (
                        <p className="text-[11px] text-amber-700 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> movimentou {l.moved_since_snapshot > 0 ? '+' : ''}
                          {fmtQty(l.moved_since_snapshot)} durante a contagem
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{l.location_name}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtQty(l.system_qty, l.unit)}</td>
                    <td className="px-4 py-2 text-right w-32">
                      {counting ? (
                        <Input inputMode="decimal" className="text-right" value={counts[l.id]?.counted ?? ''} onChange={(e) => setCounts({ ...counts, [l.id]: { ...counts[l.id], counted: e.target.value } })} aria-label={`Contado ${l.item_code}`} />
                      ) : (
                        <span className="tabular-nums">{fmtQty(l.counted_qty)}</span>
                      )}
                    </td>
                    <td className={cx('px-4 py-2 text-right tabular-nums font-semibold', d && d > 0 ? 'text-emerald-700' : d && d < 0 ? 'text-red-700' : 'text-slate-400')}>{d === null ? '—' : d > 0 ? `+${fmtQty(d)}` : fmtQty(d)}</td>
                    <td className="px-4 py-2 w-72">
                      {counting ? (
                        <Input value={counts[l.id]?.justification ?? ''} placeholder={d ? 'Obrigatória para divergência' : ''} onChange={(e) => setCounts({ ...counts, [l.id]: { ...counts[l.id], justification: e.target.value } })} />
                      ) : (
                        <span className="text-slate-600">{l.justification || '—'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex flex-wrap justify-end gap-2 mt-4">
        {['em_andamento', 'aguardando_conferencia', 'aguardando_aprovacao'].includes(inv.status) && (stockCan.operate(user) || stockCan.approve(user)) && (
          <Button icon={Ban} onClick={() => (setReasonFor('cancelar'), setReason(''))}>
            Cancelar inventário
          </Button>
        )}
        {counting && (
          <Button
            icon={Save}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await saveCounts();
                toast('success', 'Contagem salva.');
              } catch (e) {
                toast('error', (e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Salvar contagem
          </Button>
        )}
        {inv.status === 'em_andamento' && stockCan.operate(user) && (
          <Button variant="primary" icon={Send} loading={busy} onClick={() => act('enviar_conferencia', {}, 'Enviado para conferência.')}>
            Enviar para conferência
          </Button>
        )}
        {inv.status === 'aguardando_conferencia' && stockCan.operate(user) && (
          <Button variant="primary" icon={Send} loading={busy} onClick={() => act('conferir', {}, 'Conferido — aguardando aprovação.')}>
            Conferido — enviar para aprovação
          </Button>
        )}
        {['aguardando_conferencia', 'aguardando_aprovacao'].includes(inv.status) && stockCan.approve(user) && (
          <Button icon={Undo2} onClick={() => (setReasonFor('devolver'), setReason(''))}>
            Devolver para recontagem
          </Button>
        )}
        {inv.status === 'aguardando_aprovacao' && stockCan.approve(user) && (
          <Button variant="success" icon={CheckCircle2} loading={busy} onClick={() => window.confirm(`Aprovar e gerar ${divergences} ajuste(s) de estoque?`) && act('aprovar', {}, 'Inventário finalizado. Ajustes lançados.')}>
            Aprovar e ajustar estoque
          </Button>
        )}
        {inv.status === 'aguardando_aprovacao' && !stockCan.approve(user) && <p className="text-xs text-slate-500 self-center">Aguardando aprovação de gestor ou administrador.</p>}
      </div>

      <Modal
        open={!!reasonFor}
        onClose={() => setReasonFor(null)}
        title={reasonFor === 'cancelar' ? 'Cancelar inventário' : 'Devolver para recontagem'}
        size="sm"
        footer={
          <>
            <Button onClick={() => setReasonFor(null)}>Voltar</Button>
            <Button variant={reasonFor === 'cancelar' ? 'danger' : 'primary'} loading={busy} onClick={async () => (await act(reasonFor!, { reason })) && setReasonFor(null)}>
              Confirmar
            </Button>
          </>
        }
      >
        <Field label="Motivo" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
};
