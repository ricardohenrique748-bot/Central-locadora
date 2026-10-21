/**
 * Clientes: cadastro reutilizável. Inativar não afeta orçamentos existentes
 * (cada orçamento guarda uma fotografia do cliente no momento da emissão).
 */

import { DB, audit } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../http';
import { AuthUser, Customer, CustomerInput } from '../../shared/orcamentos/types';
import { canInactivateCustomers, canManageCustomers } from '../../shared/orcamentos/permissions';
import { onlyDigits, validateCustomer } from '../../shared/orcamentos/validators';

const text = (v: unknown, max = 200) => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t === '' ? null : t;
};
const digits = (v: unknown) => onlyDigits(typeof v === 'string' ? v : '') || null;

export function normalizeCustomer(raw: any): CustomerInput {
  return {
    person_type: raw?.person_type === 'PF' ? 'PF' : raw?.person_type === 'PJ' ? 'PJ' : (raw?.person_type as any),
    name: text(raw?.name) || '',
    trade_name: text(raw?.trade_name),
    document: digits(raw?.document),
    state_registration: text(raw?.state_registration, 30),
    phone: digits(raw?.phone),
    whatsapp: digits(raw?.whatsapp),
    email: text(raw?.email, 120)?.toLowerCase() || null,
    postal_code: digits(raw?.postal_code),
    street: text(raw?.street),
    street_number: text(raw?.street_number, 20),
    complement: text(raw?.complement, 100),
    neighborhood: text(raw?.neighborhood, 100),
    city: text(raw?.city, 100),
    state: text(raw?.state, 2)?.toUpperCase() || null,
    notes: text(raw?.notes, 2000),
    active: raw?.active === undefined ? true : !!raw.active,
  };
}

export function rowToCustomer(r: any): Customer {
  return { ...r, active: !!r.active };
}

export function listCustomers(db: DB, opts: { q?: string; active?: string; limit?: number; offset?: number }) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.q?.trim()) {
    const q = opts.q.trim();
    const d = onlyDigits(q);
    const conds = ['name LIKE ?', 'trade_name LIKE ?'];
    params.push(`%${q}%`, `%${q}%`);
    if (d.length >= 3) {
      conds.push('document LIKE ?', 'phone LIKE ?', 'whatsapp LIKE ?');
      params.push(`%${d}%`, `%${d}%`, `%${d}%`);
    }
    where.push(`(${conds.join(' OR ')})`);
  }
  if (opts.active === 'true') where.push('active = 1');
  if (opts.active === 'false') where.push('active = 0');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(Math.max(opts.limit || 20, 1), 100);
  const offset = Math.max(opts.offset || 0, 0);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM customers ${w}`).get(...params) as { n: number }).n;
  const rows = db.prepare(`SELECT * FROM customers ${w} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`).all(...params, limit, offset);
  return { total, rows: rows.map(rowToCustomer) };
}

export function getCustomer(db: DB, id: number): Customer {
  const r = db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
  if (!r) throw notFound('Cliente não encontrado.');
  return rowToCustomer(r);
}

function assertValid(db: DB, c: CustomerInput, ignoreId?: number) {
  const errors = validateCustomer(c);
  if (Object.keys(errors).length) throw badRequest('Verifique os campos destacados.', errors);
  if (c.document) {
    const dup = db.prepare('SELECT id, name FROM customers WHERE document = ? AND id != ?').get(c.document, ignoreId ?? 0) as
      | { id: number; name: string }
      | undefined;
    if (dup) throw conflict(`Já existe um cliente com este documento: ${dup.name}.`);
  }
}

const FIELDS: (keyof CustomerInput)[] = [
  'person_type', 'name', 'trade_name', 'document', 'state_registration', 'phone', 'whatsapp', 'email',
  'postal_code', 'street', 'street_number', 'complement', 'neighborhood', 'city', 'state', 'notes', 'active',
];

const toDb = (c: CustomerInput) => FIELDS.map((f) => (f === 'active' ? (c.active ? 1 : 0) : (c[f] as string | null)));

export function createCustomer(db: DB, user: AuthUser, raw: any): Customer {
  if (!canManageCustomers(user)) throw forbidden();
  const c = normalizeCustomer(raw);
  c.active = true;
  assertValid(db, c);
  const row = db
    .prepare(`INSERT INTO customers (${FIELDS.join(', ')}, created_by) VALUES (${FIELDS.map(() => '?').join(', ')}, ?) RETURNING *`)
    .get(...toDb(c), user.id);
  const customer = rowToCustomer(row);
  audit(db, 'customer', customer.id, 'create', user.id, c);
  return customer;
}

export function updateCustomer(db: DB, user: AuthUser, id: number, raw: any): Customer {
  if (!canManageCustomers(user)) throw forbidden();
  const before = getCustomer(db, id);
  const c = normalizeCustomer({ ...before, ...raw });
  if (c.active !== before.active && !canInactivateCustomers(user)) throw forbidden('Apenas gestor ou administrador pode ativar/inativar clientes.');
  assertValid(db, c, id);
  const row = db
    .prepare(`UPDATE customers SET ${FIELDS.map((f) => `${f} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? RETURNING *`)
    .get(...toDb(c), id);
  audit(db, 'customer', id, 'update', user.id, { before, after: c });
  return rowToCustomer(row);
}
