/**
 * Inspeção dos equipamentos devolvidos e controle de ocorrências (avarias, perdas, faltas).
 *
 * - A inspeção é separada da entrada física: o item volta retido e só é liberado aqui (ou na OS).
 * - Individual: aprovado → inspeção aprovada no Estoque (respeita OS impeditiva); avaria/bloqueado → danificado;
 *   manutenção → abre OS impeditiva; incompleto → segue aguardando inspeção.
 * - Por quantidade: aprovado → sai do indisponível; demais seguem indisponíveis.
 * - Ocorrência nunca vira cobrança sozinha: precisa de análise, responsabilidade "cliente", valor aprovado por
 *   gestor e envio explícito ao Financeiro (cobrança extraordinária do contrato).
 */

import { DB, audit, transaction } from '../../db';
import { HttpError, badRequest, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { INSPECTION_CHECKLIST, OperationalStatus } from '../../../shared/estoque/types';
import { OPERATIONAL_TRANSITIONS, round3 } from '../../../shared/estoque/rules';
import { addDaysISO, todayISO } from '../../../shared/orcamentos/dates';
import { InspectionResult, Occurrence, OccurrenceStatus, OCCURRENCE_STATUS_LABELS } from '../../../shared/logistica/types';
import { OCCURRENCE_TRANSITIONS, logCan } from '../../../shared/logistica/rules';
import { contractCan } from '../../../shared/contratos/rules';
import { applyMovement, assetEvent, refreshAssetRental } from '../stock/core';
import { inspectAssetTx } from '../stock/rental';
import { extraChargeTx } from '../contracts/billing';
import { autoCloseIfReturnedTx } from '../contracts/closing';
import { NOW_SQL, OCC_SELECT, loadOrder, loadOrderItems, logEvent, setOpStatus, text } from './core';
import { createOccurrenceTx } from './flow';

const RESULTS: InspectionResult[] = ['aprovado', 'aguardando_inspecao', 'avaria', 'incompleto', 'manutencao', 'bloqueado'];

export function inspectItem(db: DB, user: AuthUser, orderId: number, raw: any) {
  if (!logCan.inspect(user)) throw forbidden();
  const result = raw?.result as InspectionResult;
  if (!RESULTS.includes(result)) throw badRequest('Selecione o resultado da inspeção.', { result: 'Obrigatório.' });
  const notes = text(raw?.notes, 2000);
  const checklist: Record<string, boolean> = {};
  for (const c of INSPECTION_CHECKLIST) checklist[c.key] = !!raw?.checklist?.[c.key];
  if (result === 'aprovado' && INSPECTION_CHECKLIST.some((c) => !checklist[c.key])) throw badRequest('Para aprovar, todos os itens do checklist devem estar conferidos.');
  if (['avaria', 'incompleto', 'manutencao', 'bloqueado'].includes(result) && !notes) throw badRequest('Descreva o problema encontrado.', { notes: 'Obrigatório.' });
  return transaction(db, () => {
    const o = loadOrder(db, orderId);
    if (o.op_type === 'entrega') throw new HttpError(422, 'Inspeção de devolução só em retiradas/devoluções.');
    if (!['recebida', 'recebida_parcialmente', 'aguardando_inspecao', 'em_conferencia'].includes(o.status)) throw new HttpError(422, 'Receba os equipamentos antes de inspecionar.');
    const it = loadOrderItems(db, orderId).find((i) => i.id === Number(raw?.order_item_id));
    if (!it) throw badRequest('Item não pertence à operação.');
    const pending = round3(it.quantity_processed - it.quantity_inspected);
    const qty = it.tracking === 'individual' ? 1 : round3(Number(raw?.quantity));
    if (!(qty > 0) || qty > pending + 1e-9) throw new HttpError(422, `${it.asset_tag || it.item_code}: há ${pending} aguardando inspeção.`);
    let workOrderId: number | null = null;
    const damage = !!raw?.damage_detected || ['avaria', 'bloqueado', 'manutencao', 'incompleto'].includes(result);
    if (it.tracking === 'individual') {
      const a = db.prepare('SELECT asset_tag, operational_status FROM stock_assets WHERE id = ?').get(it.asset_id) as any;
      if (result !== 'aguardando_inspecao' && a.operational_status !== 'aguardando_inspecao') throw new HttpError(422, `${a.asset_tag} não está aguardando inspeção (situação atual no Estoque).`);
      if (result === 'aprovado') inspectAssetTx(db, user, it.asset_id, { result: 'aprovado', checklist, notes: `Inspeção da ${o.number}${notes ? `: ${notes}` : ''}` });
      else if (result === 'avaria' || result === 'bloqueado') inspectAssetTx(db, user, it.asset_id, { result: 'danificado', checklist, notes: `${result === 'bloqueado' ? 'Bloqueado para locação' : 'Avaria'} na devolução ${o.number}: ${notes}` });
      else if (result === 'manutencao') inspectAssetTx(db, user, it.asset_id, { result: 'manutencao', checklist, notes: `Manutenção após a devolução ${o.number}: ${notes}` });
    } else if (result === 'aprovado') {
      const loc = o.return_location_id || (db.prepare('SELECT default_location_id FROM catalog_items WHERE id = ?').get(it.item_id) as any)?.default_location_id;
      if (!loc) throw new HttpError(422, 'Local de retorno não definido para liberar a quantidade.');
      applyMovement(db, user, {
        type: 'retorno_manutencao', item_id: it.item_id, quantity: qty, location_id: loc, qty_delta: 0, unavailable_delta: -qty, origin_location_id: loc,
        reference_doc: o.number, reason: `Liberado na inspeção da ${o.number}`, document_type: 'logistica', document_id: o.id,
      });
    }
    const counts = result !== 'aguardando_inspecao';
    const insId = (
      db.prepare('INSERT INTO logistics_inspections (order_item_id, asset_id, quantity, result, checklist, condition, damage_detected, notes, work_order_id, inspected_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id').get(
        it.id, it.asset_id, qty, result, JSON.stringify(checklist), text(raw?.condition, 40), damage ? 1 : 0, notes, workOrderId, user.id
      ) as { id: number }
    ).id;
    if (counts) db.prepare('UPDATE logistics_order_items SET quantity_inspected = quantity_inspected + ?, condition_after = COALESCE(?, condition_after) WHERE id = ?').run(qty, text(raw?.condition, 40), it.id);
    // avaria/falta vira ocorrência para análise — responsabilidade a apurar, sem cobrança automática
    if (damage && result !== 'aprovado') {
      const type = result === 'incompleto' ? 'incompleto' : 'avaria';
      createOccurrenceTx(db, user, {
        order_id: o.id, order_item_id: it.id, contract_id: o.contract_id, asset_id: it.asset_id, item_id: it.item_id, occurrence_type: type,
        description: `${it.asset_tag || `${it.item_code} × ${qty}`}: ${notes}`, estimated_cost: raw?.estimated_cost ? Number(raw.estimated_cost) : null,
        status: result === 'manutencao' ? 'encaminhada_manutencao' : 'registrada', work_order_id: workOrderId,
      });
    }
    const label = { aprovado: 'aprovado e liberado', aguardando_inspecao: 'mantido aguardando inspeção', avaria: 'com avaria (bloqueado)', incompleto: 'incompleto (aguardando inspeção)', manutencao: 'encaminhado para manutenção', bloqueado: 'bloqueado para nova locação' }[result];
    logEvent(db, { order_id: o.id }, 'inspecao', `Inspeção: ${it.asset_tag || `${it.item_code} × ${qty}`} ${label}.`, user);
    // status da operação conforme o andamento da conferência
    const after = loadOrderItems(db, orderId);
    const allDone = after.every((i) => i.quantity_processed - i.quantity_inspected <= 1e-9);
    const fresh = loadOrder(db, orderId);
    if (allDone && fresh.status !== 'concluida') setOpStatus(db, fresh, 'concluida', user, 'Todos os itens recebidos foram inspecionados.');
    else if (!allDone && !counts && fresh.status !== 'aguardando_inspecao') setOpStatus(db, fresh, 'aguardando_inspecao', user, 'Inspeção adiada para parte dos itens.');
    else if (!allDone && counts && fresh.status !== 'em_conferencia') setOpStatus(db, fresh, 'em_conferencia', user, 'Conferência em andamento.');
    audit(db, 'logistics_inspection', insId, result, user.id);
    autoCloseIfReturnedTx(db, user, o.contract_id);
    return { id: insId, work_order_id: workOrderId };
  });
}

// ------------------------------------------------ ocorrências

export function createOccurrence(db: DB, user: AuthUser, raw: any) {
  if (!logCan.occurrence(user)) throw forbidden();
  const description = text(raw?.description, 2000);
  if (!description) throw badRequest('Descreva a ocorrência.', { description: 'Obrigatório.' });
  const type = raw?.occurrence_type;
  if (!['avaria', 'perda', 'acessorio_faltante', 'incompleto', 'divergencia', 'transporte', 'outro'].includes(type)) throw badRequest('Tipo inválido.', { occurrence_type: 'Obrigatório.' });
  return transaction(db, () => {
    let contractId = Number(raw?.contract_id);
    const orderId = raw?.order_id ? Number(raw.order_id) : null;
    if (orderId) contractId = loadOrder(db, orderId).contract_id;
    if (!db.prepare('SELECT 1 FROM contracts WHERE id = ?').get(contractId)) throw badRequest('Contrato inválido.', { contract_id: 'Obrigatório.' });
    const assetId = raw?.asset_id ? Number(raw.asset_id) : null;
    const est = raw?.estimated_cost === undefined || raw?.estimated_cost === null || raw?.estimated_cost === '' ? null : Number(raw.estimated_cost);
    if (est !== null && (!Number.isInteger(est) || est < 0)) throw badRequest('Estimativa inválida.');
    return { id: createOccurrenceTx(db, user, { order_id: orderId, contract_id: contractId, asset_id: assetId, occurrence_type: type, description, estimated_cost: est }) };
  });
}

function loadOcc(db: DB, id: number) {
  const o = db.prepare('SELECT * FROM logistics_occurrences WHERE id = ?').get(id) as any;
  if (!o) throw notFound('Ocorrência não encontrada.');
  return o;
}

export function occurrenceAction(db: DB, user: AuthUser, id: number, action: string, raw: any) {
  const out = transaction(db, () => {
    const oc = loadOcc(db, id);
    const notes = text(raw?.notes, 2000);
    const move = (to: OccurrenceStatus, extraSql = '', params: (string | number | null)[] = []) => {
      if (!OCCURRENCE_TRANSITIONS[oc.status as OccurrenceStatus].includes(to)) throw new HttpError(422, `Não é possível passar de "${OCCURRENCE_STATUS_LABELS[oc.status as OccurrenceStatus]}" para "${OCCURRENCE_STATUS_LABELS[to]}".`);
      db.prepare(`UPDATE logistics_occurrences SET status = ?, ${extraSql ? `${extraSql},` : ''} updated_at = ${NOW_SQL} WHERE id = ? AND status = ?`).run(to, ...params, id, oc.status);
      logEvent(db, { order_id: oc.order_id, occurrence_id: id }, 'ocorrencia', `${oc.number}: ${OCCURRENCE_STATUS_LABELS[to]}${notes ? ` — ${notes}` : ''}`, user, oc.status, to);
    };
    switch (action) {
      case 'analisar': {
        // análise: responsabilidade apurada, estimativa e próximo passo
        if (!logCan.occurrence(user)) throw forbidden();
        const to = (raw?.status || 'em_analise') as OccurrenceStatus;
        if (!['em_analise', 'aguardando_orcamento', 'aguardando_aprovacao', 'nao_cobravel', 'resolvida'].includes(to)) throw badRequest('Próximo status inválido.');
        if ((to === 'nao_cobravel' || to === 'resolvida') && !notes) throw badRequest('Registre a conclusão da análise.', { notes: 'Obrigatório.' });
        const resp = ['indefinida', 'cliente', 'empresa', 'terceiro'].includes(raw?.responsibility) ? raw.responsibility : oc.responsibility;
        if (to === 'aguardando_aprovacao' && resp !== 'cliente') throw badRequest('Só ocorrências de responsabilidade do cliente seguem para aprovação de cobrança.', { responsibility: 'Defina a responsabilidade.' });
        const est = raw?.estimated_cost === undefined || raw?.estimated_cost === '' || raw?.estimated_cost === null ? oc.estimated_cost : Number(raw.estimated_cost);
        if (est !== null && (!Number.isInteger(est) || est < 0)) throw badRequest('Estimativa inválida.');
        if (to === oc.status) {
          db.prepare(`UPDATE logistics_occurrences SET responsibility = ?, estimated_cost = ?, analysis_notes = COALESCE(?, analysis_notes), updated_at = ${NOW_SQL} WHERE id = ?`).run(resp, est, notes, id);
          logEvent(db, { order_id: oc.order_id, occurrence_id: id }, 'ocorrencia', `${oc.number}: análise atualizada${notes ? ` — ${notes}` : ''}`, user);
        } else move(to, `responsibility = ?, estimated_cost = ?, ${to === 'nao_cobravel' || to === 'resolvida' ? 'resolution_notes' : 'analysis_notes'} = COALESCE(?, ${to === 'nao_cobravel' || to === 'resolvida' ? 'resolution_notes' : 'analysis_notes'})`, [resp, est, notes]);
        return {};
      }
      case 'aprovar_cobranca': {
        if (!logCan.approve(user)) throw forbidden('Aprovação de cobrança exige gestor ou administrador.');
        if (oc.responsibility !== 'cliente') throw new HttpError(422, 'Defina a responsabilidade do cliente antes de aprovar a cobrança.');
        const cost = Number(raw?.approved_cost ?? oc.estimated_cost);
        if (!Number.isInteger(cost) || cost <= 0) throw badRequest('Informe o valor aprovado.', { approved_cost: 'Obrigatório.' });
        move('aprovada_cobranca', `approved_cost = ?, approved_by = ?, approved_at = ${NOW_SQL}`, [cost, user.id]);
        return {};
      }
      case 'reprovar_cobranca':
        if (!logCan.approve(user)) throw forbidden();
        if (!notes) throw badRequest('Justifique.', { notes: 'Obrigatório.' });
        move('nao_cobravel', 'resolution_notes = ?', [notes]);
        return {};
      case 'enviar_financeiro': {
        // cobrança pelo fluxo oficial: cobrança extraordinária do contrato → conta a receber (idempotente por ocorrência)
        if (!contractCan.charges(user)) throw forbidden();
        if (oc.status !== 'aprovada_cobranca') throw new HttpError(422, 'Só ocorrências aprovadas para cobrança vão ao Financeiro.');
        if (oc.contract_charge_id) return { charge_id: oc.contract_charge_id, already: true };
        const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(oc.contract_id) as any;
        const chargeId = extraChargeTx(db, user, c, {
          description: `Ocorrência ${oc.number} — ${oc.description}`.slice(0, 160), amount: oc.approved_cost, due_date: raw?.due_date || addDaysISO(todayISO(), 10),
          reason: `Ocorrência ${oc.number} aprovada para cobrança${oc.analysis_notes ? `: ${oc.analysis_notes}` : ''}`, idempotency_key: `occ:${oc.id}`,
        });
        db.prepare(`UPDATE logistics_occurrences SET contract_charge_id = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(chargeId, id);
        logEvent(db, { order_id: oc.order_id, occurrence_id: id }, 'financeiro', `${oc.number}: cobrança enviada ao Financeiro pelo contrato.`, user);
        return { charge_id: chargeId };
      }
      case 'encaminhar_manutencao': {
        if (!logCan.occurrence(user)) throw forbidden();
        if (!oc.asset_id) throw new HttpError(422, 'Ocorrência sem equipamento individual: a manutenção de itens por quantidade fica no Estoque (indisponível).');
        const a = db.prepare('SELECT asset_tag, operational_status, rental_status FROM stock_assets WHERE id = ?').get(oc.asset_id) as { asset_tag: string; operational_status: string; rental_status: string };
        if (a.rental_status === 'alugado') throw new HttpError(422, `${a.asset_tag} ainda está com o cliente.`);
        if (a.operational_status !== 'em_manutencao') {
          if (!OPERATIONAL_TRANSITIONS.enviar_manutencao.from.includes(a.operational_status as OperationalStatus)) throw new HttpError(422, `${a.asset_tag} não pode ir para manutenção na situação atual.`);
          db.prepare(`UPDATE stock_assets SET operational_status = 'em_manutencao', updated_at = ${NOW_SQL} WHERE id = ?`).run(oc.asset_id);
          assetEvent(db, oc.asset_id, 'manutencao', `Enviado para manutenção pela ocorrência ${oc.number}: ${oc.description}.`, user, { from: a.operational_status, to: 'em_manutencao' });
          refreshAssetRental(db, oc.asset_id);
        }
        move('encaminhada_manutencao');
        return {};
      }
      case 'resolver':
        if (!logCan.occurrence(user)) throw forbidden();
        if (!notes) throw badRequest('Descreva a resolução.', { notes: 'Obrigatório.' });
        move('resolvida', 'resolution_notes = ?', [notes]);
        return {};
      default:
        throw badRequest('Ação inválida.');
    }
  });
  audit(db, 'logistics_occurrence', id, action, user.id);
  return out;
}

export function listOccurrences(db: DB, user: AuthUser, f: Record<string, string | undefined>): Occurrence[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.status === 'abertas') where.push("oc.status NOT IN ('resolvida','nao_cobravel')");
  else if (f.status) {
    where.push('oc.status = ?');
    params.push(f.status);
  }
  if (f.contract_id) {
    where.push('oc.contract_id = ?');
    params.push(Number(f.contract_id));
  }
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    where.push("(oc.number LIKE ? OR oc.description LIKE ? OR c.contract_number LIKE ? OR json_extract(c.customer_snapshot, '$.name') LIKE ? OR a.asset_tag LIKE ?)");
    params.push(q, q, q, q, q);
  }
  const costs = logCan.viewCosts(user);
  return (db.prepare(`${OCC_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY oc.id DESC LIMIT 300`).all(...params) as any[]).map((x) => (costs ? x : { ...x, estimated_cost: null, approved_cost: null }));
}
