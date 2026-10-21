/**
 * Ciclo de vida do contrato: transições controladas, assinatura, ativação, renovação/prorrogação,
 * reajuste, encerramento e cancelamento. Cada transição valida seus requisitos no servidor.
 *
 *   rascunho → aguardando_aprovacao → aprovado → aguardando_assinatura → (assinatura registrada) aprovado
 *            → agendado/ativo → vencido (prazo) → pendente_devolucao → encerrado
 *   cancelado a partir de qualquer status aberto (com justificativa e sem equipamento com o cliente).
 */

import { DB, audit, transaction } from '../../db';
import { HttpError, badRequest, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { addDaysISO, daysBetween, isISODate, todayISO } from '../../../shared/orcamentos/dates';
import { AmendmentType, ContractAction, ContractDetail, LIVE_STATUSES, SignatureMethod } from '../../../shared/contratos/types';
import { computeTotals, contractCan, lineTotal, reservationEnd, scheduleKey } from '../../../shared/contratos/rules';
import { getReservation, insertReservationTx, reservationConflict } from '../stock/rental';
import { NOW_SQL, appendItems, contractEvent, getContractSettings, loadContract, loadItems, loadRaw, maskValues, normalizeItems, setStatus, text } from './core';
import { cancelFutureChargesTx, financialSummary, generateChargesTx, insertChargeTx, listCharges, repriceFutureChargesTx, scheduleFor } from './billing';
import { listOperations, pendingInspections, reservationBase, reserveTx } from './operations';
import { closeContractTx } from './closing';
import { addAttachmentTx, issueDocumentTx, listDocuments } from './documents';
import { cancelReservationTx } from '../stock/rental';
import { adjustContractChargeTx, cancelContractChargeTx } from '../finance/integrations';

/** Status em que o contrato ainda não foi formalizado e pode ser excluído. */
export const DELETABLE_CONTRACT_STATUSES = ['rascunho', 'aguardando_aprovacao'];

/**
 * Exclusão definitiva de contrato sem entrega, logística, OS ou recebimento. Rascunho / aguardando
 * aprovação: dono, gestor ou admin (sem documento, cobrança nem aditivo). Já formalizado: só o admin;
 * os títulos das cobranças são cancelados no Financeiro (lá ficam, com a referência) e documentos,
 * aditivos e cobranças do contrato saem junto. Reservas abertas são canceladas e ficam no Estoque com a
 * referência em texto; o orçamento de origem volta a "aprovado pelo cliente".
 */
export function deleteContract(db: DB, user: AuthUser, id: number) {
  return transaction(db, () => {
    const c = db.prepare('SELECT id, contract_number, status, responsible_user_id, created_by, quotation_id, customer_snapshot, estimated_total FROM contracts WHERE id = ?').get(id) as any;
    if (!c) throw notFound('Contrato não encontrado.');
    const draft = DELETABLE_CONTRACT_STATUSES.includes(c.status);
    const own = user.role === 'vendedor' && (c.responsible_user_id === user.id || c.created_by === user.id);
    if (draft ? !contractCan.cancel(user) && !own : user.role !== 'admin') throw forbidden(draft ? 'Você não pode excluir este contrato.' : 'Só o administrador exclui contrato já formalizado: use Cancelar.');
    const linked = [
      ['entrega ou devolução', 'SELECT 1 FROM contract_operations WHERE contract_id = ?'],
      ['operação de logística', 'SELECT 1 FROM logistics_orders WHERE contract_id = ?'],
      ['ocorrência', 'SELECT 1 FROM logistics_occurrences WHERE contract_id = ?'],
      ['ordem de serviço', 'SELECT 1 FROM work_orders WHERE contract_id = ?'],
      ['equipamento entregue', "SELECT 1 FROM stock_reservations WHERE contract_id = ? AND status IN ('em_uso','concluida')"],
      ...(draft
        ? [
            ['cobrança', 'SELECT 1 FROM contract_charges WHERE contract_id = ?'],
            ['documento emitido', 'SELECT 1 FROM contract_documents WHERE contract_id = ?'],
            ['aditivo', 'SELECT 1 FROM contract_amendments WHERE contract_id = ?'],
          ]
        : []),
    ].filter(([, sql]) => db.prepare(sql).get(id)).map(([label]) => label);
    if (linked.length) throw new HttpError(422, `Contrato com ${linked.join(', ')}: use Cancelar.`);

    const reason = `Contrato ${c.contract_number} excluído`;
    // recebimento registrado barra a exclusão (cancelContractChargeTx pede o estorno no Financeiro antes)
    for (const ch of db.prepare("SELECT financial_entry_id FROM contract_charges WHERE contract_id = ? AND status != 'cancelado' AND financial_entry_id IS NOT NULL").all(id) as { financial_entry_id: number }[])
      cancelContractChargeTx(db, user, ch.financial_entry_id, reason);
    for (const r of db.prepare("SELECT id FROM stock_reservations WHERE contract_id = ? AND status IN ('pendente','confirmada')").all(id) as { id: number }[])
      cancelReservationTx(db, user, getReservation(db, r.id), reason);
    db.prepare('UPDATE stock_reservations SET contract_ref = COALESCE(contract_ref, ?), contract_id = NULL, contract_item_id = NULL WHERE contract_id = ?').run(c.contract_number, id);
    if (c.quotation_id) {
      const q = db.prepare('SELECT status FROM quotations WHERE id = ?').get(c.quotation_id) as { status: string } | undefined;
      if (q?.status === 'convertido') {
        db.prepare(`UPDATE quotations SET status = 'aprovado_cliente', converted_record_type = NULL, converted_record_id = NULL, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`).run(c.quotation_id);
        db.prepare('INSERT INTO quotation_status_history (quotation_id, previous_status, new_status, changed_by, change_reason) VALUES (?, ?, ?, ?, ?)').run(c.quotation_id, 'convertido', 'aprovado_cliente', user.id, reason);
      }
    }
    // a marca libera as travas do banco só para este contrato e só dentro desta transação
    db.prepare('INSERT INTO contract_purges (contract_id) VALUES (?)').run(id);
    // a ordem importa: filhos antes do contrato (documentos e vigências apontam para aditivos)
    for (const t of ['contract_documents', 'contract_charges', 'contract_events', 'contract_terms', 'contract_amendments', 'contract_items']) db.prepare(`DELETE FROM ${t} WHERE contract_id = ?`).run(id);
    db.prepare('DELETE FROM contracts WHERE id = ?').run(id);
    db.prepare('DELETE FROM contract_purges WHERE contract_id = ?').run(id);
    audit(db, 'contract', id, 'delete', user.id, { contract_number: c.contract_number, status: c.status, estimated_total: c.estimated_total, customer: JSON.parse(c.customer_snapshot || '{}').name ?? null });
    return { deleted: c.contract_number as string };
  });
}

const active = (db: DB, id: number, status: string) => (db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM stock_reservations WHERE contract_id = ? AND status = ?').get(id, status) as { q: number }).q;

function needsApproval(db: DB, c: any) {
  const s = getContractSettings(db);
  const value = c.estimated_total ?? c.monthly_equivalent ?? 0;
  return s.require_approval || (s.approval_limit > 0 && value > s.approval_limit);
}

// ------------------------------------------------ ações disponíveis (a interface só mostra o que o servidor permite)

export function availableActions(db: DB, c: any, user: AuthUser): { actions: ContractAction[]; blockers: Partial<Record<ContractAction, string>> } {
  const s = getContractSettings(db);
  const a: ContractAction[] = [];
  const blockers: Partial<Record<ContractAction, string>> = {};
  const rental = c.contract_type === 'locacao';
  const onRent = active(db, c.id, 'em_uso');
  const items = loadItems(db, c.id);
  const st = c.status;
  if (st === 'rascunho' && contractCan.edit(user, c)) a.push('editar', 'enviar_aprovacao');
  if (st === 'aguardando_aprovacao' && contractCan.approve(user)) a.push('aprovar', 'rejeitar');
  if (['aprovado', 'aguardando_assinatura'].includes(st) && contractCan.edit(user, c) && !c.signed_at) a.push('reabrir');
  if (!['rascunho', 'aguardando_aprovacao', 'cancelado'].includes(st) && contractCan.documents(user)) a.push('gerar_documento');
  if (st === 'aguardando_assinatura' && contractCan.sign(user)) a.push('registrar_assinatura');
  if (rental && ['aprovado', 'aguardando_assinatura', 'agendado', 'ativo'].includes(st) && contractCan.operate(user)) {
    const missing = items.some((i) => i.modality === 'locacao' && i.quantity - i.reserved_qty - i.delivered_qty - i.returned_qty > 1e-9);
    if (missing) a.push('reservar');
  }
  if (st === 'aprovado' && contractCan.activate(user)) {
    a.push('ativar');
    if (s.require_signature_to_activate && !c.signed_at) blockers.ativar = 'Registre a assinatura do contrato antes de ativar (exigência das configurações).';
    if (c.end_date && c.end_date <= todayISO()) blockers.ativar = 'O prazo do contrato já terminou: ajuste as datas (reabrir) antes de ativar.';
  }
  if (contractCan.operate(user)) {
    const pendingDelivery = items.some((i) => (i.modality === 'venda' ? i.quantity - i.sold_delivered_qty : i.quantity - i.delivered_qty - i.returned_qty) > 1e-9);
    if (pendingDelivery && (rental ? ['agendado', 'ativo'] : ['ativo']).includes(st)) a.push('entregar');
    if (rental && onRent > 0 && ['agendado', 'ativo', 'vencido', 'pendente_devolucao'].includes(st)) a.push('devolver');
  }
  if (rental && ['agendado', 'ativo', 'vencido', 'pendente_devolucao'].includes(st) && contractCan.renew(user)) a.push('prorrogar');
  if (rental && ['agendado', 'ativo', 'vencido'].includes(st) && contractCan.renew(user) && c.billing_frequency !== 'unico') a.push('reajustar');
  if (rental && ['agendado', 'ativo'].includes(st) && contractCan.renew(user)) a.push('incluir_itens');
  if (LIVE_STATUSES.includes(st) && contractCan.charges(user)) a.push('gerar_cobrancas');
  if ([...LIVE_STATUSES, 'encerrado'].includes(st) && contractCan.charges(user)) a.push('cobranca_extra');
  if (rental && ['ativo', 'vencido'].includes(st) && contractCan.close(user)) a.push('iniciar_encerramento');
  if ((rental ? ['ativo', 'vencido', 'pendente_devolucao'] : ['ativo']).includes(st) && contractCan.close(user)) {
    a.push('encerrar');
    const b = closeBlocker(db, c, items, onRent);
    if (b) blockers.encerrar = b;
  }
  if (!['encerrado', 'cancelado'].includes(st) && contractCan.cancel(user)) {
    a.push('cancelar');
    if (onRent > 0) blockers.cancelar = 'Há equipamentos com o cliente: registre a devolução antes de cancelar.';
    else if (!rental && items.some((i) => i.sold_delivered_qty > 0)) blockers.cancelar = 'Itens da venda já foram entregues: trate a devolução no Estoque e encerre o contrato.';
  }
  return { actions: a, blockers };
}

function closeBlocker(db: DB, c: any, items = loadItems(db, c.id), onRent = active(db, c.id, 'em_uso')): string | null {
  const s = getContractSettings(db);
  if (onRent > 0) return `Ainda há ${onRent.toLocaleString('pt-BR')} unidade(s) com o cliente: registre a devolução.`;
  if (c.contract_type === 'venda' && items.some((i) => i.quantity - i.sold_delivered_qty > 1e-9)) return 'Há itens vendidos ainda não entregues.';
  if (s.require_inspection_before_close) {
    const p = pendingInspections(db, c.id);
    if (p.length) return `Equipamentos devolvidos aguardando conferência: ${p.join(', ')}. Faça a inspeção no Estoque.`;
  }
  if (s.block_close_with_open_charges) {
    const open = listCharges(db, c.id).filter((x) => x.display_status !== 'cancelado' && x.period_start <= todayISO()).reduce((t, x) => t + Math.max(0, x.updated_amount - x.settled_amount), 0);
    if (open > 0) return `Há ${(open / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em cobranças abertas (política da empresa bloqueia o encerramento).`;
  }
  return null;
}

function assertAllowed(db: DB, c: any, user: AuthUser, action: ContractAction) {
  const { actions, blockers } = availableActions(db, c, user);
  if (!actions.includes(action)) {
    const perm: Partial<Record<ContractAction, (u: AuthUser) => boolean>> = {
      aprovar: contractCan.approve, rejeitar: contractCan.approve, registrar_assinatura: contractCan.sign, ativar: contractCan.activate, prorrogar: contractCan.renew,
      reajustar: contractCan.renew, incluir_itens: contractCan.renew, encerrar: contractCan.close, iniciar_encerramento: contractCan.close, cancelar: contractCan.cancel, gerar_cobrancas: contractCan.charges,
    };
    if (perm[action] && !perm[action]!(user)) throw forbidden();
    throw new HttpError(422, `Ação indisponível para o contrato no status atual.`);
  }
  if (blockers[action]) throw new HttpError(422, blockers[action]!);
}

// ------------------------------------------------ transições

export function contractAction(db: DB, user: AuthUser, id: number, action: ContractAction, raw: any) {
  const result = transaction(db, () => {
    const c = loadRaw(db, id);
    if (raw?.row_version !== undefined && Number(raw.row_version) !== c.row_version) throw new HttpError(409, 'O contrato foi alterado por outra pessoa. Atualize a tela.');
    assertAllowed(db, c, user, action);
    const reason = text(raw?.reason, 1000);
    const today = todayISO();
    switch (action) {
      case 'enviar_aprovacao': {
        if (needsApproval(db, c)) setStatus(db, c, 'aguardando_aprovacao', user, 'Enviado para aprovação interna.');
        else setStatus(db, c, 'aprovado', user, 'Aprovação interna dispensada pelas configurações.', `approved_at = ${NOW_SQL}`);
        return {};
      }
      case 'aprovar': {
        if (c.approver_user_id && c.approver_user_id !== user.id && user.role !== 'admin') throw forbidden('Este contrato indica outro responsável pela aprovação.');
        setStatus(db, c, 'aprovado', user, `Aprovado por ${user.name}${reason ? `: ${reason}` : ''}.`, `approved_by = ?, approved_at = ${NOW_SQL}`, [user.id]);
        return {};
      }
      case 'rejeitar': {
        if (!reason) throw badRequest('Informe o que precisa ser ajustado.', { reason: 'Obrigatório.' });
        setStatus(db, c, 'rascunho', user, `Devolvido para ajustes: ${reason}`);
        return {};
      }
      case 'reabrir': {
        if (!reason) throw badRequest('Informe o motivo da reabertura.', { reason: 'Obrigatório.' });
        if (db.prepare("SELECT 1 FROM contract_charges WHERE contract_id = ? AND status = 'gerado'").get(id)) throw new HttpError(422, 'Já há cobranças geradas: não é possível reabrir.');
        for (const r of db.prepare("SELECT id FROM stock_reservations WHERE contract_id = ? AND status IN ('pendente','confirmada')").all(id) as { id: number }[]) cancelReservationTx(db, user, getReservation(db, r.id), `Contrato reaberto para edição: ${reason}`);
        db.prepare(`UPDATE contract_documents SET status = 'substituido' WHERE contract_id = ? AND document_type = 'contrato' AND status IN ('gerado','enviado')`).run(id);
        setStatus(db, c, 'rascunho', user, `Reaberto para edição: ${reason}. Reservas liberadas e documentos anteriores substituídos.`, 'approved_by = NULL, approved_at = NULL');
        return {};
      }
      case 'registrar_assinatura': {
        const method = raw?.signature_method as SignatureMethod;
        if (!['presencial', 'digitalizado', 'plataforma_externa'].includes(method)) throw badRequest('Informe como o contrato foi assinado.', { signature_method: 'Obrigatório.' });
        const signedAt = raw?.signed_at;
        if (!isISODate(signedAt) || signedAt > today) throw badRequest('Informe a data da assinatura (não futura).', { signed_at: 'Data inválida.' });
        const names = text(raw?.signed_by_names, 300);
        const evidence = text(raw?.signature_evidence, 1000);
        if (!names) throw badRequest('Informe quem assinou.', { signed_by_names: 'Obrigatório.' });
        if (!evidence) throw badRequest('Descreva a evidência da assinatura (ex.: via física arquivada na pasta X, protocolo da plataforma).', { signature_evidence: 'Obrigatório.' });
        if (method === 'digitalizado' && !raw?.file?.content) throw badRequest('Anexe a via assinada digitalizada.', { file: 'Obrigatório.' });
        const d = db.prepare("SELECT * FROM contract_documents WHERE contract_id = ? AND document_type = 'contrato' AND status IN ('gerado','enviado') ORDER BY version DESC LIMIT 1").get(id) as any;
        if (!d) throw new HttpError(422, 'Gere o documento do contrato antes de registrar a assinatura.');
        if (method === 'digitalizado') addAttachmentTx(db, user, id, { ...raw.file, title: `Via assinada — contrato v${d.version}` }, `Via assinada — contrato v${d.version}`);
        db.prepare(
          `UPDATE contract_documents SET status = 'assinado', signed_at = ?, signed_by_names = ?, signature_method = ?, signature_evidence = ?, signature_provider = ?, external_signature_id = ?, signature_registered_by = ? WHERE id = ?`
        ).run(signedAt, names, method, evidence, method === 'plataforma_externa' ? text(raw?.signature_provider, 80) : null, text(raw?.external_signature_id, 120), user.id, d.id);
        setStatus(db, c, 'aprovado', user, `Assinatura registrada (contrato v${d.version}, ${names}, ${signedAt.split('-').reverse().join('/')}). Evidência: ${evidence}`, 'signed_at = ?', [signedAt]);
        return {};
      }
      case 'ativar': {
        if (c.contract_type === 'locacao') reserveTx(db, user, c);
        const to = c.contract_type === 'locacao' && c.start_date > today ? 'agendado' : 'ativo';
        setStatus(db, c, to, user, to === 'agendado' ? `Contrato formalizado e agendado para ${c.start_date.split('-').reverse().join('/')}.` : 'Contrato ativado.', `activated_at = ${NOW_SQL}`);
        db.prepare('INSERT INTO contract_terms (contract_id, start_date, end_date, period_amount, reason, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(id, c.start_date, c.end_date, c.contract_type === 'venda' ? c.sale_total : c.period_amount, 'Vigência inicial', user.id);
        let generated = 0;
        if (raw?.generate_charges !== false && contractCan.charges(user)) generated = generateChargesTx(db, user, { ...c, status: to });
        return { generated };
      }
      case 'gerar_cobrancas':
        return { generated: generateChargesTx(db, user, c) };
      case 'prorrogar':
        return { amendment_id: extendTx(db, user, c, raw) };
      case 'reajustar':
        return { amendment_id: repriceTx(db, user, c, raw) };
      case 'incluir_itens':
        return addItemsTx(db, user, c, raw);
      case 'iniciar_encerramento': {
        for (const r of db.prepare("SELECT id FROM stock_reservations WHERE contract_id = ? AND status IN ('pendente','confirmada')").all(id) as { id: number }[]) cancelReservationTx(db, user, getReservation(db, r.id), 'Encerramento do contrato iniciado');
        setStatus(db, c, 'pendente_devolucao', user, `Encerramento iniciado${reason ? `: ${reason}` : ''}. Aguardando devolução dos equipamentos.`, `closing_started_at = ${NOW_SQL}`);
        return {};
      }
      case 'encerrar':
        // cobranças de períodos ainda não iniciados e sem recebimento deixam de valer; as demais seguem no Financeiro
        return closeContractTx(db, user, c);
      case 'cancelar': {
        if (!reason) throw badRequest('Informe a justificativa do cancelamento.', { reason: 'Obrigatório.' });
        for (const r of db.prepare("SELECT id FROM stock_reservations WHERE contract_id = ? AND status IN ('pendente','confirmada')").all(id) as { id: number }[]) cancelReservationTx(db, user, getReservation(db, r.id), `Contrato cancelado: ${reason}`);
        const delivered = !!db.prepare("SELECT 1 FROM contract_operations WHERE contract_id = ? AND operation_type = 'entrega'").get(id);
        // nunca usado: cancela tudo que não foi recebido; já usado: só o que é de períodos futuros
        const ch = cancelFutureChargesTx(db, user, id, delivered ? addDay(today) : null, `Cancelamento do contrato: ${reason}`);
        setStatus(db, c, 'cancelado', user, `Contrato cancelado: ${reason}${ch.cancelled ? `. ${ch.cancelled} cobrança(s) sem recebimento cancelada(s)` : ''}${ch.kept ? `; ${ch.kept} com recebimento mantida(s) no Financeiro` : ''}.`, `cancelled_at = ${NOW_SQL}, cancelled_by = ?, cancellation_reason = ?`, [user.id, reason]);
        return { cancelled_charges: ch.cancelled, kept_charges: ch.kept };
      }
      default:
        throw badRequest('Ação inválida.');
    }
  });
  audit(db, 'contract', id, action, user.id);
  return result;
}

const addDay = (d: string) => new Date(Date.parse(d + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
const brl = (v: number) => (v / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function nextAmendmentNumber(db: DB, id: number) {
  return ((db.prepare('SELECT MAX(number) n FROM contract_amendments WHERE contract_id = ?').get(id) as { n: number | null }).n || 0) + 1;
}

/** Renovação/prorrogação: valida a agenda do período adicional antes de estender as reservas. */
function extendTx(db: DB, user: AuthUser, c: any, raw: any): number {
  const reason = text(raw?.reason, 1000);
  const type: AmendmentType = raw?.amendment_type === 'renovacao' ? 'renovacao' : 'prorrogacao';
  const indefinite = !!raw?.indefinite;
  const newEnd: string | null = indefinite ? null : raw?.new_end;
  if (!reason) throw badRequest('Informe a justificativa.', { reason: 'Obrigatório.' });
  if (!indefinite && !isISODate(newEnd)) throw badRequest('Informe a nova data de término.', { new_end: 'Obrigatório.' });
  if (!indefinite && c.end_date && newEnd! <= c.end_date) throw badRequest('A nova data deve ser posterior ao término atual.', { new_end: 'Data inválida.' });
  if (!indefinite && newEnd! <= todayISO()) throw badRequest('A nova data de término deve ser futura.', { new_end: 'Data inválida.' });
  if (indefinite && !c.end_date) throw badRequest('O contrato já é por prazo indeterminado.');
  const resEnd = reservationEnd(newEnd);
  const conflicts: string[] = [];
  const reservations = db.prepare("SELECT id FROM stock_reservations WHERE contract_id = ? AND status IN ('confirmada','em_uso')").all(c.id) as { id: number }[];
  for (const { id: rid } of reservations) {
    const r = getReservation(db, rid);
    if (r.asset_id) {
      // só a agenda importa: o equipamento já está com o cliente (ou reservado para ele)
      const clash = db
        .prepare("SELECT number, start_date FROM stock_reservations WHERE asset_id = ? AND id != ? AND status IN ('confirmada','em_uso') AND start_date <= ? AND end_date >= ?")
        .get(r.asset_id, rid, resEnd, r.start_date) as { number: string; start_date: string } | undefined;
      if (clash) conflicts.push(`${r.asset_tag || 'Equipamento'} já está reservado a partir de ${clash.start_date.split('-').reverse().join('/')} (${clash.number}).`);
    } else {
      const msg = reservationConflict(db, { item_id: r.item_id, asset_id: null, quantity: r.quantity, start_date: r.start_date, end_date: resEnd }, rid);
      if (msg) conflicts.push(`${r.item_code}: ${msg}`);
    }
  }
  if (conflicts.length) throw new HttpError(409, `Não é possível prorrogar: ${conflicts.join(' ')}`);
  for (const { id: rid } of reservations) db.prepare(`UPDATE stock_reservations SET end_date = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(resEnd, rid);
  const number = nextAmendmentNumber(db, c.id);
  const am = db
    .prepare(
      `INSERT INTO contract_amendments (contract_id, number, amendment_type, description, reason, previous_end, new_end, previous_amount, new_amount, effective_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(c.id, number, type, `${type === 'renovacao' ? 'Renovação' : 'Prorrogação'} da vigência até ${newEnd ? newEnd.split('-').reverse().join('/') : 'prazo indeterminado'}`, reason, c.end_date, newEnd, c.period_amount, c.period_amount, c.end_date || todayISO(), user.id) as { id: number };
  const updated = { ...c, end_date: newEnd };
  const totals = computeTotals(loadItems(db, c.id), { ...updated, proportional_last: !!c.proportional_last, single_charge: !!c.single_charge });
  const backToActive = ['vencido', 'pendente_devolucao'].includes(c.status) || (c.status === 'agendado' && c.start_date <= todayISO());
  db.prepare(`UPDATE contracts SET end_date = ?, estimated_total = ?, ${backToActive ? "status = 'ativo', closing_started_at = NULL," : ''} updated_by = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`).run(newEnd, totals.estimated_total, user.id, c.id);
  db.prepare('INSERT INTO contract_terms (contract_id, start_date, end_date, period_amount, reason, amendment_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(c.id, c.start_date, newEnd, c.period_amount, reason, am.id, user.id);
  contractEvent(db, c.id, type, `Aditivo nº ${number}: vigência ${c.end_date ? `de ${c.end_date.split('-').reverse().join('/')} ` : ''}para ${newEnd ? newEnd.split('-').reverse().join('/') : 'prazo indeterminado'}. ${reason}`, user, c.status, backToActive ? 'ativo' : c.status);
  // cronograma futuro: se já há cobranças geradas, gera as dos novos períodos (idempotente)
  if (db.prepare("SELECT 1 FROM contract_charges WHERE contract_id = ? AND status = 'gerado'").get(c.id)) generateChargesTx(db, user, { ...loadRaw(db, c.id) });
  issueDocumentTx(db, user, c.id, 'aditivo', `Aditivo nº ${number} — ${type === 'renovacao' ? 'renovação' : 'prorrogação'}`, { amendment_id: am.id });
  return am.id;
}

/** Reajuste de valores com histórico; cobranças futuras sem recebimento passam ao novo valor. */
function repriceTx(db: DB, user: AuthUser, c: any, raw: any): number {
  const reason = text(raw?.reason, 1000);
  const effective = raw?.effective_date;
  if (!reason) throw badRequest('Informe a justificativa.', { reason: 'Obrigatório.' });
  if (!isISODate(effective) || effective < todayISO()) throw badRequest('A vigência do reajuste deve ser hoje ou futura (não se altera período passado).', { effective_date: 'Data inválida.' });
  const prices: Record<string, number> = raw?.prices || {};
  const pct = raw?.percent !== undefined && raw?.percent !== '' ? Number(raw.percent) : null;
  if (pct !== null && !(Number.isFinite(pct) && pct > -100 && pct <= 500)) throw badRequest('Percentual inválido.', { percent: 'Entre -99 e 500.' });
  const items = loadItems(db, c.id);
  let changed = 0;
  for (const it of items) {
    if (it.modality !== 'locacao') continue;
    const np = prices[it.id] !== undefined ? Number(prices[it.id]) : pct !== null ? Math.round(it.unit_price * (1 + pct / 100)) : it.unit_price;
    if (!Number.isInteger(np) || np < 0) throw badRequest(`${it.item_code}: valor inválido.`);
    if (np === it.unit_price) continue;
    const discount = Math.min(it.discount_amount, Math.round(it.quantity * np));
    db.prepare(`UPDATE contract_items SET unit_price = ?, discount_amount = ?, line_total = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(np, discount, lineTotal({ quantity: it.quantity, unit_price: np, discount_amount: discount }), it.id);
    changed++;
  }
  if (!changed) throw badRequest('Nenhum valor foi alterado.');
  const fresh = loadRaw(db, c.id);
  const totals = computeTotals(loadItems(db, c.id), { ...fresh, proportional_last: !!fresh.proportional_last, single_charge: !!fresh.single_charge });
  if (totals.period_amount <= 0) throw badRequest('O valor por período ficaria zerado.');
  db.prepare(
    `UPDATE contracts SET rental_subtotal = ?, period_amount = ?, estimated_total = ?, monthly_equivalent = ?, updated_by = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`
  ).run(totals.rental_subtotal, totals.period_amount, totals.estimated_total, totals.monthly_equivalent, user.id, c.id);
  const number = nextAmendmentNumber(db, c.id);
  const am = db
    .prepare(
      `INSERT INTO contract_amendments (contract_id, number, amendment_type, description, reason, previous_end, new_end, previous_amount, new_amount, effective_date, created_by)
       VALUES (?, ?, 'reajuste', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(c.id, number, `Reajuste do valor por período de ${brl(c.period_amount)} para ${brl(totals.period_amount)} a partir de ${effective.split('-').reverse().join('/')}`, reason, c.end_date, c.end_date, c.period_amount, totals.period_amount, effective, user.id) as { id: number };
  db.prepare('INSERT INTO contract_terms (contract_id, start_date, end_date, period_amount, reason, amendment_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(c.id, effective, c.end_date, totals.period_amount, reason, am.id, user.id);
  const repriced = repriceFutureChargesTx(db, user, loadRaw(db, c.id), effective, `Reajuste — aditivo ${number}: ${reason}`);
  contractEvent(db, c.id, 'reajuste', `Aditivo nº ${number}: valor por período ${brl(c.period_amount)} → ${brl(totals.period_amount)} a partir de ${effective.split('-').reverse().join('/')}; ${repriced} cobrança(s) futura(s) atualizada(s). ${reason}`, user);
  issueDocumentTx(db, user, c.id, 'aditivo', `Aditivo nº ${number} — reajuste`, { amendment_id: am.id });
  return am.id;
}

/** Fração de um período (datas inclusivas) que fica a partir de `from`. */
function shareFrom(l: { period_start: string; period_end: string }, from: string) {
  if (l.period_end < from) return 0;
  const end = addDaysISO(l.period_end, 1);
  return daysBetween(l.period_start > from ? l.period_start : from, end) / Math.max(1, daysBetween(l.period_start, end));
}

/**
 * Aditivo de inclusão de itens (o cliente pegou mais equipamentos durante a locação). Os itens novos valem a
 * partir de `effective_date`: são reservados no Estoque desse dia até o término; o valor por período sobe e as
 * cobranças já lançadas recebem a diferença — futuras sem recebimento são ajustadas; o período em curso e as
 * já pagas ganham uma cobrança complementar proporcional aos dias restantes.
 */
function addItemsTx(db: DB, user: AuthUser, c: any, raw: any) {
  const reason = text(raw?.reason, 1000);
  const effective = raw?.effective_date;
  if (!reason) throw badRequest('Informe a justificativa.', { reason: 'Obrigatório.' });
  if (!isISODate(effective) || effective < todayISO()) throw badRequest('A inclusão vale a partir de hoje ou de data futura.', { effective_date: 'Data inválida.' });
  if (effective < c.start_date) throw badRequest('A inclusão não pode valer antes do início do contrato.', { effective_date: 'Data inválida.' });
  if (c.end_date && effective >= c.end_date) throw badRequest('A inclusão precisa começar antes do término do contrato (prorrogue antes, se preciso).', { effective_date: 'Data inválida.' });

  const current = loadItems(db, c.id);
  const rawItems: any[] = Array.isArray(raw?.items) ? raw.items : [];
  const errors: Record<string, string> = {};
  if (!rawItems.length) errors.items = 'Inclua ao menos um item.';
  if (current.length + rawItems.length > 200) errors.items = 'Máximo de 200 itens no contrato.';
  const inUse = new Set(current.filter((i) => i.asset_id && i.quantity - i.returned_qty > 1e-9).map((i) => i.asset_id!));
  const items = normalizeItems(db, c.contract_type, rawItems, errors, inUse);
  items.forEach((it, idx) => {
    if (it.modality === 'locacao' && !it.asset_id && db.prepare("SELECT 1 FROM catalog_items WHERE id = ? AND tracking = 'individual'").get(it.item_id)) errors[`items.${idx}`] = 'Defina o patrimônio do equipamento.';
  });
  if (Object.keys(errors).length) throw badRequest('Revise os itens incluídos.', errors);

  const oldSchedule = new Map(scheduleFor(db, c).map((l) => [scheduleKey(l), l]));
  const ids = appendItems(db, c.id, items);
  const all = loadItems(db, c.id);
  const totals = computeTotals(all, { ...c, proportional_last: !!c.proportional_last, single_charge: !!c.single_charge });
  const newSchedule = new Map(scheduleFor(db, { ...c, period_amount: totals.period_amount, sale_total: totals.sale_total }).map((l) => [scheduleKey(l), l]));
  const addedSale = totals.sale_total - c.sale_total;
  // estimativa: só muda o que vem a partir da inclusão (o passado não é recalculado)
  let estimated: number | null = c.estimated_total === null ? null : c.estimated_total + addedSale;
  for (const [key, l] of newSchedule) {
    const prev = oldSchedule.get(key);
    if (estimated !== null && prev && (l.kind === 'periodo' || l.kind === 'unico')) estimated += Math.round((l.amount - prev.amount) * shareFrom(l, effective));
  }
  db.prepare(
    `UPDATE contracts SET rental_subtotal = ?, period_amount = ?, sale_subtotal = ?, sale_total = ?, estimated_total = ?, monthly_equivalent = ?, updated_by = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`
  ).run(totals.rental_subtotal, totals.period_amount, totals.sale_subtotal, totals.sale_total, estimated, totals.monthly_equivalent, user.id, c.id);

  // agenda do Estoque: os novos equipamentos ficam reservados da data da inclusão até o término
  const fresh = loadRaw(db, c.id);
  const added = all.filter((i) => ids.includes(i.id));
  for (const it of added.filter((i) => i.modality === 'locacao')) insertReservationTx(db, user, { ...reservationBase(fresh, it), start_date: effective, quantity: it.quantity }, true);

  const number = nextAmendmentNumber(db, c.id);
  const names = added.map((i) => `${i.item_code}${i.asset_tag ? ` (${i.asset_tag})` : ''}`).join(', ');
  const am = db
    .prepare(
      `INSERT INTO contract_amendments (contract_id, number, amendment_type, description, reason, previous_end, new_end, previous_amount, new_amount, effective_date, created_by)
       VALUES (?, ?, 'alteracao', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(c.id, number, `Inclusão de ${ids.length} item(ns) a partir de ${effective.split('-').reverse().join('/')}: ${names}`, reason, c.end_date, c.end_date, c.period_amount, totals.period_amount, effective, user.id) as { id: number };
  if (totals.period_amount !== c.period_amount)
    db.prepare('INSERT INTO contract_terms (contract_id, start_date, end_date, period_amount, reason, amendment_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(c.id, effective, c.end_date, totals.period_amount, reason, am.id, user.id);

  // cobranças já lançadas: ajusta as futuras em aberto; complementa o período em curso e as já pagas
  const due = addDaysISO(todayISO(), c.due_days_after || 0);
  const label = `Aditivo nº ${number} — inclusão de itens`;
  let adjusted = 0;
  let complements = 0;
  for (const ch of listCharges(db, c.id)) {
    if ((ch.kind !== 'periodo' && ch.kind !== 'unico') || ch.display_status === 'cancelado') continue;
    const before = oldSchedule.get(scheduleKey(ch));
    const after = newSchedule.get(scheduleKey(ch));
    const delta = before && after ? after.amount - before.amount : 0;
    const share = shareFrom(ch, effective);
    if (delta <= 0 || share <= 0) continue;
    if (share === 1 && ch.settled_amount === 0) {
      adjustContractChargeTx(db, user, ch.financial_entry_id!, ch.amount + delta, label);
      db.prepare(`UPDATE contract_charges SET amount = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(ch.amount + delta, ch.id);
      adjusted++;
    } else {
      const amount = Math.round(delta * share);
      if (amount <= 0) continue;
      const from = ch.period_start > effective ? ch.period_start : effective;
      insertChargeTx(db, user, fresh, { kind: 'extra', description: `${label} (${from.split('-').reverse().join('/')} a ${ch.period_end.split('-').reverse().join('/')})`, period_start: from, period_end: ch.period_end, due_date: due, amount }, `extra:aditivo-${am.id}-${ch.id}`, null, reason);
      complements++;
    }
  }
  if (addedSale > 0 && listCharges(db, c.id).some((ch) => ch.kind === 'venda_item' && ch.display_status !== 'cancelado')) {
    insertChargeTx(db, user, fresh, { kind: 'venda_item', description: `${label} — itens vendidos`, period_start: effective, period_end: effective, due_date: due, amount: addedSale }, `venda_item:aditivo-${am.id}`);
    complements++;
  }
  // períodos (e venda) ainda não lançados já saem com o novo valor
  if (db.prepare("SELECT 1 FROM contract_charges WHERE contract_id = ? AND status = 'gerado'").get(c.id)) generateChargesTx(db, user, loadRaw(db, c.id));

  contractEvent(
    db,
    c.id,
    'alteracao',
    `Aditivo nº ${number}: ${names} incluído(s) a partir de ${effective.split('-').reverse().join('/')}; valor por período ${brl(c.period_amount)} → ${brl(totals.period_amount)}${adjusted ? `; ${adjusted} cobrança(s) futura(s) ajustada(s)` : ''}${complements ? `; ${complements} cobrança(s) complementar(es)` : ''}. ${reason}`,
    user
  );
  issueDocumentTx(db, user, c.id, 'aditivo', label, { amendment_id: am.id, item_ids: ids });
  return { amendment_id: am.id, adjusted, complements };
}

// ------------------------------------------------ rotina diária (início de vigência e vencimento)

export function refreshContractStatuses(db: DB, today = todayISO()) {
  const start = db.prepare("SELECT * FROM contracts WHERE status = 'agendado' AND start_date <= ?").all(today) as any[];
  const expired = db.prepare("SELECT * FROM contracts WHERE status = 'ativo' AND end_date IS NOT NULL AND end_date < ?").all(today) as any[];
  const openEnded = db.prepare("SELECT * FROM contracts WHERE status IN ('ativo','vencido','pendente_devolucao') AND end_date IS NULL AND EXISTS (SELECT 1 FROM contract_charges ch WHERE ch.contract_id = contracts.id AND ch.kind = 'periodo' AND ch.status = 'gerado')").all() as any[];
  if (!start.length && !expired.length && !openEnded.length) return;
  transaction(db, () => {
    for (const c of start) setStatus(db, c, 'ativo', null, 'Início da vigência: contrato ativo.');
    for (const c of expired) setStatus(db, c, 'vencido', null, `Prazo contratual encerrado em ${c.end_date.split('-').reverse().join('/')} sem prorrogação registrada.`);
    for (const c of openEnded) generateChargesTx(db, null, loadRaw(db, c.id)); // prazo indeterminado: mantém o horizonte de cobranças
  });
}

// ------------------------------------------------ detalhe

export function getContractDetail(db: DB, user: AuthUser, id: number): ContractDetail {
  const c = loadContract(db, user, id);
  const raw = loadRaw(db, id);
  const charges = listCharges(db, id);
  const preview = scheduleFor(db, raw);
  const { actions, blockers } = availableActions(db, raw, user);
  const finance = contractCan.viewFinance(user);
  return maskValues(
    {
      ...c,
      charges: finance ? charges : [],
      schedule_preview: finance ? preview : [],
      financial: finance ? financialSummary(raw, charges, preview) : null,
      operations: listOperations(db, id),
      amendments: db.prepare('SELECT a.*, u.name AS created_by_name FROM contract_amendments a LEFT JOIN users u ON u.id = a.created_by WHERE a.contract_id = ? ORDER BY a.number DESC').all(id) as any[],
      terms: db.prepare('SELECT t.*, u.name AS created_by_name FROM contract_terms t LEFT JOIN users u ON u.id = t.created_by WHERE t.contract_id = ? ORDER BY t.id DESC').all(id) as any[],
      documents: listDocuments(db, id),
      events: db.prepare('SELECT e.*, u.name AS performed_by_name FROM contract_events e LEFT JOIN users u ON u.id = e.performed_by WHERE e.contract_id = ? ORDER BY e.id DESC').all(id) as any[],
      reservations: db
        .prepare(
          `SELECT r.id, r.number, r.contract_item_id, i.internal_code AS item_code, a.asset_tag, r.quantity, r.start_date, r.end_date, r.status
           FROM stock_reservations r JOIN catalog_items i ON i.id = r.item_id LEFT JOIN stock_assets a ON a.id = r.asset_id WHERE r.contract_id = ? ORDER BY r.id`
        )
        .all(id) as any[],
      actions,
      blockers,
    },
    user
  );
}

export function contractExists(db: DB, id: number) {
  if (!db.prepare('SELECT 1 FROM contracts WHERE id = ?').get(id)) throw notFound('Contrato não encontrado.');
}
