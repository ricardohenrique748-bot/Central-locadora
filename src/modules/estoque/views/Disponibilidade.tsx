/**
 * Disponibilidade para locação + reservas (com período), entrega, retorno e encaminhamento à inspeção.
 * Um orçamento aprovado NÃO reserva sozinho: a reserva é criada aqui e confirmada com validação de conflitos.
 */

import React, { useEffect, useState } from 'react';
import { CalendarPlus, Search, CheckCircle2, Ban, Truck, Undo2, Info, ClipboardCheck } from 'lucide-react';
import { Asset, OPERATIONAL_LABELS, Reservation, StockItemRow } from '../../../../shared/estoque/types';
import { stockCan } from '../../../../shared/estoque/rules';
import { addDaysISO, formatDateBR, todayISO } from '../../../../shared/orcamentos/dates';
import { Customer, QuotationListRow } from '../../../../shared/orcamentos/types';
import { api, ApiError, qs } from '../../orcamentos/api';
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader, Select, Textarea, cx, useAsync, useDebounced, useToast } from '../../orcamentos/ui';
import { useStock } from '../context';
import { ItemSearch, LocationSelect, OpBadge, RentBadge, ResBadge, Th, fmtQty } from '../components';

interface AvRow {
  item_id: number;
  item_code: string;
  item_description: string;
  category: string | null;
  tracking: 'quantidade' | 'individual';
  asset_id: number | null;
  asset_tag: string | null;
  location_name: string | null;
  operational_status: any;
  rental_status: any;
  available_in_period: boolean;
  capacity: number | null;
  committed: number | null;
  free_qty: number | null;
  next_reservation: { number: string; start_date: string; end_date: string; customer_name: string | null } | null;
  current_rental: { number: string; end_date: string; customer_name: string | null; contract_ref: string | null } | null;
  available_from: string | null;
  reason: string | null;
}

export const DisponibilidadeView: React.FC = () => {
  const { user, settings, navigate } = useStock();
  const today = todayISO();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDaysISO(today, 7));
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState<number | null>(null);
  const [situation, setSituation] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [tab, setTab] = useState<'disponibilidade' | 'reservas'>('disponibilidade');
  const [newRes, setNewRes] = useState<{ item?: StockItemRow | { id: number; internal_code: string; description: string; tracking: 'individual' | 'quantidade'; unit: string }; asset_id?: number | null } | null>(null);

  const av = useAsync(() => api.get<{ rows: AvRow[] }>(`/stock/availability${qs({ from, to: to < from ? from : to, category, location_id: location, situation, q: dq })}`), [from, to, category, location, situation, dq]);

  return (
    <div>
      <PageHeader
        title="Disponibilidade para Locação"
        subtitle="Calculada pelo estado operacional, reservas confirmadas, locações em uso e transferências — não por campo manual."
        actions={
          stockCan.requestReservation(user) && (
            <Button variant="primary" icon={CalendarPlus} onClick={() => setNewRes({})}>
              Nova reserva
            </Button>
          )
        }
      />
      <div className="flex flex-wrap items-end gap-2 mb-4 p-3 bg-white rounded-xl border border-slate-200">
        <Field label="Início" className="w-[calc(50%-4px)] sm:w-36">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Término" className="w-[calc(50%-4px)] sm:w-36">
          <Input type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Categoria" className="w-[calc(50%-4px)] sm:w-44">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Todas</option>
            {settings.categories.map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Local" className="w-[calc(50%-4px)] sm:w-48">
          <LocationSelect value={location} onChange={setLocation} placeholder="Todos" />
        </Field>
        <Field label="Situação no período" className="w-full sm:w-44">
          <Select value={situation} onChange={(e) => setSituation(e.target.value)}>
            <option value="">Todos</option>
            <option value="disponivel">Disponíveis</option>
            <option value="indisponivel">Indisponíveis</option>
          </Select>
        </Field>
        <Field label="Equipamento" className="w-full sm:flex-1 sm:min-w-[180px]">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código ou nome" className="pl-9" />
          </div>
        </Field>
      </div>
      <div className="flex gap-1 mb-3">
        {(
          [
            ['disponibilidade', 'Disponibilidade no período'],
            ['reservas', 'Reservas e locações'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('px-3 py-1.5 rounded-lg text-sm font-semibold', tab === k ? 'bg-[#1e3a5f] text-white' : 'bg-white border border-slate-200 text-slate-600')}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'disponibilidade' && (
        <Card bodyClassName="p-0">
          <div className="px-4 py-2 border-b border-slate-100 text-[11px] text-slate-500 flex items-start gap-1">
            <Info className="w-3.5 h-3.5 shrink-0 mt-px" /> Datas inclusivas: um equipamento devolvido no dia X fica livre a partir de X+1, e só após inspeção aprovada.
          </div>
          {av.loading && !av.data ? (
            <Loading />
          ) : av.error ? (
            <ErrorState message={av.error} onRetry={av.reload} />
          ) : !av.data?.rows.length ? (
            <EmptyState title="Nenhum equipamento locável encontrado" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[960px]">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Equipamento</Th>
                    <Th>Patrimônio / qtd</Th>
                    <Th>Local</Th>
                    <Th>Estado</Th>
                    <Th>No período</Th>
                    <Th>Disponível a partir de</Th>
                    <Th>Contrato vigente / próxima reserva</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody className={cx(av.loading && 'opacity-60')}>
                  {av.data.rows.map((r) => (
                    <tr key={`${r.item_id}-${r.asset_id || 'q'}`} className="border-t border-slate-100 align-top">
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-slate-800">{r.item_description}</p>
                        <p className="text-[11px] text-slate-500">{[r.item_code, r.category].filter(Boolean).join(' • ')}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        {r.asset_tag ? (
                          <button className="font-semibold text-[#1e3a5f] hover:underline" onClick={() => navigate({ page: 'ativo', id: r.asset_id! })}>
                            {r.asset_tag}
                          </button>
                        ) : (
                          <span className="text-xs">
                            livre <b>{fmtQty(r.free_qty)}</b> de {fmtQty(r.capacity)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{r.rental_status === 'alugado' ? 'Com cliente' : r.location_name || (r.tracking === 'quantidade' ? 'Vários' : '—')}</td>
                      <td className="px-4 py-2.5 space-y-1">
                        {r.operational_status && <OpBadge s={r.operational_status} />}
                        {r.rental_status && (
                          <div>
                            <RentBadge s={r.rental_status} />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.available_in_period ? (
                          <span className="text-emerald-700 font-semibold text-xs">Disponível</span>
                        ) : (
                          <span className="text-red-700 text-xs">
                            <b>Indisponível</b>
                            <span className="block text-slate-500">{r.reason}</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs">{r.available_from ? formatDateBR(r.available_from) : r.tracking === 'individual' ? 'Após liberação' : '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-slate-600">
                        {r.current_rental && (
                          <p>
                            <b>Em uso:</b> {r.current_rental.customer_name} até {formatDateBR(r.current_rental.end_date)}
                            {r.current_rental.contract_ref ? ` (${r.current_rental.contract_ref})` : ''}
                          </p>
                        )}
                        {r.next_reservation && (
                          <p>
                            <b>Próxima:</b> {formatDateBR(r.next_reservation.start_date)}–{formatDateBR(r.next_reservation.end_date)} • {r.next_reservation.customer_name}
                          </p>
                        )}
                        {!r.current_rental && !r.next_reservation && '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {r.available_in_period && stockCan.requestReservation(user) && (
                          <Button size="sm" icon={CalendarPlus} onClick={() => setNewRes({ item: { id: r.item_id, internal_code: r.item_code, description: r.item_description, tracking: r.tracking, unit: '' }, asset_id: r.asset_id })}>
                            Reservar
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      {tab === 'reservas' && <ReservationsPanel from={from} to={to} onChanged={av.reload} />}

      {newRes && (
        <ReservationModal
          initial={newRes}
          from={from}
          to={to < from ? from : to}
          onClose={() => setNewRes(null)}
          onSaved={() => {
            setNewRes(null);
            av.reload();
            setTab('reservas');
          }}
        />
      )}
    </div>
  );
};

const ReservationsPanel: React.FC<{ from: string; to: string; onChanged: () => void }> = ({ from, to, onChanged }) => {
  const { user, navigate } = useStock();
  const toast = useToast();
  const [status, setStatus] = useState('pendente,confirmada,em_uso');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [onlyPeriod, setOnlyPeriod] = useState(false);
  const { data, error, loading, reload } = useAsync(() => api.get<{ rows: Reservation[] }>(`/stock/reservations${qs({ status, q: dq, from: onlyPeriod ? from : '', to: onlyPeriod ? to : '' })}`), [status, dq, onlyPeriod, from, to]);
  const [action, setAction] = useState<{ r: Reservation; kind: 'cancelar' | 'retornar' | 'entregar' } | null>(null);
  const [form, setForm] = useState({ reason: '', location_id: null as number | null, returned_qty: '', damaged_qty: '0', missing_qty: '0', notes: '' });
  const [busy, setBusy] = useState(false);

  const run = async (r: Reservation, kind: string, body: any = {}) => {
    setBusy(true);
    try {
      await api.post(`/stock/reservations/${r.id}/${kind}`, body);
      toast(
        'success',
        kind === 'confirmar' ? 'Reserva confirmada.' : kind === 'entregar' ? 'Entrega registrada — equipamento alugado.' : kind === 'retornar' ? (r.asset_id ? 'Retorno registrado — equipamento aguardando inspeção.' : 'Retorno registrado.') : 'Reserva cancelada.'
      );
      setAction(null);
      reload();
      onChanged();
      if (kind === 'retornar' && r.asset_id) navigate({ page: 'ativo', id: r.asset_id });
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card bodyClassName="p-0">
      <div className="flex flex-col sm:flex-row gap-2 p-4 border-b border-slate-100">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nº, cliente, patrimônio, equipamento" className="pl-9" aria-label="Pesquisar reservas" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-56" aria-label="Status">
          <option value="pendente,confirmada,em_uso">Abertas e em uso</option>
          <option value="pendente">Pendentes</option>
          <option value="confirmada">Confirmadas</option>
          <option value="em_uso">Em uso (entregues)</option>
          <option value="concluida">Concluídas</option>
          <option value="cancelada">Canceladas</option>
          <option value="">Todas</option>
        </Select>
        <label className="text-xs text-slate-600 flex items-center gap-1.5 whitespace-nowrap">
          <input type="checkbox" checked={onlyPeriod} onChange={(e) => setOnlyPeriod(e.target.checked)} className="accent-[#1e3a5f]" /> Só no período filtrado
        </label>
      </div>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data?.rows.length ? (
        <EmptyState title="Nenhuma reserva" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead className="bg-slate-50">
              <tr>
                <Th>Reserva</Th>
                <Th>Equipamento</Th>
                <Th>Cliente</Th>
                <Th>Período</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-2.5">
                    <p className="font-semibold text-slate-800">{r.number}</p>
                    <p className="text-[11px] text-slate-500">{[r.quotation_number, r.contract_ref].filter(Boolean).join(' • ') || `por ${r.created_by_name}`}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <p>{r.item_description}</p>
                    <p className="text-[11px] text-slate-500">{r.asset_tag ? <b>{r.asset_tag}</b> : `${fmtQty(r.quantity)} un.`}</p>
                  </td>
                  <td className="px-4 py-2.5">{r.customer_name}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {formatDateBR(r.start_date)} – {formatDateBR(r.end_date)}
                    {r.status === 'concluida' && r.asset_id === null && (
                      <p className="text-[11px] text-slate-500">
                        dev. {fmtQty(r.returned_qty)} • avar. {fmtQty(r.damaged_qty)} • falt. {fmtQty(r.missing_qty)}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <ResBadge s={r.status} />
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap space-x-1">
                    {r.status === 'pendente' && stockCan.confirmReservation(user) && (
                      <Button size="sm" variant="primary" icon={CheckCircle2} loading={busy} onClick={() => run(r, 'confirmar')}>
                        Confirmar
                      </Button>
                    )}
                    {r.status === 'confirmada' && stockCan.operate(user) && (
                      <Button size="sm" variant="primary" icon={Truck} onClick={() => (setAction({ r, kind: 'entregar' }), setForm({ ...form, location_id: r.location_id }))}>
                        Entregar
                      </Button>
                    )}
                    {r.status === 'em_uso' && stockCan.operate(user) && (
                      <Button size="sm" variant="primary" icon={Undo2} onClick={() => (setAction({ r, kind: 'retornar' }), setForm({ reason: '', location_id: r.location_id, returned_qty: String(r.quantity), damaged_qty: '0', missing_qty: '0', notes: '' }))}>
                        Registrar retorno
                      </Button>
                    )}
                    {['pendente', 'confirmada'].includes(r.status) && stockCan.requestReservation(user) && (
                      <Button size="sm" icon={Ban} onClick={() => (setAction({ r, kind: 'cancelar' }), setForm({ ...form, reason: '' }))}>
                        Cancelar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal
        open={!!action}
        onClose={() => setAction(null)}
        title={action ? `${action.kind === 'cancelar' ? 'Cancelar' : action.kind === 'entregar' ? 'Entregar' : 'Registrar retorno de'} ${action.r.number}` : ''}
        size="sm"
        footer={
          <>
            <Button onClick={() => setAction(null)}>Voltar</Button>
            <Button
              variant={action?.kind === 'cancelar' ? 'danger' : 'primary'}
              loading={busy}
              onClick={() =>
                action &&
                run(action.r, action.kind, {
                  reason: form.reason,
                  location_id: form.location_id,
                  notes: form.notes,
                  returned_qty: Number(form.returned_qty.replace(',', '.')),
                  damaged_qty: Number(form.damaged_qty.replace(',', '.')),
                  missing_qty: Number(form.missing_qty.replace(',', '.')),
                })
              }
            >
              Confirmar
            </Button>
          </>
        }
      >
        {action?.kind === 'cancelar' && (
          <Field label="Motivo do cancelamento" required>
            <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </Field>
        )}
        {action?.kind === 'entregar' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Registra a saída para o cliente. O equipamento continua no patrimônio da empresa (não é venda nem baixa).</p>
            {!action.r.asset_id && (
              <Field label="Local de saída" required>
                <LocationSelect value={form.location_id} onChange={(v) => setForm({ ...form, location_id: v })} />
              </Field>
            )}
          </div>
        )}
        {action?.kind === 'retornar' && (
          <div className="space-y-3">
            <Field label="Local de retorno" required>
              <LocationSelect value={form.location_id} onChange={(v) => setForm({ ...form, location_id: v })} />
            </Field>
            {action.r.asset_id ? (
              <Notice>
                <span className="flex items-start gap-1">
                  <ClipboardCheck className="w-4 h-4 shrink-0" /> O equipamento volta como <b>&nbsp;aguardando inspeção</b> e só fica disponível depois da inspeção aprovada na ficha.
                </span>
              </Notice>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <Field label="Devolvidas OK">
                  <Input inputMode="decimal" value={form.returned_qty} onChange={(e) => setForm({ ...form, returned_qty: e.target.value })} />
                </Field>
                <Field label="Avariadas">
                  <Input inputMode="decimal" value={form.damaged_qty} onChange={(e) => setForm({ ...form, damaged_qty: e.target.value })} />
                </Field>
                <Field label="Faltantes">
                  <Input inputMode="decimal" value={form.missing_qty} onChange={(e) => setForm({ ...form, missing_qty: e.target.value })} />
                </Field>
                <p className="col-span-3 text-[11px] text-slate-500">Total deve ser {fmtQty(action.r.quantity)}. Avariadas voltam como indisponíveis; faltantes ficam registradas para indenização (Financeiro futuro).</p>
              </div>
            )}
            <Field label="Observações do retorno">
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Condição, avarias aparentes, acessórios..." />
            </Field>
          </div>
        )}
      </Modal>
    </Card>
  );
};

const ReservationModal: React.FC<{ initial: { item?: any; asset_id?: number | null }; from: string; to: string; onClose: () => void; onSaved: () => void }> = ({ initial, from, to, onClose, onSaved }) => {
  const { user } = useStock();
  const toast = useToast();
  const [item, setItem] = useState<any>(initial.item || null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [form, setForm] = useState({ asset_id: initial.asset_id ?? null, quantity: '1', start_date: from, end_date: to, customer_id: null as number | null, customer_name: '', quotation_id: null as number | null, contract_ref: '', location_id: null as number | null, notes: '' });
  const [custQ, setCustQ] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [quotes, setQuotes] = useState<QuotationListRow[]>([]);
  const [busy, setBusy] = useState(false);
  const dc = useDebounced(custQ, 250);
  const canConfirm = stockCan.confirmReservation(user);

  useEffect(() => {
    if (item?.tracking === 'individual') api.get<{ rows: Asset[] }>(`/stock/assets${qs({ item_id: item.id, page_size: 100 })}`).then((r) => setAssets(r.rows)).catch(() => setAssets([]));
  }, [item?.id]);
  useEffect(() => {
    if (dc.trim().length < 2) return setCustomers([]);
    api.get<{ rows: Customer[] }>(`/customers${qs({ q: dc, active: 'true', limit: 6 })}`).then((r) => setCustomers(r.rows)).catch(() => setCustomers([]));
  }, [dc]);
  useEffect(() => {
    api.get<{ rows: QuotationListRow[] }>(`/quotations${qs({ type: 'locacao', status: 'aprovado_cliente,enviado,em_negociacao,aprovado_interno', page_size: 50 })}`).then((r) => setQuotes(r.rows)).catch(() => setQuotes([]));
  }, []);

  const save = async (confirm: boolean) => {
    setBusy(true);
    try {
      const r = await api.post<Reservation>('/stock/reservations', { ...form, item_id: item?.id, quantity: Number(form.quantity.replace(',', '.')), confirm });
      toast('success', r.status === 'confirmada' ? `Reserva ${r.number} confirmada.` : `Reserva ${r.number} registrada como pendente${confirm ? ' (seu perfil não confirma reservas)' : ''}.`);
      onSaved();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Nova reserva"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button loading={busy} onClick={() => save(false)}>
            Salvar como pendente
          </Button>
          {canConfirm && (
            <Button variant="primary" loading={busy} onClick={() => save(true)}>
              Confirmar reserva
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <Notice>Reservas pendentes não bloqueiam a agenda. A confirmação valida conflitos com reservas confirmadas e locações em uso, e bloqueia equipamentos em manutenção, danificados ou aguardando inspeção.</Notice>
        <Field label="Equipamento" required>
          {item ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 flex justify-between gap-2">
              <span className="text-sm font-semibold">
                {item.internal_code} — {item.description}
              </span>
              <Button size="sm" variant="ghost" onClick={() => (setItem(null), setForm({ ...form, asset_id: null }))}>
                Trocar
              </Button>
            </div>
          ) : (
            <ItemSearch onPick={setItem} filter={{ rental: '1' }} placeholder="Equipamento locável" />
          )}
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {item?.tracking === 'individual' ? (
            <Field label="Patrimônio" required>
              <Select value={form.asset_id ?? ''} onChange={(e) => setForm({ ...form, asset_id: Number(e.target.value) || null })}>
                <option value="">Selecione...</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id} disabled={!['novo', 'operacional'].includes(a.operational_status)}>
                    {a.asset_tag} — {OPERATIONAL_LABELS[a.operational_status]}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label="Quantidade" required>
              <Input inputMode="decimal" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            </Field>
          )}
          <Field label="Início" required>
            <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
          </Field>
          <Field label="Término" required>
            <Input type="date" min={form.start_date} value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
          </Field>
        </div>
        <Field label="Cliente" required>
          {form.customer_name ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 flex justify-between gap-2">
              <span className="text-sm font-semibold">{form.customer_name}</span>
              <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, customer_id: null, customer_name: '' })}>
                Trocar
              </Button>
            </div>
          ) : (
            <div className="relative">
              <Input value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder="Pesquisar cliente cadastrado ou digite o nome e tecle Enter" onKeyDown={(e) => e.key === 'Enter' && custQ.trim() && setForm({ ...form, customer_name: custQ.trim(), customer_id: null })} />
              {customers.length > 0 && (
                <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl">
                  {customers.map((c) => (
                    <button key={c.id} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50" onClick={() => (setForm({ ...form, customer_id: c.id, customer_name: c.name }), setCustQ(''), setCustomers([]))}>
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Orçamento de locação (opcional)">
            <Select
              value={form.quotation_id ?? ''}
              onChange={(e) => {
                const qid = Number(e.target.value) || null;
                const qr = quotes.find((x) => x.id === qid);
                setForm({ ...form, quotation_id: qid, ...(qr && !form.customer_name ? { customer_id: qr.customer_id, customer_name: qr.customer_name } : {}) });
              }}
            >
              <option value="">—</option>
              {quotes.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.quotation_number} — {x.customer_name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Contrato / referência">
            <Input value={form.contract_ref} onChange={(e) => setForm({ ...form, contract_ref: e.target.value })} />
          </Field>
          {item?.tracking !== 'individual' && (
            <Field label="Local de saída previsto">
              <LocationSelect value={form.location_id} onChange={(v) => setForm({ ...form, location_id: v })} placeholder="Padrão do item" />
            </Field>
          )}
        </div>
        <Field label="Observações">
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
};
