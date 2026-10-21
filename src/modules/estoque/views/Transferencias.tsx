/**
 * Transferências entre locais: rascunho → aguardando envio → em trânsito → recebida (ou cancelada).
 * O saldo sai da origem no envio e entra no destino no recebimento — nunca fica duplicado.
 */

import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Send, PackageCheck, Ban, Save, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Asset, StockItemRow, Transfer } from '../../../../shared/estoque/types';
import { stockCan } from '../../../../shared/estoque/rules';
import { formatDateTimeBR } from '../../../../shared/orcamentos/dates';
import { api, ApiError, qs } from '../../orcamentos/api';
import { Button, Card, EmptyState, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader, Select, Textarea, useAsync, useToast } from '../../orcamentos/ui';
import { useStock } from '../context';
import { ItemSearch, LocationSelect, Th, TrfBadge, fmtQty } from '../components';

export const TransferenciasView: React.FC = () => {
  const { navigate, user } = useStock();
  const [status, setStatus] = useState('');
  const { data, error, loading, reload } = useAsync(() => api.get<{ rows: any[] }>(`/stock/transfers${qs({ status })}`), [status]);
  return (
    <div>
      <PageHeader
        title="Transferências"
        subtitle="Movimentação entre depósitos, filiais e locais. Durante o trânsito a quantidade não conta em nenhum local."
        actions={
          stockCan.operate(user) && (
            <Button variant="primary" icon={Plus} onClick={() => navigate({ page: 'transferencia' })}>
              Nova transferência
            </Button>
          )
        }
      />
      <Card bodyClassName="p-0">
        <div className="p-4 border-b border-slate-100">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-56" aria-label="Status">
            <option value="">Todos os status</option>
            <option value="rascunho">Rascunho</option>
            <option value="aguardando_envio">Aguardando envio</option>
            <option value="em_transito">Em trânsito</option>
            <option value="recebida">Recebida</option>
            <option value="cancelada">Cancelada</option>
          </Select>
        </div>
        {loading && !data ? (
          <Loading />
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : !data?.rows.length ? (
          <EmptyState title="Nenhuma transferência" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Número</Th>
                  <Th>Origem → destino</Th>
                  <Th right>Linhas</Th>
                  <Th>Envio / recebimento</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer" onClick={() => navigate({ page: 'transferencia', id: t.id })}>
                    <td className="px-4 py-2.5 font-semibold text-[#1e3a5f]">{t.number}</td>
                    <td className="px-4 py-2.5">
                      {t.origin_name} <ArrowRight className="inline w-3.5 h-3.5 text-slate-400" /> {t.dest_name}
                    </td>
                    <td className="px-4 py-2.5 text-right">{t.lines}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-600">
                      {t.sent_at ? formatDateTimeBR(t.sent_at) : '—'} / {t.received_at ? formatDateTimeBR(t.received_at) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      <TrfBadge s={t.status} />
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
  asset_id: number | null;
  quantity: string;
}
let k = 0;

export const TransferenciaForm: React.FC<{ id?: number }> = ({ id }) => {
  const { navigate, user } = useStock();
  const toast = useToast();
  const [t, setT] = useState<Transfer | null>(null);
  const [origin, setOrigin] = useState<number | null>(null);
  const [dest, setDest] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [assets, setAssets] = useState<Record<number, Asset[]>>({});
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const [receive, setReceive] = useState(false);
  const [received, setReceived] = useState<Record<string, string>>({});
  const [divergence, setDivergence] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const editable = !t || t.status === 'rascunho';

  const load = (tid: number) =>
    api.get<Transfer>(`/stock/transfers/${tid}`).then((x) => {
      setT(x);
      setOrigin(x.origin_location_id);
      setDest(x.dest_location_id);
      setNotes(x.notes || '');
      setLines(x.items.map((i) => ({ key: `l${++k}`, item: { id: i.item_id, internal_code: i.item_code, description: i.item_description, unit: i.unit, tracking: i.asset_id ? 'individual' : 'quantidade' }, asset_id: i.asset_id, quantity: String(i.quantity) })));
    });
  useEffect(() => {
    if (id) load(id).catch((e) => toast('error', e.message)).finally(() => setLoading(false));
  }, [id]);

  // patrimônios disponíveis na origem para itens individuais
  useEffect(() => {
    if (!origin) return;
    for (const l of lines.filter((x) => x.item.tracking === 'individual')) {
      if (assets[l.item.id]) continue;
      api.get<{ rows: Asset[] }>(`/stock/assets${qs({ item_id: l.item.id, location_id: origin, page_size: 100 })}`).then((r) => setAssets((a) => ({ ...a, [l.item.id]: r.rows }))).catch(() => {});
    }
  }, [lines, origin]);
  useEffect(() => setAssets({}), [origin]);

  const payload = () => ({ origin_location_id: origin, dest_location_id: dest, notes, items: lines.map((l) => ({ item_id: l.item.id, asset_id: l.asset_id, quantity: Number(l.quantity.replace(',', '.')) })) });

  const act = async (fn: () => Promise<Transfer>, ok: string) => {
    setBusy(true);
    try {
      const x = await fn();
      toast('success', ok);
      if (!id || x.id !== id) navigate({ page: 'transferencia', id: x.id });
      else await load(x.id);
      return true;
    } catch (e) {
      toast('error', (e as ApiError).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () => act(() => (t ? api.put<Transfer>(`/stock/transfers/${t.id}`, payload()) : api.post<Transfer>('/stock/transfers', payload())), 'Rascunho salvo.');
  const release = () =>
    act(async () => {
      const x = t ? await api.put<Transfer>(`/stock/transfers/${t.id}`, payload()) : await api.post<Transfer>('/stock/transfers', payload());
      return api.post<Transfer>(`/stock/transfers/${x.id}/liberar`);
    }, 'Transferência liberada para envio.');

  if (loading) return <Loading />;
  if (!stockCan.operate(user) && !t) return <Notice kind="warning">Seu perfil não registra transferências.</Notice>;

  return (
    <div>
      <PageHeader title={t ? `Transferência ${t.number}` : 'Nova transferência'} subtitle={t ? `Criada por ${t.created_by_name} em ${formatDateTimeBR(t.created_at)}` : undefined} onBack={() => navigate({ page: 'transferencias' })} actions={t && <TrfBadge s={t.status} />} />
      <div className="space-y-5 max-w-5xl">
        <Card title="Origem e destino">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-4 items-end">
            <Field label="Origem" required>
              <LocationSelect value={origin} disabled={!editable} onChange={setOrigin} />
            </Field>
            <ArrowRight className="hidden md:block w-5 h-5 text-slate-400 mb-2.5" />
            <Field label="Destino" required>
              <LocationSelect value={dest} disabled={!editable} onChange={setDest} />
            </Field>
          </div>
          {t && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 text-sm text-slate-600">
              <p>Envio: {t.sent_at ? `${formatDateTimeBR(t.sent_at)} por ${t.sent_by_name}` : '—'}</p>
              <p>Recebimento: {t.received_at ? `${formatDateTimeBR(t.received_at)} por ${t.received_by_name}` : '—'}</p>
              {t.divergence_notes && <p className="sm:col-span-2 text-amber-800"><b>Divergência:</b> {t.divergence_notes}</p>}
            </div>
          )}
        </Card>
        <Card title="Itens" bodyClassName="p-0">
          {editable && (
            <div className="p-4 border-b border-slate-100">
              {origin ? <ItemSearch onPick={(i) => setLines((ls) => [...ls, { key: `l${++k}`, item: i, asset_id: null, quantity: '1' }])} /> : <p className="text-sm text-slate-500">Selecione a origem para incluir itens.</p>}
            </div>
          )}
          {!lines.length ? (
            <EmptyState title="Nenhum item" />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Item</Th>
                  <Th>Patrimônio / quantidade</Th>
                  {t && ['recebida'].includes(t.status) && <Th right>Recebido</Th>}
                  {editable && <Th />}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const ti = t?.items.find((x) => x.item_id === l.item.id && x.asset_id === l.asset_id);
                  return (
                    <tr key={l.key} className="border-t border-slate-100">
                      <td className="px-4 py-2.5">
                        <p className="font-semibold text-slate-800">{l.item.description}</p>
                        <p className="text-[11px] font-mono text-slate-500">{l.item.internal_code}</p>
                      </td>
                      <td className="px-4 py-2.5 w-64">
                        {l.item.tracking === 'individual' ? (
                          editable ? (
                            <Select value={l.asset_id ?? ''} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, asset_id: Number(e.target.value) || null } : x)))}>
                              <option value="">Selecione o patrimônio</option>
                              {(assets[l.item.id] || [])
                                .filter((a) => !['alugado', 'em_transito'].includes(a.rental_status))
                                .map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.asset_tag} {a.serial_number ? `(S/N ${a.serial_number})` : ''}
                                  </option>
                                ))}
                            </Select>
                          ) : (
                            <b>{ti?.asset_tag}</b>
                          )
                        ) : editable ? (
                          <Input inputMode="decimal" value={l.quantity} onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, quantity: e.target.value } : x)))} />
                        ) : (
                          fmtQty(Number(l.quantity), l.item.unit)
                        )}
                      </td>
                      {t && t.status === 'recebida' && <td className="px-4 py-2.5 text-right tabular-nums">{fmtQty(ti?.received_quantity)}</td>}
                      {editable && (
                        <td className="px-4 py-2.5 text-right">
                          <Button variant="ghost" icon={Trash2} className="text-red-600" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remover" />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Observações">
          <Textarea value={notes} disabled={!editable} onChange={(e) => setNotes(e.target.value)} />
        </Card>
        {stockCan.operate(user) && (
          <div className="flex flex-wrap justify-end gap-2">
            {t && ['rascunho', 'aguardando_envio'].includes(t.status) && (
              <Button icon={Ban} onClick={() => setCancelOpen(true)}>
                Cancelar transferência
              </Button>
            )}
            {editable && (
              <>
                <Button icon={Save} loading={busy} onClick={saveDraft}>
                  Salvar rascunho
                </Button>
                <Button variant="primary" icon={CheckCircle2} loading={busy} onClick={release}>
                  Liberar para envio
                </Button>
              </>
            )}
            {t?.status === 'aguardando_envio' && (
              <Button variant="primary" icon={Send} loading={busy} onClick={() => act(() => api.post<Transfer>(`/stock/transfers/${t.id}/enviar`), 'Enviada — itens em trânsito.')}>
                Registrar envio
              </Button>
            )}
            {t?.status === 'em_transito' && (
              <Button
                variant="primary"
                icon={PackageCheck}
                onClick={() => {
                  setReceived(Object.fromEntries(t.items.map((i) => [String(i.id), String(i.quantity)])));
                  setDivergence('');
                  setReceive(true);
                }}
              >
                Registrar recebimento
              </Button>
            )}
          </div>
        )}
      </div>

      <Modal
        open={receive}
        onClose={() => setReceive(false)}
        title="Registrar recebimento"
        footer={
          <>
            <Button onClick={() => setReceive(false)}>Voltar</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                const ok = await act(
                  () => api.post<Transfer>(`/stock/transfers/${t!.id}/receber`, { received: Object.fromEntries(Object.entries(received).map(([k2, v]) => [k2, Number(v.replace(',', '.'))])), divergence_notes: divergence }),
                  'Recebimento registrado. Saldos do destino atualizados.'
                );
                if (ok) setReceive(false);
              }}
            >
              Confirmar recebimento
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {t?.items.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">
                {i.asset_tag ? <b>{i.asset_tag}</b> : i.item_code} — {i.item_description} <span className="text-slate-500">(enviado {fmtQty(i.quantity, i.unit)})</span>
              </span>
              {i.asset_id ? (
                <Select value={received[String(i.id)]} onChange={(e) => setReceived({ ...received, [String(i.id)]: e.target.value })} className="w-36">
                  <option value="1">Recebido</option>
                  <option value="0">Não recebido</option>
                </Select>
              ) : (
                <Input className="w-28" inputMode="decimal" value={received[String(i.id)] ?? ''} onChange={(e) => setReceived({ ...received, [String(i.id)]: e.target.value })} aria-label={`Recebido de ${i.item_code}`} />
              )}
            </div>
          ))}
          <Field label="Divergências (obrigatório se recebido ≠ enviado)">
            <Textarea value={divergence} onChange={(e) => setDivergence(e.target.value)} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancelar transferência"
        size="sm"
        footer={
          <>
            <Button onClick={() => setCancelOpen(false)}>Voltar</Button>
            <Button
              variant="danger"
              loading={busy}
              onClick={async () => {
                if (await act(() => api.post<Transfer>(`/stock/transfers/${t!.id}/cancelar`, { reason: cancelReason }), 'Transferência cancelada.')) setCancelOpen(false);
              }}
            >
              Cancelar transferência
            </Button>
          </>
        }
      >
        <Field label="Motivo">
          <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
        </Field>
      </Modal>
    </div>
  );
};
