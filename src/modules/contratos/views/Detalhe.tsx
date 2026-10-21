/**
 * Detalhe do contrato: ações conforme status e permissão (vindas do servidor) e abas
 * Resumo, Itens, Cronograma, Financeiro, Documentos, Movimentações e Histórico.
 */

import React, { useState } from 'react';
import {
  Pencil, Send, CheckCircle2, Undo2, FileText, PenLine, Lock, Play, Truck, PackageCheck, CalendarPlus, TrendingUp, Receipt, PlusCircle, LogOut, Flag, Ban, Printer, Paperclip, ExternalLink, Download, Trash2, ListPlus, Ruler,
} from 'lucide-react';
import {
  ACTION_LABELS, AMENDMENT_LABELS, BILLING_FREQUENCY_LABELS, BILLING_TIMING_LABELS, CHARGE_KIND_LABELS, CONTRACT_STATUS_LABELS, CONTRACT_TYPE_LABELS, ContractAction, ContractDetail, DOCUMENT_TYPE_LABELS,
  PERIOD_NOUN, RESPONSIBILITY_LABELS, RESPONSIBILITY_TOPICS, RETURN_CLASS_LABELS, SIGNATURE_METHOD_LABELS,
  ContractDocument,
} from '../../../../shared/contratos/types';
import { formatBRL } from '../../../../shared/orcamentos/money';
import { formatDateBR, formatDateTimeBR } from '../../../../shared/orcamentos/dates';
import { formatDocument, formatPhone } from '../../../../shared/orcamentos/validators';
import { api, ApiError, fetchBlob, saveBlob } from '../../orcamentos/api';
import { Button, Card, ErrorState, Loading, Modal, Notice, PageHeader, cx, useAsync, useToast } from '../../orcamentos/ui';
import { fmtQty } from '../../estoque/components';
import { CtrTab, useCtr } from '../context';
import { ChargePill, DocPill, KV, Money, StatusPill, Th } from '../components';
import { DeleteContractModal, canDeleteContract } from '../DeleteContract';
import { AddItemsModal, ChargeEditModal, DeliveryModal, ExtendModal, ExtraChargeModal, ReasonModal, RepriceModal, ReturnModal, SentModal, SignatureModal, readFile } from './Modals';

const TABS: { id: CtrTab; label: string }[] = [
  { id: 'resumo', label: 'Resumo' },
  { id: 'itens', label: 'Itens' },
  { id: 'cronograma', label: 'Cronograma' },
  { id: 'financeiro', label: 'Financeiro' },
  { id: 'documentos', label: 'Documentos' },
  { id: 'movimentacoes', label: 'Movimentações' },
  { id: 'historico', label: 'Histórico' },
];

const ICONS: Partial<Record<ContractAction, React.ElementType>> = {
  editar: Pencil, enviar_aprovacao: Send, aprovar: CheckCircle2, rejeitar: Undo2, reabrir: Undo2, gerar_documento: FileText, registrar_assinatura: PenLine, reservar: Lock, ativar: Play,
  entregar: Truck, devolver: PackageCheck, prorrogar: CalendarPlus, reajustar: TrendingUp, incluir_itens: ListPlus, gerar_cobrancas: Receipt, cobranca_extra: PlusCircle, iniciar_encerramento: LogOut, encerrar: Flag, cancelar: Ban,
};
const PRIMARY: ContractAction[] = ['enviar_aprovacao', 'aprovar', 'gerar_documento', 'registrar_assinatura', 'ativar', 'entregar', 'devolver', 'encerrar'];

type ModalKind = null | 'reason' | 'assinatura' | 'entrega' | 'devolucao' | 'prorrogar' | 'reajustar' | 'incluir_itens' | 'extra' | 'charge' | 'sent';

export const ContratoDetalhe: React.FC<{ id: number; initialTab?: CtrTab }> = ({ id, initialTab }) => {
  const { navigate, openFinance, user } = useCtr();
  const toast = useToast();
  const { data: c, error, loading, reload } = useAsync(() => api.get<ContractDetail>(`/contracts/${id}`), [id]);
  const [tab, setTab] = useState<CtrTab>(initialTab || 'resumo');
  const [modal, setModal] = useState<ModalKind>(null);
  const [deleting, setDeleting] = useState(false);
  const [docToDelete, setDocToDelete] = useState<ContractDocument | null>(null);
  const [docBusy, setDocBusy] = useState(false);
  const removeDoc = async () => {
    if (!docToDelete) return;
    setDocBusy(true);
    try {
      await api.del(`/contracts/${c!.id}/documents/${docToDelete.id}`);
      toast('success', 'Documento excluído.');
      setDocToDelete(null);
      reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setDocBusy(false);
    }
  };
  // assinado nunca sai; comprovante (não é reemitido) só o admin; o resto admin/gestor
  const docDeleteBlock = (d: ContractDocument): string | null => {
    if (!['admin', 'gestor'].includes(user.role)) return 'Só administrador ou gestor exclui documentos.';
    if (d.status === 'assinado') return 'Documento assinado é a prova da assinatura e não é excluído.';
    if ((d.document_type === 'comprovante_entrega' || d.document_type === 'comprovante_devolucao') && user.role !== 'admin') return 'Comprovantes só são excluídos pelo administrador.';
    return null;
  };
  const [reasonCfg, setReasonCfg] = useState<{ action: ContractAction; required: boolean; danger?: boolean; label?: string; text?: React.ReactNode; extra?: Record<string, unknown> } | null>(null);
  const [charge, setCharge] = useState<{ id: number; description: string; amount: number; mode: 'adjust' | 'cancel' } | null>(null);
  const [docId, setDocId] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (loading && !c) return <Loading />;
  if (error || !c) return <ErrorState message={error || 'Contrato não encontrado.'} onRetry={reload} />;

  const done = (msg: string) => {
    setModal(null);
    toast('success', msg);
    reload();
  };
  const post = async (label: string, url: string, body: unknown, msg: string) => {
    setBusy(label);
    try {
      const r = await api.post<any>(url, body);
      if (r?.generated === 0) {
        // nada novo no cronograma: deixa claro onde estão as cobranças já lançadas
        toast('success', 'Nenhuma cobrança nova: todas as parcelas do cronograma deste contrato já estão lançadas no Financeiro.');
        setTab('financeiro');
      } else toast('success', r?.generated !== undefined ? `${r.generated} cobrança(s) lançada(s) no Financeiro.` : msg);
      reload();
    } catch (e) {
      toast('error', (e as ApiError).message);
    } finally {
      setBusy(null);
    }
  };
  const openDoc = async (docIdToOpen: number, name: string | null, download = false) => {
    try {
      const blob = await fetchBlob(`/contracts/${c.id}/documents/${docIdToOpen}/file`);
      if (download) saveBlob(blob, name || 'documento');
      else window.open(URL.createObjectURL(blob), '_blank');
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const openInvoice = async (chargeId: number, name: string, doc: 'invoice' | 'measurement' = 'invoice') => {
    try {
      const blob = await fetchBlob(`/contracts/${c.id}/charges/${chargeId}/${doc}`);
      const url = URL.createObjectURL(blob);
      if (!window.open(url, '_blank')) saveBlob(blob, name);
    } catch (e) {
      toast('error', (e as Error).message);
    }
  };

  const onAction = (a: ContractAction) => {
    const blocker = c.blockers[a];
    if (blocker) return toast('error', blocker);
    switch (a) {
      case 'editar':
        return navigate({ page: 'editar', id: c.id });
      case 'gerar_documento':
        return post(a, `/contracts/${c.id}/documents/contract`, {}, 'Documento do contrato gerado (aba Documentos).');
      case 'reservar':
        return post(a, `/contracts/${c.id}/reserve`, {}, 'Equipamentos reservados no Estoque para o período do contrato.');
      case 'gerar_cobrancas':
        return post(a, `/contracts/${c.id}/action/gerar_cobrancas`, { row_version: c.row_version }, 'Cobranças conferidas.');
      case 'registrar_assinatura':
        return setModal('assinatura');
      case 'entregar':
        return setModal('entrega');
      case 'devolver':
        return setModal('devolucao');
      case 'prorrogar':
        return setModal('prorrogar');
      case 'reajustar':
        return setModal('reajustar');
      case 'incluir_itens':
        return setModal('incluir_itens');
      case 'cobranca_extra':
        return setModal('extra');
      case 'enviar_aprovacao':
        setReasonCfg({ action: a, required: false, label: 'Observação (opcional)', text: 'O contrato segue para aprovação interna (ou é aprovado direto, se as configurações dispensarem).' });
        return setModal('reason');
      case 'aprovar':
        setReasonCfg({ action: a, required: false, label: 'Comentário (opcional)' });
        return setModal('reason');
      case 'ativar':
        setReasonCfg({
          action: a,
          required: false,
          label: 'Observação (opcional)',
          text: c.contract_type === 'locacao' ? 'Ativar reserva no Estoque o que faltar (revalidando a agenda) e lança no Financeiro as cobranças previstas. Início futuro deixa o contrato “Agendado”.' : 'Ativar formaliza a venda e lança as parcelas no Financeiro. A baixa no estoque acontece na entrega.',
        });
        return setModal('reason');
      case 'iniciar_encerramento':
        setReasonCfg({ action: a, required: false, label: 'Observação (opcional)', text: 'Reservas ainda não entregues são liberadas; o contrato aguarda a devolução dos equipamentos.' });
        return setModal('reason');
      case 'encerrar': {
        const f = c.financial;
        setReasonCfg({
          action: a,
          required: false,
          label: 'Observação (opcional)',
          text: (
            <div className="space-y-1">
              <p>Cobranças de períodos ainda não iniciados e sem recebimento serão canceladas. Valores em aberto continuam no Financeiro.</p>
              {f && (
                <div className="mt-2 p-2 rounded bg-slate-50 text-xs">
                  <KV label="Previsto (gerado)">{formatBRL(f.scheduled)}</KV>
                  <KV label="Recebido">{formatBRL(f.received)}</KV>
                  <KV label="Pendente">{formatBRL(f.open)}</KV>
                </div>
              )}
            </div>
          ),
        });
        return setModal('reason');
      }
      case 'rejeitar':
      case 'reabrir':
      case 'cancelar':
        setReasonCfg({
          action: a,
          required: true,
          danger: a === 'cancelar',
          text:
            a === 'cancelar'
              ? 'O cancelamento é registrado com justificativa e não apaga o histórico. Reservas são liberadas e cobranças sem recebimento são canceladas (as de períodos já usados continuam devidas).'
              : a === 'reabrir'
                ? 'Volta para rascunho: reservas são liberadas e documentos gerados ficam substituídos.'
                : undefined,
        });
        return setModal('reason');
    }
  };

  const cs = c.customer_snapshot;
  const isRental = c.contract_type === 'locacao';
  const noun = PERIOD_NOUN[c.billing_frequency];
  const primary = c.actions.filter((a) => PRIMARY.includes(a));
  const secondary = c.actions.filter((a) => !PRIMARY.includes(a));

  return (
    <div>
      <PageHeader
        title={c.contract_number}
        subtitle={`${CONTRACT_TYPE_LABELS[c.contract_type]} • ${cs.name}${c.quotation_number ? ` • origem: orçamento ${c.quotation_number}` : ''}`}
        onBack={() => navigate({ page: 'painel' })}
        actions={<StatusPill s={c.status} />}
      />
      {(c.actions.length > 0 || canDeleteContract(user, c.status)) && (
        <div className="flex flex-wrap gap-2 mb-4">
          {primary.map((a) => (
            <Button key={a} variant="primary" size="sm" icon={ICONS[a]} loading={busy === a} title={c.blockers[a]} className={cx(c.blockers[a] && 'opacity-60')} onClick={() => onAction(a)}>
              {ACTION_LABELS[a]}
            </Button>
          ))}
          {secondary.map((a) => (
            <Button key={a} size="sm" icon={ICONS[a]} loading={busy === a} title={c.blockers[a]} className={cx(a === 'cancelar' && 'text-red-700', c.blockers[a] && 'opacity-60')} onClick={() => onAction(a)}>
              {ACTION_LABELS[a]}
            </Button>
          ))}
          {canDeleteContract(user, c.status) && (
            <Button size="sm" icon={Trash2} className="text-red-700" onClick={() => setDeleting(true)}>
              Excluir
            </Button>
          )}
        </div>
      )}
      <Modal
        open={!!docToDelete}
        onClose={() => setDocToDelete(null)}
        title="Excluir documento"
        footer={
          <>
            <Button onClick={() => setDocToDelete(null)}>Voltar</Button>
            <Button variant="danger" icon={Trash2} loading={docBusy} onClick={removeDoc}>
              Excluir definitivamente
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">
          Excluir <b>{docToDelete?.title}</b> (v{docToDelete?.version})? Esta ação não pode ser desfeita; a exclusão fica registrada no histórico do contrato.
        </p>
        {docToDelete && (docToDelete.document_type === 'comprovante_entrega' || docToDelete.document_type === 'comprovante_devolucao') && (
          <p className="text-xs text-amber-700 bg-amber-50 rounded-md p-2 mt-2">
            Comprovantes não são gerados de novo. A entrega/devolução continua registrada em Movimentações e no Estoque; só o PDF do comprovante deixa de existir.
          </p>
        )}
        {docToDelete?.document_type === 'contrato' && docToDelete.status !== 'substituido' && (
          <p className="text-xs text-slate-500 mt-2">Se precisar do contrato de novo, use “Gerar documento”.</p>
        )}
      </Modal>
      <DeleteContractModal contract={deleting ? { id: c.id, contract_number: c.contract_number, customer_name: cs.name, status: c.status } : null} onClose={() => setDeleting(false)} onDeleted={() => navigate({ page: 'painel' })} />
      {Object.values(c.blockers).filter(Boolean).length > 0 && (
        <Notice kind="warning" className="mb-4">
          {Object.entries(c.blockers).map(([a, b]) => (
            <p key={a}>
              <b>{ACTION_LABELS[a as ContractAction]}:</b> {b}
            </p>
          ))}
        </Notice>
      )}
      {c.status === 'aprovado' && c.signed_at && <Notice className="mb-4">Assinatura registrada em {formatDateBR(c.signed_at)}. Contrato pronto para ativação.</Notice>}

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 mb-4" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cx('px-3.5 py-2 text-sm font-semibold whitespace-nowrap border-b-2 -mb-px', tab === t.id ? 'border-[#1e3a5f] text-[#1e3a5f]' : 'border-transparent text-slate-500 hover:text-slate-800')}>
            {t.label}
            {t.id === 'documentos' && c.documents.length > 0 && <span className="ml-1 text-xs text-slate-400">({c.documents.length})</span>}
          </button>
        ))}
      </div>

      {tab === 'resumo' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
          <Card title="Cliente">
            <p className="font-semibold">{cs.name}</p>
            {cs.trade_name && <p className="text-xs text-slate-500">{cs.trade_name}</p>}
            <KV label={cs.person_type === 'PJ' ? 'CNPJ' : 'CPF'}>{cs.document ? formatDocument(cs.document) : '—'}</KV>
            <KV label="Inscrição estadual">{cs.state_registration || '—'}</KV>
            <KV label="Endereço">{cs.address || '—'}</KV>
            <KV label="Telefone">{cs.phone ? formatPhone(cs.phone) : '—'}</KV>
            <KV label="E-mail">{cs.email || '—'}</KV>
            <KV label="Contato">{cs.contact_name || '—'}</KV>
            {c.delivery_address && <KV label="Local de entrega">{c.delivery_address}</KV>}
          </Card>
          <Card title="Vigência e responsáveis">
            <KV label="Status">{CONTRACT_STATUS_LABELS[c.status]}</KV>
            <KV label={isRental ? 'Início' : 'Data da venda'}>{formatDateBR(c.start_date)}</KV>
            {isRental && <KV label="Término (devolução)">{c.end_date ? formatDateBR(c.end_date) : 'Prazo indeterminado'}</KV>}
            <KV label="Responsável comercial">{c.responsible_name}</KV>
            <KV label="Aprovação">{c.approved_by_name ? `${c.approved_by_name} em ${formatDateTimeBR(c.approved_at)}` : c.approver_name ? `Indicado: ${c.approver_name}` : 'Pendente'}</KV>
            <KV label="Assinatura">{c.signed_at ? formatDateBR(c.signed_at) : 'Não registrada'}</KV>
            <KV label="Ativação">{c.activated_at ? formatDateTimeBR(c.activated_at) : '—'}</KV>
            {c.closed_at && <KV label="Encerramento">{formatDateTimeBR(c.closed_at)}</KV>}
            {c.cancelled_at && <KV label="Cancelamento">{`${formatDateTimeBR(c.cancelled_at)} — ${c.cancellation_reason}`}</KV>}
            <KV label="Criado por">{`${c.created_by_name} em ${formatDateTimeBR(c.created_at)}`}</KV>
          </Card>
          <Card title="Valores">
            {isRental && <KV label={c.billing_frequency === 'unico' ? 'Valor da locação' : `Valor por ${noun}`}>{<b>{formatBRL(c.period_amount)}</b>}</KV>}
            {c.sale_total > 0 && <KV label="Itens vendidos">{formatBRL(c.sale_total)}</KV>}
            {c.one_time_total > 0 && <KV label="Fretes e taxas">{formatBRL(c.one_time_total)}</KV>}
            <KV label="Valor contratado estimado">{c.estimated_total === null ? 'Indeterminado' : formatBRL(c.estimated_total)}</KV>
            {c.deposit_amount > 0 && <KV label="Caução (fora do total)">{formatBRL(c.deposit_amount)}</KV>}
            {c.financial && (
              <div className="mt-2 pt-2 border-t border-slate-100">
                <KV label="Lançado no Financeiro">{formatBRL(c.financial.scheduled)}</KV>
                <KV label="Recebido">
                  <span className="text-emerald-700">{formatBRL(c.financial.received)}</span>
                </KV>
                <KV label="Em aberto">{formatBRL(c.financial.open)}</KV>
                {c.financial.overdue > 0 && (
                  <KV label="Vencido">
                    <span className="text-red-700 font-bold">{formatBRL(c.financial.overdue)}</span>
                  </KV>
                )}
              </div>
            )}
          </Card>
          <Card title="Condições comerciais" className="lg:col-span-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-6">
              <div>
                <KV label="Cobrança">{isRental ? `${BILLING_FREQUENCY_LABELS[c.billing_frequency]}${c.billing_frequency === 'personalizado' ? ` (${c.custom_period_days} dias)` : ''}` : `${c.installments_count}x`}</KV>
                {isRental && c.billing_frequency !== 'unico' && <KV label="Momento">{BILLING_TIMING_LABELS[c.billing_timing]}</KV>}
                <KV label="Vencimento">{c.due_day ? `Todo dia ${c.due_day}` : c.contract_type === 'venda' && c.first_due_date ? `1º em ${formatDateBR(c.first_due_date)}` : `${c.due_days_after} dia(s) após a referência`}</KV>
                <KV label="Multa / juros">{`${c.late_fee_percent}% / ${c.interest_month_percent}% a.m.`}</KV>
              </div>
              <div>
                <KV label="Reajuste">{c.adjustment_index ? `${c.adjustment_index}${c.adjustment_period_months ? ` a cada ${c.adjustment_period_months} meses` : ''}` : '—'}</KV>
                {isRental &&
                  RESPONSIBILITY_TOPICS.map((t) => (
                    <KV key={t.key} label={t.label}>
                      {RESPONSIBILITY_LABELS[c.responsibilities[t.key]]}
                    </KV>
                  ))}
              </div>
              <div className="text-sm">
                <p className="text-slate-500">Condições de pagamento</p>
                <p className="whitespace-pre-line mb-2">{c.payment_terms || '—'}</p>
                <p className="text-slate-500">Condições especiais</p>
                <p className="whitespace-pre-line">{c.special_conditions || '—'}</p>
                {c.internal_notes && (
                  <>
                    <p className="text-slate-500 mt-2">Observações internas</p>
                    <p className="whitespace-pre-line text-slate-600">{c.internal_notes}</p>
                  </>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === 'itens' && (
        <Card bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Item</Th>
                  <Th>Patrimônio</Th>
                  <Th right>Qtd.</Th>
                  <Th>Modalidade</Th>
                  <Th right>Valor</Th>
                  <Th>Situação física</Th>
                </tr>
              </thead>
              <tbody>
                {c.items.map((i) => (
                  <tr key={i.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-slate-500 mr-1">{i.item_code}</span>
                      {i.description}
                      {i.conditions && <p className="text-[11px] text-slate-500">{i.conditions}</p>}
                    </td>
                    <td className="px-4 py-2.5">{i.tracking === 'individual' ? i.asset_tag || <span className="text-amber-700 text-xs font-semibold">A definir</span> : '—'}</td>
                    <td className="px-4 py-2.5 text-right">{fmtQty(i.quantity, i.unit)}</td>
                    <td className="px-4 py-2.5">{i.modality === 'venda' ? 'Venda' : 'Locação'}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <Money v={i.line_total} />
                      {i.modality === 'locacao' && <span className="text-[11px] text-slate-500">/{noun}</span>}
                      {i.discount_amount > 0 && <p className="text-[11px] text-slate-500">desc. {formatBRL(i.discount_amount)}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {i.modality === 'venda' ? (
                        <span>Entregue: {fmtQty(i.sold_delivered_qty, i.unit)}</span>
                      ) : (
                        <div className="space-y-0.5">
                          {i.reserved_qty > 0 && <p className="text-indigo-700">Reservado: {fmtQty(i.reserved_qty, i.unit)}</p>}
                          {i.delivered_qty > 0 && <p className="text-emerald-700 font-semibold">Com o cliente: {fmtQty(i.delivered_qty, i.unit)}</p>}
                          {i.returned_qty > 0 && <p className="text-slate-600">Devolvido: {fmtQty(i.returned_qty, i.unit)}</p>}
                          {!i.reserved_qty && !i.delivered_qty && !i.returned_qty && <p className="text-slate-400">Sem reserva</p>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {c.reservations.length > 0 && (
            <div className="p-4 border-t border-slate-100">
              <p className="text-xs font-bold text-slate-600 uppercase mb-2">Reservas no Estoque</p>
              <div className="flex flex-wrap gap-2">
                {c.reservations.map((r) => (
                  <span key={r.id} className={cx('text-xs px-2 py-1 rounded border', r.status === 'em_uso' ? 'border-emerald-200 bg-emerald-50' : r.status === 'confirmada' ? 'border-indigo-200 bg-indigo-50' : 'border-slate-200 bg-slate-50 text-slate-500')}>
                    {r.number} • {r.asset_tag || `${r.item_code} × ${r.quantity}`} • {r.status === 'em_uso' ? 'com o cliente' : r.status} • até {r.end_date === '2099-12-31' ? 'indeterminado' : formatDateBR(r.end_date)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {tab === 'cronograma' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <Card title="Vigências">
            {c.terms.length === 0 ? (
              <p className="text-sm text-slate-500">Vigência registrada na ativação. Previsto: {formatDateBR(c.start_date)} a {c.end_date ? formatDateBR(c.end_date) : 'indeterminado'}.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {c.terms.map((t) => (
                  <li key={t.id} className="border-b border-slate-50 pb-2">
                    <p className="font-semibold">
                      {formatDateBR(t.start_date)} a {t.end_date ? formatDateBR(t.end_date) : 'indeterminado'} — {formatBRL(t.period_amount)}
                      {isRental && c.billing_frequency !== 'unico' ? `/${noun}` : ''}
                    </p>
                    <p className="text-xs text-slate-500">
                      {t.reason} • {t.created_by_name} em {formatDateTimeBR(t.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Aditivos">
            {c.amendments.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum aditivo.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {c.amendments.map((a) => (
                  <li key={a.id} className="border-b border-slate-50 pb-2">
                    <p className="font-semibold">
                      Nº {a.number} — {AMENDMENT_LABELS[a.amendment_type]}
                    </p>
                    <p>{a.description}</p>
                    <p className="text-xs text-slate-500">
                      {a.reason} • {a.created_by_name} em {formatDateTimeBR(a.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Entregas e devoluções previstas" className="lg:col-span-2">
            {c.reservations.filter((r) => r.status === 'confirmada' || r.status === 'em_uso').length === 0 ? (
              <p className="text-sm text-slate-500">Sem equipamentos reservados ou com o cliente.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {c.reservations
                  .filter((r) => r.status === 'confirmada' || r.status === 'em_uso')
                  .map((r) => (
                    <li key={r.id}>
                      <b>{r.asset_tag || `${r.item_code} × ${r.quantity}`}</b> — {r.status === 'confirmada' ? `entrega prevista em ${formatDateBR(r.start_date)}` : `devolução prevista em ${r.end_date === '2099-12-31' ? 'prazo indeterminado' : formatDateBR(r.end_date)}`}
                    </li>
                  ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === 'financeiro' &&
        (!c.financial ? (
          <Notice>Seu perfil não consulta valores financeiros.</Notice>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                ['Valor contratado', c.financial.contracted === null ? 'Indeterminado' : formatBRL(c.financial.contracted), 'estimativa do contrato'],
                ['Previsto a lançar', formatBRL(c.financial.not_generated), 'ainda não está no Financeiro'],
                ['Lançado (cobranças)', formatBRL(c.financial.scheduled), 'contas a receber'],
                ['Recebido', formatBRL(c.financial.received), 'baixas no Financeiro'],
                ['Em aberto', formatBRL(c.financial.open), c.financial.overdue ? `${formatBRL(c.financial.overdue)} vencido` : 'nada vencido'],
              ].map(([l, v, h]) => (
                <div key={l} className="bg-white rounded-xl border border-slate-200 p-3">
                  <p className="text-xs text-slate-500">{l}</p>
                  <p className="text-lg font-extrabold tabular-nums">{v}</p>
                  <p className={cx('text-[11px]', l === 'Em aberto' && c.financial!.overdue ? 'text-red-700 font-semibold' : 'text-slate-500')}>{h}</p>
                </div>
              ))}
            </div>
            <Card
              title="Cobranças lançadas"
              bodyClassName="p-0"
              actions={
                <div className="flex gap-2">
                  {c.actions.includes('cobranca_extra') && c.contract_type === 'locacao' && c.end_date && c.charges.filter((ch) => ch.kind === 'periodo' && ch.status !== 'cancelado').length > 1 && (
                    <Button size="sm" icon={Receipt} loading={busy === 'consolidate'} onClick={() => post('consolidate', `/contracts/${c.id}/charges/consolidate`, {}, 'Cobranças unificadas.')}>
                      Unificar em valor total
                    </Button>
                  )}
                  {c.actions.includes('cobranca_extra') && (
                    <Button size="sm" icon={PlusCircle} onClick={() => onAction('cobranca_extra')}>
                      Lançar cobrança
                    </Button>
                  )}
                </div>
              }
            >
              {c.charges.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8">Nenhuma cobrança lançada. Elas são geradas na ativação (ou pelo botão “Gerar cobranças”); cobranças avulsas entram por “Lançar cobrança”.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[820px]">
                    <thead className="bg-slate-50">
                      <tr>
                        <Th>Descrição</Th>
                        <Th>Competência</Th>
                        <Th>Vencimento</Th>
                        <Th right>Valor</Th>
                        <Th right>Recebido</Th>
                        <Th>Situação</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {c.charges.filter((ch) => !(ch.status === 'cancelado' && ch.cancel_reason?.startsWith('Unificada em cobrança única'))).map((ch) => (
                        <tr key={ch.id} className="border-t border-slate-100">
                          <td className="px-4 py-2.5">
                            {ch.description}
                            <p className="text-[11px] text-slate-500">
                              {CHARGE_KIND_LABELS[ch.kind]}
                              {ch.entry_number ? ` • ${ch.entry_number}` : ''}
                              {ch.cancel_reason ? ` • ${ch.cancel_reason}` : ''}
                            </p>
                          </td>
                          <td className="px-4 py-2.5 text-xs whitespace-nowrap">{ch.period_start === ch.period_end ? formatDateBR(ch.period_start) : `${formatDateBR(ch.period_start)} a ${formatDateBR(ch.period_end)}`}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">{formatDateBR(ch.due_date)}</td>
                          <td className="px-4 py-2.5 text-right">
                            <Money v={ch.updated_amount} />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <Money v={ch.settled_amount} />
                          </td>
                          <td className="px-4 py-2.5">
                            <ChargePill s={ch.display_status} />
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            {ch.financial_entry_id && ch.display_status !== 'cancelado' && (
                              <Button size="sm" variant="ghost" icon={FileText} onClick={() => openInvoice(ch.id, `Fatura ${ch.entry_number || ch.id}.pdf`)}>
                                Fatura
                              </Button>
                            )}
                            {isRental && (ch.kind === 'periodo' || ch.kind === 'unico') && ch.display_status !== 'cancelado' && (
                              <Button size="sm" variant="ghost" icon={Ruler} onClick={() => openInvoice(ch.id, `Medição ${c.contract_number}.pdf`, 'measurement')}>
                                Medição
                              </Button>
                            )}
                            {ch.financial_entry_id && openFinance && <Button size="sm" variant="ghost" icon={ExternalLink} title="Abrir no Financeiro" aria-label="Abrir no Financeiro" onClick={() => openFinance(ch.financial_entry_id!)} />}
                            {c.actions.includes('gerar_cobrancas') && ch.settled_amount === 0 && ch.display_status !== 'cancelado' && (
                              <>
                                <Button size="sm" variant="ghost" onClick={() => (setCharge({ id: ch.id, description: ch.description, amount: ch.amount, mode: 'adjust' }), setModal('charge'))}>
                                  Ajustar
                                </Button>
                                <Button size="sm" variant="ghost" className="text-red-700" onClick={() => (setCharge({ id: ch.id, description: ch.description, amount: ch.amount, mode: 'cancel' }), setModal('charge'))}>
                                  Cancelar
                                </Button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            {c.schedule_preview.length > 0 && c.financial.not_generated > 0 && (
              <Card title="Previsto pelas condições (ainda não lançado)">
                <ul className="text-sm space-y-1">
                  {c.schedule_preview
                    .filter((l) => !c.charges.some((ch) => ch.kind === l.kind && ch.period_start === l.period_start && ch.description === l.description))
                    .slice(0, 12)
                    .map((l, i) => (
                      <li key={i} className="flex justify-between gap-3">
                        <span className="text-slate-600">
                          {formatDateBR(l.due_date)} — {l.description}
                        </span>
                        <Money v={l.amount} />
                      </li>
                    ))}
                </ul>
              </Card>
            )}
            <p className="text-xs text-slate-500">Recebimentos são registrados somente no Financeiro (fonte oficial). Valor contratado não é receita recebida.</p>
          </div>
        ))}

      {tab === 'documentos' && (
        <Card
          title="Documentos"
          bodyClassName="p-0"
          actions={
            <div className="flex gap-2">
              {c.actions.includes('gerar_documento') && (
                <Button size="sm" icon={Printer} loading={busy === 'gerar_documento'} onClick={() => onAction('gerar_documento')}>
                  Gerar contrato
                </Button>
              )}
              <label className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 cursor-pointer">
                <Paperclip className="w-3.5 h-3.5" /> Anexar
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    const data = await readFile(file);
                    post('anexo', `/contracts/${c.id}/documents/attachments`, { ...data, title: file.name }, 'Anexo incluído.');
                  }}
                />
              </label>
            </div>
          }
        >
          {c.documents.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">Nenhum documento. O documento do contrato é gerado após a aprovação interna; comprovantes saem com cada entrega/devolução.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>Documento</Th>
                    <Th>Versão</Th>
                    <Th>Situação</Th>
                    <Th>Emissão</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {c.documents.map((d) => (
                    <tr key={d.id} className={cx('border-t border-slate-100 align-top', d.status === 'substituido' && 'text-slate-400')}>
                      <td className="px-4 py-2.5">
                        <p className="font-semibold">{d.title}</p>
                        <p className="text-[11px] text-slate-500">{DOCUMENT_TYPE_LABELS[d.document_type]}</p>
                        {d.signed_at && (
                          <p className="text-[11px] text-emerald-700">
                            Assinado em {formatDateBR(d.signed_at)} por {d.signed_by_names} — {d.signature_method ? SIGNATURE_METHOD_LABELS[d.signature_method] : ''}. Evidência: {d.signature_evidence}
                          </p>
                        )}
                        {d.sent_at && <p className="text-[11px] text-slate-500">Enviado em {formatDateTimeBR(d.sent_at)} ({d.sent_channel})</p>}
                      </td>
                      <td className="px-4 py-2.5">v{d.version}</td>
                      <td className="px-4 py-2.5">
                        <DocPill s={d.status} />
                      </td>
                      <td className="px-4 py-2.5 text-xs whitespace-nowrap">
                        {formatDateTimeBR(d.issued_at)}
                        {d.issued_by_name && <p className="text-slate-500">{d.issued_by_name}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" icon={FileText} onClick={() => openDoc(d.id, d.file_name)}>
                          Abrir
                        </Button>
                        <Button size="sm" variant="ghost" icon={Download} aria-label="Baixar" onClick={() => openDoc(d.id, d.file_name, true)} />
                        {['admin', 'gestor'].includes(user.role) && (
                          <Button size="sm" variant="ghost" icon={Trash2} className={cx(docDeleteBlock(d) ? 'text-slate-300' : 'text-red-600 hover:text-red-700')} aria-label="Excluir documento" title={docDeleteBlock(d) || 'Excluir documento'} onClick={() => (docDeleteBlock(d) ? toast('error', docDeleteBlock(d)!) : setDocToDelete(d))} />
                        )}
                        {d.generated && d.status === 'gerado' && d.document_type === 'contrato' && (
                          <Button size="sm" variant="ghost" icon={Send} onClick={() => (setDocId(d.id), setModal('sent'))}>
                            Enviado
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

      {tab === 'movimentacoes' && (
        <Card title="Entregas e devoluções" bodyClassName="p-0">
          {c.operations.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">Nenhuma entrega ou devolução registrada.</p>
          ) : (
            <ul>
              {c.operations.map((o) => (
                <li key={o.id} className="border-t border-slate-100 px-4 py-3 first:border-0">
                  <div className="flex flex-wrap justify-between gap-2">
                    <p className="font-semibold">
                      {o.operation_type === 'entrega' ? 'Entrega' : 'Devolução'} {o.number}
                      <span className="font-normal text-slate-500 text-xs ml-2">
                        {formatDateTimeBR(o.performed_at)} • {o.responsible_name}
                        {o.counterpart_name ? ` • ${o.operation_type === 'entrega' ? 'recebido por' : 'devolvido por'} ${o.counterpart_name}` : ''}
                      </span>
                    </p>
                  </div>
                  <ul className="mt-1 text-sm space-y-0.5">
                    {o.items.map((i) => (
                      <li key={i.id} className="text-slate-700">
                        {i.item_code} {i.asset_tag ? `(${i.asset_tag})` : ''} — {fmtQty(i.quantity)}
                        {i.classification && o.operation_type === 'devolucao' && <span className="text-xs text-slate-500"> • {RETURN_CLASS_LABELS[i.classification]}</span>}
                        {(i.damaged_qty > 0 || i.maintenance_qty > 0 || i.missing_qty > 0) && (
                          <span className="text-xs text-red-700">
                            {' '}
                            • {i.damaged_qty ? `${i.damaged_qty} avariada(s) ` : ''}
                            {i.maintenance_qty ? `${i.maintenance_qty} p/ manutenção ` : ''}
                            {i.missing_qty ? `${i.missing_qty} não devolvida(s)` : ''}
                          </span>
                        )}
                        {i.notes && <span className="text-xs text-slate-500"> • {i.notes}</span>}
                      </li>
                    ))}
                  </ul>
                  {(o.accessories || o.notes) && <p className="text-xs text-slate-500 mt-1">{[o.accessories && `Acessórios: ${o.accessories}`, o.notes].filter(Boolean).join(' • ')}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'historico' && (
        <Card title="Histórico" bodyClassName="p-0">
          <ul>
            {c.events.map((e) => (
              <li key={e.id} className="border-t border-slate-100 first:border-0 px-4 py-2.5 text-sm">
                <p>
                  {e.new_status && e.previous_status !== e.new_status && (
                    <span className="mr-2">
                      <StatusPill s={e.new_status} />
                    </span>
                  )}
                  {e.description}
                </p>
                <p className="text-[11px] text-slate-500">
                  {formatDateTimeBR(e.created_at)} • {e.performed_by_name || 'Sistema (rotina automática)'}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {reasonCfg && (
        <ReasonModal
          c={c}
          open={modal === 'reason'}
          onClose={() => setModal(null)}
          onDone={done}
          title={ACTION_LABELS[reasonCfg.action]}
          action={reasonCfg.action}
          required={reasonCfg.required}
          danger={reasonCfg.danger}
          label={reasonCfg.label}
          text={reasonCfg.text}
          extra={reasonCfg.extra}
        />
      )}
      <SignatureModal c={c} open={modal === 'assinatura'} onClose={() => setModal(null)} onDone={done} />
      <DeliveryModal c={c} open={modal === 'entrega'} onClose={() => setModal(null)} onDone={done} />
      <ReturnModal c={c} open={modal === 'devolucao'} onClose={() => setModal(null)} onDone={done} />
      {modal === 'prorrogar' && <ExtendModal c={c} open onClose={() => setModal(null)} onDone={done} />}
      {modal === 'reajustar' && <RepriceModal c={c} open onClose={() => setModal(null)} onDone={done} />}
      {modal === 'incluir_itens' && <AddItemsModal c={c} open onClose={() => setModal(null)} onDone={done} />}
      <ExtraChargeModal c={c} open={modal === 'extra'} onClose={() => setModal(null)} onDone={done} />
      <ChargeEditModal c={c} open={modal === 'charge'} onClose={() => setModal(null)} onDone={done} charge={charge} mode={charge?.mode || 'adjust'} />
      <SentModal c={c} open={modal === 'sent'} onClose={() => setModal(null)} onDone={done} docId={docId} />
    </div>
  );
};
