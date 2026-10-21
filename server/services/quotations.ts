/**
 * Orçamentos: criação, edição, ciclo de vida, versões, aprovações, auditoria e conversão.
 * Todos os totais são recalculados aqui — valores enviados pela interface não são confiáveis.
 */

import { DB, audit, nextCounter, transaction } from '../db';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../http';
import {
  ActivityEntry,
  ApprovalEntry,
  AuthUser,
  BillingPeriod,
  CatalogItem,
  Customer,
  CustomerSnapshot,
  ModuleSettings,
  Quotation,
  QuotationAction,
  QuotationDetail,
  QuotationInput,
  QuotationCategory,
  EquipmentInfo,
  QuotationItem,
  QuotationItemInput,
  QuotationListRow,
  QuotationStatus,
  StatusHistoryEntry,
  VersionEntry,
} from '../../shared/orcamentos/types';
import { calculateQuotation, catalogPrice } from '../../shared/orcamentos/calc';
import { EXPIRABLE_STATUSES, TRANSITIONS, ACTION_LABELS, STATUS_LABELS, REFUSAL_REASONS } from '../../shared/orcamentos/status';
import { allowedActions, canChangePrice, canCreateQuotation, canPerform, canViewQuotation } from '../../shared/orcamentos/permissions';
import { addDaysISO, isISODate, todayISO } from '../../shared/orcamentos/dates';
import { missingDefinitiveData } from '../../shared/orcamentos/validators';
import { formatBRL } from '../../shared/orcamentos/money';
import { getCustomer, rowToCustomer } from './customers';
import { rowToCatalog } from './catalog';
import { quotationScope } from '../../shared/acesso';
import { conversionTargetFor, getConversionAdapter } from '../integrations';

const NOW_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

// ---------------------------------------------------------------- normalização

const text = (v: unknown, max = 4000) => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t === '' ? null : t;
};
const int = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v));
const BILLING: BillingPeriod[] = ['diaria', 'semanal', 'mensal', 'personalizado'];

function normalizeEquipment(raw: any): EquipmentInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = {
    description: text(raw.description, 200) || '',
    brand: text(raw.brand, 80),
    model: text(raw.model, 80),
    serial_number: text(raw.serial_number, 80),
    reported_defect: text(raw.reported_defect, 2000),
    diagnosis: text(raw.diagnosis, 2000),
  };
  return Object.values(e).some(Boolean) ? e : null;
}

export function normalizeQuotationInput(raw: any): QuotationInput {
  const type = raw?.quotation_type === 'locacao' ? 'locacao' : 'venda';
  const category: QuotationCategory = type === 'venda' && raw?.category === 'manutencao' ? 'manutencao' : 'comercial';
  const rental = type === 'locacao';
  const items: QuotationItemInput[] = Array.isArray(raw?.items)
    ? raw.items.slice(0, 200).map((i: any) => ({
        catalog_item_id: i?.catalog_item_id ? Number(i.catalog_item_id) : null,
        item_code_snapshot: text(i?.item_code_snapshot, 30) || '',
        description_snapshot: text(i?.description_snapshot, 300) || '',
        item_type_snapshot: ['equipamento', 'produto', 'peca', 'acessorio'].includes(i?.item_type_snapshot) ? i.item_type_snapshot : 'produto',
        unit: text(i?.unit, 10) || 'un',
        quantity: Number(i?.quantity),
        unit_price: Number(i?.unit_price),
        reference_price: null, // definido pelo servidor
        billing_period: rental && BILLING.includes(i?.billing_period) ? i.billing_period : null,
        discount_type: i?.discount_type === 'fixed' ? 'fixed' : 'percent',
        discount_value: Number(i?.discount_value) || 0,
        notes: text(i?.notes, 1000),
      }))
    : [];
  return {
    customer_id: Number(raw?.customer_id),
    quotation_type: type,
    category,
    equipment_info: category === 'manutencao' ? normalizeEquipment(raw?.equipment_info) : null,
    expiration_date: raw?.expiration_date,
    client_reference: text(raw?.client_reference, 80),
    start_date: rental ? raw?.start_date || null : null,
    end_date: rental ? raw?.end_date || null : null,
    rental_billing_period: rental && BILLING.includes(raw?.rental_billing_period) ? raw.rental_billing_period : null,
    custom_periods: rental && raw?.custom_periods ? Number(raw.custom_periods) : null,
    custom_period_label: rental ? text(raw?.custom_period_label, 40) : null,
    availability_status: 'nao_verificada', // sem integração com estoque, nunca "confirmada"
    general_discount_type: raw?.general_discount_type === 'fixed' ? 'fixed' : 'percent',
    general_discount_value: Number(raw?.general_discount_value) || 0,
    additional_charges: int(raw?.additional_charges),
    freight_amount: int(raw?.freight_amount),
    pickup_freight_amount: rental ? int(raw?.pickup_freight_amount) : 0,
    installation_amount: int(raw?.installation_amount),
    other_services_amount: int(raw?.other_services_amount),
    deposit_amount: rental ? int(raw?.deposit_amount) : 0,
    payment_terms: text(raw?.payment_terms),
    delivery_terms: text(raw?.delivery_terms),
    warranty_terms: type === 'venda' ? text(raw?.warranty_terms) : null,
    pickup_delivery_terms: text(raw?.pickup_delivery_terms),
    customer_responsibilities: text(raw?.customer_responsibilities),
    return_conditions: rental ? text(raw?.return_conditions) : null,
    included_accessories: rental ? text(raw?.included_accessories) : null,
    complementary_description: text(raw?.complementary_description),
    specific_conditions: text(raw?.specific_conditions),
    commercial_notes: text(raw?.commercial_notes),
    internal_notes: text(raw?.internal_notes),
    items,
  };
}

export function buildCustomerSnapshot(c: Customer): CustomerSnapshot {
  const address = [
    [c.street, c.street_number].filter(Boolean).join(', '),
    c.complement,
    c.neighborhood,
    [c.city, c.state].filter(Boolean).join('/'),
    c.postal_code ? `CEP ${c.postal_code.replace(/(\d{5})(\d{3})/, '$1-$2')}` : null,
  ]
    .filter(Boolean)
    .join(' – ');
  return {
    id: c.id,
    person_type: c.person_type,
    name: c.name,
    trade_name: c.trade_name,
    document: c.document,
    state_registration: c.state_registration,
    phone: c.phone,
    whatsapp: c.whatsapp,
    email: c.email,
    address,
  };
}

// ---------------------------------------------------------------- leitura

const QUOTATION_COLUMNS = [
  'customer_id', 'quotation_type', 'category', 'equipment_info', 'expiration_date', 'client_reference', 'start_date', 'end_date',
  'rental_billing_period', 'custom_periods', 'custom_period_label', 'availability_status',
  'general_discount_type', 'general_discount_value', 'payment_terms', 'delivery_terms', 'warranty_terms',
  'pickup_delivery_terms', 'customer_responsibilities', 'return_conditions', 'included_accessories',
  'complementary_description', 'specific_conditions', 'commercial_notes', 'internal_notes',
] as const;

const TOTAL_COLUMNS = [
  'reference_total', 'items_gross_total', 'item_discount_total', 'price_reduction_total', 'subtotal',
  'general_discount', 'additional_charges', 'freight_amount', 'pickup_freight_amount', 'installation_amount',
  'other_services_amount', 'total_amount', 'deposit_amount', 'effective_discount_percent',
] as const;

function loadQuotation(db: DB, id: number): Quotation {
  const row = db
    .prepare('SELECT q.*, u.name AS responsible_name FROM quotations q JOIN users u ON u.id = q.responsible_user_id WHERE q.id = ?')
    .get(id) as any;
  if (!row) throw notFound('Orçamento não encontrado.');
  const items = db.prepare('SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY position').all(id) as unknown as QuotationItem[];
  return { ...row, customer_snapshot: JSON.parse(row.customer_snapshot), equipment_info: row.equipment_info ? JSON.parse(row.equipment_info) : null, items };
}

const userName = (alias: string) => `COALESCE(${alias}.name, 'Sistema')`;

export function getQuotationDetail(db: DB, user: AuthUser, id: number, settings: ModuleSettings): QuotationDetail {
  sweepExpired(db);
  const q = loadQuotation(db, id);
  if (!canViewQuotation(user, q)) throw forbidden('Você não tem acesso a este orçamento.');
  const history = db
    .prepare(
      `SELECT h.id, h.previous_status, h.new_status, ${userName('u')} AS changed_by_name, h.change_reason, h.created_at
       FROM quotation_status_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.quotation_id = ? ORDER BY h.id DESC`
    )
    .all(id) as unknown as StatusHistoryEntry[];
  const versions = db
    .prepare(
      `SELECT v.id, v.version_number, ${userName('u')} AS created_by_name, v.created_at, v.reason
       FROM quotation_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.quotation_id = ? ORDER BY v.version_number DESC`
    )
    .all(id) as unknown as VersionEntry[];
  const approvals = db
    .prepare(
      `SELECT a.id, r.name AS requested_by_name, ap.name AS approved_by_name, a.approval_type, a.status, a.comments, a.requested_at, a.resolved_at
       FROM quotation_approvals a JOIN users r ON r.id = a.requested_by LEFT JOIN users ap ON ap.id = a.approved_by
       WHERE a.quotation_id = ? ORDER BY a.id DESC`
    )
    .all(id) as unknown as ApprovalEntry[];
  const activities = db
    .prepare(
      `SELECT a.id, a.activity_type, a.description, ${userName('u')} AS performed_by_name, a.created_at
       FROM quotation_activities a LEFT JOIN users u ON u.id = a.performed_by WHERE a.quotation_id = ? ORDER BY a.id DESC`
    )
    .all(id) as unknown as ActivityEntry[];

  const needsItems: QuotationAction[] = ['enviar_revisao', 'solicitar_aprovacao', 'aprovar_interno'];
  const actions = allowedActions(user, q, settings)
    .filter((a) => a !== 'converter' || !!getConversionAdapter(conversionTargetFor(q)))
    .filter((a) => q.items.length > 0 || !needsItems.includes(a));
  return { ...q, history, versions, approvals, activities, allowed_actions: actions };
}

export interface ListFilters {
  customer_id?: string;
  number?: string;
  customer?: string;
  document?: string;
  type?: string;
  status?: string;
  responsible?: string;
  created_from?: string;
  created_to?: string;
  expires_from?: string;
  expires_to?: string;
  min_total?: string;
  max_total?: string;
  /** '1' = só os que já foram enviados ao cliente (sent_at preenchido), como no indicador "Enviados" do painel. */
  sent?: string;
  sort?: string;
  dir?: string;
  page?: string;
  page_size?: string;
}

const SORTS: Record<string, string> = {
  number: 'q.quotation_number',
  created_at: 'q.created_at',
  customer: 'customer_name',
  total: 'q.total_amount',
  expiration: 'q.expiration_date',
  status: 'q.status',
  updated_at: 'q.updated_at',
};

export function buildQuotationWhere(user: AuthUser, f: ListFilters) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const scope = quotationScope(user);
  if (scope === 'nenhum') where.push('0');
  if (scope === 'manutencao') where.push("q.category = 'manutencao'");
  if (scope === 'comercial') where.push("q.category = 'comercial'");
  if (user.role === 'vendedor') {
    where.push('q.responsible_user_id = ?');
    params.push(user.id);
  }
  if (Number(f.customer_id) > 0) {
    where.push('q.customer_id = ?');
    params.push(Number(f.customer_id));
  }
  if (f.number?.trim()) {
    where.push('q.quotation_number LIKE ?');
    params.push(`%${f.number.trim()}%`);
  }
  if (f.customer?.trim()) {
    where.push("(json_extract(q.customer_snapshot, '$.name') LIKE ? OR json_extract(q.customer_snapshot, '$.trade_name') LIKE ?)");
    params.push(`%${f.customer.trim()}%`, `%${f.customer.trim()}%`);
  }
  if (f.document?.replace(/\D/g, '')) {
    where.push("json_extract(q.customer_snapshot, '$.document') LIKE ?");
    params.push(`%${f.document.replace(/\D/g, '')}%`);
  }
  if (f.type === 'manutencao') where.push("q.category = 'manutencao'");
  else if (f.type === 'venda') where.push("q.quotation_type = 'venda' AND q.category = 'comercial'");
  else if (f.type === 'locacao') where.push("q.quotation_type = 'locacao'");
  if (f.status) {
    const list = f.status.split(',').filter((s) => s in STATUS_LABELS);
    if (list.length) {
      where.push(`q.status IN (${list.map(() => '?').join(',')})`);
      params.push(...list);
    }
  }
  if (f.responsible && Number(f.responsible) > 0) {
    where.push('q.responsible_user_id = ?');
    params.push(Number(f.responsible));
  }
  // created_at é UTC; o filtro usa a data local de São Paulo (UTC−3)
  if (isISODate(f.created_from)) {
    where.push("date(q.created_at, '-3 hours') >= ?");
    params.push(f.created_from);
  }
  if (isISODate(f.created_to)) {
    where.push("date(q.created_at, '-3 hours') <= ?");
    params.push(f.created_to);
  }
  if (isISODate(f.expires_from)) {
    where.push('q.expiration_date >= ?');
    params.push(f.expires_from);
  }
  if (isISODate(f.expires_to)) {
    where.push('q.expiration_date <= ?');
    params.push(f.expires_to);
  }
  if (f.sent === '1') where.push('q.sent_at IS NOT NULL');
  if (f.min_total && Number.isFinite(Number(f.min_total))) {
    where.push('q.total_amount >= ?');
    params.push(Number(f.min_total));
  }
  if (f.max_total && Number.isFinite(Number(f.max_total))) {
    where.push('q.total_amount <= ?');
    params.push(Number(f.max_total));
  }
  return { where: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const LIST_SELECT = `
  SELECT q.id, q.quotation_number, q.created_at, q.updated_at, q.customer_id,
    json_extract(q.customer_snapshot, '$.name') AS customer_name,
    json_extract(q.customer_snapshot, '$.document') AS customer_document,
    q.quotation_type, q.category, q.responsible_user_id, u.name AS responsible_name, q.total_amount,
    q.expiration_date, q.status, q.version
  FROM quotations q JOIN users u ON u.id = q.responsible_user_id`;

export function listQuotations(db: DB, user: AuthUser, f: ListFilters, all = false) {
  sweepExpired(db);
  const { where, params } = buildQuotationWhere(user, f);
  const sort = SORTS[f.sort || ''] || 'q.created_at';
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM quotations q ${where}`).get(...params) as { n: number }).n;
  const pageSize = all ? 5000 : Math.min(Math.max(Number(f.page_size) || 20, 5), 100);
  const page = all ? 1 : Math.max(Number(f.page) || 1, 1);
  const rows = db
    .prepare(`${LIST_SELECT} ${where} ORDER BY ${sort} ${dir}, q.id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as unknown as QuotationListRow[];
  return { total, page, page_size: pageSize, rows };
}

// ---------------------------------------------------------------- expiração automática

/** Marca como expirados os orçamentos aprovados/enviados/em negociação com validade vencida. */
export function sweepExpired(db: DB, today = todayISO()) {
  const placeholders = EXPIRABLE_STATUSES.map(() => '?').join(',');
  const due = db
    .prepare(`SELECT id, status FROM quotations WHERE status IN (${placeholders}) AND expiration_date < ?`)
    .all(...EXPIRABLE_STATUSES, today) as { id: number; status: QuotationStatus }[];
  if (!due.length) return 0;
  transaction(db, () => {
    for (const q of due) {
      db.prepare(`UPDATE quotations SET status = 'expirado', row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ? AND status = ?`).run(q.id, q.status);
      db.prepare('INSERT INTO quotation_status_history (quotation_id, previous_status, new_status, changed_by, change_reason) VALUES (?, ?, ?, NULL, ?)').run(
        q.id,
        q.status,
        'expirado',
        'Validade da proposta vencida'
      );
      activity(db, q.id, 'status', 'Proposta expirada automaticamente (validade vencida).', null);
    }
  });
  return due.length;
}

// ---------------------------------------------------------------- escrita

function activity(db: DB, quotationId: number, type: string, description: string, userId: number | null, metadata?: unknown) {
  db.prepare('INSERT INTO quotation_activities (quotation_id, activity_type, description, performed_by, metadata) VALUES (?, ?, ?, ?, ?)').run(
    quotationId,
    type,
    description,
    userId,
    metadata === undefined ? null : JSON.stringify(metadata)
  );
}

function statusHistory(db: DB, quotationId: number, prev: QuotationStatus | null, next: QuotationStatus, userId: number, reason: string | null) {
  db.prepare('INSERT INTO quotation_status_history (quotation_id, previous_status, new_status, changed_by, change_reason) VALUES (?, ?, ?, ?, ?)').run(
    quotationId,
    prev,
    next,
    userId,
    reason
  );
}

/**
 * Valida itens contra o catálogo e define o preço de referência no servidor:
 * - Itens novos precisam estar ativos e habilitados para a modalidade.
 * - Itens que já estavam no orçamento mantêm descrição e referência originais (mesmo se inativados depois).
 * - Alterar preço frente à referência exige permissão.
 */
function resolveItems(db: DB, user: AuthUser, settings: ModuleSettings, input: QuotationInput, previous: QuotationItem[]) {
  const errors: Record<string, string> = {};
  const prevByCatalog = new Map(previous.filter((p) => p.catalog_item_id).map((p) => [`${p.catalog_item_id}:${p.billing_period || ''}`, p]));
  const prevCatalogIds = new Set(previous.map((p) => p.catalog_item_id).filter(Boolean));
  const mayChangePrice = canChangePrice(user, settings);

  input.items.forEach((item, index) => {
    const label = `Item ${index + 1}`;
    if (!item.catalog_item_id) {
      // Item avulso (sem catálogo): referência = próprio preço; só quem pode alterar preço pode incluir
      item.reference_price = item.unit_price;
      if (!mayChangePrice) errors[`items.${index}`] = `${label}: seu perfil não pode incluir itens fora do catálogo.`;
      return;
    }
    const row = db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(item.catalog_item_id);
    if (!row) {
      errors[`items.${index}`] = `${label}: item do catálogo não encontrado.`;
      return;
    }
    const cat = rowToCatalog(row);
    const billing = input.quotation_type === 'locacao' ? item.billing_period || input.rental_billing_period : null;
    const existed = prevCatalogIds.has(cat.id);
    if (existed) {
      // mantém a fotografia original do item (código, tipo, unidade); descrição pode ter sido ajustada
      const original = previous.find((p) => p.catalog_item_id === cat.id)!;
      item.item_code_snapshot = original.item_code_snapshot;
      item.item_type_snapshot = original.item_type_snapshot;
      item.unit = original.unit;
      item.description_snapshot = item.description_snapshot || original.description_snapshot;
    } else {
      if (!cat.active) errors[`items.${index}`] = `${label}: ${cat.internal_code} está inativo e não pode ser usado em novos orçamentos.`;
      // manutenção usa peças/insumos do estoque mesmo que não sejam vendidos avulsos
      if (input.quotation_type === 'venda' && input.category !== 'manutencao' && !cat.sale_enabled) errors[`items.${index}`] = `${label}: ${cat.internal_code} não está habilitado para venda.`;
      if (input.quotation_type === 'locacao' && !cat.rental_enabled) errors[`items.${index}`] = `${label}: ${cat.internal_code} não está habilitado para locação.`;
      item.item_code_snapshot = cat.internal_code;
      item.description_snapshot = item.description_snapshot || cat.description;
      item.item_type_snapshot = cat.item_type;
      item.unit = cat.unit;
    }
    const prev = prevByCatalog.get(`${cat.id}:${billing || ''}`);
    const ref = prev ? prev.reference_price : catalogPrice(cat, input.quotation_type, billing);
    item.reference_price = ref ?? item.unit_price;
    if (ref !== null && ref !== undefined && item.unit_price !== ref && !mayChangePrice) {
      errors[`items.${index}.unit_price`] = `${label}: seu perfil não pode alterar o preço de tabela (${formatBRL(ref)}).`;
    }
  });
  if (Object.keys(errors).length) throw badRequest(Object.values(errors)[0], errors);
}

function validateHeader(db: DB, input: QuotationInput, isNew: boolean, currentCustomerId?: number): Customer {
  if (!Number.isInteger(input.customer_id) || input.customer_id <= 0) throw badRequest('Selecione o cliente.', { customer_id: 'Selecione o cliente.' });
  const customer = getCustomer(db, input.customer_id);
  if (!customer.active && (isNew || customer.id !== currentCustomerId)) {
    throw badRequest('Cliente inativo não pode ser usado em novos orçamentos.', { customer_id: 'Cliente inativo.' });
  }
  if (input.category === 'manutencao' && !input.equipment_info?.description) throw badRequest('Informe o equipamento do cliente.', { 'equipment_info.description': 'Obrigatório.' });
  if (!isISODate(input.expiration_date)) throw badRequest('Informe a validade da proposta.', { expiration_date: 'Data inválida.' });
  if (input.expiration_date < todayISO()) throw badRequest('A validade não pode estar no passado.', { expiration_date: 'Data no passado.' });
  return customer;
}

function calcOrThrow(input: QuotationInput, settings: ModuleSettings) {
  const calc = calculateQuotation(input, settings.rental_policy);
  if (calc.issues.length) {
    const fields: Record<string, string> = {};
    for (const i of calc.issues) fields[i.field] = i.message;
    throw badRequest(calc.issues[0].message, fields);
  }
  return calc;
}

function writeItems(db: DB, quotationId: number, calc: ReturnType<typeof calculateQuotation>) {
  db.prepare('DELETE FROM quotation_items WHERE quotation_id = ?').run(quotationId);
  const ins = db.prepare(
    `INSERT INTO quotation_items (quotation_id, position, catalog_item_id, item_code_snapshot, description_snapshot, item_type_snapshot,
      unit, quantity, unit_price, reference_price, billing_period, periods, discount_type, discount_value, gross_total, discount_amount, line_total, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const i of calc.items) {
    ins.run(
      quotationId, i.position, i.catalog_item_id, i.item_code_snapshot, i.description_snapshot.toLocaleUpperCase('pt-BR'), i.item_type_snapshot,
      i.unit, i.quantity, i.unit_price, i.reference_price, i.billing_period, i.periods, i.discount_type, i.discount_value,
      i.gross_total, i.discount_amount, i.line_total, i.notes
    );
  }
}

const headerValues = (input: QuotationInput) =>
  QUOTATION_COLUMNS.map((c) => (c === 'equipment_info' ? (input.equipment_info ? JSON.stringify(input.equipment_info) : null) : (input[c] as string | number | null)));
const totalValues = (calc: ReturnType<typeof calculateQuotation>) => TOTAL_COLUMNS.map((c) => calc.totals[c]);

export function createQuotation(db: DB, user: AuthUser, raw: any, settings: ModuleSettings): Quotation {
  if (!canCreateQuotation(user)) throw forbidden();
  const input = normalizeQuotationInput(raw);
  if (!canViewQuotation(user, { responsible_user_id: user.id, category: input.category })) throw forbidden(input.category === 'manutencao' ? 'Você não tem acesso à aba Manutenção.' : 'Você não tem acesso à aba Orçamentos.');
  const customer = validateHeader(db, input, true);
  resolveItems(db, user, settings, input, []);
  const calc = calcOrThrow(input, settings);
  const today = todayISO();

  const id = transaction(db, () => {
    const year = today.slice(0, 4);
    const seq = nextCounter(db, `quotation_${year}`);
    const number = `ORC-${year}-${String(seq).padStart(5, '0')}`;
    const cols = [...QUOTATION_COLUMNS, ...TOTAL_COLUMNS];
    const row = db
      .prepare(
        `INSERT INTO quotations (quotation_number, status, responsible_user_id, customer_snapshot, issue_date, rental_days, created_by, updated_by, ${cols.join(', ')})
         VALUES (?, 'rascunho', ?, ?, ?, ?, ?, ?, ${cols.map(() => '?').join(', ')}) RETURNING id`
      )
      .get(number, user.id, JSON.stringify(buildCustomerSnapshot(customer)), today, calc.rental_days, user.id, user.id, ...headerValues(input), ...totalValues(calc)) as {
      id: number;
    };
    writeItems(db, row.id, calc);
    statusHistory(db, row.id, null, 'rascunho', user.id, 'Orçamento criado');
    activity(db, row.id, 'criacao', `Orçamento ${number} criado (${calc.items.length} item(ns), total ${formatBRL(calc.totals.total_amount)}).`, user.id);
    return row.id;
  });
  return loadQuotation(db, id);
}

function assertRowVersion(q: Quotation, expected: unknown) {
  if (expected !== undefined && expected !== null && Number(expected) !== q.row_version) {
    throw conflict('Este orçamento foi alterado por outra pessoa. Recarregue a página para ver a versão atual.');
  }
}

export function updateQuotation(db: DB, user: AuthUser, id: number, raw: any, settings: ModuleSettings): Quotation {
  sweepExpired(db);
  const q = loadQuotation(db, id);
  if (!canViewQuotation(user, q)) throw forbidden('Você não tem acesso a este orçamento.');
  if (!canPerform(user, 'editar', q, settings)) {
    throw forbidden(
      TRANSITIONS.editar.from.includes(q.status)
        ? 'Você não pode editar este orçamento.'
        : `Orçamento "${STATUS_LABELS[q.status]}" não pode ser editado diretamente. Use "Criar nova versão".`
    );
  }
  assertRowVersion(q, raw?.row_version);
  const input = normalizeQuotationInput(raw);
  if (input.quotation_type !== q.quotation_type || input.category !== (q.category || 'comercial')) throw badRequest('Não é possível trocar a modalidade de um orçamento existente. Duplique-o para outra modalidade.');
  const customer = validateHeader(db, input, false, q.customer_id);
  resolveItems(db, user, settings, input, q.items);
  const calc = calcOrThrow(input, settings);

  transaction(db, () => {
    const cols = [...QUOTATION_COLUMNS, ...TOTAL_COLUMNS];
    const res = db
      .prepare(
        `UPDATE quotations SET ${cols.map((c) => `${c} = ?`).join(', ')}, customer_snapshot = ?, rental_days = ?, updated_by = ?,
           row_version = row_version + 1, updated_at = ${NOW_SQL}
         WHERE id = ? AND row_version = ?`
      )
      .run(...headerValues(input), ...totalValues(calc), JSON.stringify(buildCustomerSnapshot(customer)), calc.rental_days, user.id, id, q.row_version);
    if (res.changes !== 1) throw conflict('Este orçamento foi alterado por outra pessoa. Recarregue a página.');
    writeItems(db, id, calc);
    const changed = q.total_amount !== calc.totals.total_amount ? ` Total: ${formatBRL(q.total_amount)} → ${formatBRL(calc.totals.total_amount)}.` : '';
    activity(db, id, 'edicao', `Orçamento editado (${calc.items.length} item(ns)).${changed}`, user.id);
  });
  return loadQuotation(db, id);
}

/** Fotografia da versão emitida (usada no PDF e no histórico). */
function saveVersionSnapshot(db: DB, q: Quotation, userId: number, reason: string) {
  const exists = db.prepare('SELECT 1 FROM quotation_versions WHERE quotation_id = ? AND version_number = ?').get(q.id, q.version);
  if (exists) return;
  db.prepare('INSERT INTO quotation_versions (quotation_id, version_number, snapshot_data, reason, created_by) VALUES (?, ?, ?, ?, ?)').run(
    q.id,
    q.version,
    JSON.stringify(q),
    reason,
    userId
  );
}

export function getVersionSnapshot(db: DB, user: AuthUser, id: number, version: number): Quotation {
  const q = loadQuotation(db, id);
  if (!canViewQuotation(user, q)) throw forbidden('Você não tem acesso a este orçamento.');
  const row = db.prepare('SELECT snapshot_data FROM quotation_versions WHERE quotation_id = ? AND version_number = ?').get(id, version) as
    | { snapshot_data: string }
    | undefined;
  if (!row) throw notFound('Versão não encontrada.');
  return JSON.parse(row.snapshot_data);
}

export function getQuotationForView(db: DB, user: AuthUser, id: number): Quotation {
  sweepExpired(db);
  const q = loadQuotation(db, id);
  if (!canViewQuotation(user, q)) throw forbidden('Você não tem acesso a este orçamento.');
  return q;
}

export interface TransitionPayload {
  reason?: string;
  row_version?: number;
  expiration_date?: string;
  refusal_category?: string;
  channel?: string;
}

const CHANNELS: Record<string, string> = { email: 'e-mail', whatsapp: 'WhatsApp', impresso: 'impresso/entregue em mãos', outro: 'outro meio' };

export function transitionQuotation(db: DB, user: AuthUser, id: number, action: QuotationAction, payload: TransitionPayload, settings: ModuleSettings): Quotation {
  if (action === 'duplicar' || action === 'editar' || action === 'converter') throw badRequest('Ação inválida para esta rota.');
  if (!(action in TRANSITIONS)) throw badRequest('Ação desconhecida.');
  sweepExpired(db);
  const q = loadQuotation(db, id);
  if (!canViewQuotation(user, q)) throw forbidden('Você não tem acesso a este orçamento.');
  if (!TRANSITIONS[action].from.includes(q.status)) {
    throw new HttpError(422, `Não é possível "${ACTION_LABELS[action]}" um orçamento com status "${STATUS_LABELS[q.status]}".`);
  }
  if (!canPerform(user, action, q, settings)) {
    if (action === 'aprovar_interno') {
      throw forbidden(`Desconto efetivo de ${q.effective_discount_percent.toLocaleString('pt-BR')}% está acima da sua alçada. Solicite aprovação.`);
    }
    throw forbidden();
  }
  assertRowVersion(q, payload.row_version);

  const reason = text(payload.reason, 1000);
  if (TRANSITIONS[action].requiresReason && !reason && action !== 'recusar') throw badRequest('Informe a justificativa.', { reason: 'Obrigatório.' });
  const to = TRANSITIONS[action].to as QuotationStatus;
  const extra: Record<string, string | number | null> = {};
  let description = `${ACTION_LABELS[action]}: ${STATUS_LABELS[q.status]} → ${STATUS_LABELS[to]}.`;

  const needsItems = ['enviar_revisao', 'solicitar_aprovacao', 'aprovar_interno'].includes(action);
  if (needsItems && q.items.length === 0) throw badRequest('Inclua ao menos um item antes de prosseguir.');
  if (action === 'aprovar_interno' && q.expiration_date < todayISO()) throw badRequest('A validade está vencida. Ajuste a validade antes de aprovar.');

  return transaction(db, () => {
    switch (action) {
      case 'solicitar_aprovacao':
        db.prepare(
          "INSERT INTO quotation_approvals (quotation_id, requested_by, approval_type, status, discount_percent, comments) VALUES (?, ?, 'desconto', 'pendente', ?, ?)"
        ).run(id, user.id, q.effective_discount_percent, reason);
        description = `Aprovação interna solicitada (desconto efetivo ${q.effective_discount_percent.toLocaleString('pt-BR')}%).`;
        break;
      case 'aprovar_interno': {
        const pending = db.prepare("SELECT id FROM quotation_approvals WHERE quotation_id = ? AND status = 'pendente'").get(id) as { id: number } | undefined;
        if (pending) {
          db.prepare(`UPDATE quotation_approvals SET status = 'aprovado', approved_by = ?, comments = COALESCE(?, comments), resolved_at = ${NOW_SQL} WHERE id = ?`).run(
            user.id,
            reason,
            pending.id
          );
        } else {
          db.prepare(
            `INSERT INTO quotation_approvals (quotation_id, requested_by, approved_by, approval_type, status, discount_percent, comments, resolved_at)
             VALUES (?, ?, ?, 'interna', 'aprovado', ?, ?, ${NOW_SQL})`
          ).run(id, user.id, user.id, q.effective_discount_percent, reason);
        }
        description = `Aprovado internamente por ${user.name} (desconto efetivo ${q.effective_discount_percent.toLocaleString('pt-BR')}%).`;
        break;
      }
      case 'rejeitar_aprovacao':
        db.prepare(`UPDATE quotation_approvals SET status = 'rejeitado', approved_by = ?, comments = ?, resolved_at = ${NOW_SQL} WHERE quotation_id = ? AND status = 'pendente'`).run(
          user.id,
          reason,
          id
        );
        description = `Aprovação rejeitada: ${reason}`;
        break;
      case 'registrar_envio': {
        const customer = rowToCustomer(db.prepare('SELECT * FROM customers WHERE id = ?').get(q.customer_id));
        const missing = missingDefinitiveData(customer);
        if (missing.length) throw badRequest(`Complete o cadastro do cliente antes de enviar: ${missing.join(', ')}.`);
        // atualiza a fotografia do cliente para a versão emitida
        q.customer_snapshot = buildCustomerSnapshot(customer);
        db.prepare('UPDATE quotations SET customer_snapshot = ? WHERE id = ?').run(JSON.stringify(q.customer_snapshot), id);
        const channel = CHANNELS[payload.channel || ''] || CHANNELS.outro;
        saveVersionSnapshot(db, { ...q, status: 'enviado' }, user.id, `Enviada ao cliente por ${channel}`);
        extra.sent_at = new Date().toISOString();
        description = `Versão ${q.version} enviada ao cliente por ${channel}.${reason ? ' ' + reason : ''}`;
        break;
      }
      case 'recusar': {
        const category = REFUSAL_REASONS.includes(payload.refusal_category || '') ? payload.refusal_category! : null;
        if (!category) throw badRequest('Selecione o motivo da recusa.', { refusal_category: 'Obrigatório.' });
        extra.refusal_reason = reason ? `${category}: ${reason}` : category;
        description = `Cliente recusou a proposta. Motivo: ${extra.refusal_reason}`;
        break;
      }
      case 'renovar':
        if (!isISODate(payload.expiration_date) || payload.expiration_date < todayISO()) {
          throw badRequest('Informe uma nova validade a partir de hoje.', { expiration_date: 'Data inválida.' });
        }
        extra.expiration_date = payload.expiration_date;
        extra.version = q.version + 1;
        description = `Validade renovada até ${payload.expiration_date.split('-').reverse().join('/')} — nova versão ${q.version + 1}, requer nova aprovação e envio.`;
        break;
      case 'nova_versao': {
        const wasSent = db.prepare('SELECT 1 FROM quotation_versions WHERE quotation_id = ? AND version_number = ?').get(id, q.version);
        if (wasSent) extra.version = q.version + 1;
        db.prepare(`UPDATE quotation_approvals SET status = 'rejeitado', comments = 'Substituída por nova versão', resolved_at = ${NOW_SQL} WHERE quotation_id = ? AND status = 'pendente'`).run(id);
        description = wasSent
          ? `Nova versão ${q.version + 1} criada para alteração: ${reason}. Será necessário aprovar e reenviar.`
          : `Orçamento reaberto para alteração: ${reason}.`;
        break;
      }
      case 'cancelar':
        db.prepare(`UPDATE quotation_approvals SET status = 'rejeitado', comments = 'Orçamento cancelado', resolved_at = ${NOW_SQL} WHERE quotation_id = ? AND status = 'pendente'`).run(id);
        description = `Orçamento cancelado: ${reason}`;
        break;
      default:
        if (reason) description += ` ${reason}`;
    }

    const sets = Object.keys(extra).map((k) => `${k} = ?`);
    const res = db
      .prepare(
        `UPDATE quotations SET status = ?, ${sets.length ? sets.join(', ') + ',' : ''} updated_by = ?, row_version = row_version + 1, updated_at = ${NOW_SQL}
         WHERE id = ? AND row_version = ?`
      )
      .run(to, ...Object.values(extra), user.id, id, q.row_version);
    if (res.changes !== 1) throw conflict('Este orçamento foi alterado por outra pessoa. Recarregue a página.');
    statusHistory(db, id, q.status, to, user.id, (extra.refusal_reason as string) || reason);
    activity(db, id, 'status', description, user.id, { action });
    return loadQuotation(db, id);
  });
}

/**
 * Exclusão definitiva: só para rascunho/em revisão que nunca foi enviado ao cliente e não gerou
 * contrato, reserva ou lançamento. O que já circulou é cancelado (mantém o histórico).
 */
export function deleteQuotation(db: DB, user: AuthUser, id: number) {
  return transaction(db, () => {
    const q = db.prepare('SELECT id, quotation_number, status, sent_at, responsible_user_id, total_amount, customer_snapshot FROM quotations WHERE id = ?').get(id) as any;
    if (!q) throw notFound('Orçamento não encontrado.');
    const owner = user.role === 'admin' || user.role === 'gestor' || (user.role === 'vendedor' && q.responsible_user_id === user.id);
    if (!owner) throw forbidden('Você não pode excluir este orçamento.');
    if (!['rascunho', 'em_revisao'].includes(q.status)) throw new HttpError(422, `Orçamento "${STATUS_LABELS[q.status as QuotationStatus]}" não é excluído: use Cancelar para manter o histórico.`);
    if (q.sent_at) throw new HttpError(422, 'Este orçamento já foi enviado ao cliente: use Cancelar para manter o histórico.');
    const linked = [
      ['contrato', 'SELECT 1 FROM contracts WHERE quotation_id = ?'],
      ['reserva de estoque', 'SELECT 1 FROM stock_reservations WHERE quotation_id = ?'],
      ['lançamento financeiro', 'SELECT 1 FROM financial_entries WHERE quotation_id = ?'],
    ].filter(([, sql]) => db.prepare(sql).get(id)).map(([label]) => label);
    if (linked.length) throw new HttpError(422, `Orçamento ligado a ${linked.join(', ')}: use Cancelar.`);
    // itens, versões, aprovações e histórico saem junto (ON DELETE CASCADE); a auditoria guarda o registro da exclusão
    db.prepare('DELETE FROM quotations WHERE id = ?').run(id);
    audit(db, 'quotation', id, 'delete', user.id, { quotation_number: q.quotation_number, status: q.status, total_amount: q.total_amount, customer: JSON.parse(q.customer_snapshot || '{}').name ?? null });
    return { deleted: q.quotation_number as string };
  });
}

export function duplicateQuotation(db: DB, user: AuthUser, id: number, settings: ModuleSettings) {
  const src = getQuotationForView(db, user, id);
  if (!canPerform(user, 'duplicar', src, settings)) throw forbidden();
  const removed: string[] = [];
  const items = src.items.filter((i) => {
    if (!i.catalog_item_id) return true;
    const cat = db.prepare('SELECT active FROM catalog_items WHERE id = ?').get(i.catalog_item_id) as { active: number } | undefined;
    if (!cat?.active) {
      removed.push(i.item_code_snapshot);
      return false;
    }
    return true;
  });
  const customer = getCustomer(db, src.customer_id);
  if (!customer.active) throw badRequest('O cliente deste orçamento está inativo. Reative-o ou duplique e escolha outro cliente.');
  const raw = {
    ...src,
    expiration_date: addDaysISO(todayISO(), settings.default_validity_days),
    items: items.map((i) => ({ ...i, unit_price: i.unit_price })),
  };
  // Para quem não pode alterar preço, usa o preço atual de tabela
  if (!canChangePrice(user, settings)) {
    raw.items = raw.items.map((i) => {
      if (!i.catalog_item_id) return i;
      const cat = rowToCatalog(db.prepare('SELECT * FROM catalog_items WHERE id = ?').get(i.catalog_item_id));
      const price = catalogPrice(cat, src.quotation_type, src.quotation_type === 'locacao' ? i.billing_period || src.rental_billing_period : null);
      return { ...i, unit_price: price ?? i.unit_price };
    });
  }
  const copy = createQuotation(db, user, raw, settings);
  db.prepare("INSERT INTO quotation_activities (quotation_id, activity_type, description, performed_by) VALUES (?, 'criacao', ?, ?)").run(
    copy.id,
    `Duplicado a partir de ${src.quotation_number}.${removed.length ? ` Itens inativos removidos: ${removed.join(', ')}.` : ''}`,
    user.id
  );
  return { quotation: copy, removed };
}

/**
 * Conversão idempotente: se já convertido, devolve o registro existente; nunca cria duplicado.
 * Depende de um adaptador registrado em integrations.ts (nenhum nesta etapa).
 */
export function convertQuotation(db: DB, user: AuthUser, id: number, settings: ModuleSettings) {
  const q = getQuotationForView(db, user, id);
  const target = conversionTargetFor(q);
  if (q.status === 'convertido' && q.converted_record_id) {
    return { quotation: q, record_type: q.converted_record_type, record_id: q.converted_record_id, already: true };
  }
  if (!canPerform(user, 'converter', q, settings)) {
    if (q.status === 'expirado') throw new HttpError(422, 'Orçamento expirado: renove a validade antes de converter.');
    if (!TRANSITIONS.converter.from.includes(q.status)) throw new HttpError(422, 'Somente orçamentos aprovados podem ser convertidos.');
    throw forbidden();
  }
  const adapter = getConversionAdapter(target);
  if (!adapter) {
    throw new HttpError(
      501,
      target === 'venda'
        ? 'Conversão em venda depende do módulo de Vendas/Estoque, ainda não implementado.'
        : 'Conversão em contrato depende do módulo de Contratos com reserva de equipamentos, ainda não implementado.'
    );
  }
  return transaction(db, () => {
    const fresh = db.prepare('SELECT status, converted_record_type, converted_record_id, row_version FROM quotations WHERE id = ?').get(id) as any;
    if (fresh.converted_record_id) {
      return { quotation: loadQuotation(db, id), record_type: fresh.converted_record_type, record_id: fresh.converted_record_id, already: true };
    }
    if (!TRANSITIONS.converter.from.includes(fresh.status)) throw new HttpError(422, 'O status do orçamento mudou. Recarregue a página.');
    const { record_id } = adapter.convert(q, user);
    db.prepare(
      `UPDATE quotations SET status = 'convertido', converted_record_type = ?, converted_record_id = ?, updated_by = ?, row_version = row_version + 1, updated_at = ${NOW_SQL}
       WHERE id = ? AND row_version = ?`
    ).run(target, record_id, user.id, id, fresh.row_version);
    statusHistory(db, id, fresh.status, 'convertido', user.id, `Convertido em ${target} ${record_id}`);
    activity(db, id, 'conversao', `Convertido em ${target === 'venda' ? 'venda' : 'contrato de locação'} nº ${record_id}.`, user.id, { target, record_id });
    audit(db, 'quotation', id, 'convert', user.id, { target, record_id });
    return { quotation: loadQuotation(db, id), record_type: target, record_id, already: false };
  });
}

export function addContactNote(db: DB, user: AuthUser, id: number, description: unknown, settings: ModuleSettings) {
  const q = getQuotationForView(db, user, id);
  const desc = text(description, 2000);
  if (!desc) throw badRequest('Descreva o contato.', { description: 'Obrigatório.' });
  if (!['admin', 'gestor', 'vendedor'].includes(user.role) || (user.role === 'vendedor' && q.responsible_user_id !== user.id)) throw forbidden();
  void settings;
  activity(db, id, 'contato', desc, user.id);
}

/**
 * Grava o resultado da consulta de disponibilidade ao Estoque. É uma fotografia do momento:
 * não reserva nada (a reserva é um fluxo próprio no Estoque, com validação de conflitos).
 */
export function recordAvailabilityCheck(
  db: DB,
  user: AuthUser,
  id: number,
  check: (q: Quotation) => { catalog_item_id: number; needed: number; free: number; status: 'confirmada' | 'insuficiente' | 'indisponivel' }[]
) {
  const q = getQuotationForView(db, user, id);
  if (q.quotation_type !== 'locacao') throw badRequest('A verificação de disponibilidade se aplica a orçamentos de locação.');
  if (!['admin', 'gestor', 'vendedor', 'estoquista'].includes(user.role)) throw forbidden();
  const results = check(q);
  const status = results.some((r) => r.status === 'indisponivel') ? 'indisponivel' : results.some((r) => r.status === 'insuficiente') ? 'insuficiente' : 'confirmada';
  transaction(db, () => {
    db.prepare(`UPDATE quotations SET availability_status = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(results.length ? status : 'nao_verificada', id);
    const byId = new Map(q.items.map((i) => [i.catalog_item_id, i.item_code_snapshot]));
    activity(
      db,
      id,
      'disponibilidade',
      `Disponibilidade verificada para ${q.start_date?.split('-').reverse().join('/')}–${q.end_date?.split('-').reverse().join('/')}: ` +
        results.map((r) => `${byId.get(r.catalog_item_id)} ${r.free.toLocaleString('pt-BR')}/${r.needed.toLocaleString('pt-BR')} livre(s)`).join('; ') +
        '. Consulta não reserva equipamentos.',
      user.id,
      { results }
    );
  });
  return { availability_status: results.length ? status : 'nao_verificada', results };
}

export function recordPdfGenerated(db: DB, user: AuthUser, id: number, version: number) {
  activity(db, id, 'pdf', `PDF da versão ${version} gerado.`, user.id);
}
