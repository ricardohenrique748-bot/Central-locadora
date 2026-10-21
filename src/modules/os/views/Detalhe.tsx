/**
 * Detalhe da OS: transições permitidas pelo servidor e abas técnica, materiais, mão de obra/terceiros,
 * checklist, custos, anexos e histórico.
 */

import React, { useEffect, useState } from 'react';
import { Lock, Unlock, ShieldCheck, CheckCircle2, Save, Plus, ExternalLink, Paperclip, FileText, Undo2 } from 'lucide-react';
import {
  ATTACHMENT_CATEGORIES, CHECKLIST_RESULT_LABELS, ChecklistResult, ORDER_STATUS_LABELS, ORIGIN_LABELS, OrderDetail, OrderStatus, PRIORITY_LABELS, Priority, RISK_LABELS, Risk,
} from '../../../../shared/os/types';
import { INSPECTION_CHECKLIST, OPERATIONAL_LABELS, RENTAL_LABELS } from '../../../../shared/estoque/types';
import { osCan } from '../../../../shared/os/rules';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { formatDateBR, formatDateTimeBR } from '../../../../shared/orcamentos/dates';
import { api, ApiError, fetchBlob } from '../../orcamentos/api';
import { Button, Card, Checkbox, ErrorState, Field, Input, Loading, Modal, MoneyInput, Notice, PageHeader, Select, Textarea, cx, useAsync, useToast } from '../../orcamentos/ui';
import { ItemSearch, fmtQty } from '../../estoque/components';
import { OsTab, fmtMinutes, newKey, useOs } from '../context';
import { KV, OsStatusPill, PriorityPill, ServicePill, Th } from '../components';

const TABS: { id: OsTab; label: string }[] = [
  { id: 'resumo', label: 'Resumo' },
  { id: 'tecnico', label: 'Diagnóstico e execução' },
  { id: 'materiais', label: 'Peças e materiais' },
  { id: 'mao_de_obra', label: 'Mão de obra e terceiros' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'custos', label: 'Custos' },
  { id: 'anexos', label: 'Anexos' },
  { id: 'historico', label: 'Histórico' },
];
const NEEDS_REASON: OrderStatus[] = ['aguardando_pecas', 'aguardando_fornecedor', 'aguardando_aprovacao', 'cancelada'];
const nowLocal = (minus = 0) => {
  const d = new Date(Date.now() - minus * 60_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const readFile = (file: File) =>
  new Promise<{ file_name: string; content: string }>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ file_name: file.name, content: String(r.result) });
    r.onerror = reject;
    r.readAsDataURL(file);
  });

export const OsDetalhe: React.FC<{ id: number; initialTab?: OsTab }> = ({ id, initialTab }) => {
  const { user, users, types, navigate, openFinance, openContract } = useOs();
  const toast = useToast();
  const { data: o, error, loading, reload } = useAsync(() => api.get<OrderDetail>(`/os/orders/${id}`), [id]);
  const [tab, setTab] = useState<OsTab>(initialTab || 'resumo');
  const [busy, setBusy] = useState<string | null>(null);
  const [statusModal, setStatusModal] = useState<OrderStatus | null>(null);
  const [statusForm, setStatusForm] = useState({ reason: '', scheduled_at: nowLocal() });
  const [blockModal, setBlockModal] = useState(false);
  const [blockReason, setBlockReason] = useState('');
  const [releaseModal, setReleaseModal] = useState(false);
  const [inspection, setInspection] = useState<Record<string, boolean>>({});
  const [matModal, setMatModal] = useState<{ id: number; action: string; label: string; max: number; unit: string } | null>(null);
  const [matForm, setMatForm] = useState({ quantity: '', location_id: '', notes: '', withdrawn_by: '', reason: '', key: newKey() });
  const [locations, setLocations] = useState<{ id: number; code: string; name: string }[]>([]);
  const [tech, setTech] = useState<any>(null);
  const [act, setAct] = useState({ description: '', technician_user_id: String(user.id), technician_name: '', started_at: nowLocal(60), ended_at: nowLocal(), hourly_rate: 0, notes: '' });
  const [srv, setSrv] = useState({ supplier_id: '', description: '', supplier_document: '', estimated_cost: 0, expected_date: '' });
  const [srvModal, setSrvModal] = useState<{ id: number; action: string; description: string; approved?: number | null } | null>(null);
  const [srvForm, setSrvForm] = useState({ approved_cost: 0, actual_cost: 0, reason: '', due_date: '', supplier_document: '' });
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([]);
  const [answers, setAnswers] = useState<Record<number, { result: ChecklistResult | null; notes: string }>>({});
  const [newItem, setNewItem] = useState('');
  const [attCat, setAttCat] = useState('foto_defeito');
  const [pick, setPick] = useState<{ id: number; code: string; description: string; unit: string; qty: string } | null>(null);

  useEffect(() => {
    api.get<{ rows: any[] }>('/stock/locations').then((r) => setLocations(r.rows.filter((l) => l.active))).catch(() => undefined);
    api.get<{ rows: any[] }>('/stock/suppliers?active=true').then((r) => setSuppliers(r.rows)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!o) return;
    setTech({ ...o });
    setAnswers(Object.fromEntries(o.checklist.map((c) => [c.id, { result: c.result, notes: c.notes || '' }])));
  }, [o]);

  if (loading && !o) return <Loading />;
  if (error || !o) return <ErrorState message={error || 'OS não encontrada.'} onRetry={reload} />;
  const open = !['concluida', 'cancelada'].includes(o.status);
  const costs = o.costs;

  const run = async (label: string, fn: () => Promise<unknown>, msg: string, after?: () => void) => {
    setBusy(label);
    try {
      await fn();
      toast('success', msg);
      after?.();
      reload();
      return true;
    } catch (e) {
      toast('error', (e as ApiError).message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  const goStatus = (to: OrderStatus) => {
    if (o.blockers[to]) return toast('error', o.blockers[to]);
    if (NEEDS_REASON.includes(to) || to === 'programada' || to === 'concluida') {
      setStatusForm({ reason: '', scheduled_at: nowLocal() });
      return setStatusModal(to);
    }
    run(to, () => api.post(`/os/orders/${o.id}/status`, { to, row_version: o.row_version }), `Status: ${ORDER_STATUS_LABELS[to]}.`);
  };
  const openMat = (m: OrderDetail['materials'][number], action: string, label: string, max: number) => {
    setMatForm({ quantity: max > 0 ? String(max) : '', location_id: m.location_id ? String(m.location_id) : '', notes: '', withdrawn_by: user.name, reason: '', key: newKey() });
    setMatModal({ id: m.id, action, label, max, unit: m.unit });
  };

  return (
    <div>
      <PageHeader title={o.order_number} subtitle={`${o.order_type_label} • ${o.asset.asset_tag} — ${o.asset.description}`} onBack={() => navigate({ page: 'painel' })} actions={<div className="flex gap-2 items-center"><PriorityPill p={o.priority} /><OsStatusPill s={o.status} /></div>} />

      {(o.transitions.length > 0 || o.actions.length > 0) && (
        <div className="flex flex-wrap gap-2 mb-4">
          {o.transitions.map((t) => (
            <Button key={t} size="sm" variant={t === 'concluida' || t === 'em_execucao' || t === 'em_testes' ? 'primary' : 'secondary'} className={cx(t === 'cancelada' && 'text-red-700', o.blockers[t] && 'opacity-60')} title={o.blockers[t]} loading={busy === t} onClick={() => goStatus(t)}>
              {t === 'concluida' ? 'Concluir OS' : t === 'cancelada' ? 'Cancelar OS' : `→ ${ORDER_STATUS_LABELS[t]}`}
            </Button>
          ))}
          {o.actions.includes('aprovar_custo') && (
            <Button size="sm" icon={CheckCircle2} loading={busy === 'aprovar'} onClick={() => run('aprovar', () => api.post(`/os/orders/${o.id}/approve-cost`, {}), 'Custo previsto aprovado.')}>
              Aprovar custo previsto
            </Button>
          )}
          {o.actions.includes('bloquear') && <Button size="sm" icon={Lock} onClick={() => (setBlockReason(''), setBlockModal(true))}>Bloquear equipamento</Button>}
          {o.actions.includes('desbloquear') && <Button size="sm" icon={Unlock} onClick={() => (setBlockReason(''), setBlockModal(true))}>Retirar bloqueio</Button>}
          {o.actions.includes('liberar') && (
            <Button size="sm" variant="primary" icon={ShieldCheck} onClick={() => (setInspection({}), setReleaseModal(true))}>
              Liberar equipamento (inspeção)
            </Button>
          )}
        </div>
      )}
      {o.blockers.concluida && open && o.transitions.includes('concluida') && <Notice kind="warning" className="mb-4"><b>Para concluir:</b> {o.blockers.concluida}</Notice>}
      {o.blockers.em_execucao && <Notice kind="warning" className="mb-4">{o.blockers.em_execucao}</Notice>}
      {o.blocks_equipment && open && (
        <Notice kind="danger" className="mb-4">
          Equipamento <b>bloqueado para locação</b> por esta OS.
          {o.affected_reservations.length > 0 && <> Reservas/locações afetadas (não foram alteradas): {o.affected_reservations.map((r) => `${r.number}${r.contract_ref ? ` (${r.contract_ref})` : ''} ${formatDateBR(r.start_date)}–${r.end_date === '2099-12-31' ? 'indeterminado' : formatDateBR(r.end_date)}`).join('; ')}.</>}
        </Notice>
      )}
      {o.status === 'concluida' && o.asset_now.operational_status === 'aguardando_inspecao' && <Notice className="mb-4">Manutenção concluída. O equipamento aguarda a inspeção para voltar a ser locável.</Notice>}

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 mb-4" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cx('px-3.5 py-2 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px', tab === t.id ? 'border-[#1e3a5f] text-[#1e3a5f]' : 'border-transparent text-slate-500 hover:text-slate-800')}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'resumo' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
          <Card title="Equipamento">
            <p className="font-semibold">{o.asset.asset_tag} — {o.asset.description}</p>
            <KV label="Código">{o.asset.item_code}</KV>
            <KV label="Nº de série">{o.asset.serial_number || '—'}</KV>
            <KV label="Marca / modelo">{[o.asset.brand, o.asset.model].filter(Boolean).join(' ') || '—'}</KV>
            <KV label="Categoria">{o.asset.category || '—'}</KV>
            <KV label="Localização atual">{o.asset_now.location_name || '—'}</KV>
            <KV label="Situação operacional">{OPERATIONAL_LABELS[o.asset_now.operational_status as 'operacional']}</KV>
            <KV label="Locação">{RENTAL_LABELS[o.asset_now.rental_status as 'disponivel']}</KV>
            {o.contract && (
              <KV label="Contrato">
                {openContract ? <button className="text-[#1e3a5f] font-semibold hover:underline" onClick={() => openContract(o.contract!.contract_number)}>{o.contract.contract_number}</button> : o.contract.contract_number} ({o.contract.customer_name})
              </KV>
            )}
          </Card>
          <Card title="Identificação">
            <KV label="Tipo">{o.order_type_label}</KV>
            <KV label="Origem">{ORIGIN_LABELS[o.origin]}</KV>
            <KV label="Solicitante">{o.requester || '—'}</KV>
            <KV label="Responsável">{o.responsible_name || 'A definir'}</KV>
            <KV label="Abertura">{formatDateTimeBR(o.opened_at)}</KV>
            <KV label="Prazo">{formatDateBR(o.due_date)}</KV>
            {o.scheduled_at && <KV label="Programada para">{formatDateTimeBR(o.scheduled_at)}</KV>}
            <KV label="Início">{formatDateTimeBR(o.started_at)}</KV>
            <KV label="Conclusão">{formatDateTimeBR(o.completed_at)}</KV>
            <KV label="Risco">{RISK_LABELS[o.operational_risk]}</KV>
            {o.plan && <KV label="Plano preventivo">{o.plan.name}</KV>}
            {o.cancellation_reason && <KV label="Cancelamento">{o.cancellation_reason}</KV>}
          </Card>
          <Card title="Tempos">
            <KV label="Trabalhado (atividades)"><b>{fmtMinutes(o.times.worked_min)}</b></KV>
            <KV label="Em execução / testes">{fmtMinutes(o.times.execution_status_min + o.times.testing_min)}</KV>
            <KV label="Aguardando avaliação/agenda">{fmtMinutes(o.times.waiting_evaluation_min)}</KV>
            <KV label="Aguardando aprovação">{fmtMinutes(o.times.waiting_approval_min)}</KV>
            <KV label="Aguardando peças">{fmtMinutes(o.times.waiting_parts_min)}</KV>
            <KV label="Aguardando fornecedor">{fmtMinutes(o.times.waiting_supplier_min)}</KV>
            <KV label="Equipamento indisponível">{o.times.downtime_min === null ? 'Não bloqueado' : `${fmtMinutes(o.times.downtime_min)}${o.downtime_end ? '' : ' (em curso)'}`}</KV>
            {costs && (
              <div className="mt-2 pt-2 border-t border-slate-100">
                <KV label="Custo previsto">{formatBRL(costs.estimated.total)}</KV>
                <KV label="Custo realizado"><b>{formatBRL(costs.actual.total)}</b></KV>
              </div>
            )}
          </Card>
          <Card title="Ocorrência" className="lg:col-span-3">
            <p className="font-semibold">{o.title}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 text-sm mt-2">
              {[['Descrição', o.description], ['Sintomas', o.symptoms], ['Categoria do defeito', o.defect_category], ['Causa provável', o.probable_cause], ['Serviço solicitado', o.requested_service], ['Observações', o.notes]].map(([l, v]) => (
                <div key={l} className="py-1.5">
                  <p className="text-xs text-slate-500">{l}</p>
                  <p className="whitespace-pre-line">{v || '—'}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === 'tecnico' && tech && (
        <Card title="Diagnóstico e execução" actions={open && osCan.edit(user) && <Button size="sm" variant="primary" icon={Save} loading={busy === 'tec'} onClick={() => run('tec', () => api.put(`/os/orders/${o.id}`, tech), 'Dados técnicos salvos.')}>Salvar</Button>}>
          {!open && <Notice className="mb-3">OS encerrada: dados preservados para o histórico.</Notice>}
          <fieldset disabled={!open || !osCan.edit(user)} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Diagnóstico técnico">
              <Textarea rows={3} value={tech.diagnosis || ''} onChange={(e) => setTech({ ...tech, diagnosis: e.target.value })} />
            </Field>
            <Field label="Causa raiz (quando identificada)">
              <Textarea rows={3} value={tech.root_cause || ''} onChange={(e) => setTech({ ...tech, root_cause: e.target.value })} />
            </Field>
            <Field label="Procedimentos executados / serviços necessários" className="md:col-span-2">
              <Textarea rows={3} value={tech.procedures || ''} onChange={(e) => setTech({ ...tech, procedures: e.target.value })} />
            </Field>
            <Field label="Resultado dos testes finais">
              <Textarea rows={2} value={tech.test_result || ''} onChange={(e) => setTech({ ...tech, test_result: e.target.value })} />
            </Field>
            <Field label="Condições de segurança">
              <Textarea rows={2} value={tech.safety_notes || ''} onChange={(e) => setTech({ ...tech, safety_notes: e.target.value })} />
            </Field>
            <Field label="Recomendações para a próxima manutenção" className="md:col-span-2">
              <Textarea rows={2} value={tech.recommendations || ''} onChange={(e) => setTech({ ...tech, recommendations: e.target.value })} />
            </Field>
            <Field label="Leitura do medidor (horímetro/ciclos), se houver" hint="Usada nas preventivas por uso.">
              <Input type="number" min={0} step="any" value={tech.meter_reading ?? ''} onChange={(e) => setTech({ ...tech, meter_reading: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
            <Field label="Responsável">
              <Select value={tech.responsible_user_id ?? ''} onChange={(e) => setTech({ ...tech, responsible_user_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">A definir</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            </Field>
            <Field label="Tipo">
              <Select value={tech.order_type} onChange={(e) => setTech({ ...tech, order_type: e.target.value })}>
                {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </Select>
            </Field>
            <Field label="Prioridade / prazo">
              <div className="flex gap-2">
                <Select value={tech.priority} onChange={(e) => setTech({ ...tech, priority: e.target.value as Priority })}>
                  {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
                </Select>
                <Input type="date" value={tech.due_date || ''} onChange={(e) => setTech({ ...tech, due_date: e.target.value })} />
              </div>
            </Field>
            <Field label="Risco operacional">
              <Select value={tech.operational_risk} onChange={(e) => setTech({ ...tech, operational_risk: e.target.value as Risk })}>
                {(Object.keys(RISK_LABELS) as Risk[]).map((r) => <option key={r} value={r}>{RISK_LABELS[r]}</option>)}
              </Select>
            </Field>
            <div className="flex items-end pb-2">
              <Checkbox checked={!!tech.requires_checklist} onChange={(v) => setTech({ ...tech, requires_checklist: v })} label="Exige checklist de inspeção para concluir" />
            </div>
            {costs && (
              <>
                <Field label="Mão de obra prevista">
                  <MoneyInput value={tech.estimated_labor} onChange={(v) => setTech({ ...tech, estimated_labor: v ?? 0 })} />
                </Field>
                <Field label="Outros custos previstos">
                  <MoneyInput value={tech.estimated_other} onChange={(v) => setTech({ ...tech, estimated_other: v ?? 0 })} />
                </Field>
                <Field label="Outros custos realizados">
                  <MoneyInput value={tech.actual_other} onChange={(v) => setTech({ ...tech, actual_other: v ?? 0 })} />
                </Field>
                <Field label="Descrição dos outros custos">
                  <Input value={tech.actual_other_description || ''} onChange={(e) => setTech({ ...tech, actual_other_description: e.target.value })} />
                </Field>
              </>
            )}
          </fieldset>
        </Card>
      )}

      {tab === 'materiais' && (
        <Card title="Peças e materiais" bodyClassName="p-0">
          {open && osCan.materials(user) && (
            <div className="p-4 border-b border-slate-100">
              <ItemSearch filter={{ tracking: 'quantidade' }} placeholder="Adicionar peça ou material (só entra na lista; o estoque não é movimentado)" onPick={(i) => setPick({ id: i.id, code: i.internal_code, description: i.description, unit: i.unit, qty: '1' })} />
              {pick && (
                <div className="mt-2 flex flex-wrap items-end gap-2 p-2 rounded-lg bg-slate-50">
                  <span className="text-sm flex-1 min-w-[200px]">
                    <span className="font-mono text-xs text-slate-500 mr-1">{pick.code}</span>
                    {pick.description}
                  </span>
                  <Field label={`Quantidade necessária (${pick.unit})`}>
                    <Input type="number" min={0} step="any" value={pick.qty} onChange={(e) => setPick({ ...pick, qty: e.target.value })} className="w-32" />
                  </Field>
                  <Button variant="primary" icon={Plus} loading={busy === 'add-mat'} onClick={() => run('add-mat', () => api.post(`/os/orders/${o.id}/materials`, { item_id: pick.id, quantity: Number(pick.qty.replace(',', '.')) }), 'Material incluído na lista.', () => setPick(null))}>
                    Incluir
                  </Button>
                  <Button onClick={() => setPick(null)}>Cancelar</Button>
                </div>
              )}
            </div>
          )}
          {o.materials.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">Nenhum material.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[980px]">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Item</Th>
                    <Th right>Solicitado</Th>
                    <Th right>Reservado</Th>
                    <Th right>Retirado</Th>
                    <Th right>Utilizado</Th>
                    <Th right>Devolvido</Th>
                    <Th right>Custo un.</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {o.materials.map((m) => {
                    const net = Math.round((m.quantity_withdrawn - m.quantity_returned - m.quantity_used) * 1000) / 1000;
                    const toReserve = Math.max(0, Math.round((m.quantity_requested - m.quantity_reserved - m.quantity_withdrawn) * 1000) / 1000);
                    const toWithdraw = Math.max(0, Math.round((m.quantity_requested - m.quantity_withdrawn) * 1000) / 1000);
                    return (
                      <tr key={m.id} className={cx('border-t border-slate-100 align-top', m.status === 'cancelado' && 'text-slate-400 line-through')}>
                        <td className="px-4 py-2.5">
                          <span className="font-mono text-xs text-slate-500 mr-1">{m.item_code}</span>
                          {m.description}
                          <p className="text-[11px] text-slate-500 no-underline">
                            {m.kind === 'peca' ? 'Peça' : 'Material'} • disponível no estoque: {fmtQty(m.available_now, m.unit)}
                            {m.location_name ? ` • ${m.location_name}` : ''}
                          </p>
                          {m.moves.length > 0 && (
                            <details className="text-[11px] text-slate-500 mt-1">
                              <summary className="cursor-pointer">{m.moves.length} movimentação(ões)</summary>
                              {m.moves.map((mv) => (
                                <p key={mv.id}>
                                  {formatDateTimeBR(mv.created_at)} — {mv.move_type} {fmtQty(mv.quantity)} {mv.movement_number ? `(${mv.movement_number})` : ''} • {mv.performed_by_name}
                                </p>
                              ))}
                            </details>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right">{fmtQty(m.quantity_requested, m.unit)}</td>
                        <td className="px-4 py-2.5 text-right">{fmtQty(m.quantity_reserved)}</td>
                        <td className="px-4 py-2.5 text-right">{fmtQty(m.quantity_withdrawn)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">{fmtQty(m.quantity_used)}</td>
                        <td className="px-4 py-2.5 text-right">{fmtQty(m.quantity_returned)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{costs ? (m.unit_cost !== null ? formatBRL(m.unit_cost) : m.estimated_unit_cost !== null ? <span className="text-slate-400">≈ {formatBRL(m.estimated_unit_cost)}</span> : '—') : '—'}</td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          {m.status === 'ativo' && osCan.materials(user) && (
                            <>
                              {open && toReserve > 0 && <Button size="sm" variant="ghost" onClick={() => openMat(m, 'reservar', 'Reservar no estoque', toReserve)}>Reservar</Button>}
                              {open && m.quantity_reserved > 0 && <Button size="sm" variant="ghost" onClick={() => openMat(m, 'liberar', 'Liberar reserva', m.quantity_reserved)}>Liberar</Button>}
                              {open && toWithdraw > 0 && <Button size="sm" variant="ghost" onClick={() => openMat(m, 'retirar', 'Retirar do estoque (saída real)', toWithdraw)}>Retirar</Button>}
                              {open && net > 0 && <Button size="sm" variant="ghost" onClick={() => openMat(m, 'utilizar', 'Registrar utilização no equipamento', net)}>Utilizar</Button>}
                              {net > 0 && <Button size="sm" variant="ghost" icon={Undo2} onClick={() => openMat(m, 'devolver', 'Devolver sobra ao estoque', net)}>Devolver</Button>}
                              {open && m.quantity_withdrawn <= m.quantity_returned && <Button size="sm" variant="ghost" className="text-red-700" onClick={() => openMat(m, 'cancelar', 'Cancelar material', 0)}>Cancelar</Button>}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-slate-500 px-4 py-3 border-t border-slate-100">Solicitado não mexe no estoque. Reservado segura o saldo. Retirado é a saída real. Utilizado é o que vira custo. A sobra volta ao estoque pela devolução.</p>
        </Card>
      )}

      {tab === 'mao_de_obra' && (
        <div className="space-y-5">
          <Card title="Atividades de mão de obra" bodyClassName="p-0">
            {o.activities.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">Nenhuma atividade.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[760px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <Th>Atividade</Th>
                      <Th>Técnico / prestador</Th>
                      <Th>Período</Th>
                      <Th right>Horas</Th>
                      <Th right>Custo</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {o.activities.map((a) => (
                      <tr key={a.id} className={cx('border-t border-slate-100', a.voided && 'text-slate-400 line-through')}>
                        <td className="px-4 py-2.5">{a.description}{a.void_reason && <p className="text-[11px] no-underline">Estornada: {a.void_reason}</p>}</td>
                        <td className="px-4 py-2.5">{a.technician_name}</td>
                        <td className="px-4 py-2.5 text-xs whitespace-nowrap">{formatDateTimeBR(a.started_at)} → {formatDateTimeBR(a.ended_at)}</td>
                        <td className="px-4 py-2.5 text-right">{fmtMinutes(a.duration_minutes)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{costs ? formatBRL(a.labor_cost) : '—'}</td>
                        <td className="px-4 py-2.5 text-right">
                          {open && !a.voided && osCan.labor(user) && (
                            <Button size="sm" variant="ghost" onClick={() => { const r = prompt('Motivo do estorno da atividade:'); if (r) run('void', () => api.post(`/os/orders/${o.id}/activities/${a.id}/void`, { reason: r }), 'Atividade estornada.'); }}>
                              Estornar
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {open && osCan.labor(user) && (
              <div className="p-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
                <Field label="Atividade" className="md:col-span-2"><Input value={act.description} onChange={(e) => setAct({ ...act, description: e.target.value })} /></Field>
                <Field label="Técnico">
                  <Select value={act.technician_user_id} onChange={(e) => setAct({ ...act, technician_user_id: e.target.value })}>
                    <option value="">Prestador (digitar)</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </Select>
                </Field>
                {!act.technician_user_id && <Field label="Nome do prestador"><Input value={act.technician_name} onChange={(e) => setAct({ ...act, technician_name: e.target.value })} /></Field>}
                <Field label="Início"><Input type="datetime-local" value={act.started_at} onChange={(e) => setAct({ ...act, started_at: e.target.value })} /></Field>
                <Field label="Término"><Input type="datetime-local" value={act.ended_at} max={nowLocal()} onChange={(e) => setAct({ ...act, ended_at: e.target.value })} /></Field>
                {costs && <Field label="Valor por hora"><MoneyInput value={act.hourly_rate} onChange={(v) => setAct({ ...act, hourly_rate: v ?? 0 })} /></Field>}
                <Button variant="primary" icon={Plus} loading={busy === 'act'} onClick={() => run('act', () => api.post(`/os/orders/${o.id}/activities`, { ...act, technician_user_id: act.technician_user_id || null, started_at: new Date(act.started_at).toISOString(), ended_at: new Date(act.ended_at).toISOString() }), 'Atividade registrada.', () => setAct({ ...act, description: '', started_at: nowLocal(60), ended_at: nowLocal() }))}>
                  Registrar
                </Button>
              </div>
            )}
          </Card>
          <Card title="Serviços terceirizados" bodyClassName="p-0">
            {o.services.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">Nenhum serviço terceirizado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[880px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <Th>Serviço / fornecedor</Th>
                      <Th right>Previsto</Th>
                      <Th right>Aprovado</Th>
                      <Th right>Realizado</Th>
                      <Th>Datas</Th>
                      <Th>Situação</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {o.services.map((s) => (
                      <tr key={s.id} className="border-t border-slate-100 align-top">
                        <td className="px-4 py-2.5">
                          {s.description}
                          <p className="text-[11px] text-slate-500">{s.supplier_name}{s.supplier_document ? ` • doc. ${s.supplier_document}` : ''}{s.approved_by_name ? ` • aprovado por ${s.approved_by_name}` : ''}</p>
                          {s.entry_number && <p className="text-[11px] text-emerald-700">Conta a pagar {s.entry_number}</p>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{costs ? formatBRL(s.estimated_cost) : '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{costs && s.approved_cost !== null ? formatBRL(s.approved_cost) : '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{costs && s.actual_cost !== null ? formatBRL(s.actual_cost) : '—'}</td>
                        <td className="px-4 py-2.5 text-xs">{s.expected_date ? `Prev. ${formatDateBR(s.expected_date)}` : ''}{s.completed_date ? <><br />Concl. {formatDateBR(s.completed_date)}</> : ''}</td>
                        <td className="px-4 py-2.5"><ServicePill s={s.status} /></td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          {s.status === 'pendente_aprovacao' && osCan.approve(user) && open && (
                            <>
                              <Button size="sm" variant="ghost" onClick={() => (setSrvForm({ ...srvForm, approved_cost: s.estimated_cost }), setSrvModal({ id: s.id, action: 'aprovar', description: s.description }))}>Aprovar</Button>
                              <Button size="sm" variant="ghost" onClick={() => (setSrvForm({ ...srvForm, reason: '' }), setSrvModal({ id: s.id, action: 'reprovar', description: s.description }))}>Reprovar</Button>
                            </>
                          )}
                          {s.status === 'aprovado' && osCan.edit(user) && open && <Button size="sm" variant="ghost" onClick={() => (setSrvForm({ ...srvForm, actual_cost: s.approved_cost || 0, supplier_document: s.supplier_document || '' }), setSrvModal({ id: s.id, action: 'concluir', description: s.description, approved: s.approved_cost }))}>Concluir</Button>}
                          {['pendente_aprovacao', 'aprovado', 'reprovado'].includes(s.status) && osCan.edit(user) && <Button size="sm" variant="ghost" className="text-red-700" onClick={() => (setSrvForm({ ...srvForm, reason: '' }), setSrvModal({ id: s.id, action: 'cancelar', description: s.description }))}>Cancelar</Button>}
                          {s.status === 'concluido' && !s.financial_entry_id && osCan.forwardFinance(user) && <Button size="sm" variant="ghost" onClick={() => (setSrvForm({ ...srvForm, due_date: '' }), setSrvModal({ id: s.id, action: 'financeiro', description: s.description }))}>Enviar ao Financeiro</Button>}
                          {s.financial_entry_id && openFinance && <Button size="sm" variant="ghost" icon={ExternalLink} aria-label="Abrir no Financeiro" onClick={() => openFinance(s.financial_entry_id!)} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {open && osCan.edit(user) && (
              <div className="p-4 border-t border-slate-100 grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
                <Field label="Fornecedor">
                  <Select value={srv.supplier_id} onChange={(e) => setSrv({ ...srv, supplier_id: e.target.value })}>
                    <option value="">Selecione</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </Field>
                <Field label="Serviço contratado" className="md:col-span-2"><Input value={srv.description} onChange={(e) => setSrv({ ...srv, description: e.target.value })} /></Field>
                <Field label="Nº orçamento / doc."><Input value={srv.supplier_document} onChange={(e) => setSrv({ ...srv, supplier_document: e.target.value })} /></Field>
                <Field label="Valor previsto"><MoneyInput value={srv.estimated_cost} onChange={(v) => setSrv({ ...srv, estimated_cost: v ?? 0 })} /></Field>
                <Button variant="primary" icon={Plus} loading={busy === 'srv'} onClick={() => run('srv', () => api.post(`/os/orders/${o.id}/services`, srv), 'Serviço incluído (aguarda aprovação).', () => setSrv({ supplier_id: '', description: '', supplier_document: '', estimated_cost: 0, expected_date: '' }))}>
                  Incluir
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'checklist' && (
        <Card title={`Checklist de inspeção e testes${o.requires_checklist ? ' (obrigatório para concluir)' : ''}`} actions={open && osCan.edit(user) && <Button size="sm" variant="primary" icon={Save} loading={busy === 'chk'} onClick={() => run('chk', () => api.post(`/os/orders/${o.id}/checklist`, { answers: Object.entries(answers).map(([cid, a]) => ({ id: Number(cid), ...a })), add_item: newItem ? { label: newItem, required: false } : null }), 'Checklist salvo.', () => setNewItem(''))}>Salvar</Button>}>
          {o.checklist.length === 0 ? (
            <p className="text-sm text-slate-500">Sem checklist. Marque "Exige checklist" na aba de diagnóstico para carregar o modelo da categoria.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {o.checklist.map((c) => (
                <li key={c.id} className="py-2 grid grid-cols-1 md:grid-cols-[1fr_180px_1fr] gap-2 items-center">
                  <span className="text-sm">{c.label} {c.required && <span className="text-red-600 text-xs">obrigatório</span>}{c.answered_by_name && <span className="block text-[11px] text-slate-500">{c.answered_by_name} — {formatDateTimeBR(c.answered_at)}</span>}</span>
                  <Select disabled={!open} value={answers[c.id]?.result || ''} onChange={(e) => setAnswers({ ...answers, [c.id]: { ...answers[c.id], result: (e.target.value || null) as ChecklistResult | null } })} aria-label={`Resultado: ${c.label}`}>
                    <option value="">—</option>
                    {(Object.keys(CHECKLIST_RESULT_LABELS) as ChecklistResult[]).filter((r) => !(c.required && r === 'nao_aplicavel')).map((r) => <option key={r} value={r}>{CHECKLIST_RESULT_LABELS[r]}</option>)}
                  </Select>
                  <Input disabled={!open} value={answers[c.id]?.notes || ''} onChange={(e) => setAnswers({ ...answers, [c.id]: { ...answers[c.id], notes: e.target.value } })} placeholder="Observação (obrigatória se reprovado)" aria-label={`Observação: ${c.label}`} />
                </li>
              ))}
            </ul>
          )}
          {open && osCan.edit(user) && (
            <Field label="Incluir item extra (opcional)" className="mt-3">
              <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Ex.: Correia substituída" />
            </Field>
          )}
        </Card>
      )}

      {tab === 'custos' &&
        (!costs ? (
          <Notice>Seu perfil não consulta custos.</Notice>
        ) : (
          <Card title="Resumo de custos" bodyClassName="p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Componente</Th>
                  <Th right>Previsto</Th>
                  <Th right>Realizado</Th>
                  <Th right>Diferença</Th>
                </tr>
              </thead>
              <tbody>
                {([['Peças', 'parts'], ['Materiais', 'materials'], ['Mão de obra', 'labor'], ['Serviços terceirizados', 'services'], ['Outros', 'other']] as const).map(([l, k]) => (
                  <tr key={k} className="border-t border-slate-100">
                    <td className="px-4 py-2.5">{l}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(costs.estimated[k])}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(costs.actual[k])}</td>
                    <td className={cx('px-4 py-2.5 text-right tabular-nums', costs.actual[k] - costs.estimated[k] > 0 && 'text-red-700')}>{formatBRL(costs.actual[k] - costs.estimated[k])}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-200 font-bold bg-slate-50">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(costs.estimated.total)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(costs.actual.total)}</td>
                  <td className={cx('px-4 py-2.5 text-right tabular-nums', costs.difference > 0 && 'text-red-700')}>{formatBRL(costs.difference)}</td>
                </tr>
              </tbody>
            </table>
            <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-600 space-y-1">
              <p>Encaminhado ao Financeiro (contas a pagar): <b>{formatBRL(costs.payable)}</b>. Custo técnico e obrigação financeira são informações distintas: peças do estoque e mão de obra interna não geram nova despesa.</p>
              {o.cost_approved_at && <p>Custo previsto aprovado por {o.cost_approved_by_name} em {formatDateTimeBR(o.cost_approved_at)}.</p>}
              <p>Peças: custo médio do estoque na retirada, só do que foi utilizado. Previsto de peças usa o custo médio atual.</p>
            </div>
          </Card>
        ))}

      {tab === 'anexos' && (
        <Card
          title="Documentos e fotos"
          actions={
            (osCan.open(user) || osCan.edit(user)) && (
              <div className="flex gap-2 items-center">
                <Select value={attCat} onChange={(e) => setAttCat(e.target.value)} className="w-40" aria-label="Tipo de anexo">
                  {Object.entries(ATTACHMENT_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                <label className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer">
                  <Paperclip className="w-3.5 h-3.5" /> Anexar
                  <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; const d = await readFile(file); run('att', () => api.post(`/os/orders/${o.id}/attachments`, { ...d, category: attCat, title: file.name }), 'Anexo incluído.'); }} />
                </label>
              </div>
            )
          }
        >
          {o.attachments.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum anexo. Arquivos ficam no servidor e só são abertos por usuários logados.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {o.attachments.map((a) => (
                <li key={a.id} className="py-2 flex justify-between gap-3 text-sm">
                  <span>
                    <b>{a.title}</b> <span className="text-xs text-slate-500">• {ATTACHMENT_CATEGORIES[a.category] || a.category} • {a.uploaded_by_name} em {formatDateTimeBR(a.created_at)}</span>
                  </span>
                  <Button size="sm" variant="ghost" icon={FileText} onClick={async () => { try { window.open(URL.createObjectURL(await fetchBlob(`/os/orders/${o.id}/attachments/${a.id}`)), '_blank'); } catch (e) { toast('error', (e as Error).message); } }}>
                    Abrir
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'historico' && (
        <Card title="Histórico da OS" bodyClassName="p-0">
          <ul>
            {o.events.map((e) => (
              <li key={e.id} className="border-t border-slate-100 first:border-0 px-4 py-2.5 text-sm">
                <p>
                  {e.new_status && e.previous_status !== e.new_status && <span className="mr-2"><OsStatusPill s={e.new_status} /></span>}
                  {e.description}
                </p>
                <p className="text-[11px] text-slate-500">{formatDateTimeBR(e.created_at)} • {e.performed_by_name || 'Sistema'}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ------------------------------------------------ janelas */}
      <Modal
        open={!!statusModal}
        onClose={() => setStatusModal(null)}
        title={statusModal === 'concluida' ? 'Concluir OS' : statusModal === 'cancelada' ? 'Cancelar OS' : `Mudar para "${statusModal ? ORDER_STATUS_LABELS[statusModal] : ''}"`}
        size="sm"
        footer={
          <>
            <Button onClick={() => setStatusModal(null)}>Voltar</Button>
            <Button variant={statusModal === 'cancelada' ? 'danger' : 'primary'} loading={busy === 'st'} onClick={async () => (await run('st', () => api.post(`/os/orders/${o.id}/status`, { to: statusModal, row_version: o.row_version, reason: statusForm.reason, scheduled_at: statusModal === 'programada' ? new Date(statusForm.scheduled_at).toISOString() : undefined }), 'Status atualizado.')) && setStatusModal(null)}>
              Confirmar
            </Button>
          </>
        }
      >
        {statusModal === 'concluida' && <p className="text-sm text-slate-600 mb-3">{o.blocks_equipment ? 'O equipamento sai do bloqueio para "aguardando inspeção" — ainda não fica disponível para locação. ' : ''}Reservas de material não retiradas serão liberadas. A OS concluída não é mais alterada.</p>}
        {statusModal === 'cancelada' && <p className="text-sm text-slate-600 mb-3">O cancelamento não apaga o histórico. Material retirado precisa ser devolvido antes.</p>}
        {statusModal === 'programada' && (
          <Field label="Data e hora do atendimento" required>
            <Input type="datetime-local" value={statusForm.scheduled_at} onChange={(e) => setStatusForm({ ...statusForm, scheduled_at: e.target.value })} />
          </Field>
        )}
        <Field label={statusModal && NEEDS_REASON.includes(statusModal) ? 'Motivo' : 'Observação (opcional)'} required={!!statusModal && NEEDS_REASON.includes(statusModal)} className="mt-3">
          <Textarea rows={3} value={statusForm.reason} onChange={(e) => setStatusForm({ ...statusForm, reason: e.target.value })} />
        </Field>
      </Modal>

      <Modal open={blockModal} onClose={() => setBlockModal(false)} title={o.blocks_equipment ? 'Retirar bloqueio' : 'Bloquear equipamento'} size="sm" footer={<><Button onClick={() => setBlockModal(false)}>Voltar</Button><Button variant="primary" disabled={!blockReason.trim()} loading={busy === 'blk'} onClick={async () => (await run('blk', () => api.post(`/os/orders/${o.id}/blocking`, { block: !o.blocks_equipment, reason: blockReason }), 'Bloqueio atualizado.')) && setBlockModal(false)}>Confirmar</Button></>}>
        <p className="text-sm text-slate-600 mb-3">{o.blocks_equipment ? 'Sem o bloqueio, o equipamento vai para "aguardando inspeção" e só volta à locação após a inspeção aprovada.' : 'O equipamento fica indisponível para novas reservas e entregas até a conclusão da OS e a inspeção. Contratos e reservas existentes não são alterados.'}</p>
        <Field label="Justificativa" required>
          <Textarea rows={2} value={blockReason} onChange={(e) => setBlockReason(e.target.value)} />
        </Field>
      </Modal>

      <Modal open={releaseModal} onClose={() => setReleaseModal(false)} title="Liberar equipamento para locação" size="sm" footer={<><Button onClick={() => setReleaseModal(false)}>Voltar</Button><Button variant="primary" icon={ShieldCheck} loading={busy === 'rel'} onClick={async () => (await run('rel', () => api.post(`/os/orders/${o.id}/release`, { checklist: inspection }), 'Inspeção aprovada: equipamento liberado.')) && setReleaseModal(false)}>Aprovar inspeção</Button></>}>
        <p className="text-sm text-slate-600 mb-3">Registra a inspeção no Estoque. Todos os itens precisam estar conferidos.</p>
        <div className="space-y-1">
          {INSPECTION_CHECKLIST.map((c) => <Checkbox key={c.key} checked={!!inspection[c.key]} onChange={(v) => setInspection({ ...inspection, [c.key]: v })} label={c.label} />)}
        </div>
      </Modal>

      <Modal
        open={!!matModal}
        onClose={() => setMatModal(null)}
        title={matModal?.label || ''}
        size="sm"
        footer={
          <>
            <Button onClick={() => setMatModal(null)}>Voltar</Button>
            <Button variant={matModal?.action === 'cancelar' ? 'danger' : 'primary'} loading={busy === 'mat'} onClick={async () => (await run('mat', () => api.post(`/os/orders/${o.id}/materials/${matModal!.id}/${matModal!.action}`, { quantity: Number(String(matForm.quantity).replace(',', '.')), location_id: matForm.location_id || null, notes: matForm.notes, withdrawn_by: matForm.withdrawn_by, reason: matForm.reason, idempotency_key: matForm.key }), 'Material atualizado.')) && setMatModal(null)}>
              Confirmar
            </Button>
          </>
        }
      >
        {matModal && matModal.action !== 'cancelar' && (
          <div className="space-y-3">
            <Field label={`Quantidade (${matModal.unit}) — até ${fmtQty(matModal.max)}`}>
              <Input type="number" min={0} step="any" value={matForm.quantity} onChange={(e) => setMatForm({ ...matForm, quantity: e.target.value })} />
            </Field>
            {['reservar', 'retirar', 'devolver'].includes(matModal.action) && (
              <Field label="Local do estoque" hint="Vazio = local da reserva ou padrão do item">
                <Select value={matForm.location_id} onChange={(e) => setMatForm({ ...matForm, location_id: e.target.value })}>
                  <option value="">Padrão</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}
                </Select>
              </Field>
            )}
            {matModal.action === 'retirar' && (
              <Field label="Retirado por"><Input value={matForm.withdrawn_by} onChange={(e) => setMatForm({ ...matForm, withdrawn_by: e.target.value })} /></Field>
            )}
            <Field label="Observações"><Input value={matForm.notes} onChange={(e) => setMatForm({ ...matForm, notes: e.target.value })} /></Field>
            {matModal.action === 'retirar' && <p className="text-xs text-slate-500">Saída real do estoque. Reenviar este formulário não duplica a retirada.</p>}
          </div>
        )}
        {matModal?.action === 'cancelar' && (
          <Field label="Motivo"><Textarea rows={2} value={matForm.reason} onChange={(e) => setMatForm({ ...matForm, reason: e.target.value })} /></Field>
        )}
      </Modal>

      <Modal
        open={!!srvModal}
        onClose={() => setSrvModal(null)}
        title={srvModal ? { aprovar: 'Aprovar serviço', reprovar: 'Reprovar serviço', concluir: 'Concluir serviço', cancelar: 'Cancelar serviço', financeiro: 'Enviar ao Financeiro' }[srvModal.action] || '' : ''}
        size="sm"
        footer={
          <>
            <Button onClick={() => setSrvModal(null)}>Voltar</Button>
            <Button variant="primary" loading={busy === 'srva'} onClick={async () => (await run('srva', () => api.post(`/os/orders/${o.id}/services/${srvModal!.id}/${srvModal!.action}`, srvForm), 'Serviço atualizado.')) && setSrvModal(null)}>
              Confirmar
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 mb-3">{srvModal?.description}</p>
        {srvModal?.action === 'aprovar' && <Field label="Valor aprovado"><MoneyInput value={srvForm.approved_cost} onChange={(v) => setSrvForm({ ...srvForm, approved_cost: v ?? 0 })} /></Field>}
        {srvModal?.action === 'concluir' && (
          <div className="space-y-3">
            <Field label={`Valor realizado${srvModal.approved ? ` (aprovado: ${formatBRL(srvModal.approved)})` : ''}`}><MoneyInput value={srvForm.actual_cost} onChange={(v) => setSrvForm({ ...srvForm, actual_cost: v ?? 0 })} /></Field>
            <Field label="Nota fiscal / documento"><Input value={srvForm.supplier_document} onChange={(e) => setSrvForm({ ...srvForm, supplier_document: e.target.value })} /></Field>
          </div>
        )}
        {(srvModal?.action === 'reprovar' || srvModal?.action === 'cancelar') && <Field label="Motivo" required><Textarea rows={2} value={srvForm.reason} onChange={(e) => setSrvForm({ ...srvForm, reason: e.target.value })} /></Field>}
        {srvModal?.action === 'financeiro' && (
          <>
            <Field label="Vencimento" hint="Vazio = 30 dias"><Input type="date" value={srvForm.due_date} onChange={(e) => setSrvForm({ ...srvForm, due_date: e.target.value })} /></Field>
            <p className="text-xs text-slate-500 mt-2">Cria uma conta a pagar com o valor realizado. A alçada de aprovação do Financeiro vale normalmente. O mesmo serviço não gera duas contas.</p>
          </>
        )}
      </Modal>
    </div>
  );
};
