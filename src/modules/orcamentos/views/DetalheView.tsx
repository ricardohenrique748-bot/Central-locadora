/**
 * Detalhes do orçamento: proposta comercial (o que vai ao cliente) separada dos registros internos,
 * ações conforme status/perfil, linha do tempo, versões emitidas e PDF.
 */

import React, { useState } from 'react';
import {
  Pencil,
  Copy,
  FileDown,
  Eye,
  Printer,
  Share2,
  Send,
  MessageCircle,
  Mail,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Ban,
  ShieldCheck,
  ShieldAlert,
  Handshake,
  GitBranch,
  ArrowRightLeft,
  ClipboardList,
  Lock,
  Plus,
  History,
  Warehouse,
} from 'lucide-react';
import { QuotationAction, QuotationDetail, modalityLabel, BILLING_PERIOD_LABELS, AVAILABILITY_LABELS } from '../../../../shared/orcamentos/types';
import { ACTION_LABELS, REFUSAL_REASONS, STATUS_LABELS, TRANSITIONS } from '../../../../shared/orcamentos/status';
import { formatBRL, formatNumber } from '../../../../shared/orcamentos/money';
import { addDaysISO, formatDateBR, formatDateTimeBR, todayISO, daysBetween } from '../../../../shared/orcamentos/dates';
import { formatDocument, formatPhone, onlyDigits } from '../../../../shared/orcamentos/validators';
import { billingPeriodLabel } from '../../../../shared/orcamentos/rental';
import { api, ApiError, fetchBlob, saveBlob } from '../api';
import { useModule } from '../context';
import { Button, Card, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader, Select, StatusBadge, Textarea, cx, useAsync, useToast } from '../ui';

const ACTION_ICONS: Partial<Record<QuotationAction, React.ElementType>> = {
  enviar_revisao: ClipboardList,
  aprovar_interno: ShieldCheck,
  solicitar_aprovacao: ShieldAlert,
  rejeitar_aprovacao: XCircle,
  registrar_envio: Send,
  registrar_negociacao: Handshake,
  aprovar_cliente: CheckCircle2,
  recusar: XCircle,
  renovar: RotateCcw,
  nova_versao: GitBranch,
  cancelar: Ban,
  converter: ArrowRightLeft,
};

const PRIMARY_ACTIONS: QuotationAction[] = ['aprovar_interno', 'registrar_envio', 'aprovar_cliente', 'renovar'];

const ActionModal: React.FC<{ q: QuotationDetail; action: QuotationAction | null; onClose: () => void; onDone: () => void }> = ({ q, action, onClose, onDone }) => {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [channel, setChannel] = useState('email');
  const [category, setCategory] = useState('');
  const [date, setDate] = useState(addDaysISO(todayISO(), 15));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    setReason('');
    setCategory('');
    setError(null);
  }, [action]);

  if (!action) return null;
  const requiresReason = TRANSITIONS[action].requiresReason && action !== 'recusar';
  const danger = action === 'cancelar' || action === 'recusar' || action === 'rejeitar_aprovacao';

  const descriptions: Partial<Record<QuotationAction, string>> = {
    enviar_revisao: 'O orçamento segue para revisão. Ainda pode ser editado.',
    aprovar_interno: `Confirma a aprovação interna com desconto efetivo de ${q.effective_discount_percent.toLocaleString('pt-BR')}%? Depois disso, alterações exigem nova versão.`,
    solicitar_aprovacao: `O desconto efetivo (${q.effective_discount_percent.toLocaleString('pt-BR')}%) excede sua alçada. Um gestor ou administrador precisará aprovar.`,
    rejeitar_aprovacao: 'O orçamento volta para rascunho para ajuste.',
    registrar_envio: `Registra que a versão ${q.version} foi enviada ao cliente. A fotografia desta versão fica guardada no histórico. Isto NÃO envia mensagem automaticamente.`,
    registrar_negociacao: 'Registra que o cliente está negociando a proposta.',
    aprovar_cliente: 'Registra que o cliente aceitou a proposta. Não reserva equipamentos nem baixa estoque.',
    recusar: 'Registra a recusa do cliente. Orçamentos recusados não podem ser convertidos.',
    renovar: 'Define nova validade e cria uma nova versão, que precisa ser aprovada e reenviada.',
    nova_versao: 'Reabre o orçamento para alteração. Se já foi enviado, a versão atual fica preservada e uma nova versão é criada.',
    cancelar: 'Cancela o orçamento definitivamente. Esta ação não pode ser desfeita.',
  };

  const submit = async () => {
    if (requiresReason && !reason.trim()) {
      setError('Informe a justificativa.');
      return;
    }
    if (action === 'recusar' && !category) {
      setError('Selecione o motivo da recusa.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.post(`/quotations/${q.id}/actions/${action}`, {
        reason: reason.trim() || undefined,
        channel,
        refusal_category: category || undefined,
        expiration_date: action === 'renovar' ? date : undefined,
        row_version: q.row_version,
      });
      toast('success', `${ACTION_LABELS[action]}: concluído.`);
      onDone();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${ACTION_LABELS[action]} — ${q.quotation_number}`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Voltar</Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={saving} onClick={submit}>
            Confirmar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-slate-600">{descriptions[action]}</p>
        {action === 'registrar_envio' && (
          <Field label="Enviado por">
            <Select value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="email">E-mail</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="impresso">Impresso / em mãos</option>
              <option value="outro">Outro</option>
            </Select>
          </Field>
        )}
        {action === 'recusar' && (
          <Field label="Motivo da recusa" required>
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Selecione...</option>
              {REFUSAL_REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </Select>
          </Field>
        )}
        {action === 'renovar' && (
          <Field label="Nova validade" required>
            <Input type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        )}
        <Field label={requiresReason ? 'Justificativa' : 'Observação (opcional)'} required={requiresReason}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
        </Field>
        {error && <Notice kind="danger">{error}</Notice>}
      </div>
    </Modal>
  );
};

/** Contas a receber geradas pela conversão em venda (somente perfis com acesso ao Financeiro). */
const FinanceHistoryCard: React.FC<{ quotationId: number; onOpen: (entryId: number) => void }> = ({ quotationId, onOpen }) => {
  const { data } = useAsync(() => api.get<{ rows: { id: number; entry_number: string; status: string; installments: { number: number; due_date: string; updated: number; settled_amount: number; status: string }[] }[] }>(`/finance/integrations/quotation/${quotationId}`), [quotationId]);
  if (!data) return null;
  return (
    <Card title="Histórico financeiro">
      {!data.rows.length ? (
        <p className="text-xs text-slate-500">Nenhum título financeiro vinculado.</p>
      ) : (
        data.rows.map((e) => (
          <div key={e.id} className="text-sm">
            <button type="button" className="font-semibold text-[#1e3a5f] hover:underline" onClick={() => onOpen(e.id)}>
              {e.entry_number}
            </button>
            <ul className="mt-1 space-y-0.5">
              {e.installments.map((i) => (
                <li key={i.number} className="flex justify-between text-xs text-slate-600">
                  <span>
                    Parcela {i.number} • {formatDateBR(i.due_date)}
                  </span>
                  <span className={cx('tabular-nums', i.status === 'liquidado' && 'text-emerald-700 font-semibold')}>
                    {formatBRL(i.settled_amount)} / {formatBRL(i.updated)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </Card>
  );
};

export const DetalheView: React.FC<{ id: number }> = ({ id }) => {
  const { navigate, integrations, settings, user, openFinance, openContract } = useModule();
  const toast = useToast();
  const { data: q, error, loading, reload } = useAsync(() => api.get<QuotationDetail>(`/quotations/${id}`), [id]);
  const [action, setAction] = useState<QuotationAction | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [tab, setTab] = useState<'timeline' | 'status' | 'versoes'>('timeline');
  const [availResult, setAvailResult] = useState<{ catalog_item_id: number; needed: number; free: number; status: string }[] | null>(null);

  if (loading && !q) return <Loading />;
  if (error || !q) return <ErrorState message={error || 'Orçamento não encontrado.'} onRetry={reload} />;

  const isRental = q.quotation_type === 'locacao';
  const can = (a: QuotationAction) => q.allowed_actions.includes(a);
  const c = q.customer_snapshot;
  const daysLeft = daysBetween(todayISO(), q.expiration_date);
  const pdfName = `${q.quotation_number}-v${q.version}.pdf`;

  const getPdf = async (version?: number) => fetchBlob(`/quotations/${q.id}/pdf${version ? `?version=${version}` : ''}`);

  const withBusy = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const viewPdf = (version?: number) =>
    withBusy('view', async () => {
      // abre a aba antes do await para não ser bloqueada como pop-up
      const win = window.open('', '_blank');
      const blob = await getPdf(version);
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url;
      else saveBlob(blob, pdfName);
    });

  const downloadPdf = (version?: number) => withBusy('download', async () => saveBlob(await getPdf(version), version ? `${q.quotation_number}-v${version}.pdf` : pdfName));

  const printPdf = () =>
    withBusy('print', async () => {
      const url = URL.createObjectURL(await getPdf());
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      iframe.src = url;
      iframe.onload = () => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => iframe.remove(), 60_000);
      };
      document.body.appendChild(iframe);
    });

  const sharePdf = () =>
    withBusy('share', async () => {
      const blob = await getPdf();
      const file = new File([blob], pdfName, { type: 'application/pdf' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `Proposta ${q.quotation_number}` });
          toast('info', 'Compartilhamento aberto. Após enviar, use "Registrar envio".');
        } catch {
          /* usuário cancelou */
        }
      } else {
        saveBlob(blob, pdfName);
        toast('info', 'Este navegador não compartilha arquivos. O PDF foi baixado para você anexar.');
      }
    });

  const message = `Olá${c.name ? `, ${c.name.split(' ')[0]}` : ''}! Segue a proposta ${q.quotation_number} da ${settings.company.name}, no valor de ${formatBRL(q.total_amount)}, válida até ${formatDateBR(q.expiration_date)}.`;
  const prepareWhatsApp = () => {
    const phone = onlyDigits(c.whatsapp || c.phone);
    downloadPdf();
    window.open(`https://wa.me/${phone ? `55${phone}` : ''}?text=${encodeURIComponent(message + ' O PDF segue em anexo.')}`, '_blank', 'noopener');
    toast('info', 'PDF baixado e WhatsApp aberto. Anexe o PDF, envie e depois clique em "Registrar envio".');
  };
  const prepareEmail = () => {
    downloadPdf();
    window.location.href = `mailto:${c.email || ''}?subject=${encodeURIComponent(`Proposta ${q.quotation_number} – ${settings.company.name}`)}&body=${encodeURIComponent(message + '\n\nO PDF da proposta segue em anexo.')}`;
    toast('info', 'PDF baixado e e-mail preparado. Anexe o PDF, envie e depois clique em "Registrar envio".');
  };

  const duplicate = () =>
    withBusy('dup', async () => {
      const r = await api.post<{ quotation: { id: number; quotation_number: string }; removed: string[] }>(`/quotations/${q.id}/duplicate`);
      toast('success', `Cópia ${r.quotation.quotation_number} criada.${r.removed.length ? ` Itens inativos removidos: ${r.removed.join(', ')}.` : ''}`);
      navigate({ page: 'editar', id: r.quotation.id });
    });

  const convert = () =>
    withBusy('convert', async () => {
      const r = await api.post<{ record_id: string; record_type: string; already: boolean }>(`/quotations/${q.id}/convert`);
      toast('success', r.already ? `Já convertido anteriormente (${r.record_id}).` : `Convertido: ${r.record_id}.`);
      if (r.record_type === 'contrato_locacao' && openContract) openContract(r.record_id);
      else reload();
    });

  const checkAvailability = () =>
    withBusy('avail', async () => {
      const r = await api.post<{ availability_status: string; results: { catalog_item_id: number; needed: number; free: number; status: string }[] }>(`/quotations/${q.id}/availability`);
      setAvailResult(r.results);
      toast(r.availability_status === 'confirmada' ? 'success' : 'info', r.availability_status === 'confirmada' ? 'Todos os itens disponíveis no período.' : 'Há itens com disponibilidade insuficiente no período.');
      reload();
    });

  const saveNote = () =>
    withBusy('note', async () => {
      await api.post(`/quotations/${q.id}/activities`, { description: note });
      setNote('');
      setNoteOpen(false);
      toast('success', 'Contato registrado.');
      reload();
    });

  const statusActions = q.allowed_actions.filter((a) => !['editar', 'duplicar', 'converter'].includes(a));
  const conversionTarget = isRental ? 'contrato de locação' : 'venda';
  const conversionAvailable = isRental ? integrations.contrato_locacao : integrations.venda;

  return (
    <div>
      <PageHeader
        title={`${q.quotation_number}`}
        subtitle={`${modalityLabel(q)} • versão ${q.version} • ${c.name}`}
        onBack={() => navigate({ page: 'lista' })}
        actions={
          <>
            <StatusBadge status={q.status} />
            {can('editar') && (
              <Button variant="primary" icon={Pencil} onClick={() => navigate({ page: 'editar', id: q.id })}>
                Editar
              </Button>
            )}
            {can('duplicar') && (
              <Button icon={Copy} loading={busy === 'dup'} onClick={duplicate}>
                Duplicar
              </Button>
            )}
          </>
        }
      />

      {/* Ações do ciclo de vida */}
      {statusActions.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4 p-3 bg-white rounded-xl border border-slate-200">
          <span className="text-xs font-semibold text-slate-500 self-center mr-1">Próximos passos:</span>
          {statusActions.map((a) => (
            <Button
              key={a}
              size="sm"
              variant={a === 'cancelar' || a === 'recusar' || a === 'rejeitar_aprovacao' ? 'secondary' : PRIMARY_ACTIONS.includes(a) ? 'primary' : 'secondary'}
              icon={ACTION_ICONS[a]}
              onClick={() => setAction(a)}
              className={cx((a === 'cancelar' || a === 'recusar') && 'text-red-700')}
            >
              {ACTION_LABELS[a]}
            </Button>
          ))}
          {isRental && conversionAvailable && can('converter') && (
            <Button size="sm" variant="success" icon={ArrowRightLeft} loading={busy === 'convert'} onClick={convert}>
              Gerar contrato
            </Button>
          )}
        </div>
      )}

      {q.status === 'aguardando_aprovacao' && !can('aprovar_interno') && <Notice kind="warning" className="mb-4">Aguardando aprovação de um gestor ou administrador (desconto efetivo de {q.effective_discount_percent.toLocaleString('pt-BR')}%).</Notice>}
      {q.status === 'expirado' && <Notice kind="warning" className="mb-4">Proposta expirada em {formatDateBR(q.expiration_date)}. Para seguir, renove a validade (gera nova versão).</Notice>}
      {['enviado', 'em_negociacao', 'aprovado_interno'].includes(q.status) && daysLeft >= 0 && daysLeft <= settings.expiring_soon_days && (
        <Notice kind="warning" className="mb-4">{daysLeft === 0 ? 'Esta proposta vence hoje.' : `Esta proposta vence em ${daysLeft} dia(s).`}</Notice>
      )}
      {q.status === 'aprovado_cliente' && (
        <Notice kind={conversionAvailable ? 'info' : 'warning'} className="mb-4">
          {conversionAvailable ? (
            <span className="flex flex-wrap items-center gap-2">
              Pronto para converter em {conversionTarget}.
              {can('converter') && (
                <Button size="sm" variant="success" icon={ArrowRightLeft} loading={busy === 'convert'} onClick={convert}>
                  Converter em {conversionTarget}
                </Button>
              )}
            </span>
          ) : (
            <>
              <b>Conversão em {conversionTarget} indisponível:</b> depende do módulo de {isRental ? 'Contratos (com reserva e validação de disponibilidade)' : 'Vendas/Estoque'}, ainda não implementado. O orçamento permanece como aprovado pelo cliente.
            </>
          )}
        </Notice>
      )}
      {q.status === 'convertido' && (
        <Notice className="mb-4">
          Convertido em {q.converted_record_type === 'venda' ? 'venda' : 'contrato de locação'} nº <b>{q.converted_record_id}</b>.
          {q.converted_record_type === 'contrato_locacao' && openContract && (
            <button type="button" className="ml-2 font-semibold underline" onClick={() => openContract(q.converted_record_id!)}>
              Abrir contrato
            </button>
          )}
        </Notice>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-5 items-start">
        <div className="space-y-5 min-w-0">
          {/* ------------------------------------------------ proposta comercial */}
          <Card title="Proposta comercial" actions={<span className="text-[11px] text-slate-500">Conteúdo do PDF</span>}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-500">Emissão</p>
                <p className="font-semibold">{formatDateBR(q.issue_date)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Validade</p>
                <p className={cx('font-semibold', q.status === 'expirado' && 'text-orange-700')}>{formatDateBR(q.expiration_date)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Responsável</p>
                <p className="font-semibold">{q.responsible_name}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Referência do cliente</p>
                <p className="font-semibold">{q.client_reference || '—'}</p>
              </div>
            </div>

            <div className="mt-4 rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Cliente</p>
              <p className="font-semibold text-slate-800">
                {c.name} {c.trade_name && <span className="font-normal text-slate-500">({c.trade_name})</span>}
              </p>
              <p className="text-slate-600 text-xs mt-0.5">{[formatDocument(c.document), c.state_registration && `IE ${c.state_registration}`, formatPhone(c.phone), formatPhone(c.whatsapp), c.email].filter(Boolean).join(' • ') || 'Sem documento/contato'}</p>
              <p className="text-slate-600 text-xs">{c.address || 'Endereço não informado'}</p>
            </div>

            {q.category === 'manutencao' && q.equipment_info && (
              <div className="mt-4 rounded-lg bg-amber-50/60 border border-amber-200 p-3 text-sm">
                <p className="text-xs font-bold text-amber-800 uppercase tracking-wide mb-1">Equipamento do cliente</p>
                <p className="font-semibold text-slate-800">{q.equipment_info.description}</p>
                <p className="text-slate-600 text-xs mt-0.5">
                  {[q.equipment_info.brand && `Marca ${q.equipment_info.brand}`, q.equipment_info.model && `Modelo ${q.equipment_info.model}`, q.equipment_info.serial_number && `Série ${q.equipment_info.serial_number}`].filter(Boolean).join(' • ') || 'Sem marca/modelo/série'}
                </p>
                {q.equipment_info.reported_defect && <p className="text-xs text-slate-700 mt-1.5"><b>Defeito relatado:</b> {q.equipment_info.reported_defect}</p>}
                {q.equipment_info.diagnosis && <p className="text-xs text-slate-700 mt-1"><b>Diagnóstico / serviço:</b> {q.equipment_info.diagnosis}</p>}
              </div>
            )}

            {isRental && (
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className="text-xs text-slate-500">Início previsto</p>
                  <p className="font-semibold">{formatDateBR(q.start_date)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Término previsto</p>
                  <p className="font-semibold">{formatDateBR(q.end_date)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Duração</p>
                  <p className="font-semibold">{q.rental_days} dia(s)</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Cobrança</p>
                  <p className="font-semibold">{billingPeriodLabel(q.rental_billing_period, q.custom_period_label)}</p>
                </div>
              </div>
            )}

            <div className="mt-4 overflow-x-auto -mx-4">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                  <tr>
                    <th className="text-left font-semibold px-4 py-2">Item</th>
                    <th className="text-right font-semibold px-3 py-2">Qtd</th>
                    {isRental && <th className="text-right font-semibold px-3 py-2">Períodos</th>}
                    <th className="text-right font-semibold px-3 py-2">{isRental ? 'Vl. período' : 'Vl. unit.'}</th>
                    <th className="text-right font-semibold px-3 py-2">Desconto</th>
                    <th className="text-right font-semibold px-4 py-2">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {q.items.length === 0 && (
                    <tr>
                      <td colSpan={isRental ? 6 : 5} className="px-4 py-6 text-center text-sm text-slate-500">
                        Nenhum item incluído. {can('editar') ? 'Edite o orçamento para adicionar itens antes de aprovar.' : ''}
                      </td>
                    </tr>
                  )}
                  {q.items.map((i) => (
                    <tr key={i.id} className="border-t border-slate-100 align-top">
                      <td className="px-4 py-2">
                        <p className="font-semibold text-slate-800">{i.description_snapshot.toLocaleUpperCase('pt-BR')}</p>
                        <p className="text-[11px] font-mono text-slate-500">{i.item_code_snapshot}</p>
                        {i.notes && <p className="text-xs text-slate-600 mt-0.5">{i.notes}</p>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatNumber(i.quantity)} {i.unit}
                      </td>
                      {isRental && (
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatNumber(i.periods, 2)} × {billingPeriodLabel(i.billing_period, q.custom_period_label).toLowerCase()}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatBRL(i.unit_price)}
                        {i.reference_price !== null && i.reference_price !== i.unit_price && <p className="text-[10px] text-slate-400">tabela {formatBRL(i.reference_price)}</p>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-700">{i.discount_amount > 0 ? `− ${formatBRL(i.discount_amount)}` : '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold">{formatBRL(i.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* memória de cálculo */}
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="text-xs text-slate-600 space-y-1">
                <p className="font-bold text-slate-700 uppercase tracking-wide">Memória de cálculo</p>
                <p>1. Total do item = valor × quantidade{isRental ? ' × períodos' : ''} − desconto do item.</p>
                <p>2. Subtotal = soma dos itens = {formatBRL(q.subtotal)}.</p>
                <p>3. Desconto geral {q.general_discount_type === 'percent' ? `de ${q.general_discount_value.toLocaleString('pt-BR')}%` : 'fixo'} sobre o subtotal = {formatBRL(q.general_discount)}.</p>
                <p>4. Total = subtotal − desconto geral + acréscimos + fretes + serviços.</p>
                {isRental && <p>Caução informada à parte, fora do total.</p>}
              </div>
              <dl className="text-sm space-y-1">
                {[
                  ['Itens (bruto)', q.items_gross_total],
                  ['Descontos nos itens', -q.item_discount_total],
                  ['Subtotal', q.subtotal],
                  ['Desconto geral', -q.general_discount],
                  ['Acréscimos', q.additional_charges],
                  [isRental ? 'Frete de entrega' : 'Frete', q.freight_amount],
                  ...(isRental ? [['Frete de retirada', q.pickup_freight_amount] as [string, number]] : []),
                  ['Montagem/instalação', q.installation_amount],
                  [isRental ? 'Serviços adicionais' : 'Outros serviços', q.other_services_amount],
                ]
                  .filter(([l, v]) => v !== 0 || l === 'Subtotal')
                  .map(([l, v]) => (
                    <div key={l as string} className="flex justify-between">
                      <dt className="text-slate-600">{l}</dt>
                      <dd className={cx('tabular-nums', (v as number) < 0 && 'text-red-700')}>{(v as number) < 0 ? `− ${formatBRL(-(v as number))}` : formatBRL(v as number)}</dd>
                    </div>
                  ))}
                <div className="flex justify-between rounded-lg bg-[#1e3a5f] text-white px-3 py-2 mt-2">
                  <dt className="font-semibold">{isRental ? 'Total previsto' : 'Valor total'}</dt>
                  <dd className="font-extrabold tabular-nums">{formatBRL(q.total_amount)}</dd>
                </div>
                {isRental && q.deposit_amount > 0 && (
                  <div className="flex justify-between text-xs pt-1">
                    <dt className="text-slate-600">Caução (separada do total)</dt>
                    <dd className="font-semibold tabular-nums">{formatBRL(q.deposit_amount)}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* condições */}
            {(() => {
              const conds: [string, string | null][] = [
                ['Condições de pagamento', q.payment_terms],
                [isRental ? 'Prazo de entrega / mobilização' : 'Prazo de entrega', q.delivery_terms],
                ['Garantia', q.warranty_terms],
                ['Retirada / entrega', q.pickup_delivery_terms],
                ['Acessórios incluídos', q.included_accessories],
                [isRental ? 'Responsabilidades pela conservação' : 'Responsabilidades do cliente', q.customer_responsibilities],
                ['Condições de devolução', q.return_conditions],
                ['Descrição complementar', q.complementary_description],
                ['Condições específicas', q.specific_conditions],
                ['Observações', q.commercial_notes],
              ];
              const filled = conds.filter(([, v]) => v);
              if (!filled.length) return <p className="mt-4 text-xs text-slate-500">Nenhuma condição comercial informada.</p>;
              return (
                <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filled.map(([l, v]) => (
                    <div key={l} className="text-sm">
                      <p className="text-xs font-bold text-slate-500">{l}</p>
                      <p className="text-slate-800 whitespace-pre-line">{v}</p>
                    </div>
                  ))}
                </div>
              );
            })()}
          </Card>

          {/* ------------------------------------------------ linha do tempo */}
          <Card
            title={
              <span className="flex gap-1">
                {(
                  [
                    ['timeline', 'Atividades'],
                    ['status', 'Histórico de status'],
                    ['versoes', `Versões (${q.versions.length})`],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} onClick={() => setTab(k)} className={cx('px-2.5 py-1 rounded-md text-xs font-semibold', tab === k ? 'bg-[#1e3a5f] text-white' : 'text-slate-600 hover:bg-slate-100')}>
                    {l}
                  </button>
                ))}
              </span>
            }
            actions={
              tab === 'timeline' &&
              ['admin', 'gestor', 'vendedor'].includes(user.role) && (
                <Button size="sm" icon={Plus} onClick={() => setNoteOpen(true)}>
                  Registrar contato
                </Button>
              )
            }
          >
            {tab === 'timeline' && (
              <ol className="relative border-l-2 border-slate-100 ml-2 space-y-4">
                {q.activities.map((a) => (
                  <li key={a.id} className="ml-4">
                    <span className={cx('absolute -left-[7px] w-3 h-3 rounded-full border-2 border-white', a.activity_type === 'contato' ? 'bg-violet-500' : a.activity_type === 'status' ? 'bg-[#1e3a5f]' : 'bg-slate-400')} />
                    <p className="text-sm text-slate-800">{a.description}</p>
                    <p className="text-[11px] text-slate-500">
                      {formatDateTimeBR(a.created_at)} • {a.performed_by_name}
                      {a.activity_type === 'contato' && ' • contato com cliente'}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            {tab === 'status' && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th className="text-left font-semibold py-1.5">Data</th>
                      <th className="text-left font-semibold py-1.5">De → Para</th>
                      <th className="text-left font-semibold py-1.5">Usuário</th>
                      <th className="text-left font-semibold py-1.5">Justificativa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.history.map((h) => (
                      <tr key={h.id} className="border-t border-slate-100 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap text-slate-600">{formatDateTimeBR(h.created_at)}</td>
                        <td className="py-2 pr-3">
                          <span className="text-slate-500">{h.previous_status ? STATUS_LABELS[h.previous_status] : '—'}</span> → <b>{STATUS_LABELS[h.new_status]}</b>
                        </td>
                        <td className="py-2 pr-3">{h.changed_by_name}</td>
                        <td className="py-2 text-slate-600">{h.change_reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {tab === 'versoes' &&
              (q.versions.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma versão emitida ainda. A versão é registrada quando o envio ao cliente é registrado.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {q.versions.map((v) => (
                    <li key={v.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">
                          Versão {v.version_number} {v.version_number === q.version && <span className="text-[10px] uppercase bg-slate-100 px-1.5 rounded">atual</span>}
                        </p>
                        <p className="text-xs text-slate-500">
                          {v.reason} • {formatDateTimeBR(v.created_at)} • {v.created_by_name}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" icon={Eye} onClick={() => viewPdf(v.version_number)} aria-label={`Ver PDF da versão ${v.version_number}`} />
                        <Button size="sm" variant="ghost" icon={FileDown} onClick={() => downloadPdf(v.version_number)} aria-label={`Baixar PDF da versão ${v.version_number}`} />
                      </div>
                    </li>
                  ))}
                </ul>
              ))}
          </Card>
        </div>

        {/* ------------------------------------------------ lateral */}
        <aside className="space-y-4 xl:sticky xl:top-[120px]">
          <Card title="Documento PDF">
            <div className="grid grid-cols-2 gap-2">
              <Button icon={Eye} loading={busy === 'view'} onClick={() => viewPdf()}>
                Visualizar
              </Button>
              <Button icon={FileDown} loading={busy === 'download'} onClick={() => downloadPdf()}>
                Baixar
              </Button>
              <Button icon={Printer} loading={busy === 'print'} onClick={printPdf}>
                Imprimir
              </Button>
              <Button icon={Share2} loading={busy === 'share'} onClick={sharePdf}>
                Compartilhar
              </Button>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
              <p className="text-[11px] text-slate-500">Preparar envio (o envio automático depende de integração não configurada):</p>
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" icon={MessageCircle} onClick={prepareWhatsApp}>
                  WhatsApp
                </Button>
                <Button size="sm" icon={Mail} onClick={prepareEmail}>
                  E-mail
                </Button>
              </div>
              {can('registrar_envio') && (
                <Button size="sm" variant="primary" icon={Send} className="w-full" onClick={() => setAction('registrar_envio')}>
                  Registrar envio
                </Button>
              )}
              {['rascunho', 'em_revisao', 'aguardando_aprovacao'].includes(q.status) && <p className="text-[11px] text-amber-700">O PDF sai marcado como "proposta preliminar" até a aprovação interna.</p>}
            </div>
          </Card>

          <Card title={<span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Registros internos</span>}>
            <dl className="text-sm space-y-2">
              <div className="flex justify-between">
                <dt className="text-slate-500">Desconto efetivo</dt>
                <dd className="font-semibold">{q.effective_discount_percent.toLocaleString('pt-BR')}%</dd>
              </div>
              {q.price_reduction_total > 0 && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Redução sobre tabela</dt>
                  <dd className="tabular-nums">{formatBRL(q.price_reduction_total)}</dd>
                </div>
              )}
              {isRental && (
                <div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Disponibilidade</dt>
                    <dd className={cx('text-right text-xs font-semibold', q.availability_status === 'confirmada' ? 'text-emerald-700' : q.availability_status === 'nao_verificada' ? 'text-slate-600' : 'text-red-700')}>
                      {AVAILABILITY_LABELS[q.availability_status]}
                    </dd>
                  </div>
                  {['admin', 'gestor', 'vendedor', 'estoquista'].includes(user.role) && q.items.length > 0 && (
                    <Button size="sm" className="w-full mt-2" icon={Warehouse} loading={busy === 'avail'} onClick={checkAvailability}>
                      Verificar disponibilidade no Estoque
                    </Button>
                  )}
                  {availResult && (
                    <ul className="mt-2 text-xs space-y-0.5">
                      {availResult.map((r) => (
                        <li key={r.catalog_item_id} className={r.status === 'confirmada' ? 'text-emerald-700' : 'text-red-700'}>
                          {q.items.find((i) => i.catalog_item_id === r.catalog_item_id)?.item_code_snapshot}: {r.free.toLocaleString('pt-BR')} livre(s) / {r.needed.toLocaleString('pt-BR')} necessário(s)
                        </li>
                      ))}
                      <li className="text-slate-500">Consulta não reserva. Reserve em Estoque › Disponibilidade para Locação.</li>
                    </ul>
                  )}
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-slate-500">Criado em</dt>
                <dd>{formatDateTimeBR(q.created_at)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Atualizado em</dt>
                <dd>{formatDateTimeBR(q.updated_at)}</dd>
              </div>
              {q.sent_at && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">Último envio</dt>
                  <dd>{formatDateTimeBR(q.sent_at)}</dd>
                </div>
              )}
              {q.refusal_reason && (
                <div>
                  <dt className="text-slate-500">Motivo da recusa</dt>
                  <dd className="text-red-700">{q.refusal_reason}</dd>
                </div>
              )}
            </dl>
            {q.internal_notes && (
              <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-900 whitespace-pre-line">
                <p className="font-semibold mb-0.5">Observações internas</p>
                {q.internal_notes}
              </div>
            )}
            {q.approvals.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                  <History className="w-3 h-3" /> Aprovações
                </p>
                <ul className="space-y-1.5">
                  {q.approvals.map((a) => (
                    <li key={a.id} className="text-xs">
                      <span className={cx('font-semibold', a.status === 'aprovado' ? 'text-emerald-700' : a.status === 'rejeitado' ? 'text-red-700' : 'text-amber-700')}>
                        {a.status === 'aprovado' ? 'Aprovado' : a.status === 'rejeitado' ? 'Rejeitado' : 'Pendente'}
                      </span>{' '}
                      — solicitado por {a.requested_by_name}
                      {a.approved_by_name && `, ${a.status === 'aprovado' ? 'aprovado' : 'resolvido'} por ${a.approved_by_name}`}
                      {a.comments && <span className="text-slate-500"> • {a.comments}</span>}
                      <p className="text-slate-400">{formatDateTimeBR(a.resolved_at || a.requested_at)}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {q.converted_record_type === 'venda' && openFinance && <FinanceHistoryCard quotationId={q.id} onOpen={openFinance} />}

          <Card title="Arquivos relacionados">
            <p className="text-xs text-slate-500">
              Os PDFs são gerados a partir dos dados gravados de cada versão ({q.versions.length} versão(ões) emitida(s), disponíveis na aba "Versões"). Anexos externos ficarão disponíveis com o módulo de documentos.
            </p>
          </Card>
        </aside>
      </div>

      <ActionModal
        q={q}
        action={action}
        onClose={() => setAction(null)}
        onDone={() => {
          setAction(null);
          reload();
        }}
      />

      <Modal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title="Registrar contato com o cliente"
        size="sm"
        footer={
          <>
            <Button onClick={() => setNoteOpen(false)}>Cancelar</Button>
            <Button variant="primary" loading={busy === 'note'} disabled={!note.trim()} onClick={saveNote}>
              Registrar
            </Button>
          </>
        }
      >
        <Field label="Descrição do contato" required>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: Liguei para o comprador, pediu para aguardar até sexta." maxLength={2000} />
        </Field>
      </Modal>
    </div>
  );
};

