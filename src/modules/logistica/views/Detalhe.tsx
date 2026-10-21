/**
 * Detalhe da operação: ações conforme status e permissão (vindas do servidor), separação com checklist,
 * confirmação de entrega, recebimento, inspeção, transporte, anexos, ocorrências e histórico.
 */

import React, { useEffect, useState } from 'react';
import { Printer, PackageOpen, PackageCheck, Truck, CheckCircle2, Undo2, ClipboardCheck, Ban, Paperclip, FileText, SlidersHorizontal, Navigation, Wallet } from 'lucide-react';
import {
  ATTACHMENT_PHASES, EXIT_CHECKLIST, INSPECTION_RESULT_LABELS, InspectionResult, OCCURRENCE_TYPE_LABELS, OP_TYPE_LABELS, OpDetail, PICKUP_REASON_LABELS, RESPONSIBILITY_LABELS, TRANSPORT_LABELS,
} from '../../../../shared/logistica/types';
import { INSPECTION_CHECKLIST, OPERATIONAL_LABELS } from '../../../../shared/estoque/types';
import { logCan } from '../../../../shared/logistica/rules';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { formatDateBR, formatDateTimeBR } from '../../../../shared/orcamentos/dates';
import { formatDocument, formatPhone } from '../../../../shared/orcamentos/validators';
import { api, ApiError, fetchBlob } from '../../orcamentos/api';
import { Button, Card, Checkbox, ErrorState, Field, Input, Loading, Modal, MoneyInput, Notice, PageHeader, Select, Textarea, cx, useAsync, useToast } from '../../orcamentos/ui';
import { fmtQty } from '../../estoque/components';
import { readFile, toLocalInput, useLog } from '../context';
import { KV, OccPill, OpPill, Th } from '../components';

const CONDITIONS = ['novo', 'bom', 'regular', 'ruim'];
type ModalKind = null | 'confirmar' | 'receber' | 'ajustar' | 'transporte' | 'motivo' | 'inspecao' | 'frete';

export const OperacaoDetalhe: React.FC<{ id: number }> = ({ id }) => {
  const { user, suppliers, locations, navigate, openContract, openOs } = useLog();
  const toast = useToast();
  const { data: o, error, loading, reload } = useAsync(() => api.get<OpDetail>(`/logistics/operations/${id}`), [id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [reasonAction, setReasonAction] = useState<{ action: string; title: string; required: boolean } | null>(null);
  const [reason, setReason] = useState('');
  const [sep, setSep] = useState<Record<number, { quantity: string; condition: string; notes: string }>>({});
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [accessories, setAccessories] = useState('');
  const [conf, setConf] = useState({ receiver_name: '', receiver_document: '', delivered_at: toLocalInput(), notes: '', orientation_given: false });
  const [recv, setRecv] = useState<Record<number, { quantity: string; missing: string; condition: string; notes: string }>>({});
  const [recvHead, setRecvHead] = useState({ counterpart_name: '', received_at: toLocalInput(), location_id: '', notes: '' });
  const [adj, setAdj] = useState<Record<number, string>>({});
  const [tr, setTr] = useState({ departed_at: '', arrived_at: '', transport_notes: '', transport_cost_actual: null as number | null, carrier_supplier_id: '' });
  const [insp, setInsp] = useState({ order_item_id: 0, quantity: '', result: 'aprovado' as InspectionResult, condition: '', notes: '', estimated_cost: null as number | null, checklist: {} as Record<string, boolean> });
  const [phase, setPhase] = useState('saida');
  const [dueDate, setDueDate] = useState('');

  useEffect(() => {
    if (!o) return;
    setSep(Object.fromEntries(o.items.map((i) => [i.id, { quantity: String(i.quantity_planned), condition: i.condition_before || 'bom', notes: '' }])));
    setChecklist(o.separation_checklist || {});
    setAccessories(o.accessories || '');
    setRecv(Object.fromEntries(o.items.map((i) => [i.id, { quantity: String(i.quantity_planned), missing: '0', condition: '', notes: '' }])));
    setRecvHead((h) => ({ ...h, location_id: '' }));
    setTr({ departed_at: o.departed_at ? toLocalInput(o.departed_at) : '', arrived_at: o.arrived_at ? toLocalInput(o.arrived_at) : '', transport_notes: o.transport_notes || '', transport_cost_actual: o.transport_cost_actual, carrier_supplier_id: o.carrier_supplier_id ? String(o.carrier_supplier_id) : '' });
    setPhase(o.op_type === 'entrega' ? (['entregue', 'entregue_parcialmente', 'em_transporte'].includes(o.status) ? 'entrega' : 'saida') : o.status === 'em_conferencia' || o.status === 'aguardando_inspecao' ? 'inspecao' : 'retorno');
  }, [o]);

  if (loading && !o) return <Loading />;
  if (error || !o) return <ErrorState message={error || 'Operação não encontrada.'} onRetry={reload} />;
  const has = (a: string) => o.actions.includes(a);
  const run = async (label: string, url: string, body: unknown, msg: string) => {
    setBusy(label);
    try {
      const r = await api.post<any>(url, body);
      toast('success', r?.already ? 'Esta confirmação já tinha sido registrada — nada foi duplicado.' : msg);
      setModal(null);
      reload();
      return true;
    } catch (e) {
      toast('error', (e as ApiError).message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  const action = (a: string, body: unknown, msg: string) => run(a, `/logistics/operations/${o.id}/action/${a}`, { row_version: o.row_version, ...(body as object) }, msg);
  const askReason = (a: string, title: string, required: boolean) => (setReason(''), setReasonAction({ action: a, title, required }), setModal('motivo'));
  const isDelivery = o.op_type === 'entrega';
  const toInspect = o.items.filter((i) => i.quantity_processed - i.quantity_inspected > 1e-9);
  const pdf = async () => {
    try {
      window.open(URL.createObjectURL(await fetchBlob(`/logistics/operations/${o.id}/pdf`)), '_blank');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  return (
    <div>
      <PageHeader title={o.number} subtitle={`${OP_TYPE_LABELS[o.op_type]} • ${o.customer.name} • contrato ${o.contract.contract_number}`} onBack={() => navigate({ page: 'painel' })} actions={<OpPill s={o.status} />} />
      <div className="flex flex-wrap gap-2 mb-4">
        {has('programar') && <Button size="sm" variant="primary" loading={busy === 'programar'} onClick={() => action('programar', {}, 'Operação programada.')}>Programar</Button>}
        {has('iniciar_separacao') && <Button size="sm" variant="primary" icon={PackageOpen} loading={busy === 'iniciar_separacao'} onClick={() => action('iniciar_separacao', {}, 'Separação iniciada.')}>Iniciar separação</Button>}
        {has('ajustar') && <Button size="sm" icon={SlidersHorizontal} onClick={() => (setAdj(Object.fromEntries(o.items.map((i) => [i.id, String(i.quantity_planned)]))), setReason(''), setModal('ajustar'))}>Ajustar operação</Button>}
        {has('voltar_programada') && <Button size="sm" onClick={() => askReason('voltar_programada', 'Interromper separação', false)}>Interromper separação</Button>}
        {has('sair') && <Button size="sm" variant="primary" icon={Truck} loading={busy === 'sair'} onClick={() => action('sair', {}, 'Saída registrada.')}>Registrar saída</Button>}
        {has('voltar_separacao') && <Button size="sm" onClick={() => askReason('voltar_separacao', 'Voltar para separação', false)}>Voltar para separação</Button>}
        {has('confirmar_entrega') && <Button size="sm" variant="primary" icon={CheckCircle2} onClick={() => setModal('confirmar')}>Confirmar entrega</Button>}
        {has('retornar_sem_entrega') && <Button size="sm" icon={Undo2} onClick={() => askReason('retornar_sem_entrega', 'Voltou sem entregar', true)}>Voltou sem entregar</Button>}
        {has('iniciar') && <Button size="sm" variant="primary" icon={Navigation} loading={busy === 'iniciar'} onClick={() => action('iniciar', {}, 'Saída para retirada registrada.')}>Saiu para retirar</Button>}
        {has('receber') && <Button size="sm" variant="primary" icon={PackageCheck} onClick={() => setModal('receber')}>Registrar recebimento</Button>}
        {has('inspecionar') && toInspect.length > 0 && <Button size="sm" variant="primary" icon={ClipboardCheck} onClick={() => { const it = toInspect[0]; setInsp({ order_item_id: it.id, quantity: String(it.quantity_processed - it.quantity_inspected), result: 'aprovado', condition: '', notes: '', estimated_cost: null, checklist: {} }); setModal('inspecao'); }}>Inspecionar</Button>}
        {has('concluir') && !o.blockers.concluir && <Button size="sm" loading={busy === 'concluir'} onClick={() => action('concluir', {}, 'Conferência concluída.')}>Concluir conferência</Button>}
        {has('transporte') && <Button size="sm" icon={Truck} onClick={() => setModal('transporte')}>Dados de transporte</Button>}
        {has('frete_financeiro') && <Button size="sm" icon={Wallet} onClick={() => (setDueDate(''), setModal('frete'))}>Enviar frete ao Financeiro</Button>}
        <Button size="sm" icon={Printer} onClick={pdf}>{isDelivery ? 'Comprovante / romaneio' : 'Termo / checklist'}</Button>
        {has('cancelar') && <Button size="sm" icon={Ban} className="text-red-700" onClick={() => askReason('cancelar', 'Cancelar operação', true)}>Cancelar</Button>}
      </div>
      {o.status === 'entregue_parcialmente' && <Notice kind="warning" className="mb-4">Entrega parcial: os itens não entregues continuam pendentes no contrato e podem ser programados em nova entrega.</Notice>}
      {toInspect.length > 0 && <Notice kind="warning" className="mb-4">{toInspect.length} item(ns) recebido(s) aguardando inspeção — permanecem indisponíveis para nova locação até a liberação.</Notice>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start mb-5">
        <Card title="Cliente e contrato">
          <p className="font-semibold">{o.customer.name}</p>
          <KV label="Documento">{o.customer.document ? formatDocument(o.customer.document) : '—'}</KV>
          <KV label="Telefone">{o.customer.phone ? formatPhone(o.customer.phone) : '—'}</KV>
          <KV label="Contrato">{openContract ? <button className="text-[#1e3a5f] font-semibold hover:underline" onClick={() => openContract(o.contract.contract_number)}>{o.contract.contract_number}</button> : o.contract.contract_number}</KV>
          <KV label="Vigência">{`${formatDateBR(o.contract.start_date)} a ${o.contract.end_date ? formatDateBR(o.contract.end_date) : 'indeterminado'}`}</KV>
          {o.reason && <KV label="Motivo">{PICKUP_REASON_LABELS[o.reason]}</KV>}
          {o.contract_operation_number && <KV label="Movimentação no contrato">{o.contract_operation_number}</KV>}
        </Card>
        <Card title="Local e programação">
          <KV label="Programada">{formatDateTimeBR(o.scheduled_at)}</KV>
          <KV label="Endereço">{o.address || '—'}</KV>
          <KV label="Contato no local">{[o.contact_name, o.contact_phone].filter(Boolean).join(' • ') || '—'}</KV>
          {o.access_instructions && <KV label="Acesso">{o.access_instructions}</KV>}
          {o.special_equipment && <KV label="Carga/descarga">{o.special_equipment}</KV>}
          <KV label="Responsável">{o.responsible_name || '—'}</KV>
          {o.notes && <KV label="Observações">{o.notes}</KV>}
        </Card>
        <Card title="Transporte">
          <KV label="Tipo">{TRANSPORT_LABELS[o.transport_type]}</KV>
          {o.driver_name && <KV label="Motorista">{o.driver_name}</KV>}
          {o.vehicle_label && <KV label="Veículo">{o.vehicle_label}</KV>}
          {o.carrier_name && <KV label="Transportadora">{o.carrier_name}</KV>}
          <KV label="Saída / chegada">{[o.departed_at && formatDateTimeBR(o.departed_at), o.arrived_at && formatDateTimeBR(o.arrived_at)].filter(Boolean).join(' → ') || '—'}</KV>
          <KV label={isDelivery ? 'Entregue em' : 'Recebido em'}>{formatDateTimeBR(o.completed_at)}</KV>
          {o.receiver_name && <KV label={isDelivery ? 'Recebido por' : 'Conferido por'}>{[o.receiver_name, o.receiver_document].filter(Boolean).join(' — ')}</KV>}
          {logCan.viewCosts(user) && <KV label="Custo estimado / realizado">{`${o.transport_cost_estimated !== null ? formatBRL(o.transport_cost_estimated) : '—'} / ${o.transport_cost_actual !== null ? formatBRL(o.transport_cost_actual) : '—'}`}</KV>}
          {o.transport_entry_number && <KV label="Conta a pagar">{o.transport_entry_number}</KV>}
          {o.transport_notes && <p className="text-xs text-slate-600 mt-1 whitespace-pre-line">{o.transport_notes}</p>}
        </Card>
      </div>

      <Card title="Equipamentos" bodyClassName="p-0" className="mb-5">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead className="bg-slate-50">
              <tr>
                <Th>Item</Th>
                <Th>Patrimônio / série</Th>
                <Th right>Programado</Th>
                {isDelivery ? <><Th right>Separado</Th><Th right>Entregue</Th></> : <><Th right>Recebido</Th><Th right>Faltante</Th><Th right>Inspecionado</Th></>}
                <Th>Estado saída → retorno</Th>
                <Th>Situação no estoque</Th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((i) => (
                <tr key={i.id} className={cx('border-t border-slate-100 align-top', i.quantity_planned === 0 && 'text-slate-400')}>
                  <td className="px-4 py-2.5"><span className="font-mono text-xs text-slate-500 mr-1">{i.item_code}</span>{i.description}{i.adjust_reason && <p className="text-[11px] text-amber-700">Ajuste: {i.adjust_reason} (de {fmtQty(i.quantity_original)})</p>}</td>
                  <td className="px-4 py-2.5">{[i.asset_tag, i.serial_number].filter(Boolean).join(' / ') || '—'}</td>
                  <td className="px-4 py-2.5 text-right">{fmtQty(i.quantity_planned, i.unit)}</td>
                  {isDelivery ? (
                    <>
                      <td className="px-4 py-2.5 text-right">{fmtQty(i.quantity_separated)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">{fmtQty(i.quantity_processed)}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2.5 text-right font-semibold">{fmtQty(i.quantity_processed)}</td>
                      <td className={cx('px-4 py-2.5 text-right', i.quantity_missing > 0 && 'text-red-700 font-semibold')}>{fmtQty(i.quantity_missing)}</td>
                      <td className="px-4 py-2.5 text-right">{fmtQty(i.quantity_inspected)}</td>
                    </>
                  )}
                  <td className="px-4 py-2.5 text-xs">{i.condition_before || '—'} → {i.condition_after || '—'}</td>
                  <td className="px-4 py-2.5 text-xs">{i.operational_status ? OPERATIONAL_LABELS[i.operational_status as 'operacional'] : `Contrato: ${fmtQty(i.contract_delivered)} com o cliente`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {o.status === 'em_separacao' && logCan.separate(user) && (
        <Card title="Separação e conferência de saída" className="mb-5" actions={<Button size="sm" variant="primary" icon={CheckCircle2} loading={busy === 'concluir_separacao'} onClick={() => action('concluir_separacao', { checklist, accessories, items: o.items.filter((i) => i.quantity_planned > 0).map((i) => ({ id: i.id, quantity: Number(String(sep[i.id]?.quantity || 0).replace(',', '.')), condition: sep[i.id]?.condition, notes: sep[i.id]?.notes })) }, 'Separação concluída: pronta para saída.')}>Concluir separação</Button>}>
          <div className="space-y-2">
            {o.items.filter((i) => i.quantity_planned > 0).map((i) => (
              <div key={i.id} className="grid grid-cols-1 md:grid-cols-[1fr_120px_140px_1fr] gap-2 items-center">
                <span className="text-sm"><b>{i.asset_tag || i.item_code}</b> {i.description} <span className="text-xs text-slate-500">(programado {fmtQty(i.quantity_planned, i.unit)})</span></span>
                {i.tracking === 'individual' ? (
                  <Checkbox checked={sep[i.id]?.quantity === '1'} onChange={(v) => setSep({ ...sep, [i.id]: { ...sep[i.id], quantity: v ? '1' : '0' } })} label="Conferido" />
                ) : (
                  <Input type="number" min={0} step="any" value={sep[i.id]?.quantity || ''} onChange={(e) => setSep({ ...sep, [i.id]: { ...sep[i.id], quantity: e.target.value } })} aria-label={`Separado ${i.item_code}`} />
                )}
                <Select value={sep[i.id]?.condition || ''} onChange={(e) => setSep({ ...sep, [i.id]: { ...sep[i.id], condition: e.target.value } })} aria-label="Estado de conservação">
                  {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
                <Input value={sep[i.id]?.notes || ''} onChange={(e) => setSep({ ...sep, [i.id]: { ...sep[i.id], notes: e.target.value } })} placeholder="Observação" aria-label="Observação" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="space-y-1">
              <p className="text-xs font-bold text-slate-600 uppercase">Checklist de saída</p>
              {EXIT_CHECKLIST.map((k) => <Checkbox key={k.key} checked={!!checklist[k.key]} onChange={(v) => setChecklist({ ...checklist, [k.key]: v })} label={<>{k.label} {k.required && <span className="text-red-600 text-xs">obrigatório</span>}</>} />)}
            </div>
            <Field label="Acessórios incluídos"><Textarea rows={3} value={accessories} onChange={(e) => setAccessories(e.target.value)} /></Field>
          </div>
          <p className="text-xs text-slate-500 mt-3">Item faltante, danificado ou indisponível: use "Ajustar operação" (gestor), com justificativa. Fotos de saída podem ser anexadas abaixo.</p>
        </Card>
      )}

      {o.inspections.length > 0 && (
        <Card title="Inspeções" bodyClassName="p-0" className="mb-5">
          <table className="w-full text-sm">
            <thead className="bg-slate-50"><tr><Th>Equipamento</Th><Th right>Qtd.</Th><Th>Resultado</Th><Th>Observações</Th><Th>Responsável</Th></tr></thead>
            <tbody>
              {o.inspections.map((i) => (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">{i.asset_tag || i.item_code}</td>
                  <td className="px-4 py-2 text-right">{fmtQty(i.quantity)}</td>
                  <td className="px-4 py-2">{INSPECTION_RESULT_LABELS[i.result]}{i.work_order_number && <> — {openOs && i.work_order_id ? <button className="text-[#1e3a5f] font-semibold hover:underline" onClick={() => openOs(i.work_order_id!)}>{i.work_order_number}</button> : i.work_order_number}</>}</td>
                  <td className="px-4 py-2 text-xs">{i.condition ? `Estado: ${i.condition}. ` : ''}{i.notes || '—'}</td>
                  <td className="px-4 py-2 text-xs">{i.inspected_by_name} • {formatDateTimeBR(i.inspected_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <Card title="Avarias e ocorrências" actions={<Button size="sm" variant="ghost" onClick={() => navigate({ page: 'ocorrencias' })}>Gerenciar</Button>}>
          {o.occurrences.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma ocorrência.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {o.occurrences.map((x) => (
                <li key={x.id} className="py-2 text-sm">
                  <div className="flex justify-between gap-2"><b>{x.number} — {OCCURRENCE_TYPE_LABELS[x.occurrence_type]}</b><OccPill s={x.status} /></div>
                  <p className="text-slate-700">{x.description}</p>
                  <p className="text-xs text-slate-500">Responsabilidade: {RESPONSIBILITY_LABELS[x.responsibility]}{x.estimated_cost !== null ? ` • estimativa ${formatBRL(x.estimated_cost)}` : ''}{x.work_order_number ? ` • ${x.work_order_number}` : ''}{x.charge_entry_number ? ` • cobrança ${x.charge_entry_number}` : ''}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card
          title="Fotos e documentos"
          actions={
            (logCan.separate(user) || logCan.inspect(user) || logCan.confirm(user)) && (
              <div className="flex gap-2 items-center">
                <Select value={phase} onChange={(e) => setPhase(e.target.value)} className="w-44" aria-label="Etapa">
                  {Object.entries(ATTACHMENT_PHASES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
                <label className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer">
                  <Paperclip className="w-3.5 h-3.5" /> Anexar
                  <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; const d = await readFile(file); run('att', `/logistics/operations/${o.id}/attachments`, { ...d, phase, title: file.name }, 'Anexo incluído.'); }} />
                </label>
              </div>
            )
          }
        >
          {o.attachments.length === 0 ? (
            <p className="text-sm text-slate-500">Sem anexos. Fotos de saída ficam disponíveis para comparar com o retorno.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {o.attachments.map((a) => (
                <li key={a.id} className="py-2 flex justify-between gap-2 text-sm">
                  <span><b>{a.title}</b> <span className="text-xs text-slate-500">• {ATTACHMENT_PHASES[a.phase] || a.phase} • {a.uploaded_by_name} em {formatDateTimeBR(a.created_at)}</span></span>
                  <Button size="sm" variant="ghost" icon={FileText} onClick={async () => { try { window.open(URL.createObjectURL(await fetchBlob(`/logistics/attachments/${a.id}`)), '_blank'); } catch (e) { toast('error', (e as Error).message); } }}>Abrir</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Histórico" bodyClassName="p-0" className="lg:col-span-2">
          <ul>
            {o.events.map((e) => (
              <li key={e.id} className="border-t border-slate-100 first:border-0 px-4 py-2 text-sm">
                <p>{e.new_status && e.previous_status !== e.new_status && <span className="mr-2"><OpPill s={e.new_status} /></span>}{e.description}</p>
                <p className="text-[11px] text-slate-500">{formatDateTimeBR(e.created_at)} • {e.performed_by_name || 'Sistema'}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* ------------------------------------------------ janelas */}
      <Modal open={modal === 'confirmar'} onClose={() => setModal(null)} title="Confirmar entrega" footer={<><Button onClick={() => setModal(null)}>Voltar</Button><Button variant="primary" loading={busy === 'confirmar_entrega'} disabled={!conf.receiver_name.trim()} onClick={() => action('confirmar_entrega', { ...conf, delivered_at: new Date(conf.delivered_at).toISOString() }, 'Entrega confirmada: saída registrada no estoque.')}>Confirmar entrega</Button></>}>
        <Notice className="mb-3">Ao confirmar, a saída física é registrada no Estoque e o contrato é atualizado — tudo junto. Se o estoque recusar (equipamento indisponível), nada é gravado. Repetir a confirmação não duplica a saída.</Notice>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Recebido por" required><Input value={conf.receiver_name} onChange={(e) => setConf({ ...conf, receiver_name: e.target.value })} /></Field>
          <Field label="Documento (se exigido)"><Input value={conf.receiver_document} onChange={(e) => setConf({ ...conf, receiver_document: e.target.value })} /></Field>
          <Field label="Data e hora da entrega"><Input type="datetime-local" value={conf.delivered_at} max={toLocalInput()} onChange={(e) => setConf({ ...conf, delivered_at: e.target.value })} /></Field>
          <div className="flex items-end pb-2"><Checkbox checked={conf.orientation_given} onChange={(v) => setConf({ ...conf, orientation_given: v })} label="Orientações de uso e segurança passadas" /></div>
          <Field label="Observações" className="sm:col-span-2"><Textarea rows={2} value={conf.notes} onChange={(e) => setConf({ ...conf, notes: e.target.value })} /></Field>
        </div>
        <p className="text-xs text-slate-500 mt-2">Não há assinatura eletrônica: imprima o comprovante para assinatura e anexe a foto/digitalização na etapa "Entrega no cliente".</p>
      </Modal>

      <Modal open={modal === 'receber'} onClose={() => setModal(null)} title={o.op_type === 'retirada' ? 'Registrar retirada / recebimento' : 'Registrar devolução'} size="lg" footer={<><Button onClick={() => setModal(null)}>Voltar</Button><Button variant="primary" loading={busy === 'receber'} onClick={() => action('receber', { ...recvHead, received_at: new Date(recvHead.received_at).toISOString(), location_id: recvHead.location_id || null, items: o.items.filter((i) => i.quantity_planned > 0).map((i) => ({ id: i.id, quantity: Number(String(recv[i.id]?.quantity || 0).replace(',', '.')), missing: Number(String(recv[i.id]?.missing || 0).replace(',', '.')), condition: recv[i.id]?.condition, notes: recv[i.id]?.notes })) }, 'Recebimento registrado: itens retidos para inspeção.')}>Confirmar recebimento</Button></>}>
        <Notice className="mb-3">Os itens entram fisicamente no estoque, mas ficam retidos (indisponíveis) até a inspeção. Devolução parcial não encerra o contrato.</Notice>
        <div className="space-y-2">
          {o.items.filter((i) => i.quantity_planned > 0).map((i) => (
            <div key={i.id} className="grid grid-cols-1 md:grid-cols-[1fr_110px_110px_120px_1fr] gap-2 items-end">
              <span className="text-sm pb-2"><b>{i.asset_tag || i.item_code}</b> {i.description} <span className="text-xs text-slate-500">(previsto {fmtQty(i.quantity_planned, i.unit)}; saiu: {i.condition_before || '—'})</span></span>
              {i.tracking === 'individual' ? (
                <div className="pb-2"><Checkbox checked={recv[i.id]?.quantity === '1'} onChange={(v) => setRecv({ ...recv, [i.id]: { ...recv[i.id], quantity: v ? '1' : '0' } })} label="Recebido" /></div>
              ) : (
                <>
                  <Field label="Recebido"><Input type="number" min={0} step="any" value={recv[i.id]?.quantity || ''} onChange={(e) => setRecv({ ...recv, [i.id]: { ...recv[i.id], quantity: e.target.value } })} /></Field>
                  <Field label="Faltante"><Input type="number" min={0} step="any" value={recv[i.id]?.missing || ''} onChange={(e) => setRecv({ ...recv, [i.id]: { ...recv[i.id], missing: e.target.value } })} /></Field>
                </>
              )}
              <Field label="Estado"><Select value={recv[i.id]?.condition || ''} onChange={(e) => setRecv({ ...recv, [i.id]: { ...recv[i.id], condition: e.target.value } })}><option value="">—</option>{CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
              <Field label="Observação"><Input value={recv[i.id]?.notes || ''} onChange={(e) => setRecv({ ...recv, [i.id]: { ...recv[i.id], notes: e.target.value } })} /></Field>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          <Field label="Devolvido por"><Input value={recvHead.counterpart_name} onChange={(e) => setRecvHead({ ...recvHead, counterpart_name: e.target.value })} /></Field>
          <Field label="Data e hora"><Input type="datetime-local" value={recvHead.received_at} max={toLocalInput()} onChange={(e) => setRecvHead({ ...recvHead, received_at: e.target.value })} /></Field>
          <Field label="Local de retorno"><Select value={recvHead.location_id} onChange={(e) => setRecvHead({ ...recvHead, location_id: e.target.value })}><option value="">Programado / local de saída</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.name}</option>)}</Select></Field>
          <Field label="Observações" className="sm:col-span-3"><Textarea rows={2} value={recvHead.notes} onChange={(e) => setRecvHead({ ...recvHead, notes: e.target.value })} /></Field>
        </div>
        <p className="text-xs text-slate-500 mt-2">Faltantes viram ocorrência para análise — nenhuma cobrança é gerada automaticamente.</p>
      </Modal>

      <Modal open={modal === 'inspecao'} onClose={() => setModal(null)} title="Inspeção do equipamento devolvido" size="lg" footer={<><Button onClick={() => setModal(null)}>Voltar</Button><Button variant="primary" loading={busy === 'insp'} onClick={() => run('insp', `/logistics/operations/${o.id}/inspections`, { ...insp, quantity: Number(String(insp.quantity).replace(',', '.')) }, 'Inspeção registrada.')}>Registrar inspeção</Button></>}>
        {(() => {
          const it = o.items.find((i) => i.id === insp.order_item_id);
          return (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Equipamento">
                  <Select value={insp.order_item_id} onChange={(e) => { const x = toInspect.find((i) => i.id === Number(e.target.value))!; setInsp({ ...insp, order_item_id: x.id, quantity: String(x.quantity_processed - x.quantity_inspected) }); }}>
                    {toInspect.map((i) => <option key={i.id} value={i.id}>{i.asset_tag || i.item_code} — pendente {fmtQty(i.quantity_processed - i.quantity_inspected)}</option>)}
                  </Select>
                </Field>
                {it?.tracking === 'quantidade' && <Field label="Quantidade"><Input type="number" min={0} step="any" value={insp.quantity} onChange={(e) => setInsp({ ...insp, quantity: e.target.value })} /></Field>}
                <Field label="Resultado">
                  <Select value={insp.result} onChange={(e) => setInsp({ ...insp, result: e.target.value as InspectionResult })}>
                    {(Object.keys(INSPECTION_RESULT_LABELS) as InspectionResult[]).filter((r) => it?.tracking === 'individual' || r !== 'manutencao').map((r) => <option key={r} value={r}>{INSPECTION_RESULT_LABELS[r]}</option>)}
                  </Select>
                </Field>
              </div>
              {it && <p className="text-xs text-slate-500">Estado na saída: <b>{it.condition_before || 'não registrado'}</b>{it.origin_order_number ? <> (entrega {it.origin_order_number} — fotos de saída nos anexos dela)</> : null}.</p>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 p-2 rounded bg-slate-50">
                {INSPECTION_CHECKLIST.map((c) => <Checkbox key={c.key} checked={!!insp.checklist[c.key]} onChange={(v) => setInsp({ ...insp, checklist: { ...insp.checklist, [c.key]: v } })} label={c.label} />)}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Estado de conservação no retorno"><Select value={insp.condition} onChange={(e) => setInsp({ ...insp, condition: e.target.value })}><option value="">—</option>{CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}</Select></Field>
                {logCan.viewCosts(user) && insp.result !== 'aprovado' && <Field label="Estimativa de custo (opcional)"><MoneyInput value={insp.estimated_cost} allowEmpty onChange={(v) => setInsp({ ...insp, estimated_cost: v })} /></Field>}
                <Field label={insp.result === 'aprovado' || insp.result === 'aguardando_inspecao' ? 'Observações' : 'Descrição do problema (obrigatória)'} className="sm:col-span-2"><Textarea rows={2} value={insp.notes} onChange={(e) => setInsp({ ...insp, notes: e.target.value })} /></Field>
              </div>
              <p className="text-xs text-slate-500">Aprovar exige o checklist completo e libera para locação. Avaria/bloqueio/incompleto geram ocorrência para análise (responsabilidade a apurar). Manutenção abre uma OS impeditiva.</p>
            </div>
          );
        })()}
      </Modal>

      <Modal open={modal === 'ajustar'} onClose={() => setModal(null)} title="Ajustar operação (autorização)" size="sm" footer={<><Button onClick={() => setModal(null)}>Voltar</Button><Button variant="primary" disabled={!reason.trim()} loading={busy === 'ajustar'} onClick={() => action('ajustar', { reason, items: o.items.map((i) => ({ id: i.id, quantity_planned: Number(String(adj[i.id] ?? i.quantity_planned).replace(',', '.')) })) }, 'Operação ajustada.')}>Ajustar</Button></>}>
        <div className="space-y-2">
          {o.items.map((i) => (
            <div key={i.id} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{i.asset_tag || i.item_code} <span className="text-xs text-slate-500">(original {fmtQty(i.quantity_original)})</span></span>
              <Input type="number" min={0} max={i.quantity_original} step="any" value={adj[i.id] ?? ''} onChange={(e) => setAdj({ ...adj, [i.id]: e.target.value })} className="w-28" aria-label={`Nova quantidade ${i.item_code}`} />
            </div>
          ))}
        </div>
        <Field label="Justificativa" required className="mt-3"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: 2 peças danificadas na separação" /></Field>
      </Modal>

      <Modal open={modal === 'transporte'} onClose={() => setModal(null)} title="Dados de transporte" size="sm" footer={<><Button onClick={() => setModal(null)}>Voltar</Button><Button variant="primary" loading={busy === 'transporte'} onClick={() => action('transporte', { ...tr, departed_at: tr.departed_at ? new Date(tr.departed_at).toISOString() : null, arrived_at: tr.arrived_at ? new Date(tr.arrived_at).toISOString() : null, carrier_supplier_id: tr.carrier_supplier_id || null }, 'Dados de transporte salvos.')}>Salvar</Button></>}>
        <div className="space-y-3">
          <Field label="Saída"><Input type="datetime-local" value={tr.departed_at} onChange={(e) => setTr({ ...tr, departed_at: e.target.value })} /></Field>
          <Field label="Chegada"><Input type="datetime-local" value={tr.arrived_at} onChange={(e) => setTr({ ...tr, arrived_at: e.target.value })} /></Field>
          {o.transport_type === 'terceiro' && <Field label="Transportadora"><Select value={tr.carrier_supplier_id} onChange={(e) => setTr({ ...tr, carrier_supplier_id: e.target.value })}><option value="">Selecione</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>}
          {logCan.viewCosts(user) && <Field label="Custo de transporte realizado"><MoneyInput value={tr.transport_cost_actual} allowEmpty onChange={(v) => setTr({ ...tr, transport_cost_actual: v })} /></Field>}
          <Field label="Ocorrências no transporte"><Textarea rows={2} value={tr.transport_notes} onChange={(e) => setTr({ ...tr, transport_notes: e.target.value })} /></Field>
        </div>
      </Modal>

      <Modal open={modal === 'frete'} onClose={() => setModal(null)} title="Enviar frete ao Financeiro" size="sm" footer={<><Button onClick={() => setModal(null)}>Voltar</Button><Button variant="primary" loading={busy === 'frete_financeiro'} onClick={() => action('frete_financeiro', { due_date: dueDate || undefined }, 'Conta a pagar criada no Financeiro.')}>Enviar</Button></>}>
        <p className="text-sm text-slate-600 mb-3">Cria uma conta a pagar para a transportadora com o custo realizado ({o.transport_cost_actual !== null ? formatBRL(o.transport_cost_actual) : '—'}). Não duplica se enviado de novo.</p>
        <Field label="Vencimento" hint="Vazio = 30 dias"><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
      </Modal>

      <Modal open={modal === 'motivo'} onClose={() => setModal(null)} title={reasonAction?.title || ''} size="sm" footer={<><Button onClick={() => setModal(null)}>Voltar</Button><Button variant={reasonAction?.action === 'cancelar' ? 'danger' : 'primary'} disabled={!!reasonAction?.required && !reason.trim()} loading={busy === reasonAction?.action} onClick={() => reasonAction && action(reasonAction.action, { reason }, 'Operação atualizada.')}>Confirmar</Button></>}>
        {reasonAction?.action === 'cancelar' && <p className="text-sm text-slate-600 mb-3">Só operações sem movimentação física podem ser canceladas. O histórico é mantido.</p>}
        <Field label={reasonAction?.required ? 'Justificativa' : 'Observação (opcional)'} required={reasonAction?.required}><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Modal>
    </div>
  );
};
