/**
 * Inventário físico.
 *
 * Fluxo: em andamento (contagem) → aguardando conferência → aguardando aprovação → finalizado (ou cancelado).
 * Referência temporal: ao abrir, grava o saldo do sistema de cada linha e o último nº de movimentação.
 * A contagem representa o estoque no momento da abertura; o ajuste é (contado − saldo na abertura),
 * aplicado sobre o saldo atual — assim movimentações feitas durante a contagem não são perdidas nem
 * contadas em dobro. Linhas que tiveram movimentação durante a contagem são sinalizadas ao aprovador.
 * Itens individuais (patrimônio) não são ajustados automaticamente: divergências exigem tratamento
 * na ficha do equipamento (transferência, baixa), com justificativa.
 */

import { DB, audit, transaction } from '../../db';
import { HttpError, badRequest, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { Inventory, InventoryScope, ITEM_KIND_LABELS } from '../../../shared/estoque/types';
import { round3, stockCan } from '../../../shared/estoque/rules';
import { NOW_SQL, applyMovement, assertLocation, nextNumber } from './core';

const text = (v: unknown, max = 500) => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t === '' ? null : t;
};

function loadInventory(db: DB, id: number): Inventory {
  const inv = db
    .prepare(
      `SELECT v.*, l.name AS location_name, COALESCE(uo.name,'Sistema') AS opened_by_name, uc.name AS checked_by_name, ua.name AS approved_by_name
       FROM stock_inventories v LEFT JOIN stock_locations l ON l.id = v.location_id LEFT JOIN users uo ON uo.id = v.opened_by
       LEFT JOIN users uc ON uc.id = v.checked_by LEFT JOIN users ua ON ua.id = v.approved_by WHERE v.id = ?`
    )
    .get(id) as any;
  if (!inv) throw notFound('Inventário não encontrado.');
  const lines = (
    db
      .prepare(
        `SELECT ln.*, i.internal_code AS item_code, i.description AS item_description, i.unit, i.tracking, l.name AS location_name,
          COALESCE((SELECT SUM(m.qty_delta) FROM stock_movements m WHERE m.item_id = ln.item_id AND m.balance_location_id = ln.location_id
             AND m.status != 'rascunho' AND m.id > ? AND NOT (m.document_type = 'inventario' AND m.document_id = ?)), 0) AS moved_since_snapshot
         FROM stock_inventory_lines ln JOIN catalog_items i ON i.id = ln.item_id JOIN stock_locations l ON l.id = ln.location_id
         WHERE ln.inventory_id = ? ORDER BY l.name, i.internal_code`
      )
      .all(inv.snapshot_movement_id, id, id) as any[]
  ).map((l) => ({ ...l, difference: l.counted_qty === null ? null : round3(l.counted_qty - l.system_qty) }));
  return { ...inv, lines };
}

export const getInventory = loadInventory;

export function listInventories(db: DB) {
  return {
    rows: db
      .prepare(
        `SELECT v.id, v.number, v.status, v.scope_label, v.opened_at, v.approved_at, l.name AS location_name, COALESCE(u.name,'Sistema') AS opened_by_name,
          (SELECT COUNT(*) FROM stock_inventory_lines x WHERE x.inventory_id = v.id) AS lines,
          (SELECT COUNT(*) FROM stock_inventory_lines x WHERE x.inventory_id = v.id AND x.counted_qty IS NOT NULL AND x.counted_qty != x.system_qty) AS divergences
         FROM stock_inventories v LEFT JOIN stock_locations l ON l.id = v.location_id LEFT JOIN users u ON u.id = v.opened_by ORDER BY v.id DESC LIMIT 200`
      )
      .all(),
  };
}

export function openInventory(db: DB, user: AuthUser, raw: any): Inventory {
  if (!stockCan.operate(user)) throw forbidden();
  const scope = raw?.scope as InventoryScope;
  if (!['geral', 'local', 'categoria', 'tipo', 'itens'].includes(scope)) throw badRequest('Selecione o tipo de inventário.');
  const location_id = raw?.location_id ? assertLocation(db, raw.location_id) : null;
  if ((scope === 'local' || scope === 'itens') && !location_id) throw badRequest('Selecione o local inventariado.', { location_id: 'Obrigatório.' });

  const where: string[] = ['i.active = 1'];
  const params: (string | number)[] = [];
  let label = 'Inventário geral';
  if (scope === 'categoria') {
    if (!raw?.category) throw badRequest('Selecione a categoria.');
    where.push('i.category = ?');
    params.push(raw.category);
    label = `Categoria: ${raw.category}`;
  }
  if (scope === 'tipo') {
    if (!(raw?.kind in ITEM_KIND_LABELS)) throw badRequest('Selecione o tipo de item.');
    where.push('i.kind = ?');
    params.push(raw.kind);
    label = `Tipo: ${ITEM_KIND_LABELS[raw.kind as keyof typeof ITEM_KIND_LABELS]}`;
  }
  let itemIds: number[] = [];
  if (scope === 'itens') {
    itemIds = (Array.isArray(raw?.item_ids) ? raw.item_ids : []).map(Number).filter((n: number) => n > 0);
    if (!itemIds.length) throw badRequest('Selecione os itens.');
    where.push(`i.id IN (${itemIds.map(() => '?').join(',')})`);
    params.push(...itemIds);
    label = `${itemIds.length} item(ns) selecionado(s)`;
  }
  if (scope === 'local') label = 'Inventário do local';

  return loadInventory(
    db,
    transaction(db, () => {
      const snapshot = (db.prepare('SELECT COALESCE(MAX(id),0) m FROM stock_movements').get() as { m: number }).m;
      // linhas: saldos existentes (inclusive zerados) no(s) local(is); em "itens", também itens sem saldo no local
      const locWhere = location_id ? 'AND b.location_id = ?' : '';
      const locParams = location_id ? [location_id] : [];
      const rows = db
        .prepare(`SELECT b.item_id, b.location_id, b.quantity FROM stock_balances b JOIN catalog_items i ON i.id = b.item_id WHERE ${where.join(' AND ')} ${locWhere}`)
        .all(...params, ...locParams) as { item_id: number; location_id: number; quantity: number }[];
      if (scope === 'itens') {
        for (const id of itemIds) if (!rows.find((r) => r.item_id === id)) rows.push({ item_id: id, location_id: location_id!, quantity: 0 });
      }
      if (!rows.length) throw badRequest('Nenhum saldo encontrado para este escopo.');
      // não permite duas contagens abertas para o mesmo item/local
      for (const r of rows) {
        const open = db
          .prepare(
            `SELECT v.number FROM stock_inventory_lines ln JOIN stock_inventories v ON v.id = ln.inventory_id
             WHERE ln.item_id = ? AND ln.location_id = ? AND v.status IN ('em_andamento','aguardando_conferencia','aguardando_aprovacao')`
          )
          .get(r.item_id, r.location_id) as { number: string } | undefined;
        if (open) throw new HttpError(409, `Já existe inventário aberto (${open.number}) com itens deste escopo.`);
      }
      const inv = db
        .prepare(`INSERT INTO stock_inventories (number, status, scope, scope_label, location_id, snapshot_movement_id, opened_by, notes) VALUES (?, 'em_andamento', ?, ?, ?, ?, ?, ?) RETURNING id`)
        .get(nextNumber(db, 'INV'), scope, label, location_id, snapshot, user.id, text(raw?.notes, 2000)) as { id: number };
      const ins = db.prepare('INSERT INTO stock_inventory_lines (inventory_id, item_id, location_id, system_qty) VALUES (?, ?, ?, ?)');
      for (const r of rows) ins.run(inv.id, r.item_id, r.location_id, r.quantity);
      audit(db, 'stock_inventory', inv.id, 'open', user.id, { scope, label, lines: rows.length });
      return inv.id;
    })
  );
}

export function saveCounts(db: DB, user: AuthUser, id: number, raw: any): Inventory {
  if (!stockCan.operate(user)) throw forbidden();
  transaction(db, () => {
    const inv = loadInventory(db, id);
    if (!['em_andamento', 'aguardando_conferencia'].includes(inv.status)) throw new HttpError(422, 'Contagem encerrada para este inventário.');
    const counts = Array.isArray(raw?.lines) ? raw.lines : [];
    const upd = db.prepare(`UPDATE stock_inventory_lines SET counted_qty = ?, justification = ?, counted_by = ?, counted_at = ${NOW_SQL} WHERE id = ? AND inventory_id = ?`);
    for (const c of counts) {
      const line = inv.lines.find((l) => l.id === Number(c?.id));
      if (!line) continue;
      const q = c?.counted_qty === null || c?.counted_qty === '' || c?.counted_qty === undefined ? null : Number(c.counted_qty);
      if (q !== null && (!Number.isFinite(q) || q < 0)) throw badRequest(`${line.item_code}: quantidade contada inválida.`);
      if (q !== null && line.tracking === 'individual' && !Number.isInteger(q)) throw badRequest(`${line.item_code}: equipamento individual se conta em unidades inteiras.`);
      upd.run(q, text(c?.justification, 1000), user.id, line.id, id);
    }
  });
  return loadInventory(db, id);
}

export function inventoryAction(db: DB, user: AuthUser, id: number, action: string, raw: any): Inventory {
  transaction(db, () => {
    const inv = loadInventory(db, id);
    const need = (s: Inventory['status'][]) => {
      if (!s.includes(inv.status)) throw new HttpError(422, 'Ação indisponível nesta etapa do inventário.');
    };
    const pending = inv.lines.filter((l) => l.counted_qty === null);
    const unjustified = inv.lines.filter((l) => l.difference !== null && Math.abs(l.difference) > 1e-9 && !l.justification);
    if (action === 'enviar_conferencia') {
      if (!stockCan.operate(user)) throw forbidden();
      need(['em_andamento']);
      if (pending.length) throw badRequest(`Faltam ${pending.length} linha(s) sem contagem.`);
      db.prepare("UPDATE stock_inventories SET status = 'aguardando_conferencia' WHERE id = ?").run(id);
    } else if (action === 'conferir') {
      if (!stockCan.operate(user)) throw forbidden();
      need(['aguardando_conferencia']);
      if (pending.length) throw badRequest(`Faltam ${pending.length} linha(s) sem contagem.`);
      if (unjustified.length) throw badRequest(`Justifique as ${unjustified.length} divergência(s) antes de enviar para aprovação.`);
      db.prepare("UPDATE stock_inventories SET status = 'aguardando_aprovacao', checked_by = ? WHERE id = ?").run(user.id, id);
    } else if (action === 'devolver') {
      if (!stockCan.approve(user)) throw forbidden();
      need(['aguardando_aprovacao', 'aguardando_conferencia']);
      db.prepare("UPDATE stock_inventories SET status = 'em_andamento', notes = COALESCE(notes || char(10), '') || ? WHERE id = ?").run(`Devolvido para recontagem: ${text(raw?.reason, 500) || '-'}`, id);
    } else if (action === 'aprovar') {
      if (!stockCan.approve(user)) throw forbidden('A aprovação de ajustes de inventário exige gestor ou administrador.');
      need(['aguardando_aprovacao']);
      if (unjustified.length) throw badRequest('Há divergências sem justificativa.');
      for (const l of inv.lines) {
        const d = l.difference || 0;
        if (Math.abs(d) < 1e-9 || l.tracking === 'individual') continue;
        applyMovement(db, user, {
          type: d > 0 ? 'ajuste_positivo' : 'ajuste_negativo', item_id: l.item_id, quantity: Math.abs(d), location_id: l.location_id, qty_delta: d,
          origin_location_id: d < 0 ? l.location_id : null, dest_location_id: d > 0 ? l.location_id : null,
          reference_doc: inv.number, reason: `Inventário: ${l.justification}`, document_type: 'inventario', document_id: inv.id, allowUnavailable: true,
        });
      }
      db.prepare(`UPDATE stock_inventories SET status = 'finalizado', approved_by = ?, approved_at = ${NOW_SQL} WHERE id = ?`).run(user.id, id);
    } else if (action === 'cancelar') {
      if (!(stockCan.approve(user) || stockCan.operate(user))) throw forbidden();
      need(['em_andamento', 'aguardando_conferencia', 'aguardando_aprovacao']);
      const reason = text(raw?.reason, 500);
      if (!reason) throw badRequest('Informe o motivo do cancelamento.', { reason: 'Obrigatório.' });
      db.prepare("UPDATE stock_inventories SET status = 'cancelado', notes = COALESCE(notes || char(10), '') || ? WHERE id = ?").run(`Cancelado: ${reason}`, id);
    } else throw badRequest('Ação inválida.');
    audit(db, 'stock_inventory', id, action, user.id);
  });
  return loadInventory(db, id);
}
