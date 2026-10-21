/**
 * Equipamentos individuais, reservas, entrega/retorno/inspeção e disponibilidade para locação.
 *
 * - Disponibilidade = estado operacional + reservas confirmadas/em uso no período + transferências,
 *   nunca um campo manual. Datas inclusivas (ver shared/estoque/rules.ts).
 * - Confirmação de reserva roda em transação exclusiva (BEGIN IMMEDIATE) e revalida conflitos lá dentro:
 *   duas confirmações simultâneas para o mesmo equipamento não passam juntas.
 * - Saída para locação NÃO é baixa: o patrimônio continua da empresa (movimento saida_locacao / retorno_locacao).
 * - Retorno deixa o equipamento "aguardando inspeção"; só a inspeção aprovada o libera.
 */

import { DB, audit, transaction } from '../../db';
import { HttpError, badRequest, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { Asset, AssetDetail, Conservation, INSPECTION_CHECKLIST, OPERATIONAL_LABELS, OperationalStatus, RESERVATION_LABELS, Reservation, ReservationStatus } from '../../../shared/estoque/types';
import { AssetAction, OPERATIONAL_TRANSITIONS, RENTABLE_OPERATIONAL, datesOverlap, peakUsage, round3, stockCan } from '../../../shared/estoque/rules';
import { isISODate, todayISO } from '../../../shared/orcamentos/dates';
import { MOVEMENT_SELECT, NOW_SQL, applyMovement, assertLocation, assertQuantity, assetEvent, getItemOrThrow, nextNumber, openBlockingOrder, refreshAssetRental } from './core';

const text = (v: unknown, max = 500) => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t === '' ? null : t;
};

// ================================================ EQUIPAMENTOS INDIVIDUAIS

const ASSET_SELECT = `
  SELECT a.*, i.internal_code AS item_code, i.description AS item_description, i.brand, i.model, i.category,
    s.name AS supplier_name, l.name AS location_name
  FROM stock_assets a JOIN catalog_items i ON i.id = a.item_id
  LEFT JOIN suppliers s ON s.id = a.supplier_id LEFT JOIN stock_locations l ON l.id = a.location_id`;

export function listAssets(db: DB, f: Record<string, string | undefined>) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.q?.trim()) {
    where.push('(a.asset_tag LIKE ? OR a.serial_number LIKE ? OR i.internal_code LIKE ? OR i.description LIKE ?)');
    const q = `%${f.q.trim()}%`;
    params.push(q, q, q, q);
  }
  for (const [k, col] of [['operational_status', 'a.operational_status'], ['rental_status', 'a.rental_status'], ['category', 'i.category']] as const) {
    if (f[k]) {
      where.push(`${col} = ?`);
      params.push(f[k]!);
    }
  }
  if (f.item_id) {
    where.push('a.item_id = ?');
    params.push(Number(f.item_id));
  }
  if (f.location_id) {
    where.push('a.location_id = ?');
    params.push(Number(f.location_id));
  }
  if (f.include_written_off !== '1') where.push("a.operational_status != 'baixado'");
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pageSize = f.all ? 10000 : Math.min(Math.max(Number(f.page_size) || 25, 5), 100);
  const page = f.all ? 1 : Math.max(Number(f.page) || 1, 1);
  const total = (db.prepare(`SELECT COUNT(*) n FROM stock_assets a JOIN catalog_items i ON i.id = a.item_id ${w}`).get(...params) as { n: number }).n;
  const rows = db.prepare(`${ASSET_SELECT} ${w} ORDER BY a.asset_tag LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as unknown as Asset[];
  return { total, page, page_size: pageSize, rows };
}

function loadAsset(db: DB, id: number): Asset {
  const a = db.prepare(`${ASSET_SELECT} WHERE a.id = ?`).get(id) as unknown as Asset | undefined;
  if (!a) throw notFound('Equipamento não encontrado.');
  return a;
}

const RES_SELECT = `
  SELECT r.*, i.internal_code AS item_code, i.description AS item_description, a.asset_tag, q.quotation_number,
    l.name AS location_name, COALESCE(u.name,'Sistema') AS created_by_name
  FROM stock_reservations r JOIN catalog_items i ON i.id = r.item_id
  LEFT JOIN stock_assets a ON a.id = r.asset_id LEFT JOIN quotations q ON q.id = r.quotation_id
  LEFT JOIN stock_locations l ON l.id = r.location_id LEFT JOIN users u ON u.id = r.created_by`;

export function getAssetDetail(db: DB, id: number): AssetDetail {
  const a = loadAsset(db, id);
  const events = db
    .prepare(`SELECT e.id, e.event_type, e.description, COALESCE(u.name,'Sistema') AS performed_by_name, e.created_at FROM stock_asset_events e LEFT JOIN users u ON u.id = e.performed_by WHERE e.asset_id = ? ORDER BY e.id DESC`)
    .all(id) as any[];
  const files = db
    .prepare(`SELECT f.id, f.kind, f.name, f.mime, f.size, COALESCE(u.name,'Sistema') AS uploaded_by_name, f.created_at FROM stock_asset_files f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.asset_id = ? ORDER BY f.id DESC`)
    .all(id) as any[];
  const movements = db.prepare(`${MOVEMENT_SELECT} WHERE m.asset_id = ? ORDER BY m.id DESC`).all(id) as any[];
  const reservations = db.prepare(`${RES_SELECT} WHERE r.asset_id = ? ORDER BY r.start_date DESC`).all(id) as unknown as Reservation[];
  const today = todayISO();
  const last = reservations.find((r) => r.status === 'concluida' || r.status === 'em_uso') || null;
  const next = [...reservations].reverse().find((r) => r.status === 'confirmada' && r.end_date >= today) || null;
  return { ...a, events, files, movements, reservations, last_reservation: last, next_reservation: next };
}

export function updateAsset(db: DB, user: AuthUser, id: number, raw: any): Asset {
  if (!stockCan.manageItems(user)) throw forbidden();
  const a = loadAsset(db, id);
  if (a.operational_status === 'baixado') throw new HttpError(422, 'Equipamento baixado: o cadastro fica somente para consulta.');
  const cons: Conservation[] = ['novo', 'bom', 'regular', 'ruim'];
  const serial = text(raw?.serial_number, 60);
  if (serial && db.prepare('SELECT 1 FROM stock_assets WHERE item_id = ? AND serial_number = ? AND id != ?').get(a.item_id, serial, id)) throw badRequest('Nº de série já usado em outra unidade deste item.');
  const dates = ['acquisition_date', 'operation_start_date', 'warranty_until'] as const;
  for (const d of dates) if (raw?.[d] && !isISODate(raw[d])) throw badRequest('Data inválida.', { [d]: 'Data inválida.' });
  const cost = raw?.acquisition_cost === null || raw?.acquisition_cost === '' || raw?.acquisition_cost === undefined ? a.acquisition_cost : Number(raw.acquisition_cost);
  if (cost !== null && (!Number.isInteger(cost) || cost < 0)) throw badRequest('Custo inválido.');
  db.prepare(
    `UPDATE stock_assets SET serial_number = ?, acquisition_date = ?, supplier_id = ?, acquisition_cost = ?, conservation = ?, operation_start_date = ?, warranty_until = ?,
      technical_notes = ?, notes = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`
  ).run(
    serial, raw?.acquisition_date || null, raw?.supplier_id ? Number(raw.supplier_id) : null, cost, cons.includes(raw?.conservation) ? raw.conservation : a.conservation,
    raw?.operation_start_date || null, raw?.warranty_until || null, text(raw?.technical_notes, 4000), text(raw?.notes, 4000), id
  );
  assetEvent(db, id, 'cadastro', 'Dados cadastrais atualizados.', user);
  return loadAsset(db, id);
}

/** Mudança de estado operacional (manutenção, danificado, inspeção, baixa). Baixa exige gestor/admin. */
export function assetAction(db: DB, user: AuthUser, id: number, action: AssetAction, raw: any): Asset {
  const t = OPERATIONAL_TRANSITIONS[action];
  if (!t) throw badRequest('Ação inválida.');
  if (action === 'baixar' ? !stockCan.approve(user) : !stockCan.operate(user)) {
    throw forbidden(action === 'baixar' ? 'Baixa patrimonial exige perfil de gestor ou administrador.' : undefined);
  }
  const reason = text(raw?.reason, 1000);
  if (t.requiresReason && !reason) throw badRequest('Informe a justificativa.', { reason: 'Obrigatório.' });
  transaction(db, () => {
    const a = loadAsset(db, id);
    if (!t.from.includes(a.operational_status)) throw new HttpError(422, `Não é possível "${t.label}" com o equipamento "${OPERATIONAL_LABELS[a.operational_status as OperationalStatus]}".`);
    if (a.rental_status === 'alugado') throw new HttpError(422, 'Equipamento está alugado: registre o retorno antes.');
    if (a.rental_status === 'em_transito') throw new HttpError(422, 'Equipamento em trânsito: receba a transferência antes.');
    const wo = ['aprovar_inspecao', 'retornar_manutencao', 'enviar_inspecao'].includes(action) ? openBlockingOrder(db, id) : null;
    if (wo) throw new HttpError(422, `O equipamento está bloqueado pela ordem de serviço ${wo}: a liberação acontece pela OS.`);
    if (action === 'baixar') {
      const future = db.prepare("SELECT number FROM stock_reservations WHERE asset_id = ? AND status IN ('pendente','confirmada')").all(id) as { number: string }[];
      if (future.length) throw new HttpError(422, `Cancele antes as reservas abertas: ${future.map((f) => f.number).join(', ')}.`);
      if (a.location_id) {
        applyMovement(db, user, {
          type: 'baixa_perda_avaria', item_id: a.item_id, asset_id: id, quantity: 1, location_id: a.location_id, qty_delta: -1,
          origin_location_id: a.location_id, unit_cost: a.acquisition_cost, reason, document_type: 'baixa_patrimonial', document_id: id, allowUnavailable: true,
        });
      }
      db.prepare(`UPDATE stock_assets SET operational_status = 'baixado', written_off_at = ${NOW_SQL}, write_off_reason = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(reason, id);
      audit(db, 'stock_asset', id, 'write_off', user.id, { reason });
    } else {
      db.prepare(`UPDATE stock_assets SET operational_status = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(t.to, id);
      if (action === 'aprovar_inspecao') db.prepare(`UPDATE work_orders SET downtime_end = ${NOW_SQL} WHERE asset_id = ? AND status = 'concluida' AND downtime_start IS NOT NULL AND downtime_end IS NULL`).run(id);
    }
    assetEvent(db, id, action === 'baixar' ? 'baixa' : action === 'enviar_manutencao' ? 'manutencao' : action === 'aprovar_inspecao' ? 'liberacao' : 'status', `${t.label}${reason ? `: ${reason}` : ''}.`, user, { from: a.operational_status, to: t.to });
    refreshAssetRental(db, id);
  });
  return loadAsset(db, id);
}

const MAX_FILE = 1_500_000; // ~1,1 MB de arquivo em base64

export function addAssetFile(db: DB, user: AuthUser, id: number, raw: any) {
  if (!stockCan.operate(user)) throw forbidden();
  loadAsset(db, id);
  const kind = raw?.kind === 'documento' ? 'documento' : 'foto';
  const data = String(raw?.data || '');
  const m = /^data:([\w/+.-]+);base64,/.exec(data);
  if (!m) throw badRequest('Arquivo inválido.');
  const allowed = kind === 'foto' ? ['image/jpeg', 'image/png', 'image/webp'] : ['application/pdf', 'image/jpeg', 'image/png'];
  if (!allowed.includes(m[1])) throw badRequest(kind === 'foto' ? 'Foto deve ser JPG, PNG ou WEBP.' : 'Documento deve ser PDF, JPG ou PNG.');
  if (data.length > MAX_FILE) throw badRequest('Arquivo muito grande (máx. ~1 MB).');
  const name = text(raw?.name, 120) || (kind === 'foto' ? 'foto' : 'documento');
  const size = Math.round(((data.length - m[0].length) * 3) / 4);
  db.prepare('INSERT INTO stock_asset_files (asset_id, kind, name, mime, size, data, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, kind, name, m[1], size, data, user.id);
  assetEvent(db, id, 'arquivo', `${kind === 'foto' ? 'Foto' : 'Documento'} anexado: ${name}.`, user);
}

export function getAssetFile(db: DB, assetId: number, fileId: number) {
  const f = db.prepare('SELECT * FROM stock_asset_files WHERE id = ? AND asset_id = ?').get(fileId, assetId) as any;
  if (!f) throw notFound('Arquivo não encontrado.');
  return f;
}

// ================================================ RESERVAS

export function listReservations(db: DB, f: Record<string, string | undefined>) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.status) {
    const st = f.status.split(',');
    where.push(`r.status IN (${st.map(() => '?').join(',')})`);
    params.push(...st);
  }
  if (f.asset_id) {
    where.push('r.asset_id = ?');
    params.push(Number(f.asset_id));
  }
  if (f.item_id) {
    where.push('r.item_id = ?');
    params.push(Number(f.item_id));
  }
  if (f.from && f.to) {
    where.push('r.start_date <= ? AND r.end_date >= ?');
    params.push(f.to, f.from);
  }
  if (f.q?.trim()) {
    where.push('(r.number LIKE ? OR r.customer_name LIKE ? OR a.asset_tag LIKE ? OR i.description LIKE ?)');
    const q = `%${f.q.trim()}%`;
    params.push(q, q, q, q);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { rows: db.prepare(`${RES_SELECT} ${w} ORDER BY r.start_date DESC, r.id DESC LIMIT 500`).all(...params) as unknown as Reservation[] };
}

function loadReservation(db: DB, id: number): Reservation {
  const r = db.prepare(`${RES_SELECT} WHERE r.id = ?`).get(id) as unknown as Reservation | undefined;
  if (!r) throw notFound('Reserva não encontrada.');
  return r;
}

/** Reservas que ocupam agenda: confirmadas e em uso (pendentes e canceladas NÃO bloqueiam). */
const BLOCKING: ReservationStatus[] = ['confirmada', 'em_uso'];

function capacityForQuantityItem(db: DB, itemId: number): number {
  // patrimônio utilizável = físico disponível em todos os locais (sem indisponíveis) + o que está com clientes
  const bal = db.prepare('SELECT COALESCE(SUM(quantity - unavailable),0) q FROM stock_balances WHERE item_id = ?').get(itemId) as { q: number };
  const onRent = db.prepare("SELECT COALESCE(SUM(quantity),0) q FROM stock_reservations WHERE item_id = ? AND asset_id IS NULL AND status = 'em_uso'").get(itemId) as { q: number };
  return round3(bal.q + onRent.q);
}

/** Verifica se a reserva cabe na agenda. Retorna mensagem de conflito ou null. */
export function reservationConflict(db: DB, r: { item_id: number; asset_id: number | null; quantity: number; start_date: string; end_date: string }, ignoreId = 0): string | null {
  const placeholders = BLOCKING.map(() => '?').join(',');
  if (r.asset_id) {
    const a = db.prepare('SELECT asset_tag, operational_status FROM stock_assets WHERE id = ?').get(r.asset_id) as any;
    if (!a) return 'Equipamento não encontrado.';
    if (a.operational_status === 'baixado') return `${a.asset_tag} está baixado.`;
    if (!RENTABLE_OPERATIONAL.includes(a.operational_status)) return `${a.asset_tag} está "${OPERATIONAL_LABELS[a.operational_status as OperationalStatus]}" e não pode ser reservado.`;
    const wo = openBlockingOrder(db, r.asset_id);
    if (wo) return `${a.asset_tag} está bloqueado pela ordem de serviço ${wo}.`;
    const clash = db
      .prepare(`SELECT number, start_date, end_date FROM stock_reservations WHERE asset_id = ? AND status IN (${placeholders}) AND id != ? AND start_date <= ? AND end_date >= ?`)
      .get(r.asset_id, ...BLOCKING, ignoreId, r.end_date, r.start_date) as any;
    if (clash) return `${a.asset_tag} já está reservado/alugado de ${clash.start_date.split('-').reverse().join('/')} a ${clash.end_date.split('-').reverse().join('/')} (${clash.number}).`;
    return null;
  }
  const existing = db
    .prepare(`SELECT start_date, end_date, quantity FROM stock_reservations WHERE item_id = ? AND asset_id IS NULL AND status IN (${placeholders}) AND id != ?`)
    .all(r.item_id, ...BLOCKING, ignoreId) as { start_date: string; end_date: string; quantity: number }[];
  const cap = capacityForQuantityItem(db, r.item_id);
  const peak = peakUsage(existing, r.start_date, r.end_date, r.quantity);
  if (peak > cap + 1e-9) return `Quantidade insuficiente no período: capacidade ${cap.toLocaleString('pt-BR')}, já comprometido ${round3(peak - r.quantity).toLocaleString('pt-BR')}.`;
  return null;
}

function normalizeReservation(db: DB, raw: any) {
  const item = getItemOrThrow(db, Number(raw?.item_id));
  if (!item.rental_enabled) throw badRequest(`${item.internal_code} não está habilitado para locação.`);
  const start = raw?.start_date;
  const end = raw?.end_date;
  if (!isISODate(start) || !isISODate(end)) throw badRequest('Informe início e término.', { start_date: 'Obrigatório.' });
  if (end < start) throw badRequest('O término não pode ser anterior ao início.', { end_date: 'Data inválida.' });
  let asset_id: number | null = null;
  let quantity = 1;
  if (item.tracking === 'individual') {
    asset_id = Number(raw?.asset_id);
    if (!db.prepare('SELECT 1 FROM stock_assets WHERE id = ? AND item_id = ?').get(asset_id, item.id)) throw badRequest('Selecione o patrimônio.', { asset_id: 'Obrigatório.' });
  } else {
    quantity = Number(raw?.quantity);
    assertQuantity(quantity);
  }
  const customer_id = raw?.customer_id ? Number(raw.customer_id) : null;
  let customer_name = text(raw?.customer_name, 200);
  if (customer_id) {
    const c = db.prepare('SELECT name FROM customers WHERE id = ?').get(customer_id) as { name: string } | undefined;
    if (!c) throw badRequest('Cliente não encontrado.');
    customer_name = c.name;
  }
  const quotation_id = raw?.quotation_id ? Number(raw.quotation_id) : null;
  if (quotation_id) {
    const q = db.prepare('SELECT status, quotation_type FROM quotations WHERE id = ?').get(quotation_id) as any;
    if (!q) throw badRequest('Orçamento não encontrado.');
    if (q.quotation_type !== 'locacao') throw badRequest('O orçamento vinculado deve ser de locação.');
    if (['recusado', 'cancelado', 'expirado'].includes(q.status)) throw badRequest('Orçamento recusado, cancelado ou expirado não pode originar reserva.');
  }
  const location_id = raw?.location_id ? assertLocation(db, raw.location_id) : item.default_location_id;
  return { item_id: item.id, asset_id, quantity, start_date: start, end_date: end, customer_id, customer_name, quotation_id, contract_ref: text(raw?.contract_ref, 80), location_id, notes: text(raw?.notes, 2000) };
}

export function createReservation(db: DB, user: AuthUser, raw: any): Reservation {
  if (!stockCan.requestReservation(user)) throw forbidden();
  const r = normalizeReservation(db, raw);
  const confirm = !!raw?.confirm && stockCan.confirmReservation(user);
  if (!r.customer_name) throw badRequest('Informe o cliente.', { customer_name: 'Obrigatório.' });
  const id = transaction(db, () => insertReservationTx(db, user, r, confirm));
  return loadReservation(db, id);
}

export interface ReservationRow {
  item_id: number;
  asset_id: number | null;
  quantity: number;
  start_date: string;
  end_date: string;
  customer_id: number | null;
  customer_name: string | null;
  quotation_id: number | null;
  contract_ref: string | null;
  location_id: number | null;
  notes: string | null;
  contract_id?: number | null;
  contract_item_id?: number | null;
}

/**
 * Grava a reserva (deve rodar DENTRO de uma transação). Se confirmada, revalida o conflito ali mesmo:
 * usado também pelo módulo de Contratos.
 */
export function insertReservationTx(db: DB, user: AuthUser, r: ReservationRow, confirm: boolean, status: 'pendente' | 'confirmada' | 'em_uso' = confirm ? 'confirmada' : 'pendente'): number {
  if (confirm) {
    const c = reservationConflict(db, r);
    if (c) throw new HttpError(409, c);
  }
  const row = db
    .prepare(
      `INSERT INTO stock_reservations (number, item_id, asset_id, quantity, start_date, end_date, status, customer_id, customer_name, quotation_id, contract_ref, location_id, notes, created_by, confirmed_by, contract_id, contract_item_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(nextNumber(db, 'RES'), r.item_id, r.asset_id, r.quantity, r.start_date, r.end_date, status, r.customer_id, r.customer_name, r.quotation_id, r.contract_ref, r.location_id, r.notes, user.id, confirm ? user.id : null, r.contract_id ?? null, r.contract_item_id ?? null) as {
    id: number;
  };
  if (r.asset_id && status !== 'em_uso') {
    assetEvent(db, r.asset_id, 'reserva', `Reserva ${confirm ? 'confirmada' : 'solicitada'} para ${r.customer_name} de ${r.start_date.split('-').reverse().join('/')} a ${r.end_date.split('-').reverse().join('/')}${r.contract_ref ? ` (${r.contract_ref})` : ''}.`, user);
    refreshAssetRental(db, r.asset_id);
  }
  return row.id;
}

export function reservationAction(db: DB, user: AuthUser, id: number, action: string, raw: any): Reservation {
  transaction(db, () => {
    const r = loadReservation(db, id);
    const need = (st: ReservationStatus[]) => {
      if (!st.includes(r.status)) throw new HttpError(422, `Ação indisponível para reserva "${RESERVATION_LABELS[r.status]}".`);
    };
    if (action === 'confirmar') {
      if (!stockCan.confirmReservation(user)) throw forbidden();
      need(['pendente']);
      const c = reservationConflict(db, r, id);
      if (c) throw new HttpError(409, c);
      db.prepare(`UPDATE stock_reservations SET status = 'confirmada', confirmed_by = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(user.id, id);
      if (r.asset_id) assetEvent(db, r.asset_id, 'reserva', `Reserva ${r.number} confirmada.`, user);
    } else if (action === 'cancelar') {
      if (!stockCan.requestReservation(user)) throw forbidden();
      need(['pendente', 'confirmada']);
      const reason = text(raw?.reason, 500);
      if (!reason) throw badRequest('Informe o motivo do cancelamento.', { reason: 'Obrigatório.' });
      cancelReservationTx(db, user, r, reason);
    } else if (action === 'entregar') {
      if (!stockCan.operate(user)) throw forbidden();
      need(['confirmada']);
      deliverReservationTx(db, user, r, raw);
    } else if (action === 'retornar') {
      if (!stockCan.operate(user)) throw forbidden();
      need(['em_uso']);
      returnReservationTx(db, user, r, raw);
    } else throw badRequest('Ação inválida.');
    if (r.asset_id) refreshAssetRental(db, r.asset_id);
    audit(db, 'stock_reservation', id, action, user.id);
  });
  return loadReservation(db, id);
}

export function getReservation(db: DB, id: number): Reservation {
  return loadReservation(db, id);
}

/** Cancela reserva pendente/confirmada (dentro de transação). */
export function cancelReservationTx(db: DB, user: AuthUser, r: Reservation, reason: string) {
  db.prepare(`UPDATE stock_reservations SET status = 'cancelada', cancel_reason = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(reason, r.id);
  if (r.asset_id) {
    assetEvent(db, r.asset_id, 'reserva', `Reserva ${r.number} cancelada: ${reason}.`, user);
    refreshAssetRental(db, r.asset_id);
  }
}

/** Saída física para locação de uma reserva confirmada (dentro de transação). Revalida o equipamento. */
export function deliverReservationTx(db: DB, user: AuthUser, r: Reservation, raw: any) {
  if (r.status !== 'confirmada') throw new HttpError(422, `A reserva ${r.number} não está confirmada.`);
  const loc = r.asset_id ? (db.prepare('SELECT location_id FROM stock_assets WHERE id = ?').get(r.asset_id) as any).location_id : assertLocation(db, raw?.location_id || r.location_id, 'Local de saída');
  if (r.asset_id) {
    const a = db.prepare('SELECT asset_tag, operational_status, rental_status FROM stock_assets WHERE id = ?').get(r.asset_id) as any;
    if (!RENTABLE_OPERATIONAL.includes(a.operational_status)) throw new HttpError(422, `${a.asset_tag} está "${OPERATIONAL_LABELS[a.operational_status as OperationalStatus]}" e não pode ser entregue.`);
    if (a.rental_status === 'em_transito') throw new HttpError(422, `${a.asset_tag} está em trânsito e não está fisicamente disponível para entrega.`);
    if (a.rental_status === 'alugado') throw new HttpError(422, `${a.asset_tag} ainda está com outro cliente.`);
    if (!loc) throw new HttpError(422, `${a.asset_tag} está sem localização definida.`);
    const wo = openBlockingOrder(db, r.asset_id);
    if (wo) throw new HttpError(422, `${a.asset_tag} está bloqueado pela ordem de serviço ${wo}.`);
  }
  const movementId = applyMovement(db, user, {
    type: 'saida_locacao', item_id: r.item_id, asset_id: r.asset_id, quantity: r.quantity, location_id: loc, qty_delta: -r.quantity,
    origin_location_id: loc, reference_doc: r.contract_ref || r.number, reason: `Entrega a ${r.customer_name}`, document_type: 'reserva', document_id: r.id,
  });
  db.prepare(`UPDATE stock_reservations SET status = 'em_uso', delivered_at = ${NOW_SQL}, location_id = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(loc, r.id);
  if (r.asset_id) {
    db.prepare(`UPDATE stock_assets SET operational_status = CASE WHEN operational_status = 'novo' THEN 'operacional' ELSE operational_status END,
      operation_start_date = COALESCE(operation_start_date, ?) WHERE id = ?`).run(todayISO(), r.asset_id);
    assetEvent(db, r.asset_id, 'entrega', `Entregue ao cliente ${r.customer_name} (${r.number}${r.contract_ref ? ` / ${r.contract_ref}` : ''}).`, user);
    refreshAssetRental(db, r.asset_id);
  }
  return movementId;
}

/**
 * Retorno de uma reserva em uso (dentro de transação). Individual: volta "aguardando inspeção".
 * Por quantidade: devolvidas + avariadas + faltantes = quantidade da reserva; avariadas voltam indisponíveis.
 */
export function returnReservationTx(db: DB, user: AuthUser, r: Reservation, raw: any) {
  if (r.status !== 'em_uso') throw new HttpError(422, `A reserva ${r.number} não está em uso.`);
  const loc = assertLocation(db, raw?.location_id || r.location_id, 'Local de retorno');
  if (r.asset_id) {
    // equipamento volta fisicamente e fica aguardando inspeção (não volta disponível sozinho)
    applyMovement(db, user, {
      type: 'retorno_locacao', item_id: r.item_id, asset_id: r.asset_id, quantity: 1, location_id: loc, qty_delta: 1,
      dest_location_id: loc, reference_doc: r.contract_ref || r.number, reason: `Retorno de ${r.customer_name}`, document_type: 'reserva', document_id: r.id,
    });
    db.prepare(`UPDATE stock_assets SET location_id = ?, operational_status = 'aguardando_inspecao', updated_at = ${NOW_SQL} WHERE id = ?`).run(loc, r.asset_id);
    db.prepare(`UPDATE stock_reservations SET status = 'concluida', returned_at = ${NOW_SQL}, returned_qty = 1, damaged_qty = 0, missing_qty = 0, notes = COALESCE(notes || char(10), '') || ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(
      `Retorno: ${text(raw?.notes, 1000) || 'sem observações'}`,
      r.id
    );
    assetEvent(db, r.asset_id, 'retorno', `Retornou de ${r.customer_name}. Aguardando inspeção.${raw?.notes ? ` Obs.: ${text(raw.notes, 500)}` : ''}`, user);
    refreshAssetRental(db, r.asset_id);
  } else {
    const ok = Number(raw?.returned_qty ?? r.quantity);
    const damaged = Number(raw?.damaged_qty ?? 0);
    const missing = Number(raw?.missing_qty ?? 0);
    if ([ok, damaged, missing].some((v) => !Number.isFinite(v) || v < 0)) throw badRequest('Quantidades inválidas.');
    if (Math.abs(ok + damaged + missing - r.quantity) > 1e-9) throw badRequest(`Devolvidas + avariadas + faltantes deve somar ${r.quantity.toLocaleString('pt-BR')}.`);
    if (ok + damaged > 0) {
      // avariadas voltam ao local, mas como indisponíveis até avaliação
      applyMovement(db, user, {
        type: 'retorno_locacao', item_id: r.item_id, quantity: ok + damaged, location_id: loc, qty_delta: ok + damaged, unavailable_delta: damaged,
        dest_location_id: loc, reference_doc: r.contract_ref || r.number, reason: `Retorno de ${r.customer_name}${damaged ? ` (${damaged} avariada(s))` : ''}`,
        document_type: 'reserva', document_id: r.id,
      });
    }
    if (missing > 0) {
      // já saiu do local na entrega: registra a perda sem novo efeito no saldo (documentada para cobrança futura)
      applyMovement(db, user, {
        type: 'baixa_perda_avaria', item_id: r.item_id, quantity: missing, location_id: null, qty_delta: 0,
        reference_doc: r.contract_ref || r.number, reason: `Não devolvido por ${r.customer_name} — indenização a apurar`, document_type: 'reserva', document_id: r.id,
      });
    }
    db.prepare(`UPDATE stock_reservations SET status = 'concluida', returned_at = ${NOW_SQL}, returned_qty = ?, damaged_qty = ?, missing_qty = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(ok, damaged, missing, r.id);
  }
}

/**
 * Divide uma reserva por quantidade (entrega/devolução parcial): a original fica com o restante e
 * uma nova reserva, no mesmo status, recebe a parte informada. Dentro de transação.
 */
export function splitReservationTx(db: DB, user: AuthUser, r: Reservation, part: number): Reservation {
  if (r.asset_id) throw badRequest('Reserva de equipamento individual não pode ser dividida.');
  if (!(part > 0) || part >= r.quantity - 1e-9) throw badRequest('Quantidade parcial inválida.');
  db.prepare(`UPDATE stock_reservations SET quantity = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(round3(r.quantity - part), r.id);
  const row = db
    .prepare(
      `INSERT INTO stock_reservations (number, item_id, asset_id, quantity, start_date, end_date, status, customer_id, customer_name, quotation_id, contract_ref, location_id, delivered_at, notes, created_by, confirmed_by, contract_id, contract_item_id)
       SELECT ?, item_id, NULL, ?, start_date, end_date, status, customer_id, customer_name, quotation_id, contract_ref, location_id, delivered_at, ?, ?, confirmed_by, contract_id, contract_item_id
       FROM stock_reservations WHERE id = ? RETURNING id`
    )
    .get(nextNumber(db, 'RES'), part, `Desmembrada de ${r.number}`, user.id, r.id) as { id: number };
  return loadReservation(db, row.id);
}


/** Inspeção de equipamento individual que está "aguardando inspeção". */
export function inspectAsset(db: DB, user: AuthUser, id: number, raw: any) {
  if (!stockCan.operate(user)) throw forbidden();
  transaction(db, () => inspectAssetTx(db, user, id, raw));
  return loadAsset(db, id);
}

/** Registra a inspeção (dentro de transação). Também usada na devolução de contrato já conferida. */
export function inspectAssetTx(db: DB, user: AuthUser, id: number, raw: any) {
  const result = raw?.result;
  if (!['aprovado', 'manutencao', 'danificado'].includes(result)) throw badRequest('Selecione o resultado da inspeção.');
  const checklist: Record<string, boolean> = {};
  for (const c of INSPECTION_CHECKLIST) checklist[c.key] = !!raw?.checklist?.[c.key];
  const notes = text(raw?.notes, 2000);
  if (result === 'aprovado' && INSPECTION_CHECKLIST.some((c) => !checklist[c.key])) throw badRequest('Para aprovar, todos os itens do checklist devem estar conferidos.');
  if (result !== 'aprovado' && !notes) throw badRequest('Descreva o problema encontrado.', { notes: 'Obrigatório.' });
  {
    const a = loadAsset(db, id);
    if (a.operational_status !== 'aguardando_inspecao') throw new HttpError(422, 'Somente equipamentos aguardando inspeção podem ser inspecionados.');
    const wo = result === 'aprovado' ? openBlockingOrder(db, id) : null;
    if (wo) throw new HttpError(422, `Conclua antes a ordem de serviço ${wo}: o equipamento está bloqueado para manutenção.`);
    const lastRes = db.prepare("SELECT id FROM stock_reservations WHERE asset_id = ? AND status = 'concluida' ORDER BY returned_at DESC LIMIT 1").get(id) as { id: number } | undefined;
    db.prepare('INSERT INTO stock_inspections (asset_id, reservation_id, result, checklist, notes, inspected_by) VALUES (?, ?, ?, ?, ?, ?)').run(id, lastRes?.id ?? null, result, JSON.stringify(checklist), notes, user.id);
    const to = result === 'aprovado' ? 'operacional' : result === 'manutencao' ? 'em_manutencao' : 'danificado';
    db.prepare(`UPDATE stock_assets SET operational_status = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(to, id);
    // liberação após manutenção: encerra o período de indisponibilidade das OS concluídas
    if (result === 'aprovado') db.prepare(`UPDATE work_orders SET downtime_end = ${NOW_SQL} WHERE asset_id = ? AND status = 'concluida' AND downtime_start IS NOT NULL AND downtime_end IS NULL`).run(id);
    assetEvent(db, id, result === 'aprovado' ? 'liberacao' : 'inspecao', `Inspeção: ${result === 'aprovado' ? 'aprovado e liberado para locação' : result === 'manutencao' ? 'encaminhado para manutenção' : 'danificado — bloqueado até avaliação'}${notes ? ` (${notes})` : ''}.`, user, { checklist });
    refreshAssetRental(db, id);
  }
}

// ================================================ DISPONIBILIDADE

export interface AvailabilityRow {
  item_id: number;
  item_code: string;
  item_description: string;
  category: string | null;
  tracking: 'quantidade' | 'individual';
  asset_id: number | null;
  asset_tag: string | null;
  location_name: string | null;
  operational_status: string | null;
  rental_status: string | null;
  available_in_period: boolean;
  capacity: number | null;
  committed: number | null;
  free_qty: number | null;
  next_reservation: { number: string; start_date: string; end_date: string; customer_name: string | null } | null;
  current_rental: { number: string; end_date: string; customer_name: string | null; contract_ref: string | null } | null;
  available_from: string | null;
  reason: string | null;
}

/** Disponibilidade por equipamento (individuais) ou por quantidade, para um período. */
export function availability(db: DB, f: Record<string, string | undefined>): AvailabilityRow[] {
  const today = todayISO();
  const start = isISODate(f.from) ? f.from! : today;
  const end = isISODate(f.to) && f.to! >= start ? f.to! : start;
  const where: string[] = ['i.rental_enabled = 1', 'i.active = 1'];
  const params: (string | number)[] = [];
  if (f.category) {
    where.push('i.category = ?');
    params.push(f.category);
  }
  if (f.q?.trim()) {
    where.push('(i.internal_code LIKE ? OR i.description LIKE ?)');
    params.push(`%${f.q.trim()}%`, `%${f.q.trim()}%`);
  }
  if (f.item_id) {
    where.push('i.id = ?');
    params.push(Number(f.item_id));
  }
  const items = db.prepare(`SELECT * FROM catalog_items i WHERE ${where.join(' AND ')} ORDER BY i.internal_code`).all(...params) as any[];
  const out: AvailabilityRow[] = [];
  for (const it of items) {
    if (it.tracking === 'individual') {
      const aw: string[] = ['a.item_id = ?', "a.operational_status != 'baixado'"];
      const ap: (string | number)[] = [it.id];
      if (f.location_id) {
        aw.push('a.location_id = ?');
        ap.push(Number(f.location_id));
      }
      const assets = db.prepare(`SELECT a.*, l.name AS location_name FROM stock_assets a LEFT JOIN stock_locations l ON l.id = a.location_id WHERE ${aw.join(' AND ')} ORDER BY a.asset_tag`).all(...ap) as any[];
      for (const a of assets) {
        const res = db.prepare("SELECT number, start_date, end_date, customer_name, contract_ref, status FROM stock_reservations WHERE asset_id = ? AND status IN ('confirmada','em_uso') ORDER BY start_date").all(a.id) as any[];
        const current = res.find((r) => r.status === 'em_uso') || null;
        const clash = res.find((r) => datesOverlap(r.start_date, r.end_date, start, end));
        const next = res.find((r) => r.status === 'confirmada' && r.end_date >= today) || null;
        let reason: string | null = null;
        if (!RENTABLE_OPERATIONAL.includes(a.operational_status)) reason = `Estado operacional: ${OPERATIONAL_LABELS[a.operational_status as OperationalStatus]}`;
        else if (a.rental_status === 'em_transito') reason = 'Em trânsito entre locais';
        else if (clash) reason = `Ocupado por ${clash.number} (${clash.start_date.split('-').reverse().join('/')}–${clash.end_date.split('-').reverse().join('/')})`;
        // previsão: fim da locação/reserva vigente + 1 dia (sujeito a inspeção)
        let from: string | null = null;
        if (!reason) from = start;
        else if (RENTABLE_OPERATIONAL.includes(a.operational_status) || a.operational_status === 'aguardando_inspecao') {
          const blocking = res.filter((r) => r.end_date >= start).map((r) => r.end_date).sort().pop();
          if (blocking) from = new Date(Date.parse(blocking + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
        }
        const row: AvailabilityRow = {
          item_id: it.id, item_code: it.internal_code, item_description: it.description, category: it.category, tracking: 'individual',
          asset_id: a.id, asset_tag: a.asset_tag, location_name: a.location_name, operational_status: a.operational_status, rental_status: a.rental_status,
          available_in_period: !reason, capacity: null, committed: null, free_qty: null,
          next_reservation: next ? { number: next.number, start_date: next.start_date, end_date: next.end_date, customer_name: next.customer_name } : null,
          current_rental: current ? { number: current.number, end_date: current.end_date, customer_name: current.customer_name, contract_ref: current.contract_ref } : null,
          available_from: from, reason,
        };
        if (!f.situation || (f.situation === 'disponivel' ? row.available_in_period : !row.available_in_period)) out.push(row);
      }
    } else {
      const existing = db.prepare("SELECT start_date, end_date, quantity, number, customer_name, status, contract_ref FROM stock_reservations WHERE item_id = ? AND asset_id IS NULL AND status IN ('confirmada','em_uso') ORDER BY start_date").all(it.id) as any[];
      const cap = capacityForQuantityItem(db, it.id);
      const committed = peakUsage(existing, start, end, 0);
      const free = round3(cap - committed);
      const next = existing.find((r) => r.status === 'confirmada' && r.end_date >= today) || null;
      const row: AvailabilityRow = {
        item_id: it.id, item_code: it.internal_code, item_description: it.description, category: it.category, tracking: 'quantidade',
        asset_id: null, asset_tag: null, location_name: null, operational_status: null, rental_status: null,
        available_in_period: free > 0, capacity: cap, committed, free_qty: free,
        next_reservation: next ? { number: next.number, start_date: next.start_date, end_date: next.end_date, customer_name: next.customer_name } : null,
        current_rental: null, available_from: free > 0 ? start : null, reason: free > 0 ? null : 'Sem quantidade livre no período',
      };
      if (!f.situation || (f.situation === 'disponivel' ? row.available_in_period : !row.available_in_period)) out.push(row);
    }
  }
  return out;
}

/** Usado pelos Orçamentos: verifica (sem reservar) se os itens cabem no período. */
export function checkQuotationAvailability(db: DB, items: { catalog_item_id: number; quantity: number }[], start: string | null, end: string | null) {
  if (!start || !end) throw badRequest('O orçamento precisa de período de locação para verificar disponibilidade.');
  const needed = new Map<number, number>();
  for (const i of items) needed.set(i.catalog_item_id, (needed.get(i.catalog_item_id) || 0) + i.quantity);
  return [...needed.entries()].map(([itemId, qty]) => {
    const rows = availability(db, { from: start, to: end, item_id: String(itemId) });
    const free = rows.length && rows[0].tracking === 'quantidade' ? rows[0].free_qty || 0 : rows.filter((r) => r.available_in_period).length;
    const total = rows.length && rows[0].tracking === 'quantidade' ? rows[0].capacity || 0 : rows.length;
    const status = free >= qty ? 'confirmada' : total === 0 || free === 0 ? 'indisponivel' : 'insuficiente';
    return { catalog_item_id: itemId, needed: qty, free, status: status as 'confirmada' | 'insuficiente' | 'indisponivel' };
  });
}
