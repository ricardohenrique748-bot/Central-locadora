/**
 * Cronograma de cobranças do contrato.
 *
 * - O cronograma previsto é calculado (shared/contratos/rules.ts) e só vira cobrança quando o contrato está
 *   formalizado (agendado/ativo/...). Rascunho nunca gera cobrança.
 * - Cada cobrança gerada = uma conta a receber no Financeiro (origem contrato:<id>:<cobrança>).
 * - Idempotência: chave por período/parcela (índice único). Reexecutar não duplica.
 * - Pagamentos vêm do Financeiro; aqui só se lê a situação. Cobrança paga nunca é alterada.
 */

import { DB } from '../../db';
import { HttpError, badRequest, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { todayISO } from '../../../shared/orcamentos/dates';
import { addMonthsISO } from '../../../shared/financeiro/rules';
import { ChargeDisplayStatus, ContractCharge, FinancialSummary, LIVE_STATUSES, ScheduleLine } from '../../../shared/contratos/types';
import { buildSchedule, contractCan, scheduleKey } from '../../../shared/contratos/rules';
import { adjustContractChargeTx, cancelContractChargeTx, contractChargeEntryTx, contractChargeState } from '../finance/integrations';
import { NOW_SQL, contractEvent, getContractSettings, text } from './core';

/** Cronograma previsto a partir dos dados atuais do contrato (não grava nada). */
export function scheduleFor(db: DB, c: any): ScheduleLine[] {
  const s = getContractSettings(db);
  const base = c.start_date > todayISO() ? c.start_date : todayISO();
  return buildSchedule({
    contract_type: c.contract_type,
    start_date: c.start_date,
    end_date: c.end_date,
    billing_frequency: c.billing_frequency,
    custom_period_days: c.custom_period_days,
    billing_timing: c.billing_timing,
    due_day: c.due_day,
    due_days_after: c.due_days_after,
    proportional_last: !!c.proportional_last,
    single_charge: !!c.single_charge,
    general_discount: c.general_discount,
    freight_delivery: c.freight_delivery,
    freight_pickup: c.freight_pickup,
    other_fees: c.other_fees,
    other_fees_description: c.other_fees_description,
    installments_count: c.installments_count,
    first_due_date: c.first_due_date,
    period_amount: c.period_amount,
    sale_total: c.sale_total,
    horizon_end: c.end_date ? undefined : addMonthsISO(base, s.charge_horizon_months),
  });
}

function displayStatus(row: any, st: ReturnType<typeof contractChargeState>): ChargeDisplayStatus {
  if (row.status === 'cancelado') return 'cancelado';
  if (!st) return 'previsto';
  if (st.entry_status === 'cancelado' || st.status === 'cancelado') return 'cancelado';
  if (st.status === 'liquidado') return 'pago';
  if (st.status === 'parcial') return 'parcial';
  return st.due_date < todayISO() ? 'vencido' : 'em_aberto';
}

export function listCharges(db: DB, contractId: number): ContractCharge[] {
  const rows = db.prepare('SELECT * FROM contract_charges WHERE contract_id = ? ORDER BY due_date, id').all(contractId) as any[];
  return rows.map((r) => {
    const st = r.financial_entry_id ? contractChargeState(db, r.financial_entry_id) : undefined;
    return {
      id: r.id,
      kind: r.kind,
      description: r.description,
      period_start: r.period_start,
      period_end: r.period_end,
      due_date: st?.due_date || r.due_date,
      amount: r.amount,
      status: r.status,
      display_status: displayStatus(r, st),
      financial_entry_id: r.financial_entry_id,
      entry_number: st?.entry_number || null,
      settled_amount: st?.settled_amount || 0,
      updated_amount: st?.updated ?? r.amount,
      generated_at: r.generated_at,
      cancel_reason: r.cancel_reason,
    };
  });
}

export function financialSummary(c: any, charges: ContractCharge[], preview: ScheduleLine[]): FinancialSummary {
  const live = charges.filter((x) => x.display_status !== 'cancelado');
  const keys = new Set(charges.map((x) => scheduleKey(x)));
  return {
    contracted: c.estimated_total,
    scheduled: live.reduce((a, x) => a + x.updated_amount, 0),
    received: charges.reduce((a, x) => a + x.settled_amount, 0),
    open: live.reduce((a, x) => a + Math.max(0, x.updated_amount - x.settled_amount), 0),
    overdue: live.filter((x) => x.display_status === 'vencido' || (x.display_status === 'parcial' && x.due_date < todayISO())).reduce((a, x) => a + Math.max(0, x.updated_amount - x.settled_amount), 0),
    not_generated: c.status === 'cancelado' || c.status === 'encerrado' ? 0 : preview.filter((l) => !keys.has(scheduleKey(l))).reduce((a, l) => a + l.amount, 0),
  };
}

const originFor = (kind: string, contractType: string) => (kind === 'extra' ? 'cobranca_adicional' : kind === 'venda_item' || contractType === 'venda' ? 'venda' : 'locacao');

export function insertChargeTx(db: DB, user: AuthUser | null, c: any, l: ScheduleLine, key: string, categoryId: number | null = null, notes: string | null = null): number {
  const row = db
    .prepare(
      `INSERT INTO contract_charges (contract_id, charge_key, kind, description, period_start, period_end, due_date, amount, status, generated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'gerado', ?) RETURNING id`
    )
    .get(c.id, key, l.kind, l.description, l.period_start, l.period_end, l.due_date, l.amount, user?.id ?? null) as { id: number };
  const entryId = contractChargeEntryTx(db, user, {
    contract_id: c.id,
    charge_id: row.id,
    contract_number: c.contract_number,
    customer_id: c.customer_id,
    description: l.description,
    amount: l.amount,
    due_date: l.due_date,
    competence_date: l.period_start,
    category_id: categoryId,
    origin: originFor(l.kind, c.contract_type) as any,
    notes,
  });
  db.prepare('UPDATE contract_charges SET financial_entry_id = ? WHERE id = ?').run(entryId, row.id);
  return row.id;
}

/**
 * Gera no Financeiro as cobranças previstas que ainda não existem (DENTRO de transação).
 * Chaves já usadas (inclusive canceladas) não são geradas de novo.
 */
export function generateChargesTx(db: DB, user: AuthUser | null, c: any): number {
  if (!LIVE_STATUSES.includes(c.status)) throw new HttpError(422, 'Cobranças só são geradas para contratos formalizados (agendados ou ativos). Rascunhos e propostas não geram cobrança.');
  const existing = new Set((db.prepare('SELECT charge_key FROM contract_charges WHERE contract_id = ?').all(c.id) as { charge_key: string }[]).map((r) => r.charge_key));
  let n = 0;
  for (const l of scheduleFor(db, c)) {
    const key = scheduleKey(l);
    if (existing.has(key)) continue;
    let line = l;
    if (c.single_charge && l.kind === 'unico') {
      // cobrança única prorrogada: a vigência anterior já foi cobrada, entra só a diferença
      const charged = (db.prepare("SELECT COALESCE(SUM(amount), 0) AS s FROM contract_charges WHERE contract_id = ? AND kind = 'unico' AND status != 'cancelado'").get(c.id) as { s: number }).s;
      if (charged >= l.amount) continue;
      if (charged) line = { ...l, description: `${l.description} (diferença da prorrogação)`, amount: l.amount - charged };
    }
    insertChargeTx(db, user, c, line, key);
    existing.add(key);
    n++;
  }
  if (n) contractEvent(db, c.id, 'cobranca', `${n} cobrança(s) gerada(s) no Financeiro.`, user);
  return n;
}

export function extraChargeTx(db: DB, user: AuthUser, c: any, raw: any) {
  if (!contractCan.charges(user)) throw forbidden();
  if (![...LIVE_STATUSES, 'encerrado'].includes(c.status)) throw new HttpError(422, 'Cobranças extraordinárias exigem contrato formalizado.');
  const description = text(raw?.description, 160);
  const reason = text(raw?.reason, 500);
  const amount = Number(raw?.amount);
  const due = raw?.due_date;
  const key = text(raw?.idempotency_key, 80);
  if (!description) throw badRequest('Descreva a cobrança.', { description: 'Obrigatório.' });
  if (!reason) throw badRequest('Informe a justificativa.', { reason: 'Obrigatório.' });
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('Valor inválido.', { amount: 'Obrigatório.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due || '')) throw badRequest('Informe o vencimento.', { due_date: 'Obrigatório.' });
  if (!key) throw badRequest('Envio sem identificador.');
  const dup = db.prepare('SELECT id FROM contract_charges WHERE contract_id = ? AND charge_key = ?').get(c.id, `extra:${key}`) as { id: number } | undefined;
  if (dup) return dup.id;
  const id = insertChargeTx(db, user, c, { kind: 'extra', description, period_start: todayISO(), period_end: todayISO(), due_date: due, amount }, `extra:${key}`, raw?.category_id ? Number(raw.category_id) : null, reason);
  contractEvent(db, c.id, 'cobranca', `Cobrança extraordinária: ${description} (${(amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}). Justificativa: ${reason}`, user);
  return id;
}

function chargeOf(db: DB, contractId: number, chargeId: number) {
  const ch = db.prepare('SELECT * FROM contract_charges WHERE id = ? AND contract_id = ?').get(chargeId, contractId) as any;
  if (!ch) throw notFound('Cobrança não encontrada.');
  if (ch.status === 'cancelado') throw new HttpError(422, 'Cobrança já cancelada.');
  return ch;
}

/** Ajuste ou crédito autorizado numa cobrança ainda sem recebimento. */
export function adjustChargeTx(db: DB, user: AuthUser, contractId: number, chargeId: number, newAmount: number, reason: string | null) {
  if (!contractCan.charges(user)) throw forbidden();
  if (!reason) throw badRequest('Informe a justificativa do ajuste.', { reason: 'Obrigatório.' });
  const ch = chargeOf(db, contractId, chargeId);
  adjustContractChargeTx(db, user, ch.financial_entry_id, newAmount, reason);
  db.prepare(`UPDATE contract_charges SET amount = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(newAmount, chargeId);
  contractEvent(db, contractId, 'cobranca', `Cobrança "${ch.description}" ajustada de ${(ch.amount / 100).toFixed(2)} para ${(newAmount / 100).toFixed(2)}. Justificativa: ${reason}`, user, null, null, { charge_id: chargeId });
}

export function cancelChargeTx(db: DB, user: AuthUser | null, contractId: number, chargeId: number, reason: string) {
  const ch = chargeOf(db, contractId, chargeId);
  if (ch.financial_entry_id) cancelContractChargeTx(db, user, ch.financial_entry_id, reason);
  db.prepare(`UPDATE contract_charges SET status = 'cancelado', cancel_reason = ?, cancelled_at = ${NOW_SQL}, cancelled_by = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(reason, user?.id ?? null, chargeId);
  contractEvent(db, contractId, 'cobranca', `Cobrança "${ch.description}" cancelada: ${reason}`, user, null, null, { charge_id: chargeId });
}

/**
 * Troca as cobranças por período ainda sem recebimento por uma cobrança única com o valor total da vigência
 * (contrato de locação com término). Passa o contrato para cobrança única, para não voltar a separar.
 */
export function consolidateChargesTx(db: DB, user: AuthUser, c: any): number {
  if (!contractCan.charges(user)) throw forbidden();
  if (c.contract_type !== 'locacao' || !c.end_date || c.billing_frequency === 'unico') throw new HttpError(422, 'Só contratos de locação com data de término podem ter a cobrança unificada.');
  const periods = listCharges(db, c.id).filter((ch) => ch.kind === 'periodo' && ch.status !== 'cancelado' && ch.display_status !== 'cancelado');
  if (periods.some((ch) => ch.settled_amount > 0)) throw new HttpError(422, 'Há cobranças com recebimento registrado: elas não podem ser unificadas. Ajuste as cobranças em aberto manualmente.');
  for (const ch of periods) cancelChargeTx(db, user, c.id, ch.id, 'Unificada em cobrança única com o valor total');
  db.prepare(`UPDATE contracts SET single_charge = 1, updated_by = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`).run(user.id, c.id);
  const n = generateChargesTx(db, user, { ...c, single_charge: 1 });
  contractEvent(db, c.id, 'cobranca', `${periods.length} cobrança(s) por período unificada(s) em uma cobrança única com o valor total.`, user);
  return n;
}

/**
 * Encerramento/cancelamento: cancela cobranças ainda não recebidas que começam a partir de `fromDate`.
 * Cobranças com recebimento (total ou parcial) são mantidas. Retorna quantas foram canceladas e mantidas.
 */
export function cancelFutureChargesTx(db: DB, user: AuthUser | null, contractId: number, fromDate: string | null, reason: string) {
  let cancelled = 0;
  let kept = 0;
  for (const ch of listCharges(db, contractId)) {
    if (ch.status === 'cancelado' || ch.display_status === 'cancelado') continue;
    if (fromDate && ch.period_start < fromDate) continue;
    if (ch.settled_amount > 0) {
      kept++;
      continue;
    }
    cancelChargeTx(db, user, contractId, ch.id, reason);
    cancelled++;
  }
  return { cancelled, kept };
}

/** Reajuste: cobranças de período ainda não recebidas a partir da data efetiva passam ao novo valor. */
export function repriceFutureChargesTx(db: DB, user: AuthUser, c: any, effective: string, reason: string) {
  const byKey = new Map(scheduleFor(db, c).map((l) => [scheduleKey(l), l]));
  let n = 0;
  for (const ch of listCharges(db, c.id)) {
    if (ch.kind !== 'periodo' || ch.period_start < effective || ch.display_status === 'cancelado' || ch.settled_amount > 0) continue;
    const l = byKey.get(scheduleKey(ch));
    if (!l || l.amount === ch.amount) continue;
    adjustContractChargeTx(db, user, ch.financial_entry_id!, l.amount, reason);
    db.prepare(`UPDATE contract_charges SET amount = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(l.amount, ch.id);
    n++;
  }
  return n;
}
