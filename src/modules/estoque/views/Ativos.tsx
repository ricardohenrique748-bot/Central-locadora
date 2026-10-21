/**
 * Equipamentos individuais (patrimônio): listagem e ficha com linha do tempo, estados, inspeção,
 * baixa patrimonial, fotos, documentos e QR Code do patrimônio.
 */

import { ORDER_STATUS_LABELS, OrderStatus } from '../../../../shared/os/types';
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Search, Pencil, Wrench, ShieldAlert, ClipboardCheck, Ban, Upload, FileText, Image as ImageIcon, Download, Printer, ArrowRightLeft, CalendarPlus, RotateCcw } from 'lucide-react';
import {
  Asset, AssetDetail, CONSERVATION_LABELS, Conservation, INSPECTION_CHECKLIST, MOVEMENT_LABELS, OPERATIONAL_LABELS, RENTAL_LABELS, Supplier,
} from '../../../../shared/estoque/types';
import { AssetAction, OPERATIONAL_TRANSITIONS, stockCan } from '../../../../shared/estoque/rules';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { formatDateBR, formatDateTimeBR } from '../../../../shared/orcamentos/dates';
import { api, ApiError, fetchBlob, qs, saveBlob } from '../../orcamentos/api';
import { Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Loading, Modal, MoneyInput, Notice, PageHeader, Pagination, Select, Textarea, cx, useAsync, useDebounced, useToast } from '../../orcamentos/ui';
import { useStock } from '../context';
import { LocationSelect, OpBadge, RentBadge, ResBadge, Th } from '../components';

export const AtivosView: React.FC<{ initialStatus?: string }> = ({ initialStatus }) => {
  const { navigate, settings, user } = useStock();
  const [q, setQ] = useState('');
  const [op, setOp] = useState(initialStatus?.startsWith('op:') ? initialStatus.slice(3) : '');
  const [rent, setRent] = useState(initialStatus && !initialStatus.startsWith('op:') ? initialStatus : '');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState<number | null>(null);
  const [withOff, setWithOff] = useState(false);
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  useEffect(() => setPage(1), [dq, op, rent, category, location, withOff]);
  const { data, error, loading, reload } = useAsync(
    () =>
      api.get<{ total: number; page_size: number; rows: Asset[] }>(
        `/stock/assets${qs({ q: dq, operational_status: op, rental_status: rent, category, location_id: location, include_written_off: withOff ? '1' : '', page })}`
      ),
    [dq, op, rent, category, location, withOff, page]
  );
  return (
    <div>
      <PageHeader title="Equipamentos Individuais" subtitle="Cada unidade com patrimônio, nº de série, situação e histórico próprios. Novas unidades entram pela Entrada de Estoque." />
      <Card bodyClassName="p-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 p-4 border-b border-slate-100">
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Patrimônio, nº de série, item" className="pl-9" aria-label="Pesquisar equipamentos" />
          </div>
          <Select value={op} onChange={(e) => setOp(e.target.value)} aria-label="Estado operacional">
            <option value="">Estado operacional</option>
            {Object.entries(OPERATIONAL_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <Select value={rent} onChange={(e) => setRent(e.target.value)} aria-label="Situação de locação">
            <option value="">Situação de locação</option>
            {Object.entries(RENTAL_LABELS).map(([v, l]) => (
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
          <div className="lg:col-span-6">
            <Checkbox checked={withOff} onChange={setWithOff} label="Incluir equipamentos baixados" />
          </div>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.rows.length ? (
          <EmptyState title="Nenhum equipamento encontrado" text="Registre equipamentos individuais por uma Entrada de Estoque." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Patrimônio</Th>
                    <Th>Equipamento</Th>
                    <Th>Local</Th>
                    <Th>Estado operacional</Th>
                    <Th>Locação</Th>
                    <Th className="hidden lg:table-cell">Aquisição</Th>
                    {stockCan.viewCosts(user) && <Th right className="hidden lg:table-cell">Custo</Th>}
                  </tr>
                </thead>
                <tbody className={cx(loading && 'opacity-60')}>
                  {data.rows.map((a) => (
                    <tr key={a.id} className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer" onClick={() => navigate({ page: 'ativo', id: a.id })}>
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-[#1e3a5f]">{a.asset_tag}</p>
                        {a.serial_number && <p className="text-[11px] text-slate-500">S/N {a.serial_number}</p>}
                      </td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-800">{a.item_description}</p>
                        <p className="text-[11px] text-slate-500">{[a.item_code, a.brand, a.model].filter(Boolean).join(' • ')}</p>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{a.rental_status === 'alugado' ? 'Com cliente' : a.location_name || '—'}</td>
                      <td className="px-4 py-2.5">
                        <OpBadge s={a.operational_status} />
                      </td>
                      <td className="px-4 py-2.5">
                        <RentBadge s={a.rental_status} />
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 hidden lg:table-cell">{formatDateBR(a.acquisition_date)}</td>
                      {stockCan.viewCosts(user) && <td className="px-4 py-2.5 text-right tabular-nums hidden lg:table-cell">{formatBRL(a.acquisition_cost)}</td>}
                    </tr>
                  ))}
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

// ================================================ FICHA

const ACTION_ICON: Record<AssetAction, React.ElementType> = {
  enviar_manutencao: Wrench,
  retornar_manutencao: RotateCcw,
  marcar_danificado: ShieldAlert,
  enviar_inspecao: ClipboardCheck,
  aprovar_inspecao: ClipboardCheck,
  baixar: Ban,
};

const toDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    r.readAsDataURL(file);
  });

/** Histórico de manutenção do equipamento (módulo de Ordens de Serviço). */
const MaintenanceHistory: React.FC<{ assetId: number; openOs: NonNullable<ReturnType<typeof useStock>['openOs']> }> = ({ assetId, openOs }) => {
  const { data } = useAsync(
    () => api.get<{ rows: { id: number; order_number: string; order_type: string; status: string; title: string; diagnosis: string | null; procedures: string | null; parts: string | null; opened_at: string; completed_at: string | null; actual_cost: number | null; downtime_hours: number | null; responsible_name: string | null; test_result: string | null }[] }>(`/os/equipment/${assetId}/history`),
    [assetId]
  );
  return (
    <Card
      title="Histórico de manutenção"
      actions={
        <Button size="sm" onClick={() => openOs({ assetId })}>
          Abrir OS
        </Button>
      }
    >
      {!data ? (
        <p className="text-xs text-slate-500">Carregando...</p>
      ) : !data.rows.length ? (
        <p className="text-sm text-slate-500">Nenhuma ordem de serviço para este equipamento.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.rows.map((o) => (
            <li key={o.id} className="py-2 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <button type="button" className="font-semibold text-[#1e3a5f] hover:underline" onClick={() => openOs({ orderId: o.id })}>
                  {o.order_number} — {o.order_type}
                </button>
                <span className="text-xs text-slate-500">
                  {formatDateBR(o.opened_at)}
                  {o.completed_at ? ` → ${formatDateBR(o.completed_at)}` : ' (em aberto)'} • {ORDER_STATUS_LABELS[o.status as OrderStatus] || o.status}
                </span>
              </div>
              <p className="text-slate-700">{o.title}</p>
              <p className="text-xs text-slate-500">
                {[o.diagnosis && `Diagnóstico: ${o.diagnosis}`, o.procedures && `Serviço: ${o.procedures}`, o.parts && `Peças: ${o.parts}`, o.actual_cost !== null && `Custo: ${(o.actual_cost / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, o.downtime_hours !== null && `Indisponível: ${o.downtime_hours} h`, o.responsible_name && `Resp.: ${o.responsible_name}`, o.test_result && `Resultado: ${o.test_result}`]
                  .filter(Boolean)
                  .join(' • ')}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

export const AtivoFicha: React.FC<{ id: number }> = ({ id }) => {
  const { navigate, user, openOs } = useStock();
  const toast = useToast();
  const { data: a, error, loading, reload } = useAsync(() => api.get<AssetDetail>(`/stock/assets/${id}`), [id]);
  const [action, setAction] = useState<AssetAction | null>(null);
  const [reason, setReason] = useState('');
  const [inspect, setInspect] = useState(false);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<'aprovado' | 'manutencao' | 'danificado'>('aprovado');
  const [notes, setNotes] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [tab, setTab] = useState<'linha' | 'reservas' | 'movimentos' | 'arquivos'>('linha');

  useEffect(() => {
    if (a) QRCode.toDataURL(`CENTRAL-LOCADORA|PATRIMONIO|${a.asset_tag}`, { margin: 1, width: 220 }).then(setQr).catch(() => setQr(null));
  }, [a?.asset_tag]);

  if (loading && !a) return <Loading />;
  if (error || !a) return <ErrorState message={error || 'Equipamento não encontrado.'} onRetry={reload} />;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', ok);
      reload();
      return true;
    } catch (e) {
      toast('error', (e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const available = (Object.keys(OPERATIONAL_TRANSITIONS) as AssetAction[]).filter((k) => {
    const t = OPERATIONAL_TRANSITIONS[k];
    if (!t.from.includes(a.operational_status)) return false;
    if (k === 'aprovar_inspecao') return false; // aprovação passa pelo checklist de inspeção
    if (a.rental_status === 'alugado' || a.rental_status === 'em_transito') return false;
    return k === 'baixar' ? stockCan.approve(user) : stockCan.operate(user);
  });

  const upload = async (kind: 'foto' | 'documento', file?: File) => {
    if (!file) return;
    if (file.size > 1_100_000) return toast('error', 'Arquivo muito grande (máx. ~1 MB).');
    const data = await toDataUrl(file);
    run(() => api.post(`/stock/assets/${id}/files`, { kind, name: file.name, data }), `${kind === 'foto' ? 'Foto' : 'Documento'} anexado.`);
  };

  const printLabel = () => {
    const w = window.open('', '_blank', 'width=420,height=520');
    if (!w || !qr) return;
    w.document.write(
      `<html><head><title>${a.asset_tag}</title></head><body style="font-family:sans-serif;text-align:center;padding:16px"><img src="${qr}" style="width:200px"/><h2 style="margin:6px 0">${a.asset_tag}</h2><p style="margin:0">${a.item_description}</p><p style="margin:4px 0;color:#555">${a.serial_number ? 'S/N ' + a.serial_number : ''}</p><p style="font-size:11px;color:#777">Central Locadora — patrimônio</p><script>window.onload=()=>window.print()</script></body></html>`
    );
    w.document.close();
  };

  const row = (l: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0 text-sm">
      <dt className="text-slate-500">{l}</dt>
      <dd className="text-right font-medium text-slate-800">{v || '—'}</dd>
    </div>
  );
  const photos = a.files.filter((f) => f.kind === 'foto');
  const docs = a.files.filter((f) => f.kind === 'documento');

  return (
    <div>
      <PageHeader
        title={`${a.asset_tag} — ${a.item_description}`}
        subtitle={[a.item_code, a.brand, a.model, a.serial_number && `S/N ${a.serial_number}`].filter(Boolean).join(' • ')}
        onBack={() => navigate({ page: 'ativos' })}
        actions={
          <>
            <OpBadge s={a.operational_status} />
            <RentBadge s={a.rental_status} />
            {stockCan.manageItems(user) && a.operational_status !== 'baixado' && (
              <Button icon={Pencil} onClick={() => setEditOpen(true)}>
                Editar dados
              </Button>
            )}
          </>
        }
      />

      {a.operational_status === 'baixado' && (
        <Notice kind="warning" className="mb-4">
          Baixado em {formatDateTimeBR(a.written_off_at)}: {a.write_off_reason}. O histórico é mantido para consulta.
        </Notice>
      )}

      <div className="flex flex-wrap gap-2 mb-4 p-3 bg-white rounded-xl border border-slate-200">
        <span className="text-xs font-semibold text-slate-500 self-center mr-1">Ações:</span>
        {a.operational_status === 'aguardando_inspecao' && stockCan.operate(user) && (
          <Button size="sm" variant="primary" icon={ClipboardCheck} onClick={() => setInspect(true)}>
            Registrar inspeção
          </Button>
        )}
        {available.map((k) => (
          <Button key={k} size="sm" icon={ACTION_ICON[k]} className={k === 'baixar' ? 'text-red-700' : ''} onClick={() => (setAction(k), setReason(''))}>
            {OPERATIONAL_TRANSITIONS[k].label}
          </Button>
        ))}
        {stockCan.operate(user) && a.operational_status !== 'baixado' && a.rental_status !== 'alugado' && (
          <Button size="sm" icon={ArrowRightLeft} onClick={() => navigate({ page: 'transferencia' })}>
            Transferir
          </Button>
        )}
        {stockCan.requestReservation(user) && ['novo', 'operacional'].includes(a.operational_status) && (
          <Button size="sm" icon={CalendarPlus} onClick={() => navigate({ page: 'disponibilidade' })}>
            Reservar
          </Button>
        )}
        {!available.length && a.operational_status !== 'aguardando_inspecao' && <span className="text-xs text-slate-500 self-center">Nenhuma ação disponível para o estado atual ou seu perfil.</span>}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Card title="Locação">
              <dl>
                {row('Situação', <RentBadge s={a.rental_status} />)}
                {row('Local', a.rental_status === 'alugado' ? 'Com cliente' : a.location_name)}
                {row('Último cliente', a.last_reservation?.customer_name)}
                {row('Última locação', a.last_reservation ? `${formatDateBR(a.last_reservation.start_date)} a ${formatDateBR(a.last_reservation.end_date)}` : null)}
                {row('Contrato vigente', a.reservations.find((r) => r.status === 'em_uso')?.contract_ref || (a.rental_status === 'alugado' ? a.reservations.find((r) => r.status === 'em_uso')?.number : null))}
                {row('Próxima reserva', a.next_reservation ? `${formatDateBR(a.next_reservation.start_date)} — ${a.next_reservation.customer_name}` : null)}
              </dl>
            </Card>
            <Card title="Patrimônio">
              <dl>
                {row('Data de aquisição', formatDateBR(a.acquisition_date))}
                {stockCan.viewCosts(user) && row('Custo de aquisição', formatBRL(a.acquisition_cost))}
                {row('Fornecedor', a.supplier_name)}
                {row('Início de operação', formatDateBR(a.operation_start_date))}
                {row('Garantia até', formatDateBR(a.warranty_until))}
                {row('Conservação', CONSERVATION_LABELS[a.conservation])}
              </dl>
            </Card>
          </div>
          {openOs && <MaintenanceHistory assetId={a.id} openOs={openOs} />}

          {(a.technical_notes || a.notes) && (
            <Card title="Observações">
              {a.technical_notes && <p className="text-sm text-slate-700 whitespace-pre-line"><b>Técnicas:</b> {a.technical_notes}</p>}
              {a.notes && <p className="text-sm text-slate-700 whitespace-pre-line mt-2">{a.notes}</p>}
            </Card>
          )}

          <Card
            title={
              <span className="flex gap-1 flex-wrap">
                {(
                  [
                    ['linha', 'Linha do tempo'],
                    ['reservas', `Locações e reservas (${a.reservations.length})`],
                    ['movimentos', `Movimentações (${a.movements.length})`],
                    ['arquivos', `Fotos e documentos (${a.files.length})`],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} onClick={() => setTab(k)} className={cx('px-2.5 py-1 rounded-md text-xs font-semibold', tab === k ? 'bg-[#1e3a5f] text-white' : 'text-slate-600 hover:bg-slate-100')}>
                    {l}
                  </button>
                ))}
              </span>
            }
          >
            {tab === 'linha' && (
              <ol className="relative border-l-2 border-slate-100 ml-2 space-y-4">
                {a.events.map((e) => (
                  <li key={e.id} className="ml-4">
                    <span
                      className={cx(
                        'absolute -left-[7px] w-3 h-3 rounded-full border-2 border-white',
                        e.event_type === 'baixa' ? 'bg-red-500' : e.event_type === 'manutencao' || e.event_type === 'inspecao' ? 'bg-orange-500' : e.event_type === 'entrega' || e.event_type === 'retorno' ? 'bg-blue-500' : e.event_type === 'liberacao' ? 'bg-emerald-500' : 'bg-slate-400'
                      )}
                    />
                    <p className="text-sm text-slate-800">{e.description}</p>
                    <p className="text-[11px] text-slate-500">
                      {formatDateTimeBR(e.created_at)} • {e.performed_by_name}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            {tab === 'reservas' &&
              (a.reservations.length === 0 ? (
                <p className="text-sm text-slate-500">Sem reservas ou locações.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {a.reservations.map((r) => (
                    <li key={r.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                      <div>
                        <p className="font-semibold text-slate-800">
                          {r.customer_name} <span className="font-normal text-slate-500">• {r.number}{r.contract_ref ? ` • ${r.contract_ref}` : ''}{r.quotation_number ? ` • ${r.quotation_number}` : ''}</span>
                        </p>
                        <p className="text-xs text-slate-500">
                          {formatDateBR(r.start_date)} a {formatDateBR(r.end_date)}
                        </p>
                      </div>
                      <ResBadge s={r.status} />
                    </li>
                  ))}
                </ul>
              ))}
            {tab === 'movimentos' && (
              <ul className="divide-y divide-slate-100">
                {a.movements.map((m) => (
                  <li key={m.id} className="py-2 flex justify-between gap-3 text-sm">
                    <span>
                      <b>{MOVEMENT_LABELS[m.movement_type]}</b> <span className="text-slate-500">• {m.number} • {m.origin_name || m.dest_name || ''}</span>
                    </span>
                    <span className="text-xs text-slate-500 whitespace-nowrap">{formatDateTimeBR(m.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
            {tab === 'arquivos' && (
              <div className="space-y-4">
                {stockCan.operate(user) && a.operational_status !== 'baixado' && (
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer">
                      <Upload className="w-4 h-4" /> Adicionar foto
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => (upload('foto', e.target.files?.[0]), (e.target.value = ''))} />
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 cursor-pointer">
                      <FileText className="w-4 h-4" /> Adicionar documento (PDF)
                      <input type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => (upload('documento', e.target.files?.[0]), (e.target.value = ''))} />
                    </label>
                  </div>
                )}
                {photos.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {photos.map((f) => (
                      <a key={f.id} href={`/api/stock/assets/${id}/files/${f.id}`} target="_blank" rel="noreferrer" className="block">
                        <img src={`/api/stock/assets/${id}/files/${f.id}`} alt={f.name} className="w-full h-28 object-cover rounded-lg border border-slate-200" />
                      </a>
                    ))}
                  </div>
                )}
                {docs.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-3 text-sm border border-slate-200 rounded-lg px-3 py-2">
                    <span className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" /> <span className="truncate">{f.name}</span>
                      <span className="text-[11px] text-slate-400">{Math.round(f.size / 1024)} KB • {formatDateBR(f.created_at)}</span>
                    </span>
                    <Button size="sm" variant="ghost" icon={Download} onClick={async () => saveBlob(await fetchBlob(`/stock/assets/${id}/files/${f.id}?download=1`), f.name)} aria-label="Baixar" />
                  </div>
                ))}
                {!a.files.length && (
                  <p className="text-sm text-slate-500 flex items-center gap-2">
                    <ImageIcon className="w-4 h-4" /> Nenhum arquivo anexado.
                  </p>
                )}
              </div>
            )}
          </Card>
        </div>
        <aside className="space-y-4">
          <Card title="QR Code do patrimônio">
            <div className="flex flex-col items-center gap-2">
              {qr ? <img src={qr} alt={`QR Code ${a.asset_tag}`} className="w-40 h-40" /> : <div className="w-40 h-40 bg-slate-100 rounded" />}
              <p className="font-bold text-slate-800">{a.asset_tag}</p>
              <Button size="sm" icon={Printer} onClick={printLabel} disabled={!qr}>
                Imprimir etiqueta
              </Button>
            </div>
          </Card>
          {photos[0] && <img src={`/api/stock/assets/${id}/files/${photos[0].id}`} alt="" className="w-full rounded-xl border border-slate-200" />}
        </aside>
      </div>

      {/* mudança de estado */}
      <Modal
        open={!!action}
        onClose={() => setAction(null)}
        title={action ? OPERATIONAL_TRANSITIONS[action].label : ''}
        size="sm"
        footer={
          <>
            <Button onClick={() => setAction(null)}>Cancelar</Button>
            <Button
              variant={action === 'baixar' ? 'danger' : 'primary'}
              loading={busy}
              onClick={async () => {
                if (await run(() => api.post(`/stock/assets/${id}/action/${action}`, { reason }), 'Situação atualizada.')) setAction(null);
              }}
            >
              Confirmar
            </Button>
          </>
        }
      >
        {action && (
          <div className="space-y-3">
            {action === 'baixar' && <Notice kind="danger">A baixa patrimonial é definitiva: o equipamento sai do patrimônio ativo, mas todo o histórico é mantido.</Notice>}
            {action === 'retornar_manutencao' && <Notice>Após a manutenção o equipamento vai para "aguardando inspeção" e só fica disponível depois da inspeção aprovada.</Notice>}
            <Field label={OPERATIONAL_TRANSITIONS[action].requiresReason ? 'Justificativa' : 'Observação (opcional)'} required={OPERATIONAL_TRANSITIONS[action].requiresReason}>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            </Field>
          </div>
        )}
      </Modal>

      {/* inspeção */}
      <Modal
        open={inspect}
        onClose={() => setInspect(false)}
        title={`Inspeção — ${a.asset_tag}`}
        footer={
          <>
            <Button onClick={() => setInspect(false)}>Cancelar</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                if (await run(() => api.post(`/stock/assets/${id}/inspection`, { result, checklist, notes }), 'Inspeção registrada.')) setInspect(false);
              }}
            >
              Registrar inspeção
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="space-y-2">
            {INSPECTION_CHECKLIST.map((c) => (
              <Checkbox key={c.key} checked={!!checklist[c.key]} onChange={(v) => setChecklist({ ...checklist, [c.key]: v })} label={c.label} />
            ))}
          </div>
          <Field label="Resultado">
            <Select value={result} onChange={(e) => setResult(e.target.value as any)}>
              <option value="aprovado">Aprovado — liberar para locação</option>
              <option value="manutencao">Encaminhar para manutenção</option>
              <option value="danificado">Danificado — bloquear até avaliação</option>
            </Select>
          </Field>
          {result === 'aprovado' && INSPECTION_CHECKLIST.some((c) => !checklist[c.key]) && <Notice kind="warning">Para aprovar, confira todos os itens do checklist.</Notice>}
          <Field label="Observações" required={result !== 'aprovado'}>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Danos, peças faltando, testes realizados..." />
          </Field>
        </div>
      </Modal>

      <AssetEditModal open={editOpen} asset={a} onClose={() => setEditOpen(false)} onSaved={() => (setEditOpen(false), reload())} />
    </div>
  );
};

const AssetEditModal: React.FC<{ open: boolean; asset: Asset; onClose: () => void; onSaved: () => void }> = ({ open, asset, onClose, onSaved }) => {
  const toast = useToast();
  const [form, setForm] = useState<any>(asset);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm(asset);
    api.get<{ rows: Supplier[] }>('/stock/suppliers').then((r) => setSuppliers(r.rows)).catch(() => {});
  }, [open, asset]);
  const set = (k: string, v: unknown) => setForm((f: any) => ({ ...f, [k]: v }));
  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/stock/assets/${asset.id}`, form);
      toast('success', 'Dados do equipamento atualizados.');
      onSaved();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Editar ${asset.asset_tag}`}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="Patrimônio" hint="Não pode ser alterado">
          <Input value={asset.asset_tag} disabled />
        </Field>
        <Field label="Nº de série" hint="Opcional">
          <Input value={form.serial_number || ''} onChange={(e) => set('serial_number', e.target.value)} />
        </Field>
        <Field label="Conservação">
          <Select value={form.conservation} onChange={(e) => set('conservation', e.target.value as Conservation)}>
            {Object.entries(CONSERVATION_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Data de aquisição">
          <Input type="date" value={form.acquisition_date || ''} onChange={(e) => set('acquisition_date', e.target.value)} />
        </Field>
        <Field label="Custo de aquisição">
          <MoneyInput value={form.acquisition_cost} onChange={(v) => set('acquisition_cost', v)} allowEmpty />
        </Field>
        <Field label="Fornecedor">
          <Select value={form.supplier_id ?? ''} onChange={(e) => set('supplier_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Início de operação">
          <Input type="date" value={form.operation_start_date || ''} onChange={(e) => set('operation_start_date', e.target.value)} />
        </Field>
        <Field label="Garantia até">
          <Input type="date" value={form.warranty_until || ''} onChange={(e) => set('warranty_until', e.target.value)} />
        </Field>
        <div />
        <Field label="Observações técnicas" className="md:col-span-3">
          <Textarea value={form.technical_notes || ''} onChange={(e) => set('technical_notes', e.target.value)} />
        </Field>
        <Field label="Observações" className="md:col-span-3">
          <Textarea value={form.notes || ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <p className="md:col-span-3 text-[11px] text-slate-500">Localização e situação mudam apenas por transferência, locação, inspeção ou manutenção — nunca por edição manual.</p>
      </div>
    </Modal>
  );
};
