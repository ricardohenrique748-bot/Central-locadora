/**
 * Fluxo das operações logísticas.
 *
 * Entrega: programada → em separação → pronta → em transporte → entregue / entregue parcialmente.
 *   A saída física acontece SOMENTE na confirmação da entrega (deliverTx do módulo de Contratos),
 *   na mesma transação que muda o status. Se o Estoque recusar, nada é gravado.
 * Retirada/devolução: programada → em andamento → recebida (parcial) → conferência → concluída.
 *   O recebimento dá a entrada física (returnItemsTx) com os itens RETIDOS para inspeção:
 *   entrada física ≠ liberação para nova locação.
 * Idempotência: a confirmação usa a chave LOG:<operação>; repetir não duplica a movimentação.
 */

import { DB, audit, transaction } from '../../db';
import { HttpError, badRequest, forbidden } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { round3 } from '../../../shared/estoque/rules';
import { EXIT_CHECKLIST, OP_STATUS_LABELS, OpStatus } from '../../../shared/logistica/types';
import { PHYSICALLY_DONE, logCan, transitionsFor } from '../../../shared/logistica/rules';
import { addDaysISO, todayISO } from '../../../shared/orcamentos/dates';
import { deliverTx, returnItemsTx } from '../contracts/operations';
import { insertEntry, normalizeEntry } from '../finance/entries';
import { NOW_SQL, deliveryBlockers, isoOrNull, loadOrder, loadOrderItems, logEvent, setOpStatus, text } from './core';
import { loadItems } from '../contracts/core';
import { nextNumber } from '../stock/core';

export function availableActions(db: DB, o: any, user: AuthUser) {
  const a: string[] = [];
  const blockers: Record<string, string> = {};
  const st = o.status as OpStatus;
  const can = (x: boolean, ...acts: string[]) => x && a.push(...acts);
  if (o.op_type === 'entrega') {
    can(st === 'rascunho' && logCan.create(user), 'editar', 'programar');
    can(st === 'programada' && logCan.create(user), 'editar');
    can(st === 'programada' && logCan.separate(user), 'iniciar_separacao');
    can(st === 'em_separacao' && logCan.separate(user), 'concluir_separacao', 'voltar_programada');
    can(st === 'em_separacao' && logCan.approve(user), 'ajustar');
    can(st === 'pronta' && logCan.confirm(user), o.transport_type === 'cliente' ? 'confirmar_entrega' : 'sair', 'voltar_separacao');
    can(st === 'em_transporte' && logCan.confirm(user), 'confirmar_entrega', 'retornar_sem_entrega');
  } else {
    can(st === 'rascunho' && logCan.create(user), 'editar', 'programar');
    can(st === 'programada' && logCan.create(user), 'editar');
    can(st === 'programada' && o.op_type === 'retirada' && logCan.confirm(user), 'iniciar');
    can(['programada', 'em_andamento'].includes(st) && logCan.confirm(user), 'receber');
    can(['recebida', 'recebida_parcialmente', 'aguardando_inspecao', 'em_conferencia'].includes(st) && logCan.inspect(user), 'inspecionar');
    if (['recebida', 'recebida_parcialmente', 'aguardando_inspecao', 'em_conferencia'].includes(st) && logCan.inspect(user)) {
      a.push('concluir');
      const pend = loadOrderItems(db, o.id).filter((i) => i.quantity_processed - i.quantity_inspected > 1e-9);
      if (pend.length) blockers.concluir = `Itens recebidos ainda sem inspeção: ${pend.map((i) => i.asset_tag || i.item_code).join(', ')}.`;
    }
  }
  if (!PHYSICALLY_DONE.includes(st) && st !== 'cancelada' && logCan.cancel(user)) a.push('cancelar');
  if (st !== 'cancelada' && logCan.confirm(user)) a.push('transporte');
  if (o.transport_type === 'terceiro' && o.transport_cost_actual > 0 && !o.transport_entry_id && logCan.forwardFinance(user)) a.push('frete_financeiro');
  return { actions: a, blockers };
}

function assertTransition(o: any, to: OpStatus) {
  if (!transitionsFor(o.op_type)[o.status]?.includes(to)) throw new HttpError(422, `Não é possível passar de "${OP_STATUS_LABELS[o.status as OpStatus]}" para "${OP_STATUS_LABELS[to]}".`);
}

export function opAction(db: DB, user: AuthUser, id: number, action: string, raw: any) {
  const out = transaction(db, () => {
    const o = loadOrder(db, id);
    if (raw?.row_version !== undefined && Number(raw.row_version) !== o.row_version && action !== 'confirmar_entrega' && action !== 'receber') throw new HttpError(409, 'A operação foi alterada por outra pessoa. Atualize a tela.');
    const { actions, blockers } = availableActions(db, o, user);
    if (!actions.includes(action)) {
      const perms: Record<string, (u: AuthUser) => boolean> = { cancelar: logCan.cancel, ajustar: logCan.approve, confirmar_entrega: logCan.confirm, receber: logCan.confirm, iniciar_separacao: logCan.separate, concluir_separacao: logCan.separate, frete_financeiro: logCan.forwardFinance };
      if (perms[action] && !perms[action](user)) throw forbidden();
      // repetição da confirmação já processada: devolve o resultado sem refazer
      if ((action === 'confirmar_entrega' || action === 'receber') && o.contract_operation_id) return { already: true };
      throw new HttpError(422, `Ação indisponível para a operação "${OP_STATUS_LABELS[o.status as OpStatus]}".`);
    }
    if (blockers[action]) throw new HttpError(422, blockers[action]);
    const reason = text(raw?.reason, 1000);
    const items = loadOrderItems(db, id);
    switch (action) {
      case 'programar':
        setOpStatus(db, o, 'programada', user, 'Operação programada.');
        return {};
      case 'iniciar_separacao':
        assertTransition(o, 'em_separacao');
        setOpStatus(db, o, 'em_separacao', user, 'Separação iniciada.');
        return {};
      case 'voltar_programada':
        setOpStatus(db, o, 'programada', user, `Separação interrompida${reason ? `: ${reason}` : ''}.`);
        return {};
      case 'ajustar': {
        // item faltante/danificado/indisponível: reduz o programado com autorização e justificativa
        if (!reason) throw badRequest('Informe a justificativa do ajuste.', { reason: 'Obrigatório.' });
        const changes: { id: number; quantity_planned: number }[] = Array.isArray(raw?.items) ? raw.items : [];
        let n = 0;
        for (const ch of changes) {
          const it = items.find((i) => i.id === Number(ch.id));
          if (!it) throw badRequest('Item não pertence à operação.');
          const q = round3(Number(ch.quantity_planned));
          if (!(q >= 0 && q <= it.quantity_original + 1e-9)) throw badRequest(`${it.item_code}: quantidade inválida.`);
          if (it.tracking === 'individual' && q !== 0 && q !== 1) throw badRequest('Equipamento individual: 0 ou 1.');
          if (q === it.quantity_planned) continue;
          db.prepare('UPDATE logistics_order_items SET quantity_planned = ?, quantity_separated = MIN(quantity_separated, ?), adjust_reason = ? WHERE id = ?').run(q, q, reason, it.id);
          n++;
        }
        if (!n) throw badRequest('Nenhuma quantidade alterada.');
        if (!db.prepare('SELECT 1 FROM logistics_order_items WHERE order_id = ? AND quantity_planned > 0').get(id)) throw badRequest('A operação ficaria sem itens: cancele a operação.');
        logEvent(db, { order_id: id }, 'ajuste', `Operação ajustada por ${user.name} (${n} item(ns)): ${reason}`, user);
        return {};
      }
      case 'concluir_separacao': {
        const checklist: Record<string, boolean> = {};
        for (const k of EXIT_CHECKLIST) checklist[k.key] = !!raw?.checklist?.[k.key];
        const missing = EXIT_CHECKLIST.filter((k) => k.required && !checklist[k.key]);
        if (missing.length) throw badRequest(`Checklist de saída incompleto: ${missing.map((k) => k.label).join('; ')}.`);
        const sep: { id: number; quantity: number; condition?: string; notes?: string }[] = Array.isArray(raw?.items) ? raw.items : [];
        const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(o.contract_id) as any;
        const contractItems = new Map(loadItems(db, o.contract_id).map((ci) => [ci.id, ci]));
        for (const it of items.filter((i) => i.quantity_planned > 0)) {
          const s = sep.find((x) => Number(x.id) === it.id);
          const q = s ? round3(Number(s.quantity)) : 0;
          if (Math.abs(q - it.quantity_planned) > 1e-9)
            throw badRequest(`${it.asset_tag || it.item_code}: conferido ${q} de ${it.quantity_planned}. Itens faltantes, danificados ou indisponíveis exigem ajuste autorizado da operação.`);
          const b = deliveryBlockers(db, c, contractItems.get(it.contract_item_id), q);
          if (b) throw new HttpError(422, `Equipamento indisponível: ${b} Ajuste a operação.`);
          db.prepare('UPDATE logistics_order_items SET quantity_separated = ?, condition_before = ?, notes = COALESCE(?, notes) WHERE id = ?').run(q, text(s?.condition, 40), text(s?.notes, 500), it.id);
        }
        setOpStatus(db, o, 'pronta', user, 'Separação concluída e conferida: pronta para saída.', `separated_by = ?, separated_at = ${NOW_SQL}, separation_checklist = ?, accessories = ?`, [user.id, JSON.stringify(checklist), text(raw?.accessories, 1000)]);
        return {};
      }
      case 'voltar_separacao':
        setOpStatus(db, o, 'em_separacao', user, `Retornou para separação${reason ? `: ${reason}` : ''}.`);
        return {};
      case 'sair':
        setOpStatus(db, o, 'em_transporte', user, 'Saída para entrega.', 'departed_at = ?, driver_id = COALESCE(?, driver_id), vehicle_id = COALESCE(?, vehicle_id)', [isoOrNull(raw?.departed_at) || new Date().toISOString(), raw?.driver_id ? Number(raw.driver_id) : null, raw?.vehicle_id ? Number(raw.vehicle_id) : null]);
        return {};
      case 'retornar_sem_entrega':
        if (!reason) throw badRequest('Informe a ocorrência.', { reason: 'Obrigatório.' });
        setOpStatus(db, o, 'pronta', user, `Voltou sem entregar: ${reason}`, 'transport_notes = COALESCE(transport_notes || char(10), \'\') || ?', [reason]);
        return {};
      case 'confirmar_entrega': {
        const receiver = text(raw?.receiver_name, 120);
        if (!receiver) throw badRequest('Informe quem recebeu os equipamentos.', { receiver_name: 'Obrigatório.' });
        const deliveredAt = isoOrNull(raw?.delivered_at) || new Date().toISOString();
        const lines = items.filter((i) => i.quantity_separated > 0).map((i) => ({ contract_item_id: i.contract_item_id, quantity: i.quantity_separated, condition: i.condition_before }));
        if (!lines.length) throw badRequest('Nenhum item separado para entregar.');
        const chk = JSON.parse(o.separation_checklist || '{}');
        // saída física no Estoque pelo módulo de Contratos (revalida equipamento e saldo; falha desfaz tudo)
        const r = deliverTx(db, user, o.contract_id, {
          idempotency_key: `LOG:${o.id}`, performed_at: deliveredAt.slice(0, 16), counterpart_name: receiver, counterpart_document: text(raw?.receiver_document, 30), accessories: o.accessories,
          checklist: { conferido: !!chk.conferido, funcionando: !!chk.funcionando, acessorios: !!chk.acessorios, orientacao: !!raw?.orientation_given },
          notes: [o.number, text(raw?.notes, 1000)].filter(Boolean).join(' — '), lines,
        });
        for (const i of items) db.prepare('UPDATE logistics_order_items SET quantity_processed = quantity_separated WHERE id = ?').run(i.id);
        const partial = items.some((i) => i.quantity_separated + 1e-9 < i.quantity_original);
        setOpStatus(db, o, partial ? 'entregue_parcialmente' : 'entregue', user, partial ? `Entregue parcialmente a ${receiver}. O restante do contrato continua pendente de entrega.` : `Entregue a ${receiver}.`,
          `completed_at = ?, arrived_at = COALESCE(arrived_at, ?), receiver_name = ?, receiver_document = ?, contract_operation_id = ?`, [deliveredAt, deliveredAt, receiver, text(raw?.receiver_document, 30), r.operation_id]);
        return { operation_id: r.operation_id };
      }
      case 'iniciar':
        setOpStatus(db, o, 'em_andamento', user, 'Saída para retirada no cliente.', 'departed_at = ?', [isoOrNull(raw?.departed_at) || new Date().toISOString()]);
        return {};
      case 'receber': {
        const recv: { id: number; quantity: number; missing?: number; condition?: string; notes?: string }[] = Array.isArray(raw?.items) ? raw.items : [];
        const lines: any[] = [];
        let total = 0;
        let missingTotal = 0;
        for (const it of items.filter((i) => i.quantity_planned > 0)) {
          const r = recv.find((x) => Number(x.id) === it.id);
          const q = round3(Number(r?.quantity || 0));
          const miss = round3(Number(r?.missing || 0));
          if (q < 0 || miss < 0 || q + miss > it.quantity_planned + 1e-9) throw badRequest(`${it.asset_tag || it.item_code}: recebido + faltante não pode passar de ${it.quantity_planned}.`);
          if (it.tracking === 'individual' && miss > 0) throw badRequest(`${it.asset_tag}: equipamento individual não devolvido fica com o cliente (não registre como faltante); registre uma ocorrência de perda se for o caso.`);
          if (q + miss <= 0) continue;
          lines.push(it.tracking === 'individual' ? { contract_item_id: it.contract_item_id, returned: true, classification: 'aguardando_inspecao', condition: text(r?.condition, 40), notes: text(r?.notes, 500) } : { contract_item_id: it.contract_item_id, held_qty: q, missing_qty: miss, condition: text(r?.condition, 40), notes: text(r?.notes, 500) });
          db.prepare('UPDATE logistics_order_items SET quantity_processed = ?, quantity_missing = ?, condition_after = ?, notes = COALESCE(?, notes) WHERE id = ?').run(q, miss, text(r?.condition, 40), text(r?.notes, 500), it.id);
          total += q;
          missingTotal += miss;
        }
        if (!lines.length) throw badRequest('Informe os itens recebidos.');
        const loc = raw?.location_id ? Number(raw.location_id) : o.return_location_id;
        const res = returnItemsTx(db, user, o.contract_id, {
          idempotency_key: `LOG:${o.id}`, performed_at: (isoOrNull(raw?.received_at) || new Date().toISOString()).slice(0, 16), counterpart_name: text(raw?.counterpart_name, 120),
          notes: [o.number, text(raw?.notes, 1000)].filter(Boolean).join(' — '), location_id: loc, lines,
        });
        // faltantes viram ocorrência para análise (nunca cobrança automática)
        if (missingTotal > 0) {
          for (const it of loadOrderItems(db, id).filter((i) => i.quantity_missing > 0))
            createOccurrenceTx(db, user, { order_id: id, order_item_id: it.id, contract_id: o.contract_id, item_id: it.item_id, occurrence_type: 'divergencia', description: `${it.item_code}: ${it.quantity_missing} ${it.unit} não devolvido(s) na ${o.number}.` });
        }
        const partial = loadOrderItems(db, id).some((i) => i.quantity_processed + 1e-9 < i.quantity_original);
        setOpStatus(db, o, partial ? 'recebida_parcialmente' : 'recebida', user, `${partial ? 'Recebida parcialmente' : 'Recebida'}: ${total} unidade(s) retornaram e aguardam inspeção${missingTotal ? `; ${missingTotal} não devolvida(s) (ocorrência registrada)` : ''}.`,
          `completed_at = ?, receiver_name = ?, return_location_id = COALESCE(?, return_location_id), contract_operation_id = ?`, [isoOrNull(raw?.received_at) || new Date().toISOString(), user.name, loc ?? null, res.operation_id]);
        return { operation_id: res.operation_id };
      }
      case 'concluir':
        setOpStatus(db, o, 'concluida', user, 'Conferência concluída.');
        return {};
      case 'cancelar':
        if (!reason) throw badRequest('Informe a justificativa do cancelamento.', { reason: 'Obrigatório.' });
        setOpStatus(db, o, 'cancelada', user, `Operação cancelada: ${reason}. Nenhuma movimentação física havia sido feita.`, `cancel_reason = ?, cancelled_at = ${NOW_SQL}`, [reason]);
        return {};
      case 'transporte': {
        const cost = raw?.transport_cost_actual === '' || raw?.transport_cost_actual === null || raw?.transport_cost_actual === undefined ? null : Number(raw.transport_cost_actual);
        if (cost !== null && (!Number.isInteger(cost) || cost < 0)) throw badRequest('Custo realizado inválido.');
        if (o.transport_entry_id && cost !== o.transport_cost_actual) throw new HttpError(422, 'O frete já foi enviado ao Financeiro: ajuste por lá.');
        db.prepare(`UPDATE logistics_orders SET departed_at = COALESCE(?, departed_at), arrived_at = COALESCE(?, arrived_at), transport_notes = COALESCE(?, transport_notes), transport_cost_actual = COALESCE(?, transport_cost_actual), carrier_supplier_id = COALESCE(?, carrier_supplier_id), updated_at = ${NOW_SQL} WHERE id = ?`).run(
          isoOrNull(raw?.departed_at), isoOrNull(raw?.arrived_at), text(raw?.transport_notes, 2000), cost, raw?.carrier_supplier_id ? Number(raw.carrier_supplier_id) : null, id
        );
        logEvent(db, { order_id: id }, 'transporte', `Dados de transporte atualizados${cost !== null ? ` (custo realizado ${(cost / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})` : ''}.`, user);
        return {};
      }
      case 'frete_financeiro': {
        // custo de transportadora vira UMA conta a pagar (origem logistica:<id>)
        const dup = db.prepare("SELECT id, entry_number FROM financial_entries WHERE source_type = 'logistica' AND source_id = ?").get(String(id)) as any;
        if (dup) return { entry_id: dup.id, already: true };
        if (!o.carrier_supplier_id) throw badRequest('Informe a transportadora (fornecedor) nos dados de transporte.');
        const cat = db.prepare("SELECT id FROM financial_categories WHERE name = 'Frete e transporte' AND category_type = 'despesa' AND active = 1").get() as { id: number } | undefined;
        if (!cat) throw new HttpError(422, 'Categoria financeira "Frete e transporte" não encontrada.');
        const e = normalizeEntry(db, {
          description: `Frete ${o.number}`, party_type: 'fornecedor', supplier_id: o.carrier_supplier_id, category_id: cat.id, issue_date: todayISO(), competence_date: (o.completed_at || o.scheduled_at).slice(0, 10),
          original_amount: o.transport_cost_actual, plan: { total: o.transport_cost_actual, count: 1, first_due: raw?.due_date || addDaysISO(todayISO(), 30) }, source_type: 'logistica', source_id: String(id), source_ref: o.number,
        }, 'pagar');
        const entryId = insertEntry(db, user, e);
        db.prepare('UPDATE logistics_orders SET transport_entry_id = ? WHERE id = ?').run(entryId, id);
        logEvent(db, { order_id: id }, 'financeiro', 'Custo de transporte encaminhado ao Financeiro (conta a pagar).', user);
        return { entry_id: entryId };
      }
      default:
        throw badRequest('Ação inválida.');
    }
  });
  audit(db, 'logistics_order', id, action, user.id);
  return out;
}

// ------------------------------------------------ ocorrências (registro básico; o restante em inspection.ts)

export function createOccurrenceTx(db: DB, user: AuthUser, p: { order_id?: number | null; order_item_id?: number | null; contract_id: number; asset_id?: number | null; item_id?: number | null; occurrence_type: string; description: string; estimated_cost?: number | null; status?: string; work_order_id?: number | null }) {
  const row = db
    .prepare(
      `INSERT INTO logistics_occurrences (number, order_id, order_item_id, contract_id, asset_id, item_id, occurrence_type, description, estimated_cost, status, work_order_id, registered_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, number`
    )
    .get(nextNumber(db, 'OCO'), p.order_id ?? null, p.order_item_id ?? null, p.contract_id, p.asset_id ?? null, p.item_id ?? null, p.occurrence_type, p.description, p.estimated_cost ?? null, p.status || 'registrada', p.work_order_id ?? null, user.id) as { id: number; number: string };
  logEvent(db, { order_id: p.order_id ?? null, occurrence_id: row.id }, 'ocorrencia', `Ocorrência ${row.number} registrada: ${p.description}`, user, null, p.status || 'registrada');
  return row.id;
}
