/**
 * Núcleo da Logística (entregas, retiradas e devoluções): cadastros de apoio, programação,
 * validação contra o contrato e o Estoque, leitura e anexos.
 *
 * A movimentação física continua sendo a do módulo de Contratos (deliverTx/returnItemsTx),
 * que por sua vez usa as reservas e movimentos do Estoque. Aqui não existe outro controle de estoque.
 */

import { DB, audit, transaction } from '../../db';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { round3, RENTABLE_OPERATIONAL } from '../../../shared/estoque/rules';
import { OPERATIONAL_LABELS, OperationalStatus } from '../../../shared/estoque/types';
import { reservationEnd } from '../../../shared/contratos/rules';
import { OpDetail, OpStatus, OpType, PickupReason } from '../../../shared/logistica/types';
import { logCan } from '../../../shared/logistica/rules';
import { nextNumber, openBlockingOrder } from '../stock/core';
import { availability } from '../stock/rental';
import { loadItems } from '../contracts/core';

export const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export const text = (v: unknown, max = 500) => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t === '' ? null : t;
};
export const isoOrNull = (v: unknown) => (typeof v === 'string' && v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

// ------------------------------------------------ eventos

export function logEvent(db: DB, ref: { order_id?: number | null; occurrence_id?: number | null }, type: string, description: string, user: AuthUser | null, prev: string | null = null, next: string | null = null) {
  db.prepare('INSERT INTO logistics_events (order_id, occurrence_id, event_type, previous_status, new_status, description, performed_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    ref.order_id ?? null, ref.occurrence_id ?? null, type, prev, next, description, user?.id ?? null
  );
}

export function setOpStatus(db: DB, o: { id: number; status: OpStatus }, to: OpStatus, user: AuthUser, description: string, extraSql = '', params: (string | number | null)[] = []) {
  const res = db
    .prepare(`UPDATE logistics_orders SET status = ?, ${extraSql ? `${extraSql},` : ''} updated_by = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ? AND status = ?`)
    .run(to, ...params, user.id, o.id, o.status);
  if (!res.changes) throw conflict('A operação foi alterada por outra pessoa. Atualize a tela e tente novamente.');
  logEvent(db, { order_id: o.id }, 'status', description, user, o.status, to);
}

export function loadOrder(db: DB, id: number) {
  const o = db.prepare('SELECT * FROM logistics_orders WHERE id = ?').get(id) as any;
  if (!o) throw notFound('Operação não encontrada.');
  return o;
}

// ------------------------------------------------ motoristas e veículos

export function listRegistry(db: DB) {
  return {
    drivers: (db.prepare('SELECT * FROM logistics_drivers ORDER BY active DESC, name').all() as any[]).map((d) => ({ ...d, active: !!d.active })),
    vehicles: (db.prepare('SELECT * FROM logistics_vehicles ORDER BY active DESC, plate').all() as any[]).map((v) => ({ ...v, active: !!v.active })),
  };
}

export function saveDriver(db: DB, user: AuthUser, id: number | null, raw: any) {
  if (!logCan.registry(user)) throw forbidden();
  const name = text(raw?.name, 120);
  if (!name) throw badRequest('Informe o nome do motorista.', { name: 'Obrigatório.' });
  const vals = [name, text(raw?.document, 30), text(raw?.phone, 30), raw?.user_id ? Number(raw.user_id) : null, raw?.active === false ? 0 : 1];
  if (id) db.prepare('UPDATE logistics_drivers SET name = ?, document = ?, phone = ?, user_id = ?, active = ? WHERE id = ?').run(...vals, id);
  else id = (db.prepare('INSERT INTO logistics_drivers (name, document, phone, user_id, active) VALUES (?, ?, ?, ?, ?) RETURNING id').get(...vals) as { id: number }).id;
  audit(db, 'logistics_driver', id!, 'save', user.id);
  return { id };
}

export function saveVehicle(db: DB, user: AuthUser, id: number | null, raw: any) {
  if (!logCan.registry(user)) throw forbidden();
  const plate = text(raw?.plate, 12)?.toUpperCase();
  const description = text(raw?.description, 120);
  if (!plate || !description) throw badRequest('Informe placa e descrição.', { plate: 'Obrigatório.' });
  const vals = [plate, description, text(raw?.capacity, 60), raw?.active === false ? 0 : 1];
  if (id) db.prepare('UPDATE logistics_vehicles SET plate = ?, description = ?, capacity = ?, active = ? WHERE id = ?').run(...vals, id);
  else id = (db.prepare('INSERT INTO logistics_vehicles (plate, description, capacity, active) VALUES (?, ?, ?, ?) RETURNING id').get(...vals) as { id: number }).id;
  audit(db, 'logistics_vehicle', id!, 'save', user.id);
  return { id };
}

// ------------------------------------------------ saldo do contrato para programar

const OPEN_DELIVERY = "('rascunho','programada','em_separacao','pronta','em_transporte')";
const OPEN_RETURN = "('rascunho','programada','em_andamento')";

/** Itens do contrato com o que ainda pode ser programado (descontando operações em aberto). */
export function contractPlanning(db: DB, contractId: number, type: OpType, ignoreOrderId = 0) {
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(contractId) as any;
  if (!c) throw notFound('Contrato não encontrado.');
  const items = loadItems(db, contractId);
  return {
    contract: c,
    items: items.map((it) => {
      const planned = (
        db
          .prepare(
            `SELECT COALESCE(SUM(li.quantity_planned - li.quantity_processed),0) q FROM logistics_order_items li JOIN logistics_orders o ON o.id = li.order_id
             WHERE li.contract_item_id = ? AND o.id != ? AND o.op_type ${type === 'entrega' ? "= 'entrega'" : "IN ('retirada','devolucao')"} AND o.status IN ${type === 'entrega' ? OPEN_DELIVERY : OPEN_RETURN}`
          )
          .get(it.id, ignoreOrderId) as { q: number }
      ).q;
      const base = type === 'entrega' ? (it.modality === 'venda' ? it.quantity - it.sold_delivered_qty : it.quantity - it.delivered_qty - it.returned_qty) : it.modality === 'venda' ? 0 : it.delivered_qty;
      return { ...it, planned_elsewhere: round3(planned), available_to_plan: Math.max(0, round3(base - planned)) };
    }),
  };
}

/** Bloqueios do equipamento para entrega (manutenção, inspeção, OS, outra locação/reserva no período). */
export function deliveryBlockers(db: DB, c: any, it: any, qty: number): string | null {
  if (it.modality === 'venda') return null; // conferido no estoque na confirmação
  const end = reservationEnd(c.end_date);
  if (it.tracking === 'individual') {
    if (!it.asset_id) return `${it.item_code}: o contrato ainda não definiu o patrimônio.`;
    const a = db.prepare('SELECT asset_tag, operational_status FROM stock_assets WHERE id = ?').get(it.asset_id) as any;
    if (!RENTABLE_OPERATIONAL.includes(a.operational_status)) return `${a.asset_tag} está "${OPERATIONAL_LABELS[a.operational_status as OperationalStatus]}".`;
    const wo = openBlockingOrder(db, it.asset_id);
    if (wo) return `${a.asset_tag} está bloqueado pela ordem de serviço ${wo}.`;
    const clash = db
      .prepare("SELECT number, contract_ref FROM stock_reservations WHERE asset_id = ? AND status IN ('confirmada','em_uso') AND (contract_id IS NULL OR contract_id != ?) AND start_date <= ? AND end_date >= ?")
      .get(it.asset_id, c.id, end, c.start_date) as any;
    if (clash) return `${a.asset_tag} tem outra reserva/locação no período (${clash.number}${clash.contract_ref ? ` — ${clash.contract_ref}` : ''}).`;
    return null;
  }
  const own = (db.prepare("SELECT COALESCE(SUM(quantity),0) q FROM stock_reservations WHERE contract_item_id = ? AND status = 'confirmada'").get(it.id) as { q: number }).q;
  if (own + 1e-9 >= qty) return null;
  const av = availability(db, { from: c.start_date, to: end, item_id: String(it.item_id) })[0];
  const free = av?.free_qty ?? 0;
  if (free + own + 1e-9 < qty) return `${it.item_code}: disponível no período ${round3(free + own)} ${it.unit}, programado ${qty}.`;
  return null;
}

// ------------------------------------------------ programação

function normalizeHeader(db: DB, raw: any, type: OpType) {
  const errors: Record<string, string> = {};
  const scheduled_at = isoOrNull(raw?.scheduled_at);
  if (!scheduled_at) errors.scheduled_at = 'Informe data e horário programados.';
  const transport_type = ['proprio', 'terceiro', 'cliente'].includes(raw?.transport_type) ? raw.transport_type : type === 'devolucao' ? 'cliente' : 'proprio';
  const address = text(raw?.address, 500);
  if (type !== 'devolucao' && transport_type !== 'cliente' && !address) errors.address = 'Informe o endereço da operação.';
  const reason: PickupReason | null = type === 'entrega' ? null : ['fim_contrato', 'antecipada', 'substituicao', 'manutencao', 'outra'].includes(raw?.reason) ? raw.reason : null;
  if (type !== 'entrega' && !reason) errors.reason = 'Informe o motivo.';
  const driver_id = raw?.driver_id ? Number(raw.driver_id) : null;
  if (driver_id && !db.prepare('SELECT 1 FROM logistics_drivers WHERE id = ? AND active = 1').get(driver_id)) errors.driver_id = 'Motorista inválido.';
  const vehicle_id = raw?.vehicle_id ? Number(raw.vehicle_id) : null;
  if (vehicle_id && !db.prepare('SELECT 1 FROM logistics_vehicles WHERE id = ? AND active = 1').get(vehicle_id)) errors.vehicle_id = 'Veículo inválido.';
  const carrier = raw?.carrier_supplier_id ? Number(raw.carrier_supplier_id) : null;
  if (carrier && !db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(carrier)) errors.carrier_supplier_id = 'Transportadora inválida.';
  const cost = (v: unknown, k: string) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) errors[k] = 'Valor inválido.';
    return n;
  };
  const h = {
    scheduled_at, address, reason, transport_type, driver_id, vehicle_id, carrier_supplier_id: carrier,
    contact_name: text(raw?.contact_name, 120), contact_phone: text(raw?.contact_phone, 30), access_instructions: text(raw?.access_instructions, 1000),
    special_equipment: text(raw?.special_equipment, 300), responsible_user_id: raw?.responsible_user_id ? Number(raw.responsible_user_id) : null,
    origin_address: text(raw?.origin_address, 300), transport_cost_estimated: cost(raw?.transport_cost_estimated, 'transport_cost_estimated'), notes: text(raw?.notes, 2000),
    return_location_id: raw?.return_location_id ? Number(raw.return_location_id) : null,
  };
  if (Object.keys(errors).length) throw badRequest(`Revise os campos: ${Object.values(errors).join(' ')}`, errors);
  return h;
}

function normalizeLines(db: DB, contractId: number, type: OpType, raw: any, ignoreOrderId = 0) {
  const plan = contractPlanning(db, contractId, type, ignoreOrderId);
  const c = plan.contract;
  if (type === 'entrega' && !(c.contract_type === 'venda' ? ['ativo'] : ['agendado', 'ativo']).includes(c.status))
    throw new HttpError(422, 'Entregas só para contratos agendados ou ativos (formalizados).');
  if (type !== 'entrega') {
    if (c.contract_type !== 'locacao') throw new HttpError(422, 'Contratos de venda não têm retirada/devolução de locação.');
    if (!['agendado', 'ativo', 'vencido', 'pendente_devolucao'].includes(c.status)) throw new HttpError(422, 'Este contrato não aceita retirada/devolução no status atual.');
  }
  const lines: any[] = (Array.isArray(raw?.items) ? raw.items : []).filter((l: any) => Number(l?.quantity) > 0);
  if (!lines.length) throw badRequest('Selecione ao menos um equipamento.', { items: 'Obrigatório.' });
  const seen = new Set<number>();
  return {
    c,
    lines: lines.map((l) => {
      const it = plan.items.find((i) => i.id === Number(l.contract_item_id));
      if (!it) throw badRequest('Item não pertence ao contrato.');
      if (seen.has(it.id)) throw badRequest(`${it.item_code}${it.asset_tag ? ` (${it.asset_tag})` : ''} aparece duas vezes na operação.`);
      seen.add(it.id);
      const qty = it.tracking === 'individual' ? 1 : round3(Number(l.quantity));
      if (qty > it.available_to_plan + 1e-9)
        throw new HttpError(422, `${it.item_code}${it.asset_tag ? ` (${it.asset_tag})` : ''}: ${type === 'entrega' ? 'saldo pendente de entrega' : 'quantidade com o cliente'} ${it.available_to_plan}${it.planned_elsewhere ? ` (já há ${it.planned_elsewhere} em outra operação aberta)` : ''}; informado ${qty}.`);
      if (type === 'entrega') {
        const b = deliveryBlockers(db, c, it, qty);
        if (b) throw new HttpError(422, `Equipamento indisponível: ${b}`);
      }
      return { contract_item_id: it.id, asset_id: it.asset_id, quantity: qty, notes: text(l.notes, 500) };
    }),
  };
}

export function createOperation(db: DB, user: AuthUser, type: OpType, raw: any) {
  if (!logCan.create(user)) throw forbidden();
  if (!['entrega', 'retirada', 'devolucao'].includes(type)) throw badRequest('Tipo de operação inválido.');
  // endereço padrão: obra do contrato (entrega) ou endereço do cadastro — sem alterar o cadastro do cliente
  const cc = db.prepare('SELECT delivery_address, customer_snapshot FROM contracts WHERE id = ?').get(Number(raw?.contract_id)) as any;
  if (!cc) throw badRequest('Selecione o contrato.', { contract_id: 'Obrigatório.' });
  if (!text(raw?.address, 500)) raw = { ...raw, address: cc.delivery_address || JSON.parse(cc.customer_snapshot).address || null };
  const h = normalizeHeader(db, raw, type);
  return transaction(db, () => {
    const contractId = Number(raw?.contract_id);
    const { c, lines } = normalizeLines(db, contractId, type, raw);
    if (user.role === 'vendedor' && c.responsible_user_id !== user.id) throw forbidden('Vendedor programa operações apenas dos seus contratos.');
    const snap = JSON.parse(c.customer_snapshot);
    const status: OpStatus = raw?.draft ? 'rascunho' : 'programada';
    const row = db
      .prepare(
        `INSERT INTO logistics_orders (number, op_type, status, reason, contract_id, customer_id, scheduled_at, address, contact_name, contact_phone, access_instructions, special_equipment,
           transport_type, driver_id, vehicle_id, carrier_supplier_id, responsible_user_id, origin_address, return_location_id, transport_cost_estimated, notes, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, number`
      )
      .get(
        nextNumber(db, type === 'entrega' ? 'ENTG' : type === 'retirada' ? 'RETR' : 'DEVL'), type, status, h.reason, c.id, c.customer_id, h.scheduled_at,
        h.address || (type === 'entrega' ? c.delivery_address || snap.address : snap.address) || null, h.contact_name || snap.contact_name || null, h.contact_phone || snap.phone || null,
        h.access_instructions, h.special_equipment, h.transport_type, h.driver_id, h.vehicle_id, h.carrier_supplier_id, h.responsible_user_id || user.id, h.origin_address,
        h.return_location_id, h.transport_cost_estimated, h.notes, user.id, user.id
      ) as { id: number; number: string };
    const ins = db.prepare('INSERT INTO logistics_order_items (order_id, contract_item_id, asset_id, quantity_original, quantity_planned, notes) VALUES (?, ?, ?, ?, ?, ?)');
    for (const l of lines) ins.run(row.id, l.contract_item_id, l.asset_id, l.quantity, l.quantity, l.notes);
    logEvent(db, { order_id: row.id }, 'criacao', `${type === 'entrega' ? 'Entrega' : type === 'retirada' ? 'Retirada' : 'Devolução'} ${status === 'rascunho' ? 'criada em rascunho' : 'programada'} para o contrato ${c.contract_number} (${lines.length} item(ns)). Nenhuma movimentação de estoque foi feita.`, user, null, status);
    audit(db, 'logistics_order', row.id, 'create', user.id);
    return { id: row.id, number: row.number };
  });
}

/** Edição da programação (rascunho/programada): cabeçalho e itens, revalidando saldo e disponibilidade. */
export function updateOperation(db: DB, user: AuthUser, id: number, raw: any) {
  if (!logCan.create(user)) throw forbidden();
  transaction(db, () => {
    const o = loadOrder(db, id);
    if (!['rascunho', 'programada'].includes(o.status)) throw new HttpError(422, 'Só operações em rascunho ou programadas podem ser editadas.');
    if (raw?.row_version !== undefined && Number(raw.row_version) !== o.row_version) throw conflict('A operação foi alterada por outra pessoa. Recarregue.');
    const h = normalizeHeader(db, raw, o.op_type);
    if (Array.isArray(raw?.items)) {
      if (db.prepare('SELECT 1 FROM logistics_order_items WHERE order_id = ? AND (quantity_separated > 0 OR quantity_processed > 0)').get(id)) throw new HttpError(422, 'Itens já separados não são reprogramados.');
      const { lines } = normalizeLines(db, o.contract_id, o.op_type, raw, id);
      // itens não são excluídos (histórico): zera os removidos e grava os novos
      db.prepare('UPDATE logistics_order_items SET quantity_planned = 0 WHERE order_id = ?').run(id);
      for (const l of lines) {
        db.prepare(
          `INSERT INTO logistics_order_items (order_id, contract_item_id, asset_id, quantity_original, quantity_planned, notes) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(order_id, contract_item_id) DO UPDATE SET quantity_original = excluded.quantity_original, quantity_planned = excluded.quantity_planned, notes = excluded.notes`
        ).run(id, l.contract_item_id, l.asset_id, l.quantity, l.quantity, l.notes);
      }
    }
    db.prepare(
      `UPDATE logistics_orders SET reason = ?, scheduled_at = ?, address = ?, contact_name = ?, contact_phone = ?, access_instructions = ?, special_equipment = ?, transport_type = ?, driver_id = ?,
         vehicle_id = ?, carrier_supplier_id = ?, responsible_user_id = COALESCE(?, responsible_user_id), origin_address = ?, return_location_id = ?, transport_cost_estimated = ?, notes = ?,
         status = CASE WHEN status = 'rascunho' AND ? = 1 THEN 'programada' ELSE status END, updated_by = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`
    ).run(
      h.reason, h.scheduled_at, h.address, h.contact_name, h.contact_phone, h.access_instructions, h.special_equipment, h.transport_type, h.driver_id, h.vehicle_id, h.carrier_supplier_id,
      h.responsible_user_id, h.origin_address, h.return_location_id, h.transport_cost_estimated, h.notes, raw?.schedule ? 1 : 0, user.id, id
    );
    logEvent(db, { order_id: id }, 'edicao', 'Programação alterada.', user);
  });
}

// ------------------------------------------------ anexos (servidos só pela API autenticada)

export function addAttachment(db: DB, user: AuthUser, ref: { order_id?: number | null; occurrence_id?: number | null }, raw: any) {
  if (!logCan.separate(user) && !logCan.inspect(user) && !logCan.confirm(user)) throw forbidden();
  const m = (typeof raw?.content === 'string' ? raw.content : '').match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!m) throw badRequest('Arquivo inválido.');
  if (m[2].length > 2_000_000) throw badRequest('Arquivo muito grande (máx. ~1,4 MB).');
  if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(m[1])) throw badRequest('Envie PDF ou imagem (PNG, JPG, WEBP).');
  const name = text(raw?.file_name, 120) || 'arquivo';
  return transaction(db, () => {
    const id = (
      db.prepare('INSERT INTO logistics_attachments (order_id, occurrence_id, phase, category, title, file_name, mime_type, file_data, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id').get(
        ref.order_id ?? null, ref.occurrence_id ?? null, text(raw?.phase, 20) || 'documento', text(raw?.category, 30) || 'foto', text(raw?.title, 120) || name, name, m[1], m[2], user.id
      ) as { id: number }
    ).id;
    logEvent(db, ref, 'anexo', `Anexo incluído: ${text(raw?.title, 120) || name}.`, user);
    return { id };
  });
}

export function getAttachment(db: DB, id: number) {
  const a = db.prepare('SELECT file_name, mime_type, file_data FROM logistics_attachments WHERE id = ?').get(id) as any;
  if (!a) throw notFound('Anexo não encontrado.');
  return { name: a.file_name, mime: a.mime_type, buffer: Buffer.from(a.file_data, 'base64') };
}

// ------------------------------------------------ leitura

export const OCC_SELECT = `
  SELECT oc.*, o.number AS order_number, c.contract_number, json_extract(c.customer_snapshot, '$.name') AS customer_name, a.asset_tag, i.internal_code AS item_code,
    w.order_number AS work_order_number, e.entry_number AS charge_entry_number, ur.name AS registered_by_name, ua.name AS approved_by_name
  FROM logistics_occurrences oc JOIN contracts c ON c.id = oc.contract_id LEFT JOIN logistics_orders o ON o.id = oc.order_id LEFT JOIN stock_assets a ON a.id = oc.asset_id
  LEFT JOIN catalog_items i ON i.id = oc.item_id LEFT JOIN work_orders w ON w.id = oc.work_order_id LEFT JOIN contract_charges ch ON ch.id = oc.contract_charge_id
  LEFT JOIN financial_entries e ON e.id = ch.financial_entry_id LEFT JOIN users ur ON ur.id = oc.registered_by LEFT JOIN users ua ON ua.id = oc.approved_by`;

export function loadOrderItems(db: DB, id: number) {
  return (
    db
      .prepare(
        `SELECT li.*, COALESCE(li.condition_before, (SELECT d.condition_before FROM logistics_order_items d JOIN logistics_orders od ON od.id = d.order_id
             WHERE d.contract_item_id = li.contract_item_id AND od.op_type = 'entrega' AND d.quantity_processed > 0 AND od.id != li.order_id ORDER BY od.completed_at DESC LIMIT 1)) AS condition_before,
           (SELECT od.number FROM logistics_order_items d JOIN logistics_orders od ON od.id = d.order_id
             WHERE d.contract_item_id = li.contract_item_id AND od.op_type = 'entrega' AND d.quantity_processed > 0 AND od.id != li.order_id ORDER BY od.completed_at DESC LIMIT 1) AS origin_order_number,
           ci.item_id, ci.item_code_snapshot AS item_code, ci.description_snapshot AS description, ci.unit, cat.tracking, a.asset_tag, a.serial_number, a.operational_status,
           ci.quantity AS contract_quantity,
           COALESCE((SELECT SUM(quantity) FROM stock_reservations r WHERE r.contract_item_id = ci.id AND r.status = 'em_uso'), 0) AS contract_delivered,
           COALESCE((SELECT SUM(quantity) FROM stock_reservations r WHERE r.contract_item_id = ci.id AND r.status = 'concluida'), 0) AS contract_returned
         FROM logistics_order_items li JOIN contract_items ci ON ci.id = li.contract_item_id JOIN catalog_items cat ON cat.id = ci.item_id LEFT JOIN stock_assets a ON a.id = li.asset_id
         WHERE li.order_id = ? AND li.quantity_original > 0 ORDER BY li.id`
      )
      .all(id) as any[]
  );
}

export function getOperation(db: DB, user: AuthUser, id: number, actions: (o: any) => { actions: string[]; blockers: Record<string, string> }): OpDetail {
  const o = db
    .prepare(
      `SELECT o.*, c.contract_number, c.contract_type, c.status AS contract_status, c.start_date, c.end_date, c.customer_snapshot, d.name AS driver_name, v.plate || ' — ' || v.description AS vehicle_label,
         s.name AS carrier_name, ur.name AS responsible_name, us.name AS separated_by_name, uc.name AS created_by_name, e.entry_number AS transport_entry_number, op.number AS contract_operation_number
       FROM logistics_orders o JOIN contracts c ON c.id = o.contract_id LEFT JOIN logistics_drivers d ON d.id = o.driver_id LEFT JOIN logistics_vehicles v ON v.id = o.vehicle_id
       LEFT JOIN suppliers s ON s.id = o.carrier_supplier_id LEFT JOIN users ur ON ur.id = o.responsible_user_id LEFT JOIN users us ON us.id = o.separated_by
       LEFT JOIN users uc ON uc.id = o.created_by LEFT JOIN financial_entries e ON e.id = o.transport_entry_id LEFT JOIN contract_operations op ON op.id = o.contract_operation_id WHERE o.id = ?`
    )
    .get(id) as any;
  if (!o) throw notFound('Operação não encontrada.');
  const snap = JSON.parse(o.customer_snapshot);
  const costs = logCan.viewCosts(user);
  const { actions: acts, blockers } = actions(o);
  return {
    id: o.id, number: o.number, op_type: o.op_type, status: o.status, reason: o.reason,
    contract: { id: o.contract_id, contract_number: o.contract_number, contract_type: o.contract_type, status: o.contract_status, start_date: o.start_date, end_date: o.end_date },
    customer: { id: o.customer_id, name: snap.name, document: snap.document, phone: snap.phone, email: snap.email, address: snap.address },
    scheduled_at: o.scheduled_at, address: o.address, contact_name: o.contact_name, contact_phone: o.contact_phone, access_instructions: o.access_instructions, special_equipment: o.special_equipment,
    transport_type: o.transport_type, driver_id: o.driver_id, driver_name: o.driver_name, vehicle_id: o.vehicle_id, vehicle_label: o.vehicle_label, carrier_supplier_id: o.carrier_supplier_id,
    carrier_name: o.carrier_name, responsible_user_id: o.responsible_user_id, responsible_name: o.responsible_name, origin_address: o.origin_address, separated_by_name: o.separated_by_name,
    separated_at: o.separated_at, separation_checklist: JSON.parse(o.separation_checklist || '{}'), accessories: o.accessories, departed_at: o.departed_at, arrived_at: o.arrived_at,
    completed_at: o.completed_at, receiver_name: o.receiver_name, receiver_document: o.receiver_document, transport_notes: o.transport_notes,
    transport_cost_estimated: costs ? o.transport_cost_estimated : null, transport_cost_actual: costs ? o.transport_cost_actual : null, transport_entry_number: o.transport_entry_number,
    contract_operation_number: o.contract_operation_number, notes: o.notes, cancel_reason: o.cancel_reason, created_by_name: o.created_by_name, created_at: o.created_at, row_version: o.row_version,
    items: loadOrderItems(db, id),
    inspections: (
      db
        .prepare(
          `SELECT ins.*, a.asset_tag, ci.item_code_snapshot AS item_code, w.order_number AS work_order_number, u.name AS inspected_by_name
           FROM logistics_inspections ins JOIN logistics_order_items li ON li.id = ins.order_item_id JOIN contract_items ci ON ci.id = li.contract_item_id
           LEFT JOIN stock_assets a ON a.id = ins.asset_id LEFT JOIN work_orders w ON w.id = ins.work_order_id LEFT JOIN users u ON u.id = ins.inspected_by WHERE li.order_id = ? ORDER BY ins.id`
        )
        .all(id) as any[]
    ).map((i) => ({ ...i, checklist: JSON.parse(i.checklist || '{}'), damage_detected: !!i.damage_detected })),
    occurrences: (db.prepare(`${OCC_SELECT} WHERE oc.order_id = ? ORDER BY oc.id`).all(id) as any[]).map((x) => (costs ? x : { ...x, estimated_cost: null, approved_cost: null })),
    attachments: db.prepare('SELECT t.id, t.phase, t.category, t.title, t.file_name, t.mime_type, t.occurrence_id, u.name AS uploaded_by_name, t.created_at FROM logistics_attachments t LEFT JOIN users u ON u.id = t.uploaded_by WHERE t.order_id = ? ORDER BY t.id DESC').all(id) as any[],
    events: db.prepare('SELECT e.*, u.name AS performed_by_name FROM logistics_events e LEFT JOIN users u ON u.id = e.performed_by WHERE e.order_id = ? ORDER BY e.id DESC').all(id) as any[],
    actions: acts,
    blockers,
  };
}
