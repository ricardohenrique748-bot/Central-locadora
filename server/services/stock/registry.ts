/**
 * Cadastros do estoque: itens com saldos consolidados, fornecedores, locais e configurações.
 */

import { DB, audit } from '../../db';
import { badRequest, conflict, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { Balance, LocationType, StockItemRow, StockLocation, StockSettings, Supplier } from '../../../shared/estoque/types';
import { stockCan } from '../../../shared/estoque/rules';
import { validateSupplier } from '../../../shared/estoque/validators';
import { onlyDigits } from '../../../shared/orcamentos/validators';
import { getCatalogItem, rowToCatalog } from '../catalog';
import { MOVEMENT_SELECT, NOW_SQL } from './core';

const text = (v: unknown, max = 200) => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t === '' ? null : t;
};

// ------------------------------------------------ itens com saldo

const ROW_SELECT = `
  SELECT i.*, NULL AS image_data, s.name AS supplier_name,
    COALESCE(b.qty, 0) AS qty_physical, COALESCE(b.res, 0) AS qty_reserved, COALESCE(b.unav, 0) AS qty_unavailable,
    COALESCE((SELECT SUM(ti.quantity) FROM stock_transfer_items ti JOIN stock_transfers t ON t.id = ti.transfer_id WHERE ti.item_id = i.id AND t.status = 'em_transito'), 0) AS qty_in_transit,
    COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.item_id = i.id AND r.status = 'em_uso'), 0) AS qty_on_rent,
    (SELECT COUNT(*) FROM stock_assets a WHERE a.item_id = i.id AND a.operational_status != 'baixado') AS assets_total,
    (SELECT COUNT(*) FROM stock_assets a WHERE a.item_id = i.id AND a.rental_status = 'disponivel') AS assets_available
  FROM catalog_items i
  LEFT JOIN suppliers s ON s.id = i.main_supplier_id
  LEFT JOIN (SELECT item_id, SUM(quantity) qty, SUM(reserved) res, SUM(unavailable) unav FROM stock_balances GROUP BY item_id) b ON b.item_id = i.id`;

function toRow(r: any): StockItemRow {
  const base = rowToCatalog(r);
  return { ...base, ...r, ...base, qty_available: Math.round((r.qty_physical - r.qty_reserved - r.qty_unavailable) * 1000) / 1000 } as StockItemRow;
}

export function listStockItems(db: DB, f: Record<string, string | undefined>) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.q?.trim()) {
    where.push('(i.internal_code LIKE ? OR i.description LIKE ? OR i.brand LIKE ? OR i.model LIKE ? OR i.barcode = ?)');
    const q = `%${f.q.trim()}%`;
    params.push(q, q, q, q, f.q.trim());
  }
  if (f.kind) {
    where.push('i.kind = ?');
    params.push(f.kind);
  }
  if (f.category) {
    where.push('i.category = ?');
    params.push(f.category);
  }
  if (f.tracking) {
    where.push('i.tracking = ?');
    params.push(f.tracking);
  }
  if (f.active === 'true') where.push('i.active = 1');
  if (f.active === 'false') where.push('i.active = 0');
  if (f.rental === '1') where.push('i.rental_enabled = 1');
  if (f.location_id) {
    where.push('EXISTS (SELECT 1 FROM stock_balances sb WHERE sb.item_id = i.id AND sb.location_id = ? AND sb.quantity != 0 UNION SELECT 1 FROM stock_assets sa WHERE sa.item_id = i.id AND sa.location_id = ?)');
    params.push(Number(f.location_id), Number(f.location_id));
  }
  const having: string[] = [];
  if (f.situation === 'abaixo_minimo') having.push("tracking = 'quantidade' AND min_qty IS NOT NULL AND (qty_physical - qty_reserved - qty_unavailable) < min_qty");
  if (f.situation === 'sem_saldo') having.push("tracking = 'quantidade' AND qty_physical <= 0");
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const outer = having.length ? `WHERE ${having.join(' AND ')}` : '';
  const base = `SELECT * FROM (${ROW_SELECT} ${w}) x ${outer}`;
  const total = (db.prepare(`SELECT COUNT(*) n FROM (${base})`).get(...params) as { n: number }).n;
  const pageSize = f.all ? 10000 : Math.min(Math.max(Number(f.page_size) || 25, 5), 100);
  const page = f.all ? 1 : Math.max(Number(f.page) || 1, 1);
  const rows = (db.prepare(`${base} ORDER BY internal_code LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as any[]).map(toRow);
  const categories = (db.prepare('SELECT DISTINCT category FROM catalog_items WHERE category IS NOT NULL ORDER BY category').all() as { category: string }[]).map((r) => r.category);
  return { total, page, page_size: pageSize, rows, categories };
}

export function getStockItemDetail(db: DB, id: number) {
  const item = getCatalogItem(db, id);
  const row = toRow(db.prepare(`${ROW_SELECT} WHERE i.id = ?`).get(id));
  const balances = db
    .prepare('SELECT b.item_id, b.location_id, l.name AS location_name, b.quantity, b.reserved, b.unavailable FROM stock_balances b JOIN stock_locations l ON l.id = b.location_id WHERE b.item_id = ? ORDER BY l.name')
    .all(id) as unknown as Balance[];
  const movements = db.prepare(`${MOVEMENT_SELECT} WHERE m.item_id = ? ORDER BY m.id DESC LIMIT 15`).all(id);
  return { ...row, image_data: item.image_data, balances, movements };
}

// ------------------------------------------------ fornecedores

function normalizeSupplier(raw: any) {
  return {
    person_type: raw?.person_type === 'PF' ? 'PF' : 'PJ',
    name: text(raw?.name) || '',
    trade_name: text(raw?.trade_name),
    document: onlyDigits(raw?.document) || null,
    state_registration: text(raw?.state_registration, 30),
    contact_name: text(raw?.contact_name, 100),
    phone: onlyDigits(raw?.phone) || null,
    email: text(raw?.email, 120)?.toLowerCase() || null,
    address: text(raw?.address, 300),
    city: text(raw?.city, 100),
    state: text(raw?.state, 2)?.toUpperCase() || null,
    notes: text(raw?.notes, 2000),
    active: raw?.active === undefined ? true : !!raw.active,
  } as Omit<Supplier, 'id' | 'created_at'>;
}

const SUP_FIELDS = ['person_type', 'name', 'trade_name', 'document', 'state_registration', 'contact_name', 'phone', 'email', 'address', 'city', 'state', 'notes', 'active'] as const;
const supToDb = (s: any) => SUP_FIELDS.map((f) => (f === 'active' ? (s.active ? 1 : 0) : s[f]));

export function listSuppliers(db: DB, f: Record<string, string | undefined>) {
  const where: string[] = [];
  const params: string[] = [];
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    const d = onlyDigits(f.q);
    where.push(`(name LIKE ? OR trade_name LIKE ?${d.length >= 3 ? ' OR document LIKE ?' : ''})`);
    params.push(q, q);
    if (d.length >= 3) params.push(`%${d}%`);
  }
  if (f.active === 'true') where.push('active = 1');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = (db.prepare(`SELECT * FROM suppliers ${w} ORDER BY name COLLATE NOCASE LIMIT 500`).all(...params) as any[]).map((r) => ({ ...r, active: !!r.active }));
  return { total: rows.length, rows };
}

function assertSupplier(db: DB, s: any, ignoreId = 0) {
  const e = validateSupplier(s);
  if (Object.keys(e).length) throw badRequest(Object.values(e)[0], e);
  if (s.document && db.prepare('SELECT 1 FROM suppliers WHERE document = ? AND id != ?').get(s.document, ignoreId)) throw conflict('Já existe um fornecedor com este documento.');
}

export function createSupplier(db: DB, user: AuthUser, raw: any) {
  if (!stockCan.manageSuppliers(user)) throw forbidden();
  const s = normalizeSupplier(raw);
  assertSupplier(db, s);
  const row = db.prepare(`INSERT INTO suppliers (${SUP_FIELDS.join(', ')}) VALUES (${SUP_FIELDS.map(() => '?').join(', ')}) RETURNING *`).get(...supToDb(s)) as any;
  audit(db, 'supplier', row.id, 'create', user.id, s);
  return { ...row, active: !!row.active };
}

export function updateSupplier(db: DB, user: AuthUser, id: number, raw: any) {
  if (!stockCan.manageSuppliers(user)) throw forbidden();
  const before = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
  if (!before) throw notFound('Fornecedor não encontrado.');
  const s = normalizeSupplier({ ...before, ...raw });
  assertSupplier(db, s, id);
  const row = db.prepare(`UPDATE suppliers SET ${SUP_FIELDS.map((f) => `${f} = ?`).join(', ')}, updated_at = ${NOW_SQL} WHERE id = ? RETURNING *`).get(...supToDb(s), id) as any;
  audit(db, 'supplier', id, 'update', user.id, { before, after: s });
  return { ...row, active: !!row.active };
}

// ------------------------------------------------ locais

const LOC_TYPES: LocationType[] = ['deposito', 'filial', 'patio', 'oficina', 'outro'];

export function listLocations(db: DB): StockLocation[] {
  return (db.prepare('SELECT * FROM stock_locations ORDER BY active DESC, name').all() as any[]).map((r) => ({ ...r, active: !!r.active }));
}

export function saveLocation(db: DB, user: AuthUser, id: number | null, raw: any): StockLocation {
  if (!stockCan.configure(user)) throw forbidden('Somente o administrador gerencia locais.');
  const loc = {
    code: (text(raw?.code, 20) || '').toUpperCase(),
    name: text(raw?.name, 100) || '',
    location_type: LOC_TYPES.includes(raw?.location_type) ? raw.location_type : 'deposito',
    address: text(raw?.address, 300),
    responsible: text(raw?.responsible, 100),
    active: raw?.active === undefined ? true : !!raw.active,
  };
  const errors: Record<string, string> = {};
  if (!/^[A-Z0-9\-_.]{2,20}$/.test(loc.code)) errors.code = 'Código com 2 a 20 letras/números.';
  if (loc.name.length < 2) errors.name = 'Informe o nome.';
  if (Object.keys(errors).length) throw badRequest(Object.values(errors)[0], errors);
  if (db.prepare('SELECT 1 FROM stock_locations WHERE code = ? AND id != ?').get(loc.code, id ?? 0)) throw conflict('Já existe um local com este código.');
  if (id && !loc.active) {
    const hasStock = db.prepare('SELECT 1 FROM stock_balances WHERE location_id = ? AND quantity != 0 UNION SELECT 1 FROM stock_assets WHERE location_id = ? AND operational_status != \'baixado\'').get(id, id);
    if (hasStock) throw badRequest('Não é possível inativar um local que ainda tem saldo ou equipamentos. Transfira antes.');
  }
  const vals = [loc.code, loc.name, loc.location_type, loc.address, loc.responsible, loc.active ? 1 : 0];
  const row = id
    ? db.prepare('UPDATE stock_locations SET code = ?, name = ?, location_type = ?, address = ?, responsible = ?, active = ? WHERE id = ? RETURNING *').get(...vals, id)
    : db.prepare('INSERT INTO stock_locations (code, name, location_type, address, responsible, active) VALUES (?, ?, ?, ?, ?, ?) RETURNING *').get(...vals);
  if (!row) throw notFound('Local não encontrado.');
  audit(db, 'stock_location', (row as any).id, id ? 'update' : 'create', user.id, loc);
  return { ...(row as any), active: !!(row as any).active };
}

// ------------------------------------------------ configurações

export const DEFAULT_STOCK_SETTINGS: StockSettings = {
  categories: [
    { name: 'Andaimes', subcategories: ['Painéis', 'Acessórios de andaime'] },
    { name: 'Escoramento', subcategories: ['Escoras metálicas'] },
    { name: 'Ferramentas elétricas', subcategories: ['Marteletes', 'Serras', 'Furadeiras'] },
    { name: 'Concreto', subcategories: ['Betoneiras', 'Vibradores'] },
    { name: 'Compactação', subcategories: ['Placas', 'Sapos'] },
    { name: 'Acessórios', subcategories: [] },
    { name: 'Peças de reposição', subcategories: [] },
    { name: 'Material de consumo', subcategories: [] },
  ],
  units: [
    { code: 'un', name: 'Unidade' },
    { code: 'pç', name: 'Peça' },
    { code: 'cj', name: 'Conjunto' },
    { code: 'm', name: 'Metro' },
    { code: 'kg', name: 'Quilograma' },
    { code: 'l', name: 'Litro' },
    { code: 'cx', name: 'Caixa' },
  ],
  exit_reasons: ['Consumo interno', 'Perda', 'Avaria', 'Descarte', 'Uso em manutenção'],
  allow_negative_default: false,
};

export function getStockSettings(db: DB): StockSettings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'stock'").get() as { value: string } | undefined;
  return row ? { ...DEFAULT_STOCK_SETTINGS, ...JSON.parse(row.value) } : DEFAULT_STOCK_SETTINGS;
}

export function saveStockSettings(db: DB, user: AuthUser, raw: any): StockSettings {
  if (!stockCan.configure(user)) throw forbidden('Somente o administrador altera as configurações do estoque.');
  const clean = (s: unknown, max = 60) => (typeof s === 'string' ? s.trim().slice(0, max) : '');
  const categories = (Array.isArray(raw?.categories) ? raw.categories : [])
    .map((c: any) => ({ name: clean(c?.name), subcategories: (Array.isArray(c?.subcategories) ? c.subcategories : []).map((x: unknown) => clean(x)).filter(Boolean) }))
    .filter((c: any) => c.name);
  const units = (Array.isArray(raw?.units) ? raw.units : []).map((u: any) => ({ code: clean(u?.code, 10), name: clean(u?.name) })).filter((u: any) => u.code && u.name);
  const exit_reasons = (Array.isArray(raw?.exit_reasons) ? raw.exit_reasons : []).map((r: unknown) => clean(r, 80)).filter(Boolean);
  if (!categories.length) throw badRequest('Cadastre ao menos uma categoria.');
  if (!units.length) throw badRequest('Cadastre ao menos uma unidade de medida.');
  if (!exit_reasons.length) throw badRequest('Cadastre ao menos um motivo de saída.');
  const s: StockSettings = { categories, units, exit_reasons, allow_negative_default: !!raw?.allow_negative_default };
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('stock', ?, ${NOW_SQL}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(JSON.stringify(s));
  audit(db, 'settings', 'stock', 'update', user.id, s);
  return s;
}
