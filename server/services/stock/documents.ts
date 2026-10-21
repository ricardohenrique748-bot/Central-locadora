/**
 * Documentos de estoque: entradas, saídas manuais e transferências.
 * Toda confirmação roda em transação e verifica o status dentro dela (não confirma duas vezes).
 */

import { DB, audit, transaction } from '../../db';
import { HttpError, badRequest, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { Entry, EntryKind, MovementType, TRANSFER_LABELS, Transfer, TransferStatus } from '../../../shared/estoque/types';
import { apportionEntry, round3, stockCan, weightedAverageCost } from '../../../shared/estoque/rules';
import { isISODate, todayISO } from '../../../shared/orcamentos/dates';
import { NOW_SQL, applyBalance, applyMovement, assertLocation, assertQuantity, assetEvent, getBalance, getItemOrThrow, nextNumber, refreshAssetRental, totalQuantity } from './core';
import { getStockSettings } from './registry';

const text = (v: unknown, max = 500) => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t === '' ? null : t;
};
const cents = (v: unknown) => {
  const n = Number(v ?? 0);
  if (!Number.isInteger(n) || n < 0) throw badRequest('Valor monetário inválido.');
  return n;
};

// ================================================ ENTRADAS

const ENTRY_KINDS: EntryKind[] = ['compra', 'inicial', 'devolucao_venda', 'outra'];
const ENTRY_MOVEMENT: Record<EntryKind, MovementType> = {
  compra: 'entrada_compra',
  inicial: 'entrada_inicial',
  devolucao_venda: 'devolucao_venda',
  outra: 'outra_entrada',
};

function loadEntry(db: DB, id: number): Entry {
  const e = db
    .prepare(
      `SELECT e.*, s.name AS supplier_name, l.name AS location_name, COALESCE(u.name,'Sistema') AS created_by_name
       FROM stock_entries e LEFT JOIN suppliers s ON s.id = e.supplier_id JOIN stock_locations l ON l.id = e.location_id LEFT JOIN users u ON u.id = e.created_by
       WHERE e.id = ?`
    )
    .get(id) as any;
  if (!e) throw notFound('Entrada não encontrada.');
  const items = (
    db
      .prepare(
        `SELECT ei.*, i.internal_code AS item_code, i.description AS item_description, i.tracking, i.unit
         FROM stock_entry_items ei JOIN catalog_items i ON i.id = ei.item_id WHERE ei.entry_id = ? ORDER BY ei.id`
      )
      .all(id) as any[]
  ).map((r) => ({ ...r, units: r.units ? JSON.parse(r.units) : undefined }));
  return { ...e, items };
}

export function listEntries(db: DB, f: Record<string, string | undefined>) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.q?.trim()) {
    where.push('(e.number LIKE ? OR e.origin_document LIKE ? OR s.name LIKE ?)');
    const q = `%${f.q.trim()}%`;
    params.push(q, q, q);
  }
  if (f.status) {
    where.push('e.status = ?');
    params.push(f.status);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT e.id, e.number, e.entry_kind, e.status, e.entry_date, e.total, e.origin_document, s.name AS supplier_name, l.name AS location_name,
        (SELECT COUNT(*) FROM stock_entry_items ei WHERE ei.entry_id = e.id) AS lines, e.created_at
       FROM stock_entries e LEFT JOIN suppliers s ON s.id = e.supplier_id JOIN stock_locations l ON l.id = e.location_id ${w}
       ORDER BY e.id DESC LIMIT 300`
    )
    .all(...params);
  return { rows };
}

export const getEntry = loadEntry;

function normalizeEntry(db: DB, raw: any) {
  const kind: EntryKind = ENTRY_KINDS.includes(raw?.entry_kind) ? raw.entry_kind : 'compra';
  const errors: Record<string, string> = {};
  const location_id = assertLocation(db, raw?.location_id, 'Local de destino');
  const supplier_id = raw?.supplier_id ? Number(raw.supplier_id) : null;
  if (kind === 'compra' && !supplier_id) errors.supplier_id = 'Informe o fornecedor da compra.';
  if (supplier_id && !db.prepare('SELECT 1 FROM suppliers WHERE id = ? AND active = 1').get(supplier_id)) errors.supplier_id = 'Fornecedor inválido ou inativo.';
  const entry_date = raw?.entry_date || todayISO();
  if (!isISODate(entry_date)) errors.entry_date = 'Data inválida.';
  else if (entry_date > todayISO()) errors.entry_date = 'A data da entrada não pode ser futura.';
  const items = Array.isArray(raw?.items) ? raw.items : [];
  if (!items.length) errors.items = 'Inclua ao menos um item.';
  if (Object.keys(errors).length) throw badRequest(Object.values(errors)[0], errors);

  const tagsInDoc = new Set<string>();
  const lines = items.slice(0, 200).map((it: any, idx: number) => {
    const label = `Linha ${idx + 1}`;
    const item = getItemOrThrow(db, Number(it?.item_id));
    if (!item.active) throw badRequest(`${label}: ${item.internal_code} está inativo.`);
    const quantity = Number(it?.quantity);
    assertQuantity(quantity);
    const unit_cost = cents(it?.unit_cost);
    let units: { asset_tag: string | null; serial_number: string | null }[] | undefined;
    if (item.tracking === 'individual') {
      if (!Number.isInteger(quantity)) throw badRequest(`${label}: equipamento individual exige quantidade inteira.`);
      if (quantity > 100) throw badRequest(`${label}: no máximo 100 unidades individuais por linha.`);
      const given = Array.isArray(it?.units) ? it.units : [];
      units = Array.from({ length: quantity }, (_, k) => ({
        asset_tag: text(given[k]?.asset_tag, 40)?.toUpperCase() || null,
        serial_number: text(given[k]?.serial_number, 60) || null,
      }));
      for (const u of units) {
        if (u.asset_tag) {
          if (tagsInDoc.has(u.asset_tag)) throw badRequest(`${label}: patrimônio ${u.asset_tag} repetido na entrada.`);
          tagsInDoc.add(u.asset_tag);
          if (db.prepare('SELECT 1 FROM stock_assets WHERE asset_tag = ?').get(u.asset_tag)) throw badRequest(`${label}: patrimônio ${u.asset_tag} já cadastrado.`);
        }
        if (u.serial_number && db.prepare('SELECT 1 FROM stock_assets WHERE item_id = ? AND serial_number = ?').get(item.id, u.serial_number)) {
          throw badRequest(`${label}: nº de série ${u.serial_number} já cadastrado para ${item.internal_code}.`);
        }
      }
      const serials = units.map((u) => u.serial_number).filter(Boolean);
      if (new Set(serials).size !== serials.length) throw badRequest(`${label}: nº de série repetido.`);
    }
    return { item_id: item.id, quantity, unit_cost, units };
  });
  const discount = cents(raw?.discount);
  const extra_expenses = cents(raw?.extra_expenses);
  const app = apportionEntry(lines, discount, extra_expenses);
  const items_total = app.reduce((a, l) => a + l.line_total, 0);
  if (discount > items_total) throw badRequest('Desconto maior que o valor dos itens.');
  return {
    header: {
      entry_kind: kind,
      supplier_id,
      origin_document: text(raw?.origin_document, 80),
      entry_date,
      location_id,
      received_by: text(raw?.received_by, 100),
      discount,
      extra_expenses,
      items_total,
      total: items_total - discount + extra_expenses,
      notes: text(raw?.notes, 2000),
    },
    lines: lines.map((l: any, i: number) => ({ ...l, line_total: app[i].line_total, allocated_unit_cost: app[i].allocated_unit_cost })),
  };
}

function writeEntryLines(db: DB, entryId: number, lines: any[]) {
  db.prepare('DELETE FROM stock_entry_items WHERE entry_id = ?').run(entryId);
  const ins = db.prepare('INSERT INTO stock_entry_items (entry_id, item_id, quantity, unit_cost, line_total, allocated_unit_cost, units) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const l of lines) ins.run(entryId, l.item_id, l.quantity, l.unit_cost, l.line_total, l.allocated_unit_cost, l.units ? JSON.stringify(l.units) : null);
}

export function saveEntry(db: DB, user: AuthUser, id: number | null, raw: any): Entry {
  if (!stockCan.operate(user)) throw forbidden();
  const { header, lines } = normalizeEntry(db, raw);
  const entryId = transaction(db, () => {
    const vals = [header.entry_kind, header.supplier_id, header.origin_document, header.entry_date, header.location_id, header.received_by, header.discount, header.extra_expenses, header.items_total, header.total, header.notes];
    let eid = id;
    if (eid) {
      const cur = db.prepare('SELECT status FROM stock_entries WHERE id = ?').get(eid) as { status: string } | undefined;
      if (!cur) throw notFound('Entrada não encontrada.');
      if (cur.status !== 'rascunho') throw new HttpError(422, 'Somente entradas em rascunho podem ser alteradas.');
      db.prepare(
        `UPDATE stock_entries SET entry_kind=?, supplier_id=?, origin_document=?, entry_date=?, location_id=?, received_by=?, discount=?, extra_expenses=?, items_total=?, total=?, notes=?, updated_at=${NOW_SQL} WHERE id=?`
      ).run(...vals, eid);
    } else {
      eid = (
        db
          .prepare(
            `INSERT INTO stock_entries (number, status, entry_kind, supplier_id, origin_document, entry_date, location_id, received_by, discount, extra_expenses, items_total, total, notes, created_by)
             VALUES (?, 'rascunho', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
          )
          .get(nextNumber(db, 'ENT'), ...vals, user.id) as { id: number }
      ).id;
    }
    writeEntryLines(db, eid!, lines);
    return eid!;
  });
  return loadEntry(db, entryId);
}

export function confirmEntry(db: DB, user: AuthUser, id: number): Entry {
  if (!stockCan.operate(user)) throw forbidden();
  transaction(db, () => {
    const e = loadEntry(db, id);
    if (e.status !== 'rascunho') throw new HttpError(422, e.status === 'confirmada' ? 'Esta entrada já foi confirmada.' : 'Entrada cancelada.');
    // revalida (patrimônios/séries podem ter sido usados por outra entrada depois do rascunho)
    const { lines } = normalizeEntry(db, { ...e, items: e.items });
    const type = ENTRY_MOVEMENT[e.entry_kind];
    for (const l of lines) {
      const item = getItemOrThrow(db, l.item_id);
      const before = totalQuantity(db, item.id);
      if (item.tracking === 'quantidade') {
        applyMovement(db, user, {
          type, item_id: item.id, quantity: l.quantity, location_id: e.location_id, qty_delta: l.quantity,
          dest_location_id: e.location_id, unit_cost: l.allocated_unit_cost, reference_doc: e.origin_document || e.number,
          document_type: 'entrada', document_id: e.id,
        });
      } else {
        for (const u of l.units!) {
          const tag = u.asset_tag || nextNumber(db, 'PAT');
          const asset = db
            .prepare(
              `INSERT INTO stock_assets (item_id, asset_tag, serial_number, acquisition_date, supplier_id, acquisition_cost, conservation, location_id, operational_status, rental_status, operation_start_date)
               VALUES (?, ?, ?, ?, ?, ?, 'novo', ?, 'novo', 'disponivel', NULL) RETURNING id`
            )
            .get(item.id, tag, u.serial_number, e.entry_date, e.supplier_id, l.allocated_unit_cost, e.location_id) as { id: number };
          applyMovement(db, user, {
            type, item_id: item.id, asset_id: asset.id, quantity: 1, location_id: e.location_id, qty_delta: 1,
            dest_location_id: e.location_id, unit_cost: l.allocated_unit_cost, reference_doc: e.origin_document || e.number,
            document_type: 'entrada', document_id: e.id,
          });
          assetEvent(db, asset.id, 'cadastro', `Equipamento incorporado ao patrimônio pela entrada ${e.number}.`, user);
          assetEvent(db, asset.id, 'entrada', `Entrada no estoque (${e.location_name}) — ${e.entry_kind === 'compra' ? 'aquisição' : 'implantação'}${e.supplier_name ? ` de ${e.supplier_name}` : ''}.`, user);
        }
      }
      if (e.entry_kind === 'compra' || e.entry_kind === 'inicial') {
        const avg = weightedAverageCost(before, item.average_cost, l.quantity, l.allocated_unit_cost);
        db.prepare(
          `UPDATE catalog_items SET average_cost = ?, acquisition_cost = ?, last_purchase_date = CASE WHEN ? = 'compra' THEN ? ELSE last_purchase_date END,
             main_supplier_id = COALESCE(main_supplier_id, ?), updated_at = ${NOW_SQL} WHERE id = ?`
        ).run(avg, l.allocated_unit_cost, e.entry_kind, e.entry_date, e.supplier_id, item.id);
      }
    }
    db.prepare(`UPDATE stock_entries SET status = 'confirmada', confirmed_by = ?, confirmed_at = ${NOW_SQL} WHERE id = ? AND status = 'rascunho'`).run(user.id, id);
    audit(db, 'stock_entry', id, 'confirm', user.id);
  });
  return loadEntry(db, id);
}

export function cancelEntry(db: DB, user: AuthUser, id: number): Entry {
  if (!stockCan.operate(user)) throw forbidden();
  const res = db.prepare("UPDATE stock_entries SET status = 'cancelada' WHERE id = ? AND status = 'rascunho'").run(id);
  if (res.changes !== 1) throw new HttpError(422, 'Somente entradas em rascunho podem ser canceladas. Entradas confirmadas são corrigidas por estorno.');
  audit(db, 'stock_entry', id, 'cancel', user.id);
  return loadEntry(db, id);
}

// ================================================ SAÍDAS MANUAIS

const EXIT_TYPES: MovementType[] = ['saida_consumo', 'baixa_perda_avaria', 'outra_saida'];

/** Cria saída manual (rascunho ou confirmada). Não substitui venda nem locação. */
export function createExit(db: DB, user: AuthUser, raw: any) {
  if (!stockCan.operate(user)) throw forbidden();
  const type = raw?.movement_type as MovementType;
  if (!EXIT_TYPES.includes(type)) throw badRequest('Tipo de saída inválido.');
  const item = getItemOrThrow(db, Number(raw?.item_id));
  if (item.tracking === 'individual') throw badRequest('Equipamentos individuais saem por baixa patrimonial na ficha do equipamento, nunca por saída manual.');
  const quantity = Number(raw?.quantity);
  assertQuantity(quantity);
  const location_id = assertLocation(db, raw?.location_id, 'Local de origem');
  const settings = getStockSettings(db);
  const reason = text(raw?.reason, 120);
  if (!reason || !settings.exit_reasons.includes(reason)) throw badRequest('Selecione um motivo válido.', { reason: 'Obrigatório.' });
  const fromUnavailable = !!raw?.from_unavailable;
  const qty_delta = -quantity;
  const unavailable_delta = fromUnavailable ? -quantity : 0;
  const confirm = !!raw?.confirm;

  return transaction(db, () => {
    if (confirm) {
      const id = applyMovement(db, user, {
        type, item_id: item.id, quantity, location_id, qty_delta, unavailable_delta, origin_location_id: location_id,
        dest_location_id: raw?.dest_location_id ? Number(raw.dest_location_id) : null,
        reference_doc: text(raw?.reference_doc, 80), reason, notes: text(raw?.notes, 2000), document_type: 'saida', allowUnavailable: fromUnavailable,
      });
      return { id };
    }
    // rascunho: sem efeito no saldo até a confirmação
    const row = db
      .prepare(
        `INSERT INTO stock_movements (number, movement_type, status, item_id, quantity, qty_delta, unavailable_delta, balance_location_id, origin_location_id, unit_cost, reference_doc, reason, notes, document_type, created_by)
         VALUES (?, ?, 'rascunho', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saida', ?) RETURNING id`
      )
      .get(nextNumber(db, 'MOV'), type, item.id, quantity, qty_delta, unavailable_delta, location_id, location_id, item.average_cost ?? item.acquisition_cost, text(raw?.reference_doc, 80), reason, text(raw?.notes, 2000), user.id) as { id: number };
    return { id: row.id };
  });
}

export function confirmDraftMovement(db: DB, user: AuthUser, id: number) {
  if (!stockCan.operate(user)) throw forbidden();
  transaction(db, () => {
    const m = db.prepare('SELECT * FROM stock_movements WHERE id = ?').get(id) as any;
    if (!m) throw notFound('Movimentação não encontrada.');
    if (m.status !== 'rascunho') throw new HttpError(422, 'Esta movimentação já foi confirmada.');
    const item = getItemOrThrow(db, m.item_id);
    applyBalance(db, item, m.balance_location_id, m.qty_delta, m.unavailable_delta, m.unavailable_delta < 0);
    db.prepare(
      `UPDATE stock_movements SET status = 'confirmado', unit_cost = ?, total_cost = ?, confirmed_by = ?, confirmed_at = ${NOW_SQL} WHERE id = ? AND status = 'rascunho'`
    ).run(item.average_cost ?? item.acquisition_cost, item.average_cost != null ? Math.round(item.average_cost * m.quantity) : null, user.id, id);
  });
}

export function deleteDraftMovement(db: DB, user: AuthUser, id: number) {
  if (!stockCan.operate(user)) throw forbidden();
  const res = db.prepare("DELETE FROM stock_movements WHERE id = ? AND status = 'rascunho'").run(id);
  if (res.changes !== 1) throw new HttpError(422, 'Somente rascunhos podem ser descartados. Movimentações confirmadas são corrigidas por estorno.');
}

/** Itens por quantidade: separar para manutenção/avaria (disponível → indisponível) ou liberar após avaliação. */
export function changeQuantityStatus(db: DB, user: AuthUser, raw: any) {
  if (!stockCan.operate(user)) throw forbidden();
  const item = getItemOrThrow(db, Number(raw?.item_id));
  if (item.tracking !== 'quantidade') throw badRequest('Use a ficha do equipamento para itens individuais.');
  const quantity = Number(raw?.quantity);
  assertQuantity(quantity);
  const location_id = assertLocation(db, raw?.location_id);
  const action = raw?.action;
  if (action !== 'separar' && action !== 'liberar') throw badRequest('Ação inválida.');
  const reason = text(raw?.reason, 500);
  if (!reason) throw badRequest('Informe o motivo/avaliação.', { reason: 'Obrigatório.' });
  return transaction(db, () =>
    applyMovement(db, user, {
      type: action === 'separar' ? 'envio_manutencao' : 'retorno_manutencao',
      item_id: item.id,
      quantity,
      location_id,
      qty_delta: 0,
      unavailable_delta: action === 'separar' ? quantity : -quantity,
      origin_location_id: location_id,
      reason,
      document_type: 'situacao',
    })
  );
}

// ================================================ TRANSFERÊNCIAS

function loadTransfer(db: DB, id: number): Transfer {
  const t = db
    .prepare(
      `SELECT t.*, lo.name AS origin_name, ld.name AS dest_name, us.name AS sent_by_name, ur.name AS received_by_name, COALESCE(uc.name,'Sistema') AS created_by_name
       FROM stock_transfers t JOIN stock_locations lo ON lo.id = t.origin_location_id JOIN stock_locations ld ON ld.id = t.dest_location_id
       LEFT JOIN users us ON us.id = t.sent_by LEFT JOIN users ur ON ur.id = t.received_by LEFT JOIN users uc ON uc.id = t.created_by WHERE t.id = ?`
    )
    .get(id) as any;
  if (!t) throw notFound('Transferência não encontrada.');
  const items = db
    .prepare(
      `SELECT ti.*, i.internal_code AS item_code, i.description AS item_description, i.unit, a.asset_tag
       FROM stock_transfer_items ti JOIN catalog_items i ON i.id = ti.item_id LEFT JOIN stock_assets a ON a.id = ti.asset_id WHERE ti.transfer_id = ? ORDER BY ti.id`
    )
    .all(id) as any[];
  return { ...t, items };
}

export const getTransfer = loadTransfer;

export function listTransfers(db: DB, f: Record<string, string | undefined>) {
  const where: string[] = [];
  const params: string[] = [];
  if (f.status) {
    where.push('t.status = ?');
    params.push(f.status);
  }
  if (f.q?.trim()) {
    where.push('t.number LIKE ?');
    params.push(`%${f.q.trim()}%`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return {
    rows: db
      .prepare(
        `SELECT t.id, t.number, t.status, t.created_at, t.sent_at, t.received_at, lo.name AS origin_name, ld.name AS dest_name,
          (SELECT COUNT(*) FROM stock_transfer_items ti WHERE ti.transfer_id = t.id) AS lines
         FROM stock_transfers t JOIN stock_locations lo ON lo.id = t.origin_location_id JOIN stock_locations ld ON ld.id = t.dest_location_id ${w}
         ORDER BY t.id DESC LIMIT 300`
      )
      .all(...params),
  };
}

function normalizeTransfer(db: DB, raw: any) {
  const origin = assertLocation(db, raw?.origin_location_id, 'Origem');
  const dest = assertLocation(db, raw?.dest_location_id, 'Destino');
  if (origin === dest) throw badRequest('Origem e destino devem ser diferentes.');
  const items = Array.isArray(raw?.items) ? raw.items : [];
  if (!items.length) throw badRequest('Inclua ao menos um item.');
  const seenAssets = new Set<number>();
  const lines = items.slice(0, 200).map((it: any, idx: number) => {
    const item = getItemOrThrow(db, Number(it?.item_id));
    if (item.tracking === 'individual') {
      const assetId = Number(it?.asset_id);
      const a = db.prepare('SELECT * FROM stock_assets WHERE id = ? AND item_id = ?').get(assetId, item.id) as any;
      if (!a) throw badRequest(`Linha ${idx + 1}: selecione o equipamento (patrimônio).`);
      if (seenAssets.has(assetId)) throw badRequest(`Linha ${idx + 1}: patrimônio repetido.`);
      seenAssets.add(assetId);
      return { item_id: item.id, asset_id: assetId, quantity: 1 };
    }
    const quantity = Number(it?.quantity);
    assertQuantity(quantity);
    return { item_id: item.id, asset_id: null, quantity };
  });
  return { origin, dest, notes: text(raw?.notes, 2000), lines };
}

/** Valida disponibilidade na origem no momento do envio (não permite enviar mais que o saldo disponível). */
function assertTransferable(db: DB, origin: number, lines: { item_id: number; asset_id: number | null; quantity: number }[]) {
  const perItem = new Map<number, number>();
  for (const l of lines) {
    if (l.asset_id) {
      const a = db.prepare('SELECT asset_tag, location_id, operational_status, rental_status FROM stock_assets WHERE id = ?').get(l.asset_id) as any;
      if (a.location_id !== origin) throw new HttpError(422, `Patrimônio ${a.asset_tag} não está no local de origem.`);
      if (a.operational_status === 'baixado') throw new HttpError(422, `Patrimônio ${a.asset_tag} está baixado.`);
      if (a.rental_status === 'alugado' || a.rental_status === 'em_transito') throw new HttpError(422, `Patrimônio ${a.asset_tag} está ${a.rental_status === 'alugado' ? 'alugado' : 'em trânsito'}.`);
    } else perItem.set(l.item_id, (perItem.get(l.item_id) || 0) + l.quantity);
  }
  for (const [itemId, q] of perItem) {
    const item = getItemOrThrow(db, itemId);
    const b = getBalance(db, itemId, origin);
    const free = round3(b.quantity - b.reserved - b.unavailable);
    if (q > free + 1e-9 && !item.allow_negative) throw new HttpError(422, `${item.internal_code}: saldo disponível na origem é ${free.toLocaleString('pt-BR')} ${item.unit}.`);
  }
}

export function saveTransfer(db: DB, user: AuthUser, id: number | null, raw: any): Transfer {
  if (!stockCan.operate(user)) throw forbidden();
  const t = normalizeTransfer(db, raw);
  const tid = transaction(db, () => {
    let tid = id;
    if (tid) {
      const cur = db.prepare('SELECT status FROM stock_transfers WHERE id = ?').get(tid) as { status: TransferStatus } | undefined;
      if (!cur) throw notFound('Transferência não encontrada.');
      if (cur.status !== 'rascunho') throw new HttpError(422, 'Somente rascunhos podem ser alterados.');
      db.prepare('UPDATE stock_transfers SET origin_location_id = ?, dest_location_id = ?, notes = ? WHERE id = ?').run(t.origin, t.dest, t.notes, tid);
      db.prepare('DELETE FROM stock_transfer_items WHERE transfer_id = ?').run(tid);
    } else {
      tid = (
        db.prepare("INSERT INTO stock_transfers (number, status, origin_location_id, dest_location_id, notes, created_by) VALUES (?, 'rascunho', ?, ?, ?, ?) RETURNING id").get(nextNumber(db, 'TRF'), t.origin, t.dest, t.notes, user.id) as {
          id: number;
        }
      ).id;
    }
    const ins = db.prepare('INSERT INTO stock_transfer_items (transfer_id, item_id, asset_id, quantity) VALUES (?, ?, ?, ?)');
    for (const l of t.lines) ins.run(tid, l.item_id, l.asset_id, l.quantity);
    return tid!;
  });
  return loadTransfer(db, tid);
}

export function transferAction(db: DB, user: AuthUser, id: number, action: string, raw: any): Transfer {
  if (!stockCan.operate(user)) throw forbidden();
  transaction(db, () => {
    const t = loadTransfer(db, id);
    const need = (s: TransferStatus[]) => {
      if (!s.includes(t.status)) throw new HttpError(422, `Ação indisponível para transferência "${TRANSFER_LABELS[t.status]}".`);
    };
    if (action === 'liberar') {
      need(['rascunho']);
      assertTransferable(db, t.origin_location_id, t.items);
      db.prepare("UPDATE stock_transfers SET status = 'aguardando_envio' WHERE id = ?").run(id);
    } else if (action === 'enviar') {
      need(['aguardando_envio']);
      assertTransferable(db, t.origin_location_id, t.items);
      for (const l of t.items) {
        applyMovement(db, user, {
          type: 'transferencia_saida', item_id: l.item_id, asset_id: l.asset_id, quantity: l.quantity, location_id: t.origin_location_id,
          qty_delta: -l.quantity, origin_location_id: t.origin_location_id, dest_location_id: t.dest_location_id, reference_doc: t.number,
          document_type: 'transferencia', document_id: t.id,
        });
      }
      db.prepare(`UPDATE stock_transfers SET status = 'em_transito', sent_by = ?, sent_at = ${NOW_SQL} WHERE id = ?`).run(user.id, id);
      for (const l of t.items.filter((x) => x.asset_id)) {
        refreshAssetRental(db, l.asset_id!);
        assetEvent(db, l.asset_id!, 'transferencia', `Enviado de ${t.origin_name} para ${t.dest_name} (${t.number}).`, user);
      }
    } else if (action === 'receber') {
      need(['em_transito']);
      const received: Record<string, number> = raw?.received || {};
      let divergent = false;
      for (const l of t.items) {
        const r = received[String(l.id)] === undefined ? l.quantity : Number(received[String(l.id)]);
        if (!Number.isFinite(r) || r < 0 || r > l.quantity + 1e-9) throw badRequest(`Quantidade recebida inválida para ${l.item_code}.`);
        if (l.asset_id && r !== 0 && r !== 1) throw badRequest(`Patrimônio ${l.asset_tag}: informe recebido (1) ou não recebido (0).`);
        if (Math.abs(r - l.quantity) > 1e-9) divergent = true;
        db.prepare('UPDATE stock_transfer_items SET received_quantity = ? WHERE id = ?').run(r, l.id);
        if (r > 0) {
          applyMovement(db, user, {
            type: 'transferencia_entrada', item_id: l.item_id, asset_id: l.asset_id, quantity: r, location_id: t.dest_location_id,
            qty_delta: r, origin_location_id: t.origin_location_id, dest_location_id: t.dest_location_id, reference_doc: t.number,
            document_type: 'transferencia', document_id: t.id,
          });
        }
      }
      const notes = text(raw?.divergence_notes, 2000);
      if (divergent && !notes) throw badRequest('Há divergência entre enviado e recebido: descreva o ocorrido.', { divergence_notes: 'Obrigatório.' });
      db.prepare(`UPDATE stock_transfers SET status = 'recebida', received_by = ?, received_at = ${NOW_SQL}, divergence_notes = ? WHERE id = ?`).run(user.id, notes, id);
      for (const l of t.items.filter((x) => x.asset_id)) {
        const got = Number(received[String(l.id)] ?? 1) === 1;
        if (got) {
          db.prepare(`UPDATE stock_assets SET location_id = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(t.dest_location_id, l.asset_id);
          assetEvent(db, l.asset_id!, 'transferencia', `Recebido em ${t.dest_name} (${t.number}).`, user);
        } else {
          db.prepare(`UPDATE stock_assets SET location_id = NULL, operational_status = 'danificado', updated_at = ${NOW_SQL} WHERE id = ?`).run(l.asset_id);
          assetEvent(db, l.asset_id!, 'divergencia', `NÃO recebido no destino (${t.number}). Equipamento bloqueado até apuração: ${notes}`, user);
        }
        refreshAssetRental(db, l.asset_id!);
      }
    } else if (action === 'cancelar') {
      need(['rascunho', 'aguardando_envio']);
      db.prepare("UPDATE stock_transfers SET status = 'cancelada', notes = COALESCE(notes || char(10), '') || ? WHERE id = ?").run(`Cancelada: ${text(raw?.reason, 500) || 'sem motivo informado'}`, id);
    } else throw badRequest('Ação inválida.');
    audit(db, 'stock_transfer', id, action, user.id);
  });
  return loadTransfer(db, id);
}
