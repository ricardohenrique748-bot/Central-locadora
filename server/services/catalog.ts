/**
 * Cadastro único de itens (Estoque + catálogo dos Orçamentos).
 * O saldo NUNCA é alterado aqui: só por movimentações auditáveis.
 * Orçamentos guardam código, descrição e preço do momento da inclusão (alterações não retroagem).
 */

import { DB, audit, nextCounter } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../http';
import { AuthUser } from '../../shared/orcamentos/types';
import { ItemKind, StockItem, StockItemInput } from '../../shared/estoque/types';
import { KIND_DEFAULTS, validateStockItem } from '../../shared/estoque/validators';
import { stockCan } from '../../shared/estoque/rules';

const text = (v: unknown, max = 200) => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t === '' ? null : t;
};
const money = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const qty = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const intOrNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

const KINDS = Object.keys(KIND_DEFAULTS) as ItemKind[];

export function normalizeCatalogItem(raw: any): StockItemInput {
  const kind: ItemKind = KINDS.includes(raw?.kind) ? raw.kind : raw?.item_type === 'peca' ? 'peca' : raw?.item_type === 'acessorio' ? 'acessorio' : raw?.rental_enabled && raw?.sale_enabled ? 'venda_locacao' : raw?.rental_enabled ? 'equipamento_locacao' : 'produto_venda';
  const def = KIND_DEFAULTS[kind];
  return {
    internal_code: (text(raw?.internal_code, 30) || '').toUpperCase(),
    description: text(raw?.description) || '',
    long_description: text(raw?.long_description, 4000),
    kind,
    tracking: raw?.tracking === 'individual' ? 'individual' : 'quantidade',
    category: text(raw?.category, 80),
    subcategory: text(raw?.subcategory, 80),
    brand: text(raw?.brand, 80),
    model: text(raw?.model, 80),
    unit: text(raw?.unit, 10) || '',
    barcode: text(raw?.barcode, 40),
    notes: text(raw?.notes, 2000),
    image_data: typeof raw?.image_data === 'string' && raw.image_data ? raw.image_data : null,
    active: raw?.active === undefined ? true : !!raw.active,
    sale_enabled: raw?.sale_enabled === undefined ? def.sale : !!raw.sale_enabled,
    rental_enabled: raw?.rental_enabled === undefined ? def.rental : !!raw.rental_enabled,
    acquisition_cost: money(raw?.acquisition_cost),
    sale_price: money(raw?.sale_price),
    daily_rental_price: money(raw?.daily_rental_price),
    weekly_rental_price: money(raw?.weekly_rental_price),
    monthly_rental_price: money(raw?.monthly_rental_price),
    custom_rental_price: money(raw?.custom_rental_price),
    main_supplier_id: intOrNull(raw?.main_supplier_id),
    supplier_code: text(raw?.supplier_code, 40),
    min_qty: qty(raw?.min_qty),
    max_qty: qty(raw?.max_qty),
    default_location_id: intOrNull(raw?.default_location_id),
    allow_negative: !!raw?.allow_negative,
    technical_description: text(raw?.technical_description, 4000),
  };
}

export function rowToCatalog(r: any): StockItem {
  return { ...r, sale_enabled: !!r.sale_enabled, rental_enabled: !!r.rental_enabled, active: !!r.active, allow_negative: !!r.allow_negative };
}

export function listCatalog(
  db: DB,
  opts: { q?: string; category?: string; item_type?: string; kind?: string; modality?: string; active?: string; limit?: number; offset?: number; withImages?: boolean }
) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.q?.trim()) {
    where.push('(internal_code LIKE ? OR description LIKE ? OR brand LIKE ? OR model LIKE ? OR barcode = ?)');
    const q = `%${opts.q.trim()}%`;
    params.push(q, q, q, q, opts.q.trim());
  }
  if (opts.category) {
    where.push('category = ?');
    params.push(opts.category);
  }
  if (opts.item_type) {
    where.push('item_type = ?');
    params.push(opts.item_type);
  }
  if (opts.kind) {
    where.push('kind = ?');
    params.push(opts.kind);
  }
  if (opts.modality === 'venda') where.push('sale_enabled = 1');
  if (opts.modality === 'locacao') where.push('rental_enabled = 1');
  if (opts.modality === 'manutencao') where.push("(sale_enabled = 1 OR kind IN ('peca','consumo','acessorio'))");
  if (opts.active === 'true') where.push('active = 1');
  if (opts.active === 'false') where.push('active = 0');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit || 20, 1), 100);
  const offset = Math.max(opts.offset || 0, 0);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM catalog_items ${w}`).get(...params) as { n: number }).n;
  const cols = opts.withImages ? '*' : `*, NULL AS image_data`;
  const rows = db.prepare(`SELECT ${cols} FROM catalog_items ${w} ORDER BY internal_code LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const categories = (db.prepare('SELECT DISTINCT category FROM catalog_items WHERE category IS NOT NULL ORDER BY category').all() as { category: string }[]).map((r) => r.category);
  return { total, rows: rows.map(rowToCatalog), categories };
}

export function getCatalogItem(db: DB, id: number): StockItem {
  const r = db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(id);
  if (!r) throw notFound('Item não encontrado.');
  return rowToCatalog(r);
}

const PREFIX: Record<ItemKind, string> = {
  produto_venda: 'PRD',
  equipamento_locacao: 'EQP',
  venda_locacao: 'PVL',
  peca: 'PEC',
  acessorio: 'ACS',
  consumo: 'CON',
};

/** Gera código sequencial por tipo (dentro da transação de gravação; o índice único impede repetição). */
function generateCode(db: DB, kind: ItemKind): string {
  for (;;) {
    const code = `${PREFIX[kind]}-${String(nextCounter(db, `item_code_${PREFIX[kind]}`)).padStart(5, '0')}`;
    if (!db.prepare('SELECT 1 FROM catalog_items WHERE internal_code = ?').get(code)) return code;
  }
}

function assertValid(db: DB, i: StockItemInput, ignoreId?: number) {
  const errors = validateStockItem(i);
  if (i.image_data) {
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(i.image_data)) errors.image_data = 'Imagem deve ser PNG, JPG ou WEBP.';
    else if (i.image_data.length > 700_000) errors.image_data = 'Imagem muito grande (máx. ~500 KB).';
  }
  if (i.main_supplier_id && !db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(i.main_supplier_id)) errors.main_supplier_id = 'Fornecedor não encontrado.';
  if (i.default_location_id && !db.prepare('SELECT 1 FROM stock_locations WHERE id = ? AND active = 1').get(i.default_location_id)) errors.default_location_id = 'Local inválido ou inativo.';
  if (Object.keys(errors).length) throw badRequest(Object.values(errors)[0], errors);
  if (i.internal_code) {
    const dup = db.prepare('SELECT id FROM catalog_items WHERE internal_code = ? AND id != ?').get(i.internal_code, ignoreId ?? 0);
    if (dup) throw conflict(`Já existe um item com o código ${i.internal_code}.`);
  }
}

const FIELDS: (keyof StockItemInput | 'item_type')[] = [
  'internal_code', 'description', 'long_description', 'kind', 'tracking', 'category', 'subcategory', 'item_type', 'sale_enabled', 'rental_enabled',
  'brand', 'model', 'unit', 'barcode', 'notes', 'acquisition_cost', 'sale_price', 'daily_rental_price', 'weekly_rental_price',
  'monthly_rental_price', 'custom_rental_price', 'main_supplier_id', 'supplier_code', 'min_qty', 'max_qty', 'default_location_id',
  'allow_negative', 'technical_description', 'image_data', 'active',
];
const toDb = (i: StockItemInput) =>
  FIELDS.map((f) => {
    if (f === 'item_type') return KIND_DEFAULTS[i.kind].item_type;
    const v = i[f];
    return typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | number | null);
  });

export function createCatalogItem(db: DB, user: AuthUser, raw: any): StockItem {
  if (!stockCan.manageItems(user)) throw forbidden();
  const i = normalizeCatalogItem(raw);
  assertValid(db, i);
  if (!i.internal_code) i.internal_code = generateCode(db, i.kind);
  const row = db.prepare(`INSERT INTO catalog_items (${FIELDS.join(', ')}) VALUES (${FIELDS.map(() => '?').join(', ')}) RETURNING *`).get(...toDb(i));
  const item = rowToCatalog(row);
  audit(db, 'catalog_item', item.id, 'create', user.id, { ...i, image_data: i.image_data ? '[imagem]' : null });
  return item;
}

export function updateCatalogItem(db: DB, user: AuthUser, id: number, raw: any): StockItem {
  if (!stockCan.manageItems(user)) throw forbidden();
  const before = getCatalogItem(db, id);
  const i = normalizeCatalogItem({ ...before, ...raw });
  if (!i.internal_code) i.internal_code = before.internal_code;
  assertValid(db, i, id);
  if (i.tracking !== before.tracking) {
    const used = db.prepare('SELECT 1 FROM stock_movements WHERE item_id = ? UNION SELECT 1 FROM stock_assets WHERE item_id = ? LIMIT 1').get(id, id);
    if (used) throw badRequest('Não é possível trocar o tipo de controle de um item que já tem movimentações ou unidades.');
  }
  const row = db
    .prepare(`UPDATE catalog_items SET ${FIELDS.map((f) => `${f} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? RETURNING *`)
    .get(...toDb(i), id);
  const strip = (x: any) => ({ ...x, image_data: x.image_data ? '[imagem]' : null });
  audit(db, 'catalog_item', id, 'update', user.id, { before: strip(before), after: strip(i) });
  return rowToCatalog(row);
}
