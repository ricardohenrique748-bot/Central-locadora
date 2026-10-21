/**
 * Núcleo do estoque: numeração, saldos por local e movimentações.
 *
 * Regra de ouro: o saldo (stock_balances) só muda dentro de applyMovement, na mesma transação
 * em que a movimentação confirmada é gravada. A soma dos deltas das movimentações confirmadas
 * de um item/local é sempre igual ao saldo. Movimentações confirmadas não são editadas nem
 * apagadas — correção por estorno.
 */

import { DB, nextCounter, transaction } from '../../db';
import { HttpError, badRequest, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { Movement, MovementType, StockItem } from '../../../shared/estoque/types';
import { deriveRentalStatus, round3, stockCan } from '../../../shared/estoque/rules';
import { todayISO } from '../../../shared/orcamentos/dates';
import { getCatalogItem } from '../catalog';

export const NOW_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

export function nextNumber(db: DB, prefix: string): string {
  const year = todayISO().slice(0, 4);
  return `${prefix}-${year}-${String(nextCounter(db, `${prefix}_${year}`)).padStart(6, '0')}`;
}

export function getItemOrThrow(db: DB, id: number): StockItem {
  return getCatalogItem(db, id);
}

export function assertLocation(db: DB, id: unknown, label = 'Local'): number {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${label}: selecione o local.`);
  const row = db.prepare('SELECT active FROM stock_locations WHERE id = ?').get(n) as { active: number } | undefined;
  if (!row) throw badRequest(`${label}: local não encontrado.`);
  if (!row.active) throw badRequest(`${label}: local inativo.`);
  return n;
}

export function getBalance(db: DB, itemId: number, locationId: number) {
  return (db.prepare('SELECT quantity, reserved, unavailable FROM stock_balances WHERE item_id = ? AND location_id = ?').get(itemId, locationId) as
    | { quantity: number; reserved: number; unavailable: number }
    | undefined) || { quantity: 0, reserved: 0, unavailable: 0 };
}

export function totalQuantity(db: DB, itemId: number): number {
  return (db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM stock_balances WHERE item_id = ?').get(itemId) as { q: number }).q;
}

export interface MovementParams {
  type: MovementType;
  item_id: number;
  asset_id?: number | null;
  quantity: number;
  /** Local cujo saldo muda (origem nas saídas, destino nas entradas). */
  location_id: number | null;
  qty_delta: number;
  unavailable_delta?: number;
  origin_location_id?: number | null;
  dest_location_id?: number | null;
  unit_cost?: number | null;
  reference_doc?: string | null;
  reason?: string | null;
  notes?: string | null;
  document_type?: string | null;
  document_id?: number | null;
  reversal_of_id?: number | null;
  /** Permite consumir saldo reservado/indisponível (ex.: baixa de item avariado). */
  allowUnavailable?: boolean;
}

export function assertQuantity(q: number) {
  if (!(q > 0)) throw badRequest('Quantidade deve ser maior que zero.');
  if (Math.abs(q * 1000 - Math.round(q * 1000)) > 1e-6) throw badRequest('Use no máximo 3 casas decimais na quantidade.');
}

/**
 * Aplica deltas ao saldo de um item/local validando: físico não negativo (salvo item que permite),
 * indisponível entre 0 e o físico, e saída que não consome saldo reservado/indisponível.
 */
export function applyBalance(db: DB, item: StockItem, locationId: number, qtyDelta: number, unavDelta: number, allowUnavailable = false) {
  if (qtyDelta === 0 && unavDelta === 0) return;
  const bal = getBalance(db, item.id, locationId);
  const newQty = round3(bal.quantity + qtyDelta);
  const newUnav = round3(bal.unavailable + unavDelta);
  if (newUnav < 0) throw new HttpError(422, `${item.internal_code}: quantidade indisponível insuficiente no local.`);
  if (newUnav > newQty + 1e-9 && !item.allow_negative) throw new HttpError(422, `${item.internal_code}: saldo insuficiente no local.`);
  const available = round3(newQty - bal.reserved - newUnav);
  if (qtyDelta < 0 && !allowUnavailable && available < 0 && !item.allow_negative) {
    const free = round3(bal.quantity - bal.reserved - bal.unavailable);
    throw new HttpError(422, `${item.internal_code}: saldo disponível insuficiente no local (disponível: ${free.toLocaleString('pt-BR')} ${item.unit}).`);
  }
  db.prepare(
    `INSERT INTO stock_balances (item_id, location_id, quantity, unavailable, updated_at) VALUES (?, ?, ?, ?, ${NOW_SQL})
     ON CONFLICT(item_id, location_id) DO UPDATE SET quantity = excluded.quantity, unavailable = excluded.unavailable, updated_at = excluded.updated_at`
  ).run(item.id, locationId, newQty, newUnav);
}

/** Grava a movimentação confirmada e atualiza o saldo. Deve ser chamada DENTRO de uma transação. */
export function applyMovement(db: DB, user: AuthUser | null, p: MovementParams): number {
  assertQuantity(p.quantity);
  const item = getItemOrThrow(db, p.item_id);
  const unav = p.unavailable_delta || 0;
  if (p.location_id) applyBalance(db, item, p.location_id, p.qty_delta, unav, p.allowUnavailable);

  const unitCost = p.unit_cost ?? item.average_cost ?? item.acquisition_cost ?? null;
  const row = db
    .prepare(
      `INSERT INTO stock_movements (number, movement_type, status, item_id, asset_id, quantity, qty_delta, unavailable_delta, balance_location_id,
        origin_location_id, dest_location_id, unit_cost, total_cost, reference_doc, reason, notes, document_type, document_id, reversal_of_id,
        created_by, confirmed_by, confirmed_at)
       VALUES (?, ?, 'confirmado', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${NOW_SQL}) RETURNING id`
    )
    .get(
      nextNumber(db, 'MOV'), p.type, p.item_id, p.asset_id ?? null, p.quantity, p.qty_delta, unav, p.location_id,
      p.origin_location_id ?? null, p.dest_location_id ?? null, unitCost, unitCost !== null ? Math.round(unitCost * p.quantity) : null,
      p.reference_doc ?? null, p.reason ?? null, p.notes ?? null, p.document_type ?? null, p.document_id ?? null, p.reversal_of_id ?? null,
      user?.id ?? null, user?.id ?? null
    ) as { id: number };
  return row.id;
}

// ------------------------------------------------ consultas de movimentações

export const MOVEMENT_SELECT = `
  SELECT m.*, i.internal_code AS item_code, i.description AS item_description, a.asset_tag,
    lo.name AS origin_name, ld.name AS dest_name, COALESCE(u.name, 'Sistema') AS created_by_name
  FROM stock_movements m
  JOIN catalog_items i ON i.id = m.item_id
  LEFT JOIN stock_assets a ON a.id = m.asset_id
  LEFT JOIN stock_locations lo ON lo.id = m.origin_location_id
  LEFT JOIN stock_locations ld ON ld.id = m.dest_location_id
  LEFT JOIN users u ON u.id = m.created_by`;

export function listMovements(db: DB, f: Record<string, string | undefined>) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.q?.trim()) {
    where.push('(m.number LIKE ? OR i.internal_code LIKE ? OR i.description LIKE ? OR m.reference_doc LIKE ? OR a.asset_tag LIKE ?)');
    const q = `%${f.q.trim()}%`;
    params.push(q, q, q, q, q);
  }
  if (f.type) {
    const types = f.type.split(',').filter(Boolean);
    where.push(`m.movement_type IN (${types.map(() => '?').join(',')})`);
    params.push(...types);
  }
  if (f.status) {
    where.push('m.status = ?');
    params.push(f.status);
  }
  if (f.item_id) {
    where.push('m.item_id = ?');
    params.push(Number(f.item_id));
  }
  if (f.location_id) {
    where.push('(m.origin_location_id = ? OR m.dest_location_id = ? OR m.balance_location_id = ?)');
    params.push(Number(f.location_id), Number(f.location_id), Number(f.location_id));
  }
  if (f.direction === 'entrada') where.push('(m.qty_delta > 0 AND m.status != \'rascunho\')');
  if (f.direction === 'saida') where.push('(m.qty_delta < 0 AND m.status != \'rascunho\')');
  if (f.from) {
    where.push("date(m.created_at, '-3 hours') >= ?");
    params.push(f.from);
  }
  if (f.to) {
    where.push("date(m.created_at, '-3 hours') <= ?");
    params.push(f.to);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pageSize = f.all ? 10000 : Math.min(Math.max(Number(f.page_size) || 25, 5), 100);
  const page = f.all ? 1 : Math.max(Number(f.page) || 1, 1);
  const total = (db.prepare(`SELECT COUNT(*) n FROM stock_movements m JOIN catalog_items i ON i.id = m.item_id LEFT JOIN stock_assets a ON a.id = m.asset_id ${w}`).get(...params) as { n: number }).n;
  const rows = db.prepare(`${MOVEMENT_SELECT} ${w} ORDER BY m.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as unknown as Movement[];
  return { total, page, page_size: pageSize, rows };
}

export function getMovement(db: DB, id: number): Movement {
  const m = db.prepare(`${MOVEMENT_SELECT} WHERE m.id = ?`).get(id) as unknown as Movement | undefined;
  if (!m) throw notFound('Movimentação não encontrada.');
  return m;
}

/** Tipos que podem ser estornados diretamente (os demais são desfeitos pelo próprio fluxo: transferência, locação, inventário). */
const REVERSIBLE: MovementType[] = ['entrada_compra', 'entrada_inicial', 'devolucao_venda', 'outra_entrada', 'saida_consumo', 'outra_saida', 'baixa_perda_avaria', 'ajuste_positivo', 'ajuste_negativo', 'envio_manutencao', 'retorno_manutencao'];

export function reverseMovement(db: DB, user: AuthUser, id: number, reason: unknown): Movement {
  if (!stockCan.approve(user)) throw forbidden('Estorno exige perfil de gestor ou administrador.');
  const why = typeof reason === 'string' ? reason.trim().slice(0, 1000) : '';
  if (!why) throw badRequest('Informe o motivo do estorno.', { reason: 'Obrigatório.' });
  return transaction(db, () => {
    const m = getMovement(db, id);
    if (m.status !== 'confirmado') throw new HttpError(422, 'Somente movimentações confirmadas podem ser estornadas.');
    if (!REVERSIBLE.includes(m.movement_type)) throw new HttpError(422, 'Este tipo de movimentação é desfeito pelo próprio fluxo (transferência, locação ou inventário), não por estorno.');
    if (m.asset_id) throw new HttpError(422, 'Movimentações de equipamentos individuais são corrigidas pela ficha do equipamento.');
    const raw = db.prepare('SELECT balance_location_id FROM stock_movements WHERE id = ?').get(id) as { balance_location_id: number | null };
    const newId = applyMovement(db, user, {
      type: 'estorno',
      item_id: m.item_id,
      quantity: m.quantity,
      location_id: raw.balance_location_id,
      qty_delta: -m.qty_delta,
      unavailable_delta: -m.unavailable_delta,
      origin_location_id: m.dest_location_id,
      dest_location_id: m.origin_location_id,
      unit_cost: m.unit_cost,
      reference_doc: m.number,
      reason: why,
      reversal_of_id: m.id,
      allowUnavailable: true,
    });
    db.prepare("UPDATE stock_movements SET status = 'estornado' WHERE id = ?").run(id);
    return getMovement(db, newId);
  });
}

// ------------------------------------------------ equipamentos individuais (apoio)

export function assetEvent(db: DB, assetId: number, type: string, description: string, user: AuthUser | null, metadata?: unknown) {
  db.prepare('INSERT INTO stock_asset_events (asset_id, event_type, description, performed_by, metadata) VALUES (?, ?, ?, ?, ?)').run(
    assetId,
    type,
    description,
    user?.id ?? null,
    metadata === undefined ? null : JSON.stringify(metadata)
  );
}

/** OS impeditiva aberta para o equipamento (módulo de Ordens de Serviço): bloqueia reserva, entrega e liberação. */
export function openBlockingOrder(db: DB, assetId: number): string | null {
  const r = db.prepare("SELECT order_number FROM work_orders WHERE asset_id = ? AND blocks_equipment = 1 AND status NOT IN ('concluida','cancelada') ORDER BY id LIMIT 1").get(assetId) as { order_number: string } | undefined;
  return r?.order_number ?? null;
}

/** Recalcula a situação de locação a partir de estado operacional, reservas e transferências. */
export function refreshAssetRental(db: DB, assetId: number, today = todayISO()) {
  const a = db.prepare('SELECT operational_status FROM stock_assets WHERE id = ?').get(assetId) as { operational_status: any } | undefined;
  if (!a) return;
  const onRent = !!db.prepare("SELECT 1 FROM stock_reservations WHERE asset_id = ? AND status = 'em_uso'").get(assetId);
  const inTransit = !!db
    .prepare("SELECT 1 FROM stock_transfer_items ti JOIN stock_transfers t ON t.id = ti.transfer_id WHERE ti.asset_id = ? AND t.status = 'em_transito'")
    .get(assetId);
  const reservedToday = !!db.prepare("SELECT 1 FROM stock_reservations WHERE asset_id = ? AND status = 'confirmada' AND start_date <= ? AND end_date >= ?").get(assetId, today, today);
  const status = deriveRentalStatus(a.operational_status, { onRent, inTransit, reservedToday });
  db.prepare(`UPDATE stock_assets SET rental_status = ?, updated_at = ${NOW_SQL} WHERE id = ? AND rental_status != ?`).run(status, assetId, status);
}

/** Reprocessa todos (reservas que começam/terminam com a passagem dos dias). */
export function refreshAllAssets(db: DB) {
  const ids = db.prepare("SELECT id FROM stock_assets WHERE operational_status != 'baixado' OR rental_status != 'indisponivel'").all() as { id: number }[];
  transaction(db, () => ids.forEach((r) => refreshAssetRental(db, r.id)));
}
