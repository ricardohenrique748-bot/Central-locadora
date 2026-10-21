/**
 * Peças e materiais da OS, integrados ao Estoque.
 *
 *   solicitado (lista)  → não mexe no estoque
 *   reservado           → stock_balances.reserved (o saldo continua no local, mas não pode sair para outro uso)
 *   retirado            → saída real (movimento consumo_os), com custo médio do item
 *   utilizado           → confirmação do que foi aplicado no equipamento (custo realizado)
 *   devolvido           → retorno real ao estoque (movimento devolucao_os)
 *
 * Cada retirada/devolução leva chave de idempotência (reenvio não duplica) e roda em transação exclusiva.
 */

import { DB, transaction } from '../../db';
import { HttpError, badRequest, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { round3 } from '../../../shared/estoque/rules';
import { Material } from '../../../shared/os/types';
import { osCan } from '../../../shared/os/rules';
import { applyMovement, assertLocation, assertQuantity, getBalance, getItemOrThrow } from '../stock/core';
import { NOW_SQL, assertOpen, loadRawOrder, orderEvent, recalcCostsTx, text } from './core';

function loadMaterial(db: DB, orderId: number, materialId: number) {
  const m = db.prepare('SELECT * FROM work_order_materials WHERE id = ? AND work_order_id = ?').get(materialId, orderId) as any;
  if (!m) throw notFound('Material não encontrado nesta OS.');
  return m;
}

export function addMaterial(db: DB, user: AuthUser, orderId: number, raw: any) {
  if (!osCan.materials(user)) throw forbidden();
  return transaction(db, () => {
    const o = loadRawOrder(db, orderId);
    assertOpen(o);
    const item = getItemOrThrow(db, Number(raw?.item_id));
    if (item.tracking === 'individual') throw badRequest(`${item.internal_code} é patrimônio individual: não é peça/material de consumo.`);
    if (!item.active) throw badRequest(`${item.internal_code} está inativo.`);
    if (item.kind === 'equipamento_locacao') throw badRequest(`${item.internal_code} é equipamento de locação, não peça ou material de consumo.`);
    const qty = round3(Number(raw?.quantity));
    assertQuantity(qty);
    const row = db
      .prepare(
        `INSERT INTO work_order_materials (work_order_id, item_id, description_snapshot, quantity_requested, estimated_unit_cost, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .get(orderId, item.id, `${item.internal_code} — ${item.description}`, qty, item.average_cost ?? item.acquisition_cost ?? null, text(raw?.notes, 500), user.id) as { id: number };
    orderEvent(db, orderId, 'material', `Material solicitado: ${item.internal_code} × ${qty} ${item.unit} (sem movimentar o estoque).`, user);
    recalcCostsTx(db, orderId);
    return { id: row.id };
  });
}

function move(db: DB, user: AuthUser, m: any, type: string, qty: number, extra: { location_id?: number | null; stock_movement_id?: number | null; key?: string | null; notes?: string | null } = {}) {
  db.prepare('INSERT INTO work_order_material_moves (material_id, move_type, quantity, location_id, stock_movement_id, idempotency_key, notes, performed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    m.id, type, qty, extra.location_id ?? null, extra.stock_movement_id ?? null, extra.key ?? null, extra.notes ?? null, user.id
  );
}

/**
 * Operação sobre um material: reservar, liberar, retirar, utilizar, devolver, cancelar.
 * Retirar/devolver exigem `idempotency_key`; um reenvio com a mesma chave não faz nada.
 */
export function materialAction(db: DB, user: AuthUser, orderId: number, materialId: number, action: string, raw: any) {
  if (!osCan.materials(user)) throw forbidden();
  return transaction(db, () => {
    const o = loadRawOrder(db, orderId);
    const m = loadMaterial(db, orderId, materialId);
    const key = text(raw?.idempotency_key, 80);
    if (key && db.prepare('SELECT 1 FROM work_order_material_moves WHERE idempotency_key = ?').get(key)) return { already: true };
    if (action !== 'devolver') assertOpen(o); // devolução de sobra é permitida mesmo após encerrar
    if (m.status !== 'ativo') throw new HttpError(422, 'Material cancelado.');
    const item = getItemOrThrow(db, m.item_id);
    const qty = round3(Number(raw?.quantity));
    const label = `${item.internal_code} × ${qty} ${item.unit}`;
    if (action !== 'cancelar') assertQuantity(qty);
    const net = round3(m.quantity_withdrawn - m.quantity_returned - m.quantity_used); // retirado e ainda não aplicado/devolvido

    switch (action) {
      case 'reservar': {
        const loc = assertLocation(db, raw?.location_id || m.location_id || item.default_location_id, 'Local da reserva');
        if (m.quantity_reserved > 0 && m.location_id && m.location_id !== loc) throw badRequest('Libere a reserva atual antes de reservar em outro local.');
        const pending = round3(m.quantity_requested - m.quantity_reserved - m.quantity_withdrawn); // devolução = sobra (não precisava)
        if (qty > pending + 1e-9) throw new HttpError(422, `Reserva maior que o solicitado (falta reservar ${Math.max(0, pending)}).`);
        const b = getBalance(db, item.id, loc);
        const free = round3(b.quantity - b.reserved - b.unavailable);
        if (qty > free + 1e-9 && !item.allow_negative) throw new HttpError(422, `${item.internal_code}: disponível no local ${free.toLocaleString('pt-BR')} ${item.unit}.`);
        db.prepare(`UPDATE stock_balances SET reserved = reserved + ?, updated_at = ${NOW_SQL} WHERE item_id = ? AND location_id = ?`).run(qty, item.id, loc);
        db.prepare(`UPDATE work_order_materials SET quantity_reserved = quantity_reserved + ?, location_id = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(qty, loc, m.id);
        move(db, user, m, 'reserva', qty, { location_id: loc });
        orderEvent(db, orderId, 'material', `Reservado no estoque: ${label}.`, user);
        break;
      }
      case 'liberar': {
        if (qty > m.quantity_reserved + 1e-9) throw new HttpError(422, `Só há ${m.quantity_reserved} reservado.`);
        db.prepare(`UPDATE stock_balances SET reserved = MAX(0, reserved - ?), updated_at = ${NOW_SQL} WHERE item_id = ? AND location_id = ?`).run(qty, item.id, m.location_id);
        db.prepare(`UPDATE work_order_materials SET quantity_reserved = quantity_reserved - ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(qty, m.id);
        move(db, user, m, 'liberacao', qty, { location_id: m.location_id });
        orderEvent(db, orderId, 'material', `Reserva liberada: ${label}.`, user);
        break;
      }
      case 'retirar': {
        if (!key) throw badRequest('Envio sem identificador (atualize a tela).');
        const loc = assertLocation(db, raw?.location_id || m.location_id || item.default_location_id, 'Local de retirada');
        // consome primeiro a própria reserva (no mesmo local), depois o saldo livre
        const fromReserve = m.location_id === loc ? Math.min(qty, m.quantity_reserved) : 0;
        if (fromReserve > 0) {
          db.prepare(`UPDATE stock_balances SET reserved = MAX(0, reserved - ?) WHERE item_id = ? AND location_id = ?`).run(fromReserve, item.id, loc);
          db.prepare('UPDATE work_order_materials SET quantity_reserved = quantity_reserved - ? WHERE id = ?').run(fromReserve, m.id);
        }
        const movId = applyMovement(db, user, {
          type: 'consumo_os', item_id: item.id, quantity: qty, location_id: loc, qty_delta: -qty, origin_location_id: loc,
          reference_doc: o.order_number, reason: `Retirada para a OS ${o.order_number}`, document_type: 'os', document_id: o.id,
        });
        const cost = (db.prepare('SELECT total_cost FROM stock_movements WHERE id = ?').get(movId) as { total_cost: number | null }).total_cost || 0;
        db.prepare(`UPDATE work_order_materials SET quantity_withdrawn = quantity_withdrawn + ?, withdrawn_cost = withdrawn_cost + ?, location_id = COALESCE(location_id, ?), updated_at = ${NOW_SQL} WHERE id = ?`).run(qty, cost, loc, m.id);
        move(db, user, m, 'retirada', qty, { location_id: loc, stock_movement_id: movId, key, notes: text(raw?.notes, 300) });
        orderEvent(db, orderId, 'material', `Retirado do estoque: ${label}${raw?.withdrawn_by ? ` por ${text(raw.withdrawn_by, 80)}` : ''}.`, user);
        break;
      }
      case 'utilizar': {
        if (qty > net + 1e-9) throw new HttpError(422, `Só há ${net} retirado e ainda não aplicado. Retire do estoque antes de registrar a utilização.`);
        db.prepare(`UPDATE work_order_materials SET quantity_used = quantity_used + ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(qty, m.id);
        move(db, user, m, 'utilizacao', qty, { key, notes: text(raw?.notes, 300) });
        orderEvent(db, orderId, 'material', `Utilizado no equipamento: ${label}.`, user);
        break;
      }
      case 'devolver': {
        if (!key) throw badRequest('Envio sem identificador (atualize a tela).');
        if (qty > net + 1e-9) throw new HttpError(422, `Só há ${net} retirado e não utilizado para devolver.`);
        const loc = assertLocation(db, raw?.location_id || m.location_id || item.default_location_id, 'Local de devolução');
        const unit = m.quantity_withdrawn > 0 ? m.withdrawn_cost / m.quantity_withdrawn : null;
        const movId = applyMovement(db, user, {
          type: 'devolucao_os', item_id: item.id, quantity: qty, location_id: loc, qty_delta: qty, dest_location_id: loc, unit_cost: unit === null ? null : Math.round(unit),
          reference_doc: o.order_number, reason: `Sobra devolvida da OS ${o.order_number}`, document_type: 'os', document_id: o.id,
        });
        db.prepare(`UPDATE work_order_materials SET quantity_returned = quantity_returned + ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(qty, m.id);
        move(db, user, m, 'devolucao', qty, { location_id: loc, stock_movement_id: movId, key, notes: text(raw?.notes, 300) });
        orderEvent(db, orderId, 'material', `Devolvido ao estoque: ${label}.`, user);
        break;
      }
      case 'cancelar': {
        if (m.quantity_withdrawn > m.quantity_returned + 1e-9) throw new HttpError(422, 'Há material retirado: registre a utilização ou devolva antes de cancelar.');
        if (m.quantity_reserved > 0) {
          db.prepare(`UPDATE stock_balances SET reserved = MAX(0, reserved - ?) WHERE item_id = ? AND location_id = ?`).run(m.quantity_reserved, item.id, m.location_id);
          move(db, user, m, 'liberacao', m.quantity_reserved, { location_id: m.location_id });
        }
        db.prepare(`UPDATE work_order_materials SET status = 'cancelado', quantity_reserved = 0, updated_at = ${NOW_SQL} WHERE id = ?`).run(m.id);
        orderEvent(db, orderId, 'material', `Material cancelado: ${item.internal_code}. ${text(raw?.reason, 300) || ''}`.trim(), user);
        break;
      }
      default:
        throw badRequest('Ação inválida.');
    }
    if (!['concluida', 'cancelada'].includes(o.status)) recalcCostsTx(db, orderId);
    return { already: false };
  });
}

/** Libera reservas pendentes (cancelamento/conclusão da OS). Dentro de transação. */
export function releaseAllReservationsTx(db: DB, user: AuthUser | null, orderId: number) {
  for (const m of db.prepare("SELECT * FROM work_order_materials WHERE work_order_id = ? AND status = 'ativo' AND quantity_reserved > 0").all(orderId) as any[]) {
    db.prepare(`UPDATE stock_balances SET reserved = MAX(0, reserved - ?) WHERE item_id = ? AND location_id = ?`).run(m.quantity_reserved, m.item_id, m.location_id);
    db.prepare('UPDATE work_order_materials SET quantity_reserved = 0 WHERE id = ?').run(m.id);
    db.prepare("INSERT INTO work_order_material_moves (material_id, move_type, quantity, location_id, notes, performed_by) VALUES (?, 'liberacao', ?, ?, 'Liberação automática no encerramento da OS', ?)").run(m.id, m.quantity_reserved, m.location_id, user?.id ?? null);
  }
}

export function listMaterials(db: DB, orderId: number): Material[] {
  return (
    db
      .prepare(
        `SELECT m.*, i.internal_code AS item_code, i.description, i.unit, i.kind AS item_kind, l.name AS location_name,
           (SELECT COALESCE(SUM(quantity - reserved - unavailable),0) FROM stock_balances b WHERE b.item_id = m.item_id) AS available_now
         FROM work_order_materials m JOIN catalog_items i ON i.id = m.item_id LEFT JOIN stock_locations l ON l.id = m.location_id WHERE m.work_order_id = ? ORDER BY m.id`
      )
      .all(orderId) as any[]
  ).map((m) => ({
    id: m.id, item_id: m.item_id, item_code: m.item_code, description: m.description, unit: m.unit, kind: m.item_kind === 'peca' ? 'peca' : 'material',
    quantity_requested: m.quantity_requested, quantity_reserved: m.quantity_reserved, quantity_withdrawn: m.quantity_withdrawn, quantity_returned: m.quantity_returned, quantity_used: m.quantity_used,
    location_id: m.location_id, location_name: m.location_name, unit_cost: m.quantity_withdrawn > 0 ? Math.round(m.withdrawn_cost / m.quantity_withdrawn) : null, estimated_unit_cost: m.estimated_unit_cost,
    available_now: round3(m.available_now), status: m.status, notes: m.notes,
    moves: db
      .prepare(
        `SELECT mv.id, mv.move_type, mv.quantity, sm.number AS movement_number, u.name AS performed_by_name, mv.created_at
         FROM work_order_material_moves mv LEFT JOIN stock_movements sm ON sm.id = mv.stock_movement_id LEFT JOIN users u ON u.id = mv.performed_by WHERE mv.material_id = ? ORDER BY mv.id`
      )
      .all(m.id) as any[],
  }));
}
