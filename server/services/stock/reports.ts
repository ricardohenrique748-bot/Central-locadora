/**
 * Painel e relatórios do estoque — consultas diretas ao banco.
 *
 * Valores (nunca somados entre si):
 * - Estoque a custo médio: itens por quantidade que NÃO são equipamento de locação (venda, peças, consumo, acessórios),
 *   saldo físico × custo médio ponderado.
 * - Patrimônio de locação a custo de aquisição: equipamentos individuais (custo de cada unidade, exceto baixados)
 *   + equipamentos de locação por quantidade (físico + com clientes) × custo médio. Sem depreciação: valor contábil
 *   depende de política de depreciação do módulo financeiro (futuro).
 * - Valor comercial estimado: saldo × preço de venda (apenas itens vendáveis). É estimativa, não custo.
 */

import { DB } from '../../db';
import { addDaysISO, daysBetween, isISODate, todayISO } from '../../../shared/orcamentos/dates';
import { MOVEMENT_SELECT } from './core';

const RENTAL_KINDS = "('equipamento_locacao','venda_locacao')";
/** Fora dos indicadores de entradas/saídas: transferências (só mudam de local) e locação (o patrimônio continua da empresa). */
const TRANSFER_TYPES = "('transferencia_saida','transferencia_entrada','saida_locacao','retorno_locacao')";

function itemFilter(f: Record<string, string | undefined>, alias = 'i') {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.category) {
    where.push(`${alias}.category = ?`);
    params.push(f.category);
  }
  if (f.kind) {
    where.push(`${alias}.kind = ?`);
    params.push(f.kind);
  }
  return { where, params };
}

export function stockDashboard(db: DB, f: Record<string, string | undefined>) {
  const today = todayISO();
  const from = isISODate(f.from) ? f.from! : addDaysISO(today, -29);
  const to = isISODate(f.to) ? f.to! : today;
  const loc = f.location_id ? Number(f.location_id) : null;
  const it = itemFilter(f);
  const iw = it.where.length ? `AND ${it.where.join(' AND ')}` : '';

  const balLoc = loc ? 'AND b.location_id = ?' : '';
  const balParams = loc ? [loc] : [];

  const items = db.prepare(`SELECT COUNT(*) n, SUM(tracking = 'quantidade') q, SUM(tracking = 'individual') ind FROM catalog_items i WHERE i.active = 1 ${iw}`).get(...it.params) as any;
  const assetLoc = loc ? 'AND a.location_id = ?' : '';
  const assets = db
    .prepare(
      `SELECT COUNT(*) total, SUM(a.rental_status = 'disponivel') disponivel, SUM(a.rental_status = 'alugado') alugado, SUM(a.rental_status = 'reservado') reservado,
         SUM(a.rental_status = 'em_transito') transito, SUM(a.operational_status = 'em_manutencao') manutencao, SUM(a.operational_status = 'aguardando_inspecao') inspecao,
         SUM(a.operational_status = 'danificado') danificado, COALESCE(SUM(a.acquisition_cost),0) custo
       FROM stock_assets a JOIN catalog_items i ON i.id = a.item_id WHERE a.operational_status != 'baixado' ${iw} ${assetLoc}`
    )
    .get(...it.params, ...(loc ? [loc] : [])) as any;

  const stockValue = db
    .prepare(
      `SELECT COALESCE(SUM(b.quantity * COALESCE(i.average_cost, i.acquisition_cost, 0)),0) v,
              COALESCE(SUM(CASE WHEN i.sale_enabled = 1 THEN b.quantity * COALESCE(i.sale_price,0) END),0) comercial
       FROM stock_balances b JOIN catalog_items i ON i.id = b.item_id WHERE i.tracking = 'quantidade' AND i.kind NOT IN ${RENTAL_KINDS} ${iw} ${balLoc}`
    )
    .get(...it.params, ...balParams) as any;
  const rentalQtyValue = db
    .prepare(
      `SELECT COALESCE(SUM((COALESCE(b.q,0) + COALESCE(r.q,0)) * COALESCE(i.average_cost, i.acquisition_cost, 0)),0) v
       FROM catalog_items i
       LEFT JOIN (SELECT item_id, SUM(quantity) q FROM stock_balances b WHERE 1=1 ${balLoc} GROUP BY item_id) b ON b.item_id = i.id
       LEFT JOIN (SELECT item_id, SUM(quantity) q FROM stock_reservations WHERE status = 'em_uso' AND asset_id IS NULL GROUP BY item_id) r ON r.item_id = i.id
       WHERE i.tracking = 'quantidade' AND i.kind IN ${RENTAL_KINDS} ${iw}`
    )
    .get(...balParams, ...it.params) as any;

  const levels = db
    .prepare(
      `SELECT SUM(min_qty IS NOT NULL AND avail < min_qty) abaixo, SUM(phys <= 0) sem_saldo FROM (
         SELECT i.min_qty, COALESCE(SUM(b.quantity),0) phys, COALESCE(SUM(b.quantity - b.reserved - b.unavailable),0) avail
         FROM catalog_items i LEFT JOIN stock_balances b ON b.item_id = i.id ${loc ? 'AND b.location_id = ?' : ''}
         WHERE i.active = 1 AND i.tracking = 'quantidade' AND i.kind NOT IN ${RENTAL_KINDS} ${iw} GROUP BY i.id)`
    )
    .get(...balParams, ...it.params) as any;

  const movWhere = [`m.status != 'rascunho'`, `m.movement_type NOT IN ${TRANSFER_TYPES}`, `date(m.created_at, '-3 hours') BETWEEN ? AND ?`, ...it.where];
  const movParams: (string | number)[] = [from, to, ...it.params];
  if (loc) {
    movWhere.push('m.balance_location_id = ?');
    movParams.push(loc);
  }
  const mw = `WHERE ${movWhere.join(' AND ')}`;
  const flow = db
    .prepare(
      `SELECT SUM(m.qty_delta > 0) entradas, SUM(m.qty_delta < 0) saidas,
         COALESCE(SUM(CASE WHEN m.qty_delta > 0 THEN m.total_cost END),0) valor_entradas, COALESCE(SUM(CASE WHEN m.qty_delta < 0 THEN m.total_cost END),0) valor_saidas
       FROM stock_movements m JOIN catalog_items i ON i.id = m.item_id ${mw}`
    )
    .get(...movParams) as any;

  const span = daysBetween(from, to);
  const bucket = span <= 45 ? "date(m.created_at, '-3 hours')" : "strftime('%Y-%m', m.created_at, '-3 hours')";
  const flowSeries = db
    .prepare(`SELECT ${bucket} bucket, SUM(m.qty_delta > 0) entradas, SUM(m.qty_delta < 0) saidas FROM stock_movements m JOIN catalog_items i ON i.id = m.item_id ${mw} GROUP BY bucket ORDER BY bucket`)
    .all(...movParams);
  const byCategory = db
    .prepare(
      `SELECT COALESCE(i.category,'Sem categoria') label, COUNT(*) items,
         COALESCE(SUM(CASE WHEN i.tracking = 'quantidade' THEN (SELECT COALESCE(SUM(quantity),0) FROM stock_balances b WHERE b.item_id = i.id ${balLoc}) * COALESCE(i.average_cost, i.acquisition_cost, 0)
           ELSE (SELECT COALESCE(SUM(acquisition_cost),0) FROM stock_assets a WHERE a.item_id = i.id AND a.operational_status != 'baixado' ${assetLoc}) END),0) value
       FROM catalog_items i WHERE i.active = 1 ${iw} GROUP BY label ORDER BY value DESC`
    )
    .all(...balParams, ...(loc ? [loc] : []), ...it.params);
  const topMoved = db
    .prepare(
      `SELECT i.internal_code code, i.description label, i.unit, SUM(m.quantity) qty, COUNT(*) movements
       FROM stock_movements m JOIN catalog_items i ON i.id = m.item_id ${mw} GROUP BY i.id ORDER BY qty DESC LIMIT 8`
    )
    .all(...movParams);
  // evolução: valor movimentado acumulado a custo (soma de delta × custo unitário registrado em cada movimentação)
  const evoBucket = span <= 45 ? "date(m.created_at, '-3 hours')" : "strftime('%Y-%m', m.created_at, '-3 hours')";
  const evoRaw = db
    .prepare(
      `SELECT ${evoBucket} bucket, SUM(m.qty_delta * COALESCE(m.unit_cost,0)) delta FROM stock_movements m JOIN catalog_items i ON i.id = m.item_id
       WHERE m.status != 'rascunho' ${iw.replace(/^AND/, 'AND')} ${loc ? 'AND m.balance_location_id = ?' : ''} GROUP BY bucket ORDER BY bucket`
    )
    .all(...it.params, ...(loc ? [loc] : [])) as { bucket: string; delta: number }[];
  let acc = 0;
  const evolution = evoRaw
    .map((r) => ({ bucket: r.bucket, value: (acc += r.delta) }))
    .filter((r) => r.bucket >= (span <= 45 ? from : from.slice(0, 7)) && r.bucket <= (span <= 45 ? to : to.slice(0, 7)));

  const recent = db.prepare(`${MOVEMENT_SELECT} WHERE m.status != 'rascunho' ORDER BY m.id DESC LIMIT 10`).all();

  return {
    period: { from, to, granularity: span <= 45 ? 'dia' : 'mes' },
    kpis: {
      itens_ativos: items.n || 0,
      itens_quantidade: items.q || 0,
      itens_individuais: items.ind || 0,
      equipamentos_patrimoniais: assets.total || 0,
      valor_estoque_custo: Math.round(stockValue.v),
      valor_comercial_estimado: Math.round(stockValue.comercial),
      valor_patrimonio_locacao: Math.round(assets.custo + rentalQtyValue.v),
      abaixo_minimo: levels.abaixo || 0,
      sem_saldo: levels.sem_saldo || 0,
      eq_disponiveis: assets.disponivel || 0,
      eq_alugados: assets.alugado || 0,
      eq_reservados: assets.reservado || 0,
      eq_transito: assets.transito || 0,
      eq_manutencao: assets.manutencao || 0,
      eq_inspecao: assets.inspecao || 0,
      eq_danificados: assets.danificado || 0,
      entradas: flow.entradas || 0,
      saidas: flow.saidas || 0,
      valor_entradas: flow.valor_entradas || 0,
      valor_saidas: flow.valor_saidas || 0,
    },
    flowSeries,
    byCategory,
    topMoved,
    evolution,
    recent,
  };
}

export function stockReport(db: DB, kind: string, f: Record<string, string | undefined>) {
  const it = itemFilter(f);
  const iw = it.where.length ? `AND ${it.where.join(' AND ')}` : '';
  const today = todayISO();
  switch (kind) {
    case 'posicao':
      return db
        .prepare(
          `SELECT i.internal_code code, i.description, i.kind, i.category, i.unit, l.name location, b.quantity, b.reserved, b.unavailable,
             (b.quantity - b.reserved - b.unavailable) available, COALESCE(i.average_cost, i.acquisition_cost) unit_cost,
             ROUND(b.quantity * COALESCE(i.average_cost, i.acquisition_cost, 0)) total_cost
           FROM stock_balances b JOIN catalog_items i ON i.id = b.item_id JOIN stock_locations l ON l.id = b.location_id
           WHERE i.tracking = 'quantidade' ${iw} ${f.location_id ? 'AND b.location_id = ?' : ''} ORDER BY i.internal_code, l.name`
        )
        .all(...it.params, ...(f.location_id ? [Number(f.location_id)] : []));
    case 'abaixo_minimo':
      return db
        .prepare(
          `SELECT * FROM (SELECT i.internal_code code, i.description, i.unit, i.min_qty, COALESCE(SUM(b.quantity - b.reserved - b.unavailable),0) available, s.name supplier
             FROM catalog_items i LEFT JOIN stock_balances b ON b.item_id = i.id LEFT JOIN suppliers s ON s.id = i.main_supplier_id
             WHERE i.active = 1 AND i.tracking = 'quantidade' AND i.min_qty IS NOT NULL ${iw} GROUP BY i.id) WHERE available < min_qty ORDER BY code`
        )
        .all(...it.params);
    case 'patrimonio':
      return db
        .prepare(
          `SELECT a.asset_tag, a.serial_number, i.internal_code code, i.description, i.category, a.acquisition_date, a.acquisition_cost,
             a.operational_status, a.rental_status, l.name location, a.conservation, a.written_off_at
           FROM stock_assets a JOIN catalog_items i ON i.id = a.item_id LEFT JOIN stock_locations l ON l.id = a.location_id
           WHERE 1=1 ${iw} ${f.include_written_off === '1' ? '' : "AND a.operational_status != 'baixado'"} ORDER BY a.asset_tag`
        )
        .all(...it.params);
    case 'valor_categoria':
      return db
        .prepare(
          `SELECT COALESCE(i.category,'Sem categoria') category,
             COALESCE(SUM(CASE WHEN i.tracking = 'quantidade' AND i.kind NOT IN ${RENTAL_KINDS} THEN (SELECT COALESCE(SUM(quantity),0) FROM stock_balances b WHERE b.item_id = i.id) * COALESCE(i.average_cost, i.acquisition_cost, 0) END),0) stock_cost,
             COALESCE(SUM(CASE WHEN i.tracking = 'individual' THEN (SELECT COALESCE(SUM(acquisition_cost),0) FROM stock_assets a WHERE a.item_id = i.id AND a.operational_status != 'baixado')
                               WHEN i.kind IN ${RENTAL_KINDS} THEN (SELECT COALESCE(SUM(quantity),0) FROM stock_balances b WHERE b.item_id = i.id) * COALESCE(i.average_cost, i.acquisition_cost, 0) END),0) rental_cost,
             COALESCE(SUM(CASE WHEN i.sale_enabled = 1 AND i.tracking = 'quantidade' THEN (SELECT COALESCE(SUM(quantity),0) FROM stock_balances b WHERE b.item_id = i.id) * COALESCE(i.sale_price,0) END),0) commercial
           FROM catalog_items i WHERE i.active = 1 ${iw} GROUP BY category ORDER BY category`
        )
        .all(...it.params);
    case 'utilizacao': {
      const from = isISODate(f.from) ? f.from! : addDaysISO(today, -29);
      const to = isISODate(f.to) ? f.to! : today;
      const days = daysBetween(from, to) + 1;
      const rows = db
        .prepare(
          `SELECT a.asset_tag, i.internal_code code, i.description, r.start_date, r.end_date, r.status
           FROM stock_assets a JOIN catalog_items i ON i.id = a.item_id
           LEFT JOIN stock_reservations r ON r.asset_id = a.id AND r.status IN ('em_uso','concluida') AND r.start_date <= ? AND r.end_date >= ?
           WHERE a.operational_status != 'baixado' ${iw} ORDER BY a.asset_tag`
        )
        .all(to, from, ...it.params) as any[];
      const map = new Map<string, any>();
      for (const r of rows) {
        const cur = map.get(r.asset_tag) || { asset_tag: r.asset_tag, code: r.code, description: r.description, rented_days: 0, period_days: days };
        if (r.start_date) {
          const s = r.start_date > from ? r.start_date : from;
          const e = r.end_date < to ? r.end_date : to;
          cur.rented_days += Math.max(0, daysBetween(s, e) + 1);
        }
        map.set(r.asset_tag, cur);
      }
      return [...map.values()].map((r) => ({ ...r, rented_days: Math.min(r.rented_days, days), utilization: Math.round((Math.min(r.rented_days, days) / days) * 1000) / 10 }));
    }
    case 'divergencias':
      return db
        .prepare(
          `SELECT v.number inventory, v.approved_at, i.internal_code code, i.description, l.name location, ln.system_qty, ln.counted_qty, (ln.counted_qty - ln.system_qty) difference, ln.justification
           FROM stock_inventory_lines ln JOIN stock_inventories v ON v.id = ln.inventory_id JOIN catalog_items i ON i.id = ln.item_id JOIN stock_locations l ON l.id = ln.location_id
           WHERE v.status = 'finalizado' AND ln.counted_qty != ln.system_qty ${iw} ORDER BY v.id DESC`
        )
        .all(...it.params);
    default:
      return null;
  }
}

/** Pesquisa rápida no módulo (itens, patrimônios, documentos). */
export function quickSearch(db: DB, q: string) {
  const term = `%${q.trim()}%`;
  if (q.trim().length < 2) return { items: [], assets: [], documents: [] };
  return {
    items: db.prepare('SELECT id, internal_code, description FROM catalog_items WHERE internal_code LIKE ? OR description LIKE ? OR barcode = ? ORDER BY internal_code LIMIT 8').all(term, term, q.trim()),
    assets: db
      .prepare('SELECT a.id, a.asset_tag, a.serial_number, i.description FROM stock_assets a JOIN catalog_items i ON i.id = a.item_id WHERE a.asset_tag LIKE ? OR a.serial_number LIKE ? LIMIT 8')
      .all(term, term),
    documents: db
      .prepare(
        `SELECT 'entrada' type, id, number FROM stock_entries WHERE number LIKE ?
         UNION ALL SELECT 'transferencia', id, number FROM stock_transfers WHERE number LIKE ?
         UNION ALL SELECT 'inventario', id, number FROM stock_inventories WHERE number LIKE ?
         UNION ALL SELECT 'reserva', id, number FROM stock_reservations WHERE number LIKE ?
         UNION ALL SELECT 'movimentacao', id, number FROM stock_movements WHERE number LIKE ? LIMIT 10`
      )
      .all(term, term, term, term, term),
  };
}
