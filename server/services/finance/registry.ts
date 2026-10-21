/**
 * Cadastros financeiros: categorias (com grupo da DRE), centros de custo, contas e configurações.
 * Clientes e fornecedores NÃO são duplicados: usa os cadastros de Orçamentos e Estoque.
 */

import { DB, audit, transaction } from '../../db';
import { badRequest, conflict, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { AccountType, CategoryType, CostCenter, DRE_GROUPS_BY_TYPE, DreGroup, FinanceSettings, FinancialAccount, FinancialCategory } from '../../../shared/financeiro/types';
import { financeCan } from '../../../shared/financeiro/rules';
import { isISODate, todayISO } from '../../../shared/orcamentos/dates';

const NOW_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
const text = (v: unknown, max = 200) => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t === '' ? null : t;
};

// ------------------------------------------------ configurações

export const DEFAULT_FINANCE_SETTINGS: FinanceSettings = {
  default_receivable_days: 30,
  payment_approval_limit: 0,
  allow_negative_balance: false,
  auto_reconcile_exact: false,
  recurrence_horizon_days: 60,
  sale_category_id: null,
  rental_category_id: null,
};

export function getFinanceSettings(db: DB): FinanceSettings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'finance'").get() as { value: string } | undefined;
  return row ? { ...DEFAULT_FINANCE_SETTINGS, ...JSON.parse(row.value) } : DEFAULT_FINANCE_SETTINGS;
}

export function saveFinanceSettings(db: DB, user: AuthUser, raw: any): FinanceSettings {
  if (!financeCan.configure(user)) throw forbidden('Somente o administrador altera as configurações financeiras.');
  const n = (v: unknown, min: number, max: number, label: string) => {
    const x = Number(v);
    if (!Number.isFinite(x) || x < min || x > max) throw badRequest(`${label}: informe um valor entre ${min} e ${max}.`);
    return Math.round(x);
  };
  const catOk = (id: unknown, type: CategoryType) => {
    if (id === null || id === undefined || id === '') return null;
    const c = db.prepare('SELECT category_type FROM financial_categories WHERE id = ?').get(Number(id)) as { category_type: string } | undefined;
    if (!c || c.category_type !== type) throw badRequest('Categoria padrão inválida.');
    return Number(id);
  };
  const s: FinanceSettings = {
    default_receivable_days: n(raw?.default_receivable_days, 0, 365, 'Prazo padrão de recebimento'),
    payment_approval_limit: n(raw?.payment_approval_limit ?? 0, 0, 10_000_000_000, 'Alçada de aprovação'),
    allow_negative_balance: !!raw?.allow_negative_balance,
    auto_reconcile_exact: !!raw?.auto_reconcile_exact,
    recurrence_horizon_days: n(raw?.recurrence_horizon_days, 7, 365, 'Horizonte de recorrências'),
    sale_category_id: catOk(raw?.sale_category_id, 'receita'),
    rental_category_id: catOk(raw?.rental_category_id, 'receita'),
  };
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('finance', ?, ${NOW_SQL}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(JSON.stringify(s));
  audit(db, 'settings', 'finance', 'update', user.id, s);
  return s;
}

// ------------------------------------------------ categorias

export function listCategories(db: DB): FinancialCategory[] {
  return (db.prepare('SELECT * FROM financial_categories ORDER BY category_type, COALESCE(parent_id, id), parent_id IS NOT NULL, name').all() as any[]).map((r) => ({ ...r, active: !!r.active }));
}

export function saveCategory(db: DB, user: AuthUser, id: number | null, raw: any): FinancialCategory {
  if (!financeCan.configure(user)) throw forbidden('Somente o administrador gerencia o plano de categorias.');
  const type: CategoryType = raw?.category_type === 'receita' ? 'receita' : 'despesa';
  const name = text(raw?.name, 80);
  if (!name || name.length < 2) throw badRequest('Informe o nome da categoria.', { name: 'Obrigatório.' });
  const parent_id = raw?.parent_id ? Number(raw.parent_id) : null;
  let dre: DreGroup = DRE_GROUPS_BY_TYPE[type].includes(raw?.dre_group) ? raw.dre_group : DRE_GROUPS_BY_TYPE[type][0];
  if (parent_id) {
    const p = db.prepare('SELECT category_type, parent_id, dre_group FROM financial_categories WHERE id = ?').get(parent_id) as any;
    if (!p) throw badRequest('Categoria pai não encontrada.');
    if (p.category_type !== type) throw badRequest('A subcategoria deve ser do mesmo tipo da categoria pai.');
    if (p.parent_id) throw badRequest('Use no máximo dois níveis (categoria e subcategoria).');
    if (parent_id === id) throw badRequest('Uma categoria não pode ser pai dela mesma.');
    if (!raw?.dre_group) dre = p.dre_group;
  }
  const active = raw?.active === undefined ? true : !!raw.active;
  if (id) {
    const cur = db.prepare('SELECT category_type FROM financial_categories WHERE id = ?').get(id) as any;
    if (!cur) throw notFound('Categoria não encontrada.');
    const used = db.prepare('SELECT 1 FROM financial_entries WHERE category_id = ? LIMIT 1').get(id);
    if (used && cur.category_type !== type) throw badRequest('Categoria já usada em lançamentos: não é possível trocar entre receita e despesa.');
  }
  try {
    const row = id
      ? db.prepare('UPDATE financial_categories SET name = ?, category_type = ?, parent_id = ?, dre_group = ?, active = ? WHERE id = ? RETURNING *').get(name, type, parent_id, dre, active ? 1 : 0, id)
      : db.prepare('INSERT INTO financial_categories (name, category_type, parent_id, dre_group, active) VALUES (?, ?, ?, ?, ?) RETURNING *').get(name, type, parent_id, dre, active ? 1 : 0);
    audit(db, 'financial_category', (row as any).id, id ? 'update' : 'create', user.id, { name, type, parent_id, dre, active });
    return { ...(row as any), active: !!(row as any).active };
  } catch (e: any) {
    if (String(e?.message).includes('UNIQUE')) throw conflict('Já existe uma categoria com esse nome neste nível.');
    throw e;
  }
}

// ------------------------------------------------ centros de custo

export function listCostCenters(db: DB): CostCenter[] {
  return (db.prepare('SELECT * FROM cost_centers ORDER BY active DESC, code').all() as any[]).map((r) => ({ ...r, active: !!r.active }));
}

export function saveCostCenter(db: DB, user: AuthUser, id: number | null, raw: any): CostCenter {
  if (!financeCan.configure(user)) throw forbidden('Somente o administrador gerencia centros de custo.');
  const code = (text(raw?.code, 20) || '').toUpperCase();
  const name = text(raw?.name, 80);
  if (!/^[A-Z0-9\-_.]{2,20}$/.test(code)) throw badRequest('Código com 2 a 20 letras/números.', { code: 'Inválido.' });
  if (!name) throw badRequest('Informe o nome.', { name: 'Obrigatório.' });
  if (db.prepare('SELECT 1 FROM cost_centers WHERE code = ? AND id != ?').get(code, id ?? 0)) throw conflict('Já existe um centro de custo com este código.');
  const vals = [code, name, text(raw?.description, 300), raw?.active === undefined ? 1 : raw.active ? 1 : 0];
  const row = id
    ? db.prepare('UPDATE cost_centers SET code = ?, name = ?, description = ?, active = ? WHERE id = ? RETURNING *').get(...vals, id)
    : db.prepare('INSERT INTO cost_centers (code, name, description, active) VALUES (?, ?, ?, ?) RETURNING *').get(...vals);
  if (!row) throw notFound('Centro de custo não encontrado.');
  audit(db, 'cost_center', (row as any).id, id ? 'update' : 'create', user.id, { code, name });
  return { ...(row as any), active: !!(row as any).active };
}

// ------------------------------------------------ contas financeiras

export function listAccounts(db: DB): FinancialAccount[] {
  const rows = db.prepare('SELECT * FROM financial_accounts ORDER BY active DESC, name').all() as any[];
  const today = todayISO();
  return rows.map((a) => {
    const sums = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN status = 'efetivada' AND transaction_date <= ? THEN direction * amount END),0) bal,
           COALESCE(SUM(CASE WHEN status = 'efetivada' AND statement_item_id IS NOT NULL THEN direction * amount END),0) rec,
           COALESCE(SUM(CASE WHEN status = 'pendente' THEN direction * amount END),0) pend
         FROM financial_transactions WHERE account_id = ?`
      )
      .get(today, a.id) as { bal: number; rec: number; pend: number };
    const opening = a.opening_balance_date <= today ? a.opening_balance : 0;
    return { ...a, active: !!a.active, balance: opening + sums.bal, reconciled_balance: opening + sums.rec, pending_transfers: sums.pend };
  });
}

const ACCOUNT_TYPES: AccountType[] = ['caixa', 'corrente', 'poupanca', 'outra'];

export function saveAccount(db: DB, user: AuthUser, id: number | null, raw: any): FinancialAccount {
  if (!financeCan.configure(user)) throw forbidden('Somente o administrador gerencia contas financeiras.');
  const name = text(raw?.name, 80);
  if (!name) throw badRequest('Informe o nome da conta.', { name: 'Obrigatório.' });
  const type: AccountType = ACCOUNT_TYPES.includes(raw?.account_type) ? raw.account_type : 'corrente';
  const opening = Number(raw?.opening_balance ?? 0);
  if (!Number.isInteger(opening)) throw badRequest('Saldo inicial inválido.');
  const date = raw?.opening_balance_date || todayISO();
  if (!isISODate(date)) throw badRequest('Data do saldo inicial inválida.');
  const active = raw?.active === undefined ? true : !!raw.active;
  return transaction(db, () => {
    if (id) {
      const cur = db.prepare('SELECT * FROM financial_accounts WHERE id = ?').get(id) as any;
      if (!cur) throw notFound('Conta não encontrada.');
      const hasTx = db.prepare('SELECT MIN(transaction_date) d FROM financial_transactions WHERE account_id = ?').get(id) as { d: string | null };
      // saldo inicial é a base de todo o histórico: só muda enquanto não há movimentação
      if (hasTx.d && (cur.opening_balance !== opening || cur.opening_balance_date !== date)) {
        throw badRequest('A conta já tem movimentações: o saldo inicial não pode mais ser alterado. Use um lançamento de ajuste auditável.');
      }
      if (!active && cur.active) {
        const bal = accountBalance0(db, id);
        if (bal !== 0) throw badRequest('Só é possível inativar conta com saldo zerado. Transfira o saldo antes.');
      }
      db.prepare(
        `UPDATE financial_accounts SET name = ?, account_type = ?, institution_name = ?, account_reference = ?, opening_balance = ?, opening_balance_date = ?,
           responsible = ?, notes = ?, active = ?, updated_at = ${NOW_SQL} WHERE id = ?`
      ).run(name, type, text(raw?.institution_name, 80), text(raw?.account_reference, 60), opening, date, text(raw?.responsible, 80), text(raw?.notes, 1000), active ? 1 : 0, id);
      audit(db, 'financial_account', id, 'update', user.id, { before: cur, after: { name, type, opening, date, active } });
    } else {
      const row = db
        .prepare(
          `INSERT INTO financial_accounts (name, account_type, institution_name, account_reference, opening_balance, opening_balance_date, responsible, notes, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
        )
        .get(name, type, text(raw?.institution_name, 80), text(raw?.account_reference, 60), opening, date, text(raw?.responsible, 80), text(raw?.notes, 1000), active ? 1 : 0) as { id: number };
      id = row.id;
      audit(db, 'financial_account', id, 'create', user.id, { name, type, opening, date });
    }
    return listAccounts(db).find((a) => a.id === id)!;
  });
}

function accountBalance0(db: DB, id: number) {
  const a = db.prepare('SELECT opening_balance FROM financial_accounts WHERE id = ?').get(id) as { opening_balance: number };
  const s = db.prepare("SELECT COALESCE(SUM(direction * amount),0) s FROM financial_transactions WHERE account_id = ? AND status = 'efetivada'").get(id) as { s: number };
  return a.opening_balance + s.s;
}

// ------------------------------------------------ carga inicial

const CATEGORIES: { name: string; type: CategoryType; dre: DreGroup; children?: string[] }[] = [
  { name: 'Compra de equipamentos', type: 'despesa', dre: 'investimento' },
  { name: 'Compra de peças', type: 'despesa', dre: 'compra_estoque' },
  { name: 'Compra de produtos para revenda', type: 'despesa', dre: 'compra_estoque' },
  { name: 'Manutenção', type: 'despesa', dre: 'custo_operacional' },
  { name: 'Combustível', type: 'despesa', dre: 'custo_operacional' },
  { name: 'Frete e transporte', type: 'despesa', dre: 'custo_operacional' },
  { name: 'Aluguel', type: 'despesa', dre: 'despesa_administrativa' },
  { name: 'Água e energia', type: 'despesa', dre: 'despesa_administrativa' },
  { name: 'Internet e telefonia', type: 'despesa', dre: 'despesa_administrativa' },
  { name: 'Folha de pagamento', type: 'despesa', dre: 'despesa_operacional' },
  { name: 'Impostos', type: 'despesa', dre: 'despesa_operacional' },
  { name: 'Tarifas bancárias', type: 'despesa', dre: 'despesa_financeira' },
  { name: 'Juros e multas pagos', type: 'despesa', dre: 'despesa_financeira' },
  { name: 'Marketing', type: 'despesa', dre: 'despesa_operacional' },
  { name: 'Despesas administrativas', type: 'despesa', dre: 'despesa_administrativa' },
  { name: 'Outras despesas', type: 'despesa', dre: 'despesa_operacional' },
  { name: 'Venda de equipamentos', type: 'receita', dre: 'receita_venda' },
  { name: 'Venda de produtos', type: 'receita', dre: 'receita_venda' },
  { name: 'Locação de equipamentos', type: 'receita', dre: 'receita_locacao' },
  { name: 'Serviços', type: 'receita', dre: 'receita_servico' },
  { name: 'Frete cobrado', type: 'receita', dre: 'outras_receitas' },
  { name: 'Multas e cobranças adicionais', type: 'receita', dre: 'outras_receitas' },
  { name: 'Rendimentos e juros recebidos', type: 'receita', dre: 'receita_financeira' },
  { name: 'Outras receitas', type: 'receita', dre: 'outras_receitas' },
];

const COST_CENTERS = [
  ['ADM', 'Administração'],
  ['COM', 'Comercial'],
  ['EST', 'Estoque'],
  ['MAN', 'Manutenção'],
  ['LOC', 'Operação de locação'],
  ['TRA', 'Transporte e entrega'],
  ['EQL', 'Equipamentos para locação'],
  ['EQV', 'Equipamentos para venda'],
];

/** Plano de categorias, centros de custo e o caixa físico (saldo inicial zero, a ser ajustado pelo administrador). */
export function seedFinanceIfEmpty(db: DB) {
  if ((db.prepare('SELECT COUNT(*) n FROM financial_categories').get() as { n: number }).n > 0) return;
  transaction(db, () => {
    const ins = db.prepare('INSERT INTO financial_categories (name, category_type, dre_group) VALUES (?, ?, ?) RETURNING id');
    const ids: Record<string, number> = {};
    for (const c of CATEGORIES) ids[c.name] = (ins.get(c.name, c.type, c.dre) as { id: number }).id;
    const cc = db.prepare('INSERT INTO cost_centers (code, name) VALUES (?, ?)');
    for (const [code, name] of COST_CENTERS) cc.run(code, name);
    if (!(db.prepare('SELECT COUNT(*) n FROM financial_accounts').get() as { n: number }).n) {
      db.prepare("INSERT INTO financial_accounts (name, account_type, opening_balance, opening_balance_date, notes) VALUES ('Caixa da loja', 'caixa', 0, ?, 'Criada automaticamente. Ajuste o saldo inicial antes do primeiro lançamento.')").run(todayISO());
    }
    const s = { ...DEFAULT_FINANCE_SETTINGS, sale_category_id: ids['Venda de equipamentos'], rental_category_id: ids['Locação de equipamentos'] };
    db.prepare(`INSERT INTO settings (key, value) VALUES ('finance', ?) ON CONFLICT(key) DO NOTHING`).run(JSON.stringify(s));
  });
}
