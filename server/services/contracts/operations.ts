/**
 * Operação física do contrato: reserva, entrega e devolução — sempre pelas funções do Estoque.
 *
 * - Reserva NÃO é saída física: bloqueia a agenda (stock_reservations confirmada).
 * - Entrega = saída para locação (ou saída por venda), revalidando equipamento e saldo na hora.
 * - Devolução: o equipamento volta "aguardando inspeção" e só fica disponível após conferência aprovada.
 * - Cada entrega/devolução tem chave de idempotência: o mesmo envio nunca é processado duas vezes.
 */

import { DB, audit, transaction } from '../../db';
import { HttpError, badRequest, forbidden } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { todayISO } from '../../../shared/orcamentos/dates';
import { INSPECTION_CHECKLIST, Reservation } from '../../../shared/estoque/types';
import { round3 } from '../../../shared/estoque/rules';
import { DELIVERY_CHECKLIST, Operation, ReturnClassification } from '../../../shared/contratos/types';
import { contractCan, reservationEnd } from '../../../shared/contratos/rules';
import { applyMovement, assertLocation, assetEvent, nextNumber } from '../stock/core';
import { deliverReservationTx, getReservation, insertReservationTx, inspectAssetTx, returnReservationTx, splitReservationTx } from '../stock/rental';
import { NOW_SQL, contractEvent, loadItems, loadRaw, text } from './core';
import { issueDocumentTx } from './documents';
import { autoCloseIfReturnedTx } from './closing';

function reservationsOf(db: DB, contractItemId: number, status: string): Reservation[] {
  return (db.prepare('SELECT id FROM stock_reservations WHERE contract_item_id = ? AND status = ? ORDER BY id').all(contractItemId, status) as { id: number }[]).map((r) => getReservation(db, r.id));
}

export function reservationBase(c: any, it: any) {
  const snap = JSON.parse(c.customer_snapshot);
  return {
    item_id: it.item_id,
    asset_id: it.asset_id,
    start_date: c.start_date,
    end_date: reservationEnd(c.end_date),
    customer_id: c.customer_id,
    customer_name: snap.name,
    quotation_id: c.quotation_id,
    contract_ref: c.contract_number,
    location_id: null,
    notes: null,
    contract_id: c.id,
    contract_item_id: it.id,
  };
}

/**
 * Reserva (confirmada) o que falta reservar dos itens de locação, revalidando conflitos dentro da transação.
 * Retorna quantas reservas foram criadas. Itens individuais precisam do patrimônio definido.
 */
export function reserveTx(db: DB, user: AuthUser, c: any): number {
  let n = 0;
  for (const it of loadItems(db, c.id)) {
    if (it.modality !== 'locacao') continue;
    const missing = round3(it.quantity - it.reserved_qty - it.delivered_qty - it.returned_qty);
    if (missing <= 1e-9) continue;
    if (it.tracking === 'individual' && !it.asset_id) throw new HttpError(422, `Defina o patrimônio de ${it.item_code} antes de reservar.`);
    insertReservationTx(db, user, { ...reservationBase(c, it), quantity: missing, location_id: null }, true);
    n++;
  }
  if (n) contractEvent(db, c.id, 'reserva', `${n} reserva(s) confirmada(s) no Estoque para o período do contrato.`, user);
  return n;
}

export function reserveContract(db: DB, user: AuthUser, id: number) {
  if (!contractCan.operate(user)) throw forbidden();
  return transaction(db, () => {
    const c = loadRaw(db, id);
    if (!['aprovado', 'aguardando_assinatura', 'agendado', 'ativo'].includes(c.status)) throw new HttpError(422, 'Reservas são feitas após a aprovação do contrato.');
    if (c.contract_type !== 'locacao') throw new HttpError(422, 'Contratos de venda não reservam agenda: o estoque é conferido na entrega.');
    return { created: reserveTx(db, user, c) };
  });
}

function existingOperation(db: DB, key: string) {
  return db.prepare('SELECT id, contract_id FROM contract_operations WHERE idempotency_key = ?').get(key) as { id: number; contract_id: number } | undefined;
}

function opHeader(db: DB, user: AuthUser, c: any, type: 'entrega' | 'devolucao', raw: any, key: string) {
  const performed_at = typeof raw?.performed_at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw.performed_at) ? raw.performed_at.slice(0, 16) : new Date().toISOString().slice(0, 16);
  if (performed_at.slice(0, 10) > todayISO()) throw badRequest('A data da operação não pode ser futura.', { performed_at: 'Data futura.' });
  const checklist: Record<string, boolean> = {};
  for (const k of DELIVERY_CHECKLIST) checklist[k.key] = !!raw?.checklist?.[k.key];
  const row = db
    .prepare(
      `INSERT INTO contract_operations (contract_id, number, operation_type, idempotency_key, performed_at, responsible_user_id, counterpart_name, counterpart_document, accessories, checklist, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, number`
    )
    .get(c.id, nextNumber(db, type === 'entrega' ? 'ENT' : 'DEV'), type, key, performed_at, user.id, text(raw?.counterpart_name, 120), text(raw?.counterpart_document, 30), text(raw?.accessories, 1000), JSON.stringify(checklist), text(raw?.notes, 2000)) as {
    id: number;
    number: string;
  };
  return row;
}

function opItem(db: DB, p: { operation_id: number; contract_item_id: number; reservation_id: number | null; asset_id: number | null; quantity: number; condition?: string | null; classification?: ReturnClassification | null; damaged?: number; maintenance?: number; missing?: number; notes?: string | null }) {
  db.prepare(
    `INSERT INTO contract_operation_items (operation_id, contract_item_id, reservation_id, asset_id, quantity, condition, classification, damaged_qty, maintenance_qty, missing_qty, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(p.operation_id, p.contract_item_id, p.reservation_id, p.asset_id, p.quantity, p.condition ?? null, p.classification ?? null, p.damaged ?? 0, p.maintenance ?? 0, p.missing ?? 0, p.notes ?? null);
}

// ------------------------------------------------ entrega

export function deliver(db: DB, user: AuthUser, id: number, raw: any): { operation_id: number; already: boolean } {
  if (!contractCan.operate(user)) throw forbidden();
  return transaction(db, () => deliverTx(db, user, id, raw));
}

/** Mesmo processamento, DENTRO de uma transação já aberta (usado pela Logística). */
export function deliverTx(db: DB, user: AuthUser, id: number, raw: any): { operation_id: number; already: boolean } {
  const key = text(raw?.idempotency_key, 80);
  if (!key) throw badRequest('Envio sem identificador (atualize a tela).');
  const dup = existingOperation(db, key);
  if (dup) return { operation_id: dup.id, already: true };
  const c = loadRaw(db, id);
  const allowed = c.contract_type === 'venda' ? ['ativo'] : ['agendado', 'ativo'];
  if (!allowed.includes(c.status)) throw new HttpError(422, c.contract_type === 'venda' ? 'A entrega da venda exige contrato ativo (formalizado).' : 'Entregas só para contratos agendados ou ativos.');
  const lines: any[] = Array.isArray(raw?.lines) ? raw.lines.filter((l: any) => Number(l?.quantity) > 0) : [];
  if (!lines.length) throw badRequest('Informe os itens entregues.');
  const items = new Map(loadItems(db, id).map((i) => [i.id, i]));
  const op = opHeader(db, user, c, 'entrega', raw, key);
  const snap = JSON.parse(c.customer_snapshot);
  for (const l of lines) {
    const it = items.get(Number(l.contract_item_id));
    if (!it) throw badRequest('Item não pertence ao contrato.');
    const qty = it.tracking === 'individual' ? 1 : round3(Number(l.quantity));
    if (it.modality === 'venda') {
      const pending = round3(it.quantity - it.sold_delivered_qty);
      if (qty > pending + 1e-9) throw new HttpError(422, `${it.item_code}: restam ${pending} para entregar.`);
      const loc = assertLocation(db, l.location_id || raw?.location_id || (db.prepare('SELECT default_location_id FROM catalog_items WHERE id = ?').get(it.item_id) as any)?.default_location_id, 'Local de saída');
      applyMovement(db, user, {
        type: 'saida_venda', item_id: it.item_id, quantity: qty, location_id: loc, qty_delta: -qty, origin_location_id: loc,
        reference_doc: c.contract_number, reason: `Venda a ${snap.name}`, document_type: 'contrato', document_id: c.id,
      });
      opItem(db, { operation_id: op.id, contract_item_id: it.id, reservation_id: null, asset_id: null, quantity: qty, condition: text(l.condition, 40), notes: text(l.notes, 500) });
      it.sold_delivered_qty = round3(it.sold_delivered_qty + qty);
      continue;
    }
    const pending = round3(it.quantity - it.delivered_qty - it.returned_qty);
    if (qty > pending + 1e-9) throw new HttpError(422, `${it.item_code}${it.asset_tag ? ` (${it.asset_tag})` : ''}: ${pending > 0 ? `restam ${pending} para entregar` : 'já entregue'}.`);
    if (it.tracking === 'individual' && !it.asset_id) throw new HttpError(422, `Defina o patrimônio de ${it.item_code} antes da entrega.`);
    // usa reservas confirmadas; o que faltar é reservado agora, revalidando o conflito
    let confirmed = reservationsOf(db, it.id, 'confirmada');
    const reservedQty = confirmed.reduce((a, r) => a + r.quantity, 0);
    if (reservedQty + 1e-9 < qty) {
      insertReservationTx(db, user, { ...reservationBase(c, it), quantity: round3(qty - reservedQty), location_id: l.location_id ? Number(l.location_id) : null }, true);
      confirmed = reservationsOf(db, it.id, 'confirmada');
    }
    let left = qty;
    for (let r of confirmed) {
      if (left <= 1e-9) break;
      if (r.quantity > left + 1e-9) r = splitReservationTx(db, user, r, left);
      if (!r.asset_id && !r.location_id && !l.location_id && !raw?.location_id) {
        const def = (db.prepare('SELECT default_location_id FROM catalog_items WHERE id = ?').get(it.item_id) as any)?.default_location_id;
        if (def) db.prepare('UPDATE stock_reservations SET location_id = ? WHERE id = ?').run(def, r.id), (r = getReservation(db, r.id));
      }
      deliverReservationTx(db, user, r, { location_id: l.location_id || raw?.location_id });
      opItem(db, { operation_id: op.id, contract_item_id: it.id, reservation_id: r.id, asset_id: r.asset_id, quantity: r.quantity, condition: text(l.condition, 40), notes: text(l.notes, 500) });
      left = round3(left - r.quantity);
    }
    it.delivered_qty = round3(it.delivered_qty + qty);
  }
  contractEvent(db, c.id, 'entrega', `Entrega ${op.number} registrada (${lines.length} item(ns))${raw?.counterpart_name ? `, recebida por ${text(raw.counterpart_name, 120)}` : ''}.`, user);
  issueDocumentTx(db, user, c.id, 'comprovante_entrega', `Comprovante de entrega ${op.number}`, { operation_id: op.id });
  audit(db, 'contract', c.id, 'entrega', user.id, { operation: op.number });
  return { operation_id: op.id, already: false };
}

// ------------------------------------------------ devolução

export function returnItems(db: DB, user: AuthUser, id: number, raw: any): { operation_id: number; already: boolean } {
  if (!contractCan.operate(user)) throw forbidden();
  return transaction(db, () => returnItemsTx(db, user, id, raw));
}

/** Mesmo processamento, DENTRO de uma transação já aberta (usado pela Logística). */
export function returnItemsTx(db: DB, user: AuthUser, id: number, raw: any): { operation_id: number; already: boolean } {
  const key = text(raw?.idempotency_key, 80);
  if (!key) throw badRequest('Envio sem identificador (atualize a tela).');
  const dup = existingOperation(db, key);
  if (dup) return { operation_id: dup.id, already: true };
  const c = loadRaw(db, id);
  if (c.contract_type !== 'locacao') throw new HttpError(422, 'Contratos de venda não têm devolução de locação. Devoluções de venda são lançadas como entrada no Estoque.');
  if (!['ativo', 'vencido', 'pendente_devolucao', 'agendado'].includes(c.status)) throw new HttpError(422, 'Este contrato não aceita devoluções no status atual.');
  const lines: any[] = Array.isArray(raw?.lines) ? raw.lines : [];
  const items = new Map(loadItems(db, id).map((i) => [i.id, i]));
  const op = opHeader(db, user, c, 'devolucao', raw, key);
  let count = 0;
  let damagedTotal = 0;
  for (const l of lines) {
    const it = items.get(Number(l.contract_item_id));
    if (!it) throw badRequest('Item não pertence ao contrato.');
    if (it.modality !== 'locacao') continue;
    const notes = text(l.notes, 1000);
    if (it.tracking === 'individual') {
      if (!l.returned) continue;
      const [r] = reservationsOf(db, it.id, 'em_uso');
      if (!r) throw new HttpError(422, `${it.asset_tag || it.item_code} não está com o cliente.`);
      const cls: ReturnClassification = ['disponivel', 'aguardando_inspecao', 'avaria', 'manutencao'].includes(l.classification) ? l.classification : 'aguardando_inspecao';
      returnReservationTx(db, user, r, { location_id: l.location_id || raw?.location_id, notes });
      if (cls === 'disponivel') {
        const checklist: Record<string, boolean> = {};
        for (const k of INSPECTION_CHECKLIST) checklist[k.key] = !!l.inspection?.[k.key];
        inspectAssetTx(db, user, r.asset_id!, { result: 'aprovado', checklist, notes });
      } else if (cls === 'avaria' || cls === 'manutencao') {
        if (!notes) throw badRequest(`Descreva ${cls === 'avaria' ? 'a avaria' : 'o motivo da manutenção'} de ${it.asset_tag}.`);
        inspectAssetTx(db, user, r.asset_id!, { result: cls === 'avaria' ? 'danificado' : 'manutencao', checklist: {}, notes });
        damagedTotal++;
      }
      if (['novo', 'bom', 'regular', 'ruim'].includes(l.condition)) {
        db.prepare(`UPDATE stock_assets SET conservation = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(l.condition, r.asset_id);
        assetEvent(db, r.asset_id!, 'conservacao', `Estado de conservação na devolução (${c.contract_number}): ${l.condition}.`, user);
      }
      opItem(db, { operation_id: op.id, contract_item_id: it.id, reservation_id: r.id, asset_id: r.asset_id, quantity: 1, condition: text(l.condition, 40), classification: cls, notes });
      count++;
      continue;
    }
    const ok = round3(Number(l.returned_qty || 0));
    const damaged = round3(Number(l.damaged_qty || 0));
    const maint = round3(Number(l.maintenance_qty || 0));
    const missing = round3(Number(l.missing_qty || 0));
    const held = round3(Number(l.held_qty || 0)); // recebidas e retidas até a inspeção (indisponíveis)
    if ([ok, damaged, maint, missing, held].some((v) => !Number.isFinite(v) || v < 0)) throw badRequest(`${it.item_code}: quantidades inválidas.`);
    const total = round3(ok + damaged + maint + missing + held);
    if (total <= 0) continue;
    if (total > it.delivered_qty + 1e-9) throw new HttpError(422, `${it.item_code}: o cliente está com ${it.delivered_qty}; informado ${total}.`);
    if ((damaged || maint) && !notes) throw badRequest(`${it.item_code}: descreva as avarias/necessidade de manutenção.`);
    // distribui as quantidades pelas reservas em uso (dividindo a última se a devolução for parcial)
    const pools = { ok, bad: round3(damaged + maint + held), missing };
    let left = total;
    for (let r of reservationsOf(db, it.id, 'em_uso')) {
      if (left <= 1e-9) break;
      if (r.quantity > left + 1e-9) r = splitReservationTx(db, user, r, left);
      let take = r.quantity;
      const part = { ok: 0, bad: 0, missing: 0 };
      for (const k of ['ok', 'bad', 'missing'] as const) {
        const v = Math.min(pools[k], take);
        part[k] = round3(v);
        pools[k] = round3(pools[k] - v);
        take = round3(take - v);
      }
      returnReservationTx(db, user, r, { location_id: l.location_id || raw?.location_id, returned_qty: part.ok, damaged_qty: part.bad, missing_qty: part.missing });
      left = round3(left - r.quantity);
    }
    opItem(db, { operation_id: op.id, contract_item_id: it.id, reservation_id: null, asset_id: null, quantity: total, condition: text(l.condition, 40), damaged, maintenance: maint, missing, notes, classification: damaged || maint ? (maint && !damaged ? 'manutencao' : 'avaria') : held ? 'aguardando_inspecao' : 'disponivel' });
    damagedTotal += damaged + maint;
    count++;
  }
  if (!count) throw badRequest('Informe ao menos um item devolvido.');
  contractEvent(db, c.id, 'devolucao', `Devolução ${op.number} registrada (${count} item(ns))${damagedTotal ? ' com avarias/manutenção' : ''}.`, user);
  issueDocumentTx(db, user, c.id, 'comprovante_devolucao', `Comprovante de devolução ${op.number}`, { operation_id: op.id });
  audit(db, 'contract', c.id, 'devolucao', user.id, { operation: op.number });
  // tudo de volta (e conferido, se exigido): a locação termina aqui, paga ou não
  autoCloseIfReturnedTx(db, user, c.id);
  return { operation_id: op.id, already: false };
}

// ------------------------------------------------ leitura

export function listOperations(db: DB, contractId: number): Operation[] {
  const ops = db
    .prepare('SELECT o.*, u.name AS responsible_name FROM contract_operations o LEFT JOIN users u ON u.id = o.responsible_user_id WHERE o.contract_id = ? ORDER BY o.performed_at DESC, o.id DESC')
    .all(contractId) as any[];
  return ops.map((o) => ({
    ...o,
    checklist: JSON.parse(o.checklist || '{}'),
    items: db
      .prepare(
        `SELECT oi.*, ci.item_code_snapshot AS item_code, ci.description_snapshot AS description, a.asset_tag
         FROM contract_operation_items oi JOIN contract_items ci ON ci.id = oi.contract_item_id LEFT JOIN stock_assets a ON a.id = oi.asset_id WHERE oi.operation_id = ?`
      )
      .all(o.id) as any[],
  }));
}

/** Equipamentos individuais devolvidos neste contrato que ainda aguardam inspeção. */
export { pendingInspections } from './closing';

