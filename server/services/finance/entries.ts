/**
 * Títulos (contas a pagar e a receber), parcelas, rateio por centro de custo, aprovação, cancelamento,
 * ajustes de encargos, recorrências e anexos.
 *
 * Criar um título NÃO movimenta dinheiro: só a liquidação (settlement.ts) gera movimentação na conta.
 */

import { DB, audit, transaction } from '../../db';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { addDaysISO, isISODate, todayISO } from '../../../shared/orcamentos/dates';
import { onlyDigits } from '../../../shared/orcamentos/validators';
import {
  EntryDetail, EntryType, PartyType, ReceivableOrigin, SourceType, ORIGIN_LABELS,
} from '../../../shared/financeiro/types';
import { InstallmentPlan, buildInstallments, daysOverdue, displayStatus, entryDisplayStatus, financeCan, installmentStatus, recurrenceDates, updatedAmount, validateCostCenterSplit } from '../../../shared/financeiro/rules';
import { NOW_SQL, cents, nextNumber, text } from './core';
import { getFinanceSettings } from './registry';

export type { InstallmentPlan };

const ORIGINS = Object.keys(ORIGIN_LABELS) as ReceivableOrigin[];

export interface EntryInput {
  entry_type: EntryType;
  description: string;
  party_type: PartyType;
  supplier_id: number | null;
  customer_id: number | null;
  party_name: string;
  party_document: string | null;
  category_id: number;
  origin: ReceivableOrigin | null;
  document_ref: string | null;
  issue_date: string;
  competence_date: string;
  payment_method: string | null;
  planned_account_id: number | null;
  notes: string | null;
  plan: InstallmentPlan;
  cost_centers: { cost_center_id: number; amount: number }[];
  source_type: SourceType;
  source_id: string | null;
  source_ref: string | null;
  quotation_id: number | null;
  recurrence_id: number | null;
}

/** Normaliza e valida (inclusive vínculos com cadastros). Lança HttpError. */
export function normalizeEntry(db: DB, raw: any, type: EntryType): EntryInput {
  const errors: Record<string, string> = {};
  const description = text(raw?.description, 200) || '';
  if (description.length < 3) errors.description = 'Informe a descrição.';
  let party_type: PartyType = ['fornecedor', 'cliente', 'outro'].includes(raw?.party_type) ? raw.party_type : type === 'pagar' ? 'fornecedor' : 'cliente';
  let supplier_id: number | null = null;
  let customer_id: number | null = null;
  let party_name = text(raw?.party_name, 200) || '';
  let party_document = onlyDigits(raw?.party_document) || null;
  if (party_type === 'fornecedor') {
    const s = db.prepare('SELECT id, name, document FROM suppliers WHERE id = ?').get(Number(raw?.supplier_id)) as any;
    if (!s) errors.supplier_id = 'Selecione o fornecedor.';
    else ((supplier_id = s.id), (party_name = s.name), (party_document = s.document));
  } else if (party_type === 'cliente') {
    const c = db.prepare('SELECT id, name, document FROM customers WHERE id = ?').get(Number(raw?.customer_id)) as any;
    if (!c) errors.customer_id = 'Selecione o cliente.';
    else ((customer_id = c.id), (party_name = c.name), (party_document = c.document));
  } else if (party_name.length < 2) errors.party_name = 'Informe o favorecido.';

  const category_id = Number(raw?.category_id);
  const cat = db.prepare('SELECT category_type, active FROM financial_categories WHERE id = ?').get(category_id) as any;
  if (!cat) errors.category_id = 'Selecione a categoria financeira.';
  else if (!cat.active) errors.category_id = 'Categoria inativa não pode ser usada em novos lançamentos.';
  else if (cat.category_type !== (type === 'pagar' ? 'despesa' : 'receita')) errors.category_id = type === 'pagar' ? 'Use uma categoria de despesa.' : 'Use uma categoria de receita.';

  const issue_date = raw?.issue_date || todayISO();
  const competence_date = raw?.competence_date || issue_date;
  if (!isISODate(issue_date)) errors.issue_date = 'Data inválida.';
  if (!isISODate(competence_date)) errors.competence_date = 'Data inválida.';

  const planned_account_id = raw?.planned_account_id ? Number(raw.planned_account_id) : null;
  if (planned_account_id && !db.prepare('SELECT 1 FROM financial_accounts WHERE id = ? AND active = 1').get(planned_account_id)) errors.planned_account_id = 'Conta inválida.';

  const total = Number(raw?.original_amount ?? raw?.plan?.total);
  const plan: InstallmentPlan = {
    total,
    count: Number(raw?.plan?.count ?? 1),
    first_due: raw?.plan?.first_due || raw?.due_date,
    interval: ['mensal', 'quinzenal', 'semanal', 'dias'].includes(raw?.plan?.interval) ? raw.plan.interval : 'mensal',
    interval_days: Number(raw?.plan?.interval_days) || undefined,
    custom: Array.isArray(raw?.plan?.custom) && raw.plan.custom.length ? raw.plan.custom.map((c: any) => ({ due_date: c.due_date, amount: Number(c.amount) })) : undefined,
  };
  try {
    buildInstallments(plan);
  } catch (e: any) {
    errors.plan = e.message;
  }
  const cost_centers = (Array.isArray(raw?.cost_centers) ? raw.cost_centers : [])
    .filter((c: any) => c && c.cost_center_id)
    .map((c: any) => ({ cost_center_id: Number(c.cost_center_id), amount: Number(c.amount) }));
  if (cost_centers.length) {
    const msg = Number.isInteger(total) && total > 0 ? validateCostCenterSplit(total, cost_centers) : null;
    if (msg) errors.cost_centers = msg;
    for (const c of cost_centers) {
      const cc = db.prepare('SELECT active FROM cost_centers WHERE id = ?').get(c.cost_center_id) as any;
      if (!cc || !cc.active) errors.cost_centers = 'Centro de custo inválido ou inativo.';
    }
  }
  const origin: ReceivableOrigin | null = type === 'receber' ? (ORIGINS.includes(raw?.origin) ? raw.origin : 'outras') : null;
  if (Object.keys(errors).length) throw badRequest(Object.values(errors)[0], errors);
  return {
    entry_type: type, description, party_type, supplier_id, customer_id, party_name, party_document, category_id, origin,
    document_ref: text(raw?.document_ref, 80), issue_date, competence_date, payment_method: text(raw?.payment_method, 40),
    planned_account_id, notes: text(raw?.notes, 2000), plan, cost_centers,
    source_type: raw?.source_type || 'manual', source_id: raw?.source_id ?? null, source_ref: text(raw?.source_ref, 120),
    quotation_id: raw?.quotation_id ? Number(raw.quotation_id) : null, recurrence_id: raw?.recurrence_id ? Number(raw.recurrence_id) : null,
  };
}

function writeInstallments(db: DB, entryId: number, plan: InstallmentPlan) {
  db.prepare('DELETE FROM financial_installments WHERE entry_id = ?').run(entryId);
  const ins = db.prepare("INSERT INTO financial_installments (entry_id, number, due_date, original_amount, status) VALUES (?, ?, ?, ?, 'aberto')");
  for (const p of buildInstallments(plan)) ins.run(entryId, p.number, p.due_date, p.amount);
}

function writeCostCenters(db: DB, entryId: number, split: { cost_center_id: number; amount: number }[]) {
  db.prepare('DELETE FROM financial_entry_cost_centers WHERE entry_id = ?').run(entryId);
  const ins = db.prepare('INSERT INTO financial_entry_cost_centers (entry_id, cost_center_id, amount) VALUES (?, ?, ?)');
  for (const c of split) ins.run(entryId, c.cost_center_id, c.amount);
}

/** Decide a situação ao lançar: pagamento acima da alçada exige aprovação de gestor/administrador. */
function launchStatus(db: DB, user: AuthUser | null, e: EntryInput) {
  const limit = getFinanceSettings(db).payment_approval_limit;
  if (e.entry_type === 'pagar' && limit > 0 && e.plan.total > limit && !(user && financeCan.approve(user))) return 'aguardando_aprovacao';
  return 'ativo';
}

/** Insere título (chamar DENTRO de transação). Integrações passam source_type/source_id: índice único impede duplicidade. */
export function insertEntry(db: DB, user: AuthUser | null, e: EntryInput, asDraft = false): number {
  if (e.source_id) {
    const dup = db.prepare('SELECT entry_number FROM financial_entries WHERE source_type = ? AND source_id = ?').get(e.source_type, e.source_id) as any;
    if (dup) throw conflict(`Já existe o lançamento ${dup.entry_number} para esta origem.`);
  }
  const status = asDraft ? 'rascunho' : launchStatus(db, user, e);
  const row = db
    .prepare(
      `INSERT INTO financial_entries (entry_number, entry_type, status, description, party_type, supplier_id, customer_id, party_name, party_document,
         category_id, origin, source_type, source_id, source_ref, quotation_id, recurrence_id, document_ref, issue_date, competence_date, original_amount,
         payment_method, planned_account_id, notes, created_by, approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(
      nextNumber(db, e.entry_type === 'pagar' ? 'PAG' : 'REC'), e.entry_type, status, e.description, e.party_type, e.supplier_id, e.customer_id,
      e.party_name, e.party_document, e.category_id, e.origin, e.source_type, e.source_id, e.source_ref, e.quotation_id, e.recurrence_id, e.document_ref,
      e.issue_date, e.competence_date, e.plan.total, e.payment_method, e.planned_account_id, e.notes, user?.id ?? null,
      status === 'ativo' && e.entry_type === 'pagar' && user && financeCan.approve(user) ? user.id : null, null
    ) as { id: number };
  writeInstallments(db, row.id, e.plan);
  writeCostCenters(db, row.id, e.cost_centers);
  audit(db, 'financial_entry', row.id, 'create', user?.id ?? null, { status, total: e.plan.total, installments: e.plan.count, source: `${e.source_type}:${e.source_id ?? ''}` });
  return row.id;
}

export function createEntry(db: DB, user: AuthUser, type: EntryType, raw: any) {
  if (!financeCan.operate(user)) throw forbidden();
  const e = normalizeEntry(db, { ...raw, source_type: 'manual', source_id: null }, type);
  const id = transaction(db, () => insertEntry(db, user, e, !!raw?.draft));
  return getEntryDetail(db, user, id);
}

function loadRaw(db: DB, id: number) {
  const e = db.prepare('SELECT * FROM financial_entries WHERE id = ?').get(id) as any;
  if (!e) throw notFound('Lançamento não encontrado.');
  return e;
}

const settledOf = (db: DB, id: number) => (db.prepare('SELECT COALESCE(SUM(settled_amount),0) s FROM financial_installments WHERE entry_id = ?').get(id) as { s: number }).s;

export function updateEntry(db: DB, user: AuthUser, id: number, raw: any) {
  if (!financeCan.operate(user)) throw forbidden();
  transaction(db, () => {
    const cur = loadRaw(db, id);
    if (raw?.row_version !== undefined && Number(raw.row_version) !== cur.row_version) throw conflict('Este lançamento foi alterado por outra pessoa. Recarregue a página.');
    if (cur.status === 'cancelado') throw new HttpError(422, 'Lançamento cancelado não pode ser alterado.');
    if (settledOf(db, id) > 0) throw new HttpError(422, 'Lançamento com pagamento/recebimento registrado não pode ser alterado. Ajuste encargos na parcela ou estorne o pagamento.');
    if (cur.source_type !== 'manual' && cur.source_type !== 'recorrencia') throw new HttpError(422, 'Lançamentos gerados por integração são alterados na origem (venda, contrato ou entrada de estoque).');
    const e = normalizeEntry(db, { ...raw, source_type: cur.source_type, source_id: cur.source_id }, cur.entry_type);
    const status = cur.status === 'rascunho' && raw?.draft ? 'rascunho' : launchStatus(db, user, e);
    db.prepare(
      `UPDATE financial_entries SET status = ?, description = ?, party_type = ?, supplier_id = ?, customer_id = ?, party_name = ?, party_document = ?, category_id = ?,
        origin = ?, document_ref = ?, issue_date = ?, competence_date = ?, original_amount = ?, payment_method = ?, planned_account_id = ?, notes = ?,
        row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`
    ).run(status, e.description, e.party_type, e.supplier_id, e.customer_id, e.party_name, e.party_document, e.category_id, e.origin, e.document_ref, e.issue_date, e.competence_date, e.plan.total, e.payment_method, e.planned_account_id, e.notes, id);
    writeInstallments(db, id, e.plan);
    writeCostCenters(db, id, e.cost_centers);
    audit(db, 'financial_entry', id, 'update', user.id, { before: { total: cur.original_amount, status: cur.status }, after: { total: e.plan.total, status } });
  });
  return getEntryDetail(db, user, id);
}

export function entryAction(db: DB, user: AuthUser, id: number, action: string, raw: any) {
  transaction(db, () => {
    const cur = loadRaw(db, id);
    const reason = text(raw?.reason, 500);
    if (action === 'lancar') {
      if (!financeCan.operate(user)) throw forbidden();
      if (cur.status !== 'rascunho') throw new HttpError(422, 'Somente rascunhos podem ser lançados.');
      const total = cur.original_amount;
      const limit = getFinanceSettings(db).payment_approval_limit;
      const st = cur.entry_type === 'pagar' && limit > 0 && total > limit && !financeCan.approve(user) ? 'aguardando_aprovacao' : 'ativo';
      db.prepare(`UPDATE financial_entries SET status = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`).run(st, id);
    } else if (action === 'aprovar') {
      if (!financeCan.approve(user)) throw forbidden('Aprovação exige gestor ou administrador.');
      if (cur.status !== 'aguardando_aprovacao') throw new HttpError(422, 'Este lançamento não aguarda aprovação.');
      db.prepare(`UPDATE financial_entries SET status = 'ativo', approved_by = ?, approved_at = ${NOW_SQL}, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`).run(user.id, id);
    } else if (action === 'rejeitar') {
      if (!financeCan.approve(user)) throw forbidden('Rejeição exige gestor ou administrador.');
      if (cur.status !== 'aguardando_aprovacao') throw new HttpError(422, 'Este lançamento não aguarda aprovação.');
      if (!reason) throw badRequest('Informe o motivo.', { reason: 'Obrigatório.' });
      db.prepare(`UPDATE financial_entries SET status = 'rascunho', notes = COALESCE(notes || char(10), '') || ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`).run(`Rejeitado: ${reason}`, id);
    } else if (action === 'cancelar') {
      if (!financeCan.operate(user)) throw forbidden();
      if (cur.status === 'cancelado') throw new HttpError(422, 'Já cancelado.');
      if (!reason) throw badRequest('Informe o motivo do cancelamento.', { reason: 'Obrigatório.' });
      if (settledOf(db, id) > 0) throw new HttpError(422, 'Há pagamentos/recebimentos registrados: estorne-os antes de cancelar (o histórico é mantido).');
      db.prepare(`UPDATE financial_entries SET status = 'cancelado', cancel_reason = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`).run(reason, id);
      db.prepare(`UPDATE financial_installments SET status = 'cancelado', updated_at = ${NOW_SQL} WHERE entry_id = ?`).run(id);
    } else throw badRequest('Ação inválida.');
    audit(db, 'financial_entry', id, action, user.id, { reason });
  });
  return getEntryDetail(db, user, id);
}

/** Desconto autorizado, juros, multa e acréscimos de uma parcela em aberto (com auditoria). */
export function adjustInstallment(db: DB, user: AuthUser, installmentId: number, raw: any) {
  if (!financeCan.operate(user)) throw forbidden();
  const reason = text(raw?.reason, 500);
  if (!reason) throw badRequest('Informe o motivo do ajuste.', { reason: 'Obrigatório.' });
  let entryId = 0;
  transaction(db, () => {
    const i = db.prepare('SELECT * FROM financial_installments WHERE id = ?').get(installmentId) as any;
    if (!i) throw notFound('Parcela não encontrada.');
    entryId = i.entry_id;
    const e = loadRaw(db, i.entry_id);
    if (e.status !== 'ativo') throw new HttpError(422, 'Somente lançamentos ativos podem ter encargos ajustados.');
    if (i.status === 'liquidado' || i.status === 'cancelado') throw new HttpError(422, 'Parcela já liquidada ou cancelada.');
    if (raw?.row_version !== undefined && Number(raw.row_version) !== i.row_version) throw conflict('A parcela foi alterada por outra pessoa. Recarregue.');
    const next = { original_amount: i.original_amount, discount: cents(raw?.discount, 'Desconto'), interest: cents(raw?.interest, 'Juros'), penalty: cents(raw?.penalty, 'Multa'), additional: cents(raw?.additional, 'Acréscimos') };
    const upd = updatedAmount(next);
    if (upd <= 0) throw badRequest('O desconto não pode zerar ou negativar a parcela.');
    if (upd < i.settled_amount) throw badRequest('O valor atualizado não pode ficar abaixo do que já foi liquidado.');
    db.prepare(`UPDATE financial_installments SET discount = ?, interest = ?, penalty = ?, additional = ?, status = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`).run(
      next.discount, next.interest, next.penalty, next.additional, installmentStatus(upd, i.settled_amount), installmentId
    );
    audit(db, 'financial_entry', i.entry_id, 'ajuste_parcela', user.id, { parcela: i.number, before: { discount: i.discount, interest: i.interest, penalty: i.penalty, additional: i.additional }, after: next, reason });
  });
  return getEntryDetail(db, user, entryId);
}

// ------------------------------------------------ consulta

const ENTRY_SELECT = `
  SELECT e.*, c.name AS category_name, c.dre_group, a.name AS planned_account_name, COALESCE(u.name,'Sistema') AS created_by_name,
    COALESCE(SUM(CASE WHEN i.status != 'cancelado' THEN i.original_amount - i.discount + i.interest + i.penalty + i.additional END), 0) AS updated_amount,
    COALESCE(SUM(i.settled_amount), 0) AS settled_amount,
    COUNT(i.id) AS installments_count,
    MIN(CASE WHEN i.status IN ('aberto','parcial') THEN i.due_date END) AS next_due_date,
    SUM(CASE WHEN i.status IN ('aberto','parcial') AND i.due_date < ? THEN 1 ELSE 0 END) AS overdue_count,
    SUM(CASE WHEN i.status IN ('parcial','liquidado') THEN 1 ELSE 0 END) AS paid_count,
    SUM(CASE WHEN i.status = 'liquidado' THEN 1 ELSE 0 END) AS liquidated_count,
    SUM(CASE WHEN i.status != 'cancelado' THEN 1 ELSE 0 END) AS live_count
  FROM financial_entries e
  JOIN financial_categories c ON c.id = e.category_id
  LEFT JOIN financial_accounts a ON a.id = e.planned_account_id
  LEFT JOIN users u ON u.id = e.created_by
  LEFT JOIN financial_installments i ON i.entry_id = e.id`;

function shape(r: any, user: AuthUser) {
  const today = todayISO();
  let display = r.status;
  if (r.status === 'ativo') {
    if (r.live_count === 0) display = 'cancelado';
    else if (r.liquidated_count === r.live_count) display = 'liquidado';
    else if (r.overdue_count > 0) display = 'vencido';
    else if (r.paid_count > 0) display = 'parcial';
    else display = 'aberto';
  }
  void today;
  return {
    ...r,
    display_status: display,
    pending_amount: r.status === 'cancelado' ? 0 : r.updated_amount - r.settled_amount,
    party_document: financeCan.seeDocuments(user) ? r.party_document : r.party_document ? '•••' + String(r.party_document).slice(-2) : null,
  };
}

export function listEntries(db: DB, user: AuthUser, type: EntryType, f: Record<string, string | undefined>) {
  const where: string[] = ['e.entry_type = ?'];
  const params: (string | number)[] = [type];
  const today = todayISO();
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    where.push('(e.entry_number LIKE ? OR e.description LIKE ? OR e.party_name LIKE ? OR e.document_ref LIKE ? OR e.party_document LIKE ?)');
    params.push(q, q, q, q, `%${onlyDigits(f.q) || '#'}%`);
  }
  if (f.category_id) {
    where.push('(e.category_id = ? OR c.parent_id = ?)');
    params.push(Number(f.category_id), Number(f.category_id));
  }
  if (f.cost_center_id) {
    where.push('EXISTS (SELECT 1 FROM financial_entry_cost_centers x WHERE x.entry_id = e.id AND x.cost_center_id = ?)');
    params.push(Number(f.cost_center_id));
  }
  for (const [k, col] of [['supplier_id', 'e.supplier_id'], ['customer_id', 'e.customer_id'], ['quotation_id', 'e.quotation_id']] as const) {
    if (f[k]) {
      where.push(`${col} = ?`);
      params.push(Number(f[k]));
    }
  }
  if (f.origin) {
    where.push('e.origin = ?');
    params.push(f.origin);
  }
  if (f.source_type) {
    where.push('e.source_type = ?');
    params.push(f.source_type);
  }
  if (f.due_from) {
    where.push('EXISTS (SELECT 1 FROM financial_installments y WHERE y.entry_id = e.id AND y.status IN (\'aberto\',\'parcial\') AND y.due_date >= ?)');
    params.push(f.due_from);
  }
  if (f.due_to) {
    where.push('EXISTS (SELECT 1 FROM financial_installments y WHERE y.entry_id = e.id AND y.status IN (\'aberto\',\'parcial\') AND y.due_date <= ?)');
    params.push(f.due_to);
  }
  const having: string[] = [];
  const st = f.status;
  if (st === 'rascunho' || st === 'aguardando_aprovacao' || st === 'cancelado') {
    where.push('e.status = ?');
    params.push(st);
  } else if (st) {
    where.push("e.status = 'ativo'");
    if (st === 'vencido') having.push('overdue_count > 0');
    if (st === 'liquidado') having.push('liquidated_count = live_count AND live_count > 0');
    if (st === 'parcial') having.push('paid_count > 0 AND liquidated_count < live_count AND overdue_count = 0');
    if (st === 'aberto') having.push('paid_count = 0 AND overdue_count = 0 AND live_count > 0');
    if (st === 'pendente') having.push('liquidated_count < live_count');
  }
  if (f.soon) having.push(`next_due_date BETWEEN '${today}' AND '${addDaysISO(today, Math.min(Math.max(Number(f.soon) || 7, 1), 90))}'`);
  const sortMap: Record<string, string> = { due: 'next_due_date IS NULL, next_due_date', number: 'e.id', amount: 'updated_amount', party: 'e.party_name', created: 'e.id' };
  const sort = sortMap[f.sort || 'due'] || sortMap.due;
  const dir = f.dir === 'desc' ? 'DESC' : 'ASC';
  const base = `${ENTRY_SELECT} WHERE ${where.join(' AND ')} GROUP BY e.id ${having.length ? 'HAVING ' + having.join(' AND ') : ''}`;
  const total = (db.prepare(`SELECT COUNT(*) n FROM (${base})`).get(today, ...params) as { n: number }).n;
  const totals = db.prepare(`SELECT COALESCE(SUM(updated_amount),0) upd, COALESCE(SUM(settled_amount),0) settled FROM (${base}) WHERE status != 'cancelado'`).get(today, ...params) as any;
  const pageSize = f.all ? 10000 : Math.min(Math.max(Number(f.page_size) || 25, 5), 100);
  const page = f.all ? 1 : Math.max(Number(f.page) || 1, 1);
  const rows = (db.prepare(`${base} ORDER BY ${sort} ${dir}, e.id DESC LIMIT ? OFFSET ?`).all(today, ...params, pageSize, (page - 1) * pageSize) as any[]).map((r) => shape(r, user));
  return { total, page, page_size: pageSize, rows, totals: { updated: totals.upd, settled: totals.settled, pending: totals.upd - totals.settled } };
}

export function getEntryDetail(db: DB, user: AuthUser, id: number): EntryDetail {
  const today = todayISO();
  const r = db.prepare(`${ENTRY_SELECT} WHERE e.id = ? GROUP BY e.id`).get(today, id) as any;
  if (!r) throw notFound('Lançamento não encontrado.');
  const e = shape(r, user);
  const installments = (db.prepare('SELECT * FROM financial_installments WHERE entry_id = ? ORDER BY number').all(id) as any[]).map((i) => {
    const upd = updatedAmount(i);
    return { ...i, updated_amount: upd, pending_amount: i.status === 'cancelado' ? 0 : upd - i.settled_amount, display_status: displayStatus(e.status, i.status, i.due_date, today), days_overdue: i.status === 'aberto' || i.status === 'parcial' ? daysOverdue(i.due_date, today) : 0 };
  });
  e.display_status = entryDisplayStatus(e.status, installments, today);
  const cost_centers = db.prepare('SELECT x.cost_center_id, c.code || \' — \' || c.name AS cost_center_name, x.amount FROM financial_entry_cost_centers x JOIN cost_centers c ON c.id = x.cost_center_id WHERE x.entry_id = ?').all(id) as any[];
  const payments = (
    db
      .prepare(
        `SELECT al.id AS allocation_id, t.id AS transaction_id, t.transaction_number, i.number AS installment_number, al.amount, t.transaction_date, a.name AS account_name, t.method,
          (SELECT 1 FROM financial_transactions r WHERE r.reversal_of_id = t.id) AS reversed, (t.reversal_of_id IS NOT NULL) AS is_reversal,
          COALESCE(u.name,'Sistema') AS performed_by_name, t.created_at
         FROM financial_allocations al JOIN financial_transactions t ON t.id = al.transaction_id JOIN financial_installments i ON i.id = al.installment_id
         JOIN financial_accounts a ON a.id = t.account_id LEFT JOIN users u ON u.id = t.performed_by
         WHERE i.entry_id = ? ORDER BY t.id, i.number`
      )
      .all(id) as any[]
  ).map((p) => ({ ...p, reversed: !!p.reversed, is_reversal: !!p.is_reversal }));
  const attachments = db
    .prepare(`SELECT f.id, f.name, f.mime, f.size, COALESCE(u.name,'Sistema') AS uploaded_by_name, f.created_at FROM financial_attachments f LEFT JOIN users u ON u.id = f.uploaded_by WHERE f.entity_type = 'entry' AND f.entity_id = ? ORDER BY f.id DESC`)
    .all(id) as any[];
  const history = db
    .prepare(`SELECT l.id, l.action, l.data, COALESCE(u.name,'Sistema') AS user_name, l.created_at FROM audit_log l LEFT JOIN users u ON u.id = l.user_id WHERE l.entity = 'financial_entry' AND l.entity_id = ? ORDER BY l.id DESC`)
    .all(String(id)) as any[];
  const op = financeCan.operate(user);
  return {
    ...e,
    installments,
    cost_centers,
    payments,
    attachments,
    history,
    allowed: {
      edit: op && e.status !== 'cancelado' && e.settled_amount === 0 && ['manual', 'recorrencia'].includes(e.source_type),
      approve: financeCan.approve(user) && e.status === 'aguardando_aprovacao',
      settle: op && e.status === 'ativo' && e.pending_amount > 0,
      cancel: op && e.status !== 'cancelado' && e.settled_amount === 0,
      reverse: financeCan.reverse(user),
    },
  };
}

// ------------------------------------------------ recorrências

export function createRecurrence(db: DB, user: AuthUser, type: EntryType, raw: any) {
  if (!financeCan.operate(user)) throw forbidden();
  const freq = ['semanal', 'mensal', 'anual'].includes(raw?.frequency) ? raw.frequency : 'mensal';
  const start = raw?.start_date;
  if (!isISODate(start)) throw badRequest('Informe a data da primeira ocorrência.', { start_date: 'Obrigatório.' });
  const end = raw?.end_date || null;
  if (end && (!isISODate(end) || end < start)) throw badRequest('Data final inválida.', { end_date: 'Inválida.' });
  // valida o modelo como um lançamento de parcela única
  const tpl = normalizeEntry(db, { ...raw, plan: { total: Number(raw?.original_amount), count: 1, first_due: start } }, type);
  const id = transaction(db, () => {
    const row = db
      .prepare('INSERT INTO financial_recurrences (entry_type, template, amount, frequency, start_date, end_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
      .get(type, JSON.stringify({ ...raw, original_amount: tpl.plan.total }), tpl.plan.total, freq, start, end, user.id) as { id: number };
    audit(db, 'financial_recurrence', row.id, 'create', user.id, { freq, start, end, amount: tpl.plan.total });
    return row.id;
  });
  generateRecurrences(db);
  return id;
}

/**
 * Gera os lançamentos das recorrências ativas até o horizonte configurado.
 * Idempotente: cada ocorrência tem source_id "recorrência:data" (índice único).
 */
export function generateRecurrences(db: DB, until?: string) {
  const s = getFinanceSettings(db);
  const today = todayISO();
  const limit = until || addDaysISO(today, s.recurrence_horizon_days);
  const recs = db.prepare('SELECT * FROM financial_recurrences WHERE active = 1').all() as any[];
  let created = 0;
  for (const r of recs) {
    const tpl = JSON.parse(r.template);
    for (const d of recurrenceDates(r.start_date, r.frequency, r.start_date, limit, r.end_date)) {
      const sid = `${r.id}:${d}`;
      if (db.prepare("SELECT 1 FROM financial_entries WHERE source_type = 'recorrencia' AND source_id = ?").get(sid)) continue;
      try {
        transaction(db, () => {
          const e = normalizeEntry(db, { ...tpl, issue_date: d < today ? d : today, competence_date: d, plan: { total: r.amount, count: 1, first_due: d }, source_type: 'recorrencia', source_id: sid, recurrence_id: r.id, source_ref: `Recorrência #${r.id}` }, r.entry_type);
          insertEntry(db, null, e);
        });
        created++;
      } catch {
        // categoria/cadastro inativado: a ocorrência não é gerada (a recorrência deve ser revisada)
      }
    }
  }
  return created;
}

export function listRecurrences(db: DB, type?: EntryType) {
  const rows = db.prepare(`SELECT r.*, (SELECT COUNT(*) FROM financial_entries e WHERE e.recurrence_id = r.id) generated FROM financial_recurrences r ${type ? 'WHERE r.entry_type = ?' : ''} ORDER BY r.id DESC`).all(...(type ? [type] : [])) as any[];
  return rows.map((r) => {
    const t = JSON.parse(r.template);
    const cat = db.prepare('SELECT name FROM financial_categories WHERE id = ?').get(Number(t.category_id)) as any;
    const next = recurrenceDates(r.start_date, r.frequency, todayISO(), '9999-12-31', r.end_date)[0] || null;
    const party = t.party_name || (t.supplier_id ? (db.prepare('SELECT name FROM suppliers WHERE id = ?').get(Number(t.supplier_id)) as any)?.name : t.customer_id ? (db.prepare('SELECT name FROM customers WHERE id = ?').get(Number(t.customer_id)) as any)?.name : '');
    return { id: r.id, entry_type: r.entry_type, description: t.description, amount: r.amount, frequency: r.frequency, start_date: r.start_date, end_date: r.end_date, next_date: next, active: !!r.active, party_name: party || '—', category_name: cat?.name || '—', generated: r.generated };
  });
}

export function setRecurrenceActive(db: DB, user: AuthUser, id: number, active: boolean) {
  if (!financeCan.operate(user)) throw forbidden();
  const r = db.prepare('UPDATE financial_recurrences SET active = ? WHERE id = ? RETURNING id').get(active ? 1 : 0, id);
  if (!r) throw notFound('Recorrência não encontrada.');
  audit(db, 'financial_recurrence', id, active ? 'activate' : 'deactivate', user.id);
}

// ------------------------------------------------ anexos

const MAX_FILE = 2_000_000;

export function addAttachment(db: DB, user: AuthUser, entityType: 'entry' | 'transaction', entityId: number, raw: any) {
  if (!financeCan.operate(user)) throw forbidden();
  const table = entityType === 'entry' ? 'financial_entries' : 'financial_transactions';
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(entityId)) throw notFound();
  const data = String(raw?.data || '');
  const m = /^data:([\w/+.-]+);base64,/.exec(data);
  if (!m || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/xml', 'application/xml'].includes(m[1])) throw badRequest('Anexo deve ser PDF, imagem ou XML de nota.');
  if (data.length > MAX_FILE) throw badRequest('Arquivo muito grande (máx. ~1,4 MB).');
  const name = text(raw?.name, 120) || 'anexo';
  db.prepare('INSERT INTO financial_attachments (entity_type, entity_id, name, mime, size, data, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(entityType, entityId, name, m[1], Math.round(((data.length - m[0].length) * 3) / 4), data, user.id);
  audit(db, entityType === 'entry' ? 'financial_entry' : 'financial_transaction', entityId, 'anexo', user.id, { name });
}

export function getAttachment(db: DB, id: number) {
  const f = db.prepare('SELECT * FROM financial_attachments WHERE id = ?').get(id) as any;
  if (!f) throw notFound('Anexo não encontrado.');
  return f;
}
