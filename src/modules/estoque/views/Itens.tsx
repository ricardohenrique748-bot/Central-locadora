/**
 * Produtos e Equipamentos: listagem com saldos consolidados, ficha do item e cadastro em seções.
 * O saldo nunca é editado aqui — só por movimentações (entrada, saída, ajuste de inventário...).
 */

import React, { useEffect, useState } from 'react';
import { Plus, Search, Pencil, ImagePlus, Trash2, Package, ArrowDownToLine, Wrench, CheckCircle2, AlertTriangle, Boxes } from 'lucide-react';
import { ITEM_KIND_LABELS, ItemKind, MOVEMENT_LABELS, Movement, StockItem, StockItemInput, StockItemRow, Supplier, TRACKING_LABELS, Balance } from '../../../../shared/estoque/types';
import { KIND_DEFAULTS, estimatedMargin, validateStockItem } from '../../../../shared/estoque/validators';
import { stockCan } from '../../../../shared/estoque/rules';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { formatDateBR, formatDateTimeBR } from '../../../../shared/orcamentos/dates';
import { api, ApiError, qs } from '../../orcamentos/api';
import { Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Loading, Modal, MoneyInput, Notice, PageHeader, Pagination, Select, Textarea, cx, useAsync, useDebounced, useToast } from '../../orcamentos/ui';
import { useStock } from '../context';
import { LocationSelect, Th, fmtQty } from '../components';

// ================================================ LISTAGEM

export const ItensView: React.FC<{ initialSituation?: string; initialKind?: ItemKind }> = ({ initialSituation, initialKind }) => {
  const { navigate, settings, user } = useStock();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<string>(initialKind || '');
  const parts = kind === 'peca';
  const [category, setCategory] = useState('');
  const [tracking, setTracking] = useState('');
  const [location, setLocation] = useState<number | null>(null);
  const [situation, setSituation] = useState(initialSituation || '');
  const [active, setActive] = useState('true');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq, kind, category, tracking, location, situation, active]);
  const { data, error, loading, reload } = useAsync(
    () => api.get<{ total: number; page_size: number; rows: StockItemRow[] }>(`/stock/items${qs({ q: dq, kind, category, tracking, location_id: location, situation, active, page })}`),
    [dq, kind, category, tracking, location, situation, active, page]
  );

  return (
    <div>
      <PageHeader
        title={parts ? 'Peças de reposição' : 'Produtos e Equipamentos'}
        subtitle={parts ? 'Peças usadas nos consertos e na manutenção. Saldos somam todos os locais; entrada e saída como qualquer item.' : 'Cadastro único usado pelo Estoque e pelos Orçamentos. Saldos somam todos os locais.'}
        actions={
          stockCan.manageItems(user) && (
            <Button variant="primary" icon={Plus} onClick={() => navigate(parts ? { page: 'item_novo', kind: 'peca' } : { page: 'item_novo' })}>
              {parts ? 'Cadastrar peça' : 'Cadastrar item'}
            </Button>
          )
        }
      />
      <Card bodyClassName="p-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2 p-4 border-b border-slate-100">
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código, nome, marca, código de barras" className="pl-9" aria-label="Pesquisar itens" />
          </div>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo">
            <option value="">Todos os tipos</option>
            {Object.entries(ITEM_KIND_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoria">
            <option value="">Todas as categorias</option>
            {settings.categories.map((c) => (
              <option key={c.name}>{c.name}</option>
            ))}
          </Select>
          <LocationSelect value={location} onChange={setLocation} placeholder="Todos os locais" includeInactive aria-label="Local" />
          <Select value={situation} onChange={(e) => setSituation(e.target.value)} aria-label="Situação do saldo">
            <option value="">Qualquer saldo</option>
            <option value="abaixo_minimo">Abaixo do mínimo</option>
            <option value="sem_saldo">Sem saldo</option>
          </Select>
          <div className="flex gap-2">
            <Select value={tracking} onChange={(e) => setTracking(e.target.value)} aria-label="Controle">
              <option value="">Controle</option>
              <option value="quantidade">Quantidade</option>
              <option value="individual">Individual</option>
            </Select>
            <Select value={active} onChange={(e) => setActive(e.target.value)} aria-label="Situação do cadastro">
              <option value="true">Ativos</option>
              <option value="false">Inativos</option>
              <option value="">Todos</option>
            </Select>
          </div>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.rows.length ? (
          <EmptyState title="Nenhum item encontrado" text="Ajuste os filtros ou cadastre um item." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Código</Th>
                    <Th>Item</Th>
                    <Th className="hidden lg:table-cell">Tipo</Th>
                    <Th right>Físico</Th>
                    <Th right>Reserv.</Th>
                    <Th right>Indisp.</Th>
                    <Th right>Disponível</Th>
                    <Th right className="hidden xl:table-cell">Com clientes</Th>
                    <Th right>Mínimo</Th>
                  </tr>
                </thead>
                <tbody className={cx(loading && 'opacity-60')}>
                  {data.rows.map((i) => {
                    const low = i.tracking === 'quantidade' && i.min_qty !== null && i.qty_available < i.min_qty;
                    return (
                      <tr key={i.id} className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer" onClick={() => navigate({ page: 'item', id: i.id })}>
                        <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-700">{i.internal_code}</td>
                        <td className="px-4 py-2.5">
                          <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                            {i.description}
                            {!i.active && <span className="text-[10px] font-bold uppercase bg-slate-200 text-slate-600 px-1.5 rounded">Inativo</span>}
                          </p>
                          <p className="text-xs text-slate-500">{[i.category, i.brand, i.model].filter(Boolean).join(' • ') || '—'}</p>
                        </td>
                        <td className="px-4 py-2.5 hidden lg:table-cell text-slate-600 text-xs">
                          {ITEM_KIND_LABELS[i.kind]}
                          <span className="block text-slate-400">{i.tracking === 'individual' ? 'Individual' : 'Quantidade'}</span>
                        </td>
                        {i.tracking === 'individual' ? (
                          <>
                            <td className="px-4 py-2.5 text-right tabular-nums">{i.assets_total} un</td>
                            <td className="px-4 py-2.5 text-right text-slate-400">—</td>
                            <td className="px-4 py-2.5 text-right text-slate-400">—</td>
                            <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{i.assets_available} disp.</td>
                            <td className="px-4 py-2.5 text-right text-slate-400 hidden xl:table-cell">—</td>
                            <td className="px-4 py-2.5 text-right text-slate-400">—</td>
                          </>
                        ) : (
                          <>
                            <td className="px-4 py-2.5 text-right tabular-nums">{fmtQty(i.qty_physical)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{fmtQty(i.qty_reserved)}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{fmtQty(i.qty_unavailable)}</td>
                            <td className={cx('px-4 py-2.5 text-right tabular-nums font-semibold', low ? 'text-amber-700' : i.qty_available <= 0 ? 'text-red-700' : 'text-slate-900')}>
                              {fmtQty(i.qty_available, i.unit)}
                              {low && <span className="block text-[10px] font-normal">abaixo do mínimo</span>}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 hidden xl:table-cell">{i.qty_on_rent ? fmtQty(i.qty_on_rent) : '—'}</td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{i.min_qty !== null ? fmtQty(i.min_qty) : '—'}</td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={data.page_size} total={data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
};

// ================================================ FICHA DO ITEM

type ItemDetail = StockItemRow & { balances: Balance[]; movements: Movement[] };

export const ItemDetalhe: React.FC<{ id: number }> = ({ id }) => {
  const { navigate, user, locations } = useStock();
  const toast = useToast();
  const { data: i, error, loading, reload } = useAsync(() => api.get<ItemDetail>(`/stock/items/${id}`), [id]);
  const [qs_, setQs] = useState<{ action: 'separar' | 'liberar'; location_id: number | null; quantity: string; reason: string } | null>(null);
  const [saving, setSaving] = useState(false);

  if (loading && !i) return <Loading />;
  if (error || !i) return <ErrorState message={error || 'Item não encontrado.'} onRetry={reload} />;
  const showCost = stockCan.viewCosts(user);
  const margin = estimatedMargin(i.average_cost ?? i.acquisition_cost, i.sale_price);

  const submitQs = async () => {
    if (!qs_) return;
    setSaving(true);
    try {
      await api.post('/stock/items/quantity-status', { item_id: id, action: qs_.action, location_id: qs_.location_id, quantity: Number(qs_.quantity.replace(',', '.')), reason: qs_.reason });
      toast('success', qs_.action === 'separar' ? 'Quantidade separada como indisponível.' : 'Quantidade liberada.');
      setQs(null);
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const row = (l: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
      <dt className="text-slate-500">{l}</dt>
      <dd className="text-right font-medium text-slate-800">{v ?? '—'}</dd>
    </div>
  );

  return (
    <div>
      <PageHeader
        title={i.description}
        subtitle={`${i.internal_code} • ${ITEM_KIND_LABELS[i.kind]} • ${TRACKING_LABELS[i.tracking]}`}
        onBack={() => navigate({ page: 'itens' })}
        actions={
          <>
            {stockCan.operate(user) && (
              <Button icon={ArrowDownToLine} onClick={() => navigate({ page: 'entrada' })}>
                Nova entrada
              </Button>
            )}
            {stockCan.manageItems(user) && (
              <Button variant="primary" icon={Pencil} onClick={() => navigate({ page: 'item_editar', id })}>
                Editar cadastro
              </Button>
            )}
          </>
        }
      />
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <Card title={i.tracking === 'individual' ? 'Unidades patrimoniais' : 'Saldo por local'} bodyClassName="p-0">
            {i.tracking === 'individual' ? (
              <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-700">
                  <b>{i.assets_total}</b> unidade(s) ativa(s), <b>{i.assets_available}</b> disponível(is) para locação agora.
                </p>
                <Button icon={Boxes} onClick={() => navigate({ page: 'ativos' })}>
                  Ver equipamentos individuais
                </Button>
              </div>
            ) : i.balances.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">Sem saldo em nenhum local. Registre uma entrada.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <Th>Local</Th>
                      <Th right>Físico</Th>
                      <Th right>Reservado</Th>
                      <Th right>Indisponível</Th>
                      <Th right>Disponível</Th>
                      {stockCan.operate(user) && <Th />}
                    </tr>
                  </thead>
                  <tbody>
                    {i.balances.map((b) => (
                      <tr key={b.location_id} className="border-t border-slate-100">
                        <td className="px-4 py-2">{b.location_name}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmtQty(b.quantity, i.unit)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmtQty(b.reserved)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{fmtQty(b.unavailable)}</td>
                        <td className="px-4 py-2 text-right tabular-nums font-semibold">{fmtQty(b.quantity - b.reserved - b.unavailable, i.unit)}</td>
                        {stockCan.operate(user) && (
                          <td className="px-4 py-2 text-right whitespace-nowrap">
                            <Button size="sm" variant="ghost" icon={Wrench} onClick={() => setQs({ action: 'separar', location_id: b.location_id, quantity: '', reason: '' })}>
                              Separar
                            </Button>
                            {b.unavailable > 0 && (
                              <Button size="sm" variant="ghost" icon={CheckCircle2} onClick={() => setQs({ action: 'liberar', location_id: b.location_id, quantity: String(b.unavailable), reason: '' })}>
                                Liberar
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                      <td className="px-4 py-2">Total</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtQty(i.qty_physical, i.unit)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtQty(i.qty_reserved)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtQty(i.qty_unavailable)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtQty(i.qty_available, i.unit)}</td>
                      {stockCan.operate(user) && <td />}
                    </tr>
                  </tfoot>
                </table>
                {(i.qty_in_transit > 0 || i.qty_on_rent > 0) && (
                  <p className="px-4 py-2 text-xs text-slate-500 border-t border-slate-100">
                    {i.qty_in_transit > 0 && `${fmtQty(i.qty_in_transit, i.unit)} em trânsito entre locais. `}
                    {i.qty_on_rent > 0 && `${fmtQty(i.qty_on_rent, i.unit)} com clientes (locação em uso — continuam no patrimônio).`}
                  </p>
                )}
              </div>
            )}
          </Card>

          <Card title="Últimas movimentações" actions={<Button size="sm" variant="ghost" onClick={() => navigate({ page: 'movimentacoes' })}>Ver todas</Button>} bodyClassName="p-0">
            {i.movements.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-8">Nenhuma movimentação.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {i.movements.map((m) => (
                  <li key={m.id} className="px-4 py-2 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800">
                        {MOVEMENT_LABELS[m.movement_type]} {m.asset_tag && <span className="font-normal text-slate-500">• {m.asset_tag}</span>}
                        {m.status === 'estornado' && <span className="ml-1 text-[10px] uppercase bg-slate-200 px-1 rounded">estornado</span>}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {m.number} • {formatDateTimeBR(m.created_at)} • {m.origin_name || m.dest_name || ''} • {m.created_by_name}
                      </p>
                    </div>
                    <span className={cx('tabular-nums font-semibold', m.qty_delta > 0 ? 'text-emerald-700' : m.qty_delta < 0 ? 'text-red-700' : 'text-slate-500')}>
                      {m.qty_delta > 0 ? '+' : m.qty_delta < 0 ? '−' : ''}
                      {fmtQty(m.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          {i.image_data && <img src={i.image_data} alt="" className="w-full max-h-56 object-contain bg-white rounded-xl border border-slate-200" />}
          <Card title="Dados comerciais">
            <dl className="text-sm">
              {showCost && row('Custo médio', formatBRL(i.average_cost))}
              {showCost && row('Último custo de aquisição', formatBRL(i.acquisition_cost))}
              {i.sale_enabled && row('Preço de venda', formatBRL(i.sale_price))}
              {showCost && i.sale_enabled && row('Margem estimada', margin !== null ? `${margin.toLocaleString('pt-BR')}%` : '—')}
              {i.rental_enabled && row('Locação diária', formatBRL(i.daily_rental_price))}
              {i.rental_enabled && row('Locação semanal', formatBRL(i.weekly_rental_price))}
              {i.rental_enabled && row('Locação mensal', formatBRL(i.monthly_rental_price))}
              {row('Fornecedor principal', i.supplier_name)}
              {row('Última compra', formatDateBR(i.last_purchase_date))}
            </dl>
          </Card>
          <Card title="Controle">
            <dl className="text-sm">
              {row('Unidade', i.unit)}
              {row('Mínimo / máximo', `${i.min_qty ?? '—'} / ${i.max_qty ?? '—'}`)}
              {row('Local padrão', locations.find((l) => l.id === i.default_location_id)?.name)}
              {row('Saldo negativo', i.allow_negative ? 'Permitido' : 'Não permitido')}
              {row('Código de barras', i.barcode)}
              {row('Categoria', [i.category, i.subcategory].filter(Boolean).join(' › '))}
            </dl>
          </Card>
        </aside>
      </div>

      <Modal
        open={!!qs_}
        onClose={() => setQs(null)}
        title={qs_?.action === 'separar' ? 'Separar como indisponível (manutenção/avaria)' : 'Liberar quantidade avaliada'}
        size="sm"
        footer={
          <>
            <Button onClick={() => setQs(null)}>Cancelar</Button>
            <Button variant="primary" loading={saving} onClick={submitQs}>
              Confirmar
            </Button>
          </>
        }
      >
        {qs_ && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {qs_.action === 'separar'
                ? 'A quantidade continua no local, mas deixa de ser disponível para venda/locação até ser liberada.'
                : 'Libera a quantidade indisponível após avaliação. Para descartar, use Saídas → baixa por perda ou avaria.'}
            </p>
            <Field label="Quantidade" required>
              <Input inputMode="decimal" value={qs_.quantity} onChange={(e) => setQs({ ...qs_, quantity: e.target.value })} />
            </Field>
            <Field label={qs_.action === 'separar' ? 'Motivo' : 'Resultado da avaliação'} required>
              <Textarea value={qs_.reason} onChange={(e) => setQs({ ...qs_, reason: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
};

// ================================================ CADASTRO

const EMPTY: StockItemInput = {
  internal_code: '',
  description: '',
  long_description: null,
  kind: 'produto_venda',
  tracking: 'quantidade',
  category: null,
  subcategory: null,
  brand: null,
  model: null,
  unit: 'un',
  barcode: null,
  notes: null,
  image_data: null,
  active: true,
  sale_enabled: true,
  rental_enabled: false,
  acquisition_cost: null,
  sale_price: null,
  daily_rental_price: null,
  weekly_rental_price: null,
  monthly_rental_price: null,
  custom_rental_price: null,
  main_supplier_id: null,
  supplier_code: null,
  min_qty: null,
  max_qty: null,
  default_location_id: null,
  allow_negative: false,
  technical_description: null,
};

function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 600 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => reject(new Error('Arquivo de imagem inválido.'));
    img.src = URL.createObjectURL(file);
  });
}

const Section: React.FC<{ n: string; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <Card
    title={
      <span className="flex items-center gap-2">
        <span className="w-6 h-6 rounded-md bg-[#1e3a5f] text-white text-xs font-bold flex items-center justify-center">{n}</span>
        {title}
      </span>
    }
  >
    {children}
  </Card>
);

export const ItemForm: React.FC<{ id?: number; initialKind?: ItemKind }> = ({ id, initialKind }) => {
  const { navigate, settings, user } = useStock();
  const toast = useToast();
  // "Cadastro de peça" já abre com o tipo e os padrões de peça
  const [form, setForm] = useState<StockItemInput>(() =>
    initialKind ? { ...EMPTY, kind: initialKind, sale_enabled: KIND_DEFAULTS[initialKind].sale, rental_enabled: KIND_DEFAULTS[initialKind].rental } : EMPTY
  );
  const [original, setOriginal] = useState<StockItem | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ rows: Supplier[] }>('/stock/suppliers?active=true').then((r) => setSuppliers(r.rows)).catch(() => {});
    if (!id) return;
    api
      .get<StockItem>(`/stock/items/${id}`)
      .then((it) => {
        setOriginal(it);
        setForm({ ...EMPTY, ...it });
      })
      .catch((e) => toast('error', e.message))
      .finally(() => setLoading(false));
  }, [id, toast]);

  if (!stockCan.manageItems(user)) return <Notice kind="warning">Seu perfil não pode cadastrar ou alterar itens.</Notice>;
  if (loading) return <Loading />;

  const set = <K extends keyof StockItemInput>(k: K, v: StockItemInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const changeKind = (k: ItemKind) => {
    const d = KIND_DEFAULTS[k];
    setForm((f) => ({ ...f, kind: k, sale_enabled: d.sale, rental_enabled: d.rental, tracking: ['equipamento_locacao', 'venda_locacao', 'acessorio'].includes(k) ? f.tracking : 'quantidade' }));
  };
  const subcats = settings.categories.find((c) => c.name === form.category)?.subcategories || [];
  const margin = estimatedMargin(form.acquisition_cost, form.sale_price);
  const individualAllowed = ['equipamento_locacao', 'venda_locacao', 'acessorio'].includes(form.kind);

  const save = async () => {
    const local = validateStockItem(form);
    setErrors(local);
    if (Object.keys(local).length) {
      toast('error', Object.values(local)[0]);
      return;
    }
    setSaving(true);
    try {
      const saved = id ? await api.put<StockItem>(`/stock/items/${id}`, form) : await api.post<StockItem>('/stock/items', form);
      toast('success', id ? 'Item atualizado.' : `Item ${saved.internal_code} cadastrado.`);
      navigate({ page: 'item', id: saved.id });
    } catch (e) {
      const err = e as ApiError;
      if (err.fields) setErrors(err.fields);
      toast('error', err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={id ? `Editar ${original?.internal_code}` : initialKind === 'peca' ? 'Cadastro de Peça' : 'Cadastro de Item'}
        subtitle="Saldos não são digitados aqui: registre uma entrada (compra ou implantação inicial) depois de salvar."
        onBack={() => navigate(id ? { page: 'item', id } : initialKind === 'peca' ? { page: 'itens', kind: 'peca' } : { page: 'itens' })}
      />
      <div className="space-y-5 max-w-5xl">
        <Section n="1" title="Identificação">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
            <Field label="Código interno" error={errors.internal_code} hint={id ? undefined : 'Deixe vazio para gerar automaticamente'} className="md:col-span-2">
              <Input value={form.internal_code} onChange={(e) => set('internal_code', e.target.value.toUpperCase())} error={errors.internal_code} placeholder="Automático" />
            </Field>
            <Field label="Nome do item" required error={errors.description} className="md:col-span-4">
              <Input value={form.description} onChange={(e) => set('description', e.target.value)} error={errors.description} />
            </Field>
            <Field label="Tipo de item" required error={errors.kind} className="md:col-span-2">
              <Select value={form.kind} onChange={(e) => changeKind(e.target.value as ItemKind)}>
                {Object.entries(ITEM_KIND_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Controle" required error={errors.tracking} className="md:col-span-2" hint={!individualAllowed ? 'Individual só para equipamentos e acessórios patrimoniais' : undefined}>
              <Select value={form.tracking} onChange={(e) => set('tracking', e.target.value as any)} disabled={!individualAllowed}>
                {Object.entries(TRACKING_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Unidade de medida" required error={errors.unit} className="md:col-span-2">
              <Select value={form.unit} onChange={(e) => set('unit', e.target.value)}>
                {!settings.units.some((u) => u.code === form.unit) && <option value={form.unit}>{form.unit}</option>}
                {settings.units.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.code} — {u.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Categoria" className="md:col-span-2">
              <Select value={form.category || ''} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value || null, subcategory: null }))}>
                <option value="">—</option>
                {form.category && !settings.categories.some((c) => c.name === form.category) && <option>{form.category}</option>}
                {settings.categories.map((c) => (
                  <option key={c.name}>{c.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Subcategoria" className="md:col-span-2">
              <Select value={form.subcategory || ''} onChange={(e) => set('subcategory', e.target.value || null)} disabled={!subcats.length}>
                <option value="">—</option>
                {subcats.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label="Código de barras" error={errors.barcode} className="md:col-span-2" hint="O QR Code de cada patrimônio é gerado pelo nº do patrimônio">
              <Input value={form.barcode || ''} onChange={(e) => set('barcode', e.target.value || null)} error={errors.barcode} />
            </Field>
            <Field label="Marca" className="md:col-span-3">
              <Input value={form.brand || ''} onChange={(e) => set('brand', e.target.value || null)} />
            </Field>
            <Field label="Modelo" className="md:col-span-3">
              <Input value={form.model || ''} onChange={(e) => set('model', e.target.value || null)} />
            </Field>
            <Field label="Descrição" className="md:col-span-6">
              <Textarea value={form.long_description || ''} onChange={(e) => set('long_description', e.target.value || null)} />
            </Field>
            <Field label="Imagem" error={errors.image_data} className="md:col-span-3">
              <div className="flex items-center gap-3">
                {form.image_data ? (
                  <img src={form.image_data} alt="" className="w-16 h-16 rounded-lg object-cover border border-slate-200" />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-slate-100 flex items-center justify-center text-slate-300">
                    <Package className="w-7 h-7" />
                  </div>
                )}
                <label className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer">
                  <ImagePlus className="w-4 h-4" /> Escolher
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      try {
                        set('image_data', await resizeImage(f));
                      } catch (err: any) {
                        toast('error', err.message);
                      }
                    }}
                  />
                </label>
                {form.image_data && <Button variant="ghost" icon={Trash2} onClick={() => set('image_data', null)} aria-label="Remover imagem" />}
              </div>
            </Field>
            <Field label="Status do cadastro" className="md:col-span-3">
              <Checkbox checked={form.active} onChange={(v) => set('active', v)} label="Ativo (inativos não entram em novos orçamentos, entradas ou reservas)" />
            </Field>
            <Field label="Observações" className="md:col-span-6">
              <Textarea value={form.notes || ''} onChange={(e) => set('notes', e.target.value || null)} />
            </Field>
          </div>
        </Section>

        <Section n="2" title="Dados comerciais">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Field label="Custo de aquisição (referência)" hint="Atualizado automaticamente a cada compra" error={errors.acquisition_cost}>
              <MoneyInput value={form.acquisition_cost} onChange={(v) => set('acquisition_cost', v)} allowEmpty />
            </Field>
            <Field label="Custo médio">
              <Input value={original?.average_cost != null ? formatBRL(original.average_cost) : 'Calculado pelas entradas'} disabled />
            </Field>
            <Field label="Fornecedor principal" error={errors.main_supplier_id}>
              <Select value={form.main_supplier_id ?? ''} onChange={(e) => set('main_supplier_id', e.target.value ? Number(e.target.value) : null)}>
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Código do fornecedor">
              <Input value={form.supplier_code || ''} onChange={(e) => set('supplier_code', e.target.value || null)} />
            </Field>
            <div className={cx('md:col-span-4 rounded-lg border p-3', form.sale_enabled ? 'border-[#1e3a5f]/40 bg-slate-50' : 'border-slate-200')}>
              <Checkbox checked={form.sale_enabled} onChange={(v) => set('sale_enabled', v)} label={<b>Disponível para venda</b>} />
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-3">
                <Field label="Preço de venda" error={errors.sale_price}>
                  <MoneyInput value={form.sale_price} onChange={(v) => set('sale_price', v)} disabled={!form.sale_enabled} allowEmpty error={errors.sale_price} />
                </Field>
                <Field label="Margem estimada">
                  <Input value={margin !== null ? `${margin.toLocaleString('pt-BR')}%` : '—'} disabled />
                </Field>
              </div>
            </div>
            <div className={cx('md:col-span-4 rounded-lg border p-3', form.rental_enabled ? 'border-[#1e3a5f]/40 bg-slate-50' : 'border-slate-200')}>
              <Checkbox checked={form.rental_enabled} onChange={(v) => set('rental_enabled', v)} label={<b>Disponível para locação</b>} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-3">
                <Field label="Diária" error={errors.daily_rental_price}>
                  <MoneyInput value={form.daily_rental_price} onChange={(v) => set('daily_rental_price', v)} disabled={!form.rental_enabled} allowEmpty error={errors.daily_rental_price} />
                </Field>
                <Field label="Semanal">
                  <MoneyInput value={form.weekly_rental_price} onChange={(v) => set('weekly_rental_price', v)} disabled={!form.rental_enabled} allowEmpty />
                </Field>
                <Field label="Mensal">
                  <MoneyInput value={form.monthly_rental_price} onChange={(v) => set('monthly_rental_price', v)} disabled={!form.rental_enabled} allowEmpty />
                </Field>
                <Field label="Personalizado">
                  <MoneyInput value={form.custom_rental_price} onChange={(v) => set('custom_rental_price', v)} disabled={!form.rental_enabled} allowEmpty />
                </Field>
              </div>
            </div>
            <p className="md:col-span-4 text-[11px] text-slate-500">Os preços valem para novos orçamentos. Orçamentos já emitidos mantêm os valores do momento em que foram feitos.</p>
          </div>
        </Section>

        <Section n="3" title={form.tracking === 'individual' ? 'Controle patrimonial' : 'Controle de estoque'}>
          {form.tracking === 'individual' ? (
            <Notice>
              Cada unidade (patrimônio, nº de série, custo, data de aquisição, situação, fotos e documentos) é registrada na <b>entrada de estoque</b> e mantida em <b>Equipamentos Individuais</b>.
              O nº de série é opcional.
            </Notice>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Field label="Quantidade mínima" error={errors.min_qty}>
                <Input type="number" min={0} step="any" value={form.min_qty ?? ''} onChange={(e) => set('min_qty', e.target.value === '' ? null : Number(e.target.value))} error={errors.min_qty} />
              </Field>
              <Field label="Quantidade máxima (opcional)" error={errors.max_qty}>
                <Input type="number" min={0} step="any" value={form.max_qty ?? ''} onChange={(e) => set('max_qty', e.target.value === '' ? null : Number(e.target.value))} error={errors.max_qty} />
              </Field>
              <Field label="Localização padrão" error={errors.default_location_id}>
                <LocationSelect value={form.default_location_id} onChange={(v) => set('default_location_id', v)} placeholder="—" />
              </Field>
              <Field label="Saldo negativo">
                <Checkbox checked={form.allow_negative} onChange={(v) => set('allow_negative', v)} label="Permitir" />
              </Field>
            </div>
          )}
          {form.tracking === 'individual' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
              <Field label="Localização padrão" error={errors.default_location_id}>
                <LocationSelect value={form.default_location_id} onChange={(v) => set('default_location_id', v)} placeholder="—" />
              </Field>
            </div>
          )}
          <Field label="Descrição técnica" className="mt-4">
            <Textarea value={form.technical_description || ''} onChange={(e) => set('technical_description', e.target.value || null)} />
          </Field>
          {original && original.tracking !== form.tracking && (
            <p className="mt-2 text-xs text-amber-700 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" /> Só é possível trocar o controle se o item ainda não tiver movimentações.
            </p>
          )}
        </Section>

        <div className="flex justify-end gap-2">
          <Button onClick={() => navigate(id ? { page: 'item', id } : { page: 'itens' })}>Cancelar</Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {id ? 'Salvar alterações' : 'Cadastrar item'}
          </Button>
        </div>
      </div>
    </div>
  );
};
