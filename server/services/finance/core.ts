/**
 * Núcleo financeiro: saldo oficial das contas e gravação de movimentações efetivas.
 *
 * Regra única de saldo: saldo(conta, data) = saldo inicial (se a data inicial ≤ data)
 *   + Σ (direção × valor) das movimentações EFETIVADAS com data ≤ data.
 * Movimentações não são editadas nem apagadas; correção por estorno (movimentação inversa vinculada).
 */

import { DB } from '../../db';
import { HttpError, badRequest, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { isISODate, todayISO } from '../../../shared/orcamentos/dates';
import { TransactionType } from '../../../shared/financeiro/types';
import { nextNumber } from '../stock/core';
import { getFinanceSettings } from './registry';

export const NOW_SQL = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;
export { nextNumber };

export function accountBalance(db: DB, accountId: number, asOf: string = '9999-12-31'): number {
  const a = db.prepare('SELECT opening_balance, opening_balance_date FROM financial_accounts WHERE id = ?').get(accountId) as
    | { opening_balance: number; opening_balance_date: string }
    | undefined;
  if (!a) throw notFound('Conta financeira não encontrada.');
  const tx = db
    .prepare("SELECT COALESCE(SUM(direction * amount), 0) s FROM financial_transactions WHERE account_id = ? AND status = 'efetivada' AND transaction_date <= ?")
    .get(accountId, asOf) as { s: number };
  return (a.opening_balance_date <= asOf ? a.opening_balance : 0) + tx.s;
}

export function assertAccount(db: DB, id: unknown, label = 'Conta') {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${label}: selecione a conta financeira.`);
  const a = db.prepare('SELECT * FROM financial_accounts WHERE id = ?').get(n) as any;
  if (!a) throw badRequest(`${label}: conta não encontrada.`);
  if (!a.active) throw badRequest(`${label}: conta inativa.`);
  return a as { id: number; name: string; account_type: string; opening_balance_date: string };
}

export interface TxParams {
  account_id: number;
  type: TransactionType;
  direction: 1 | -1;
  amount: number;
  date: string;
  description: string;
  method?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  status?: 'pendente' | 'efetivada';
  idempotency_key?: string | null;
  reversal_of_id?: number | null;
  /** Ignora a regra de saldo negativo (estornos e ajustes autorizados). */
  allowNegative?: boolean;
}

/** Grava movimentação. Deve rodar DENTRO de transação. */
export function insertTransaction(db: DB, user: AuthUser | null, p: TxParams): number {
  if (!Number.isInteger(p.amount) || p.amount <= 0) throw badRequest('Valor da movimentação deve ser maior que zero.');
  if (!isISODate(p.date)) throw badRequest('Data da movimentação inválida.');
  const status = p.status || 'efetivada';
  const acc = assertAccount(db, p.account_id);
  if (status === 'efetivada') {
    if (p.date > todayISO()) throw badRequest('Movimentação efetivada não pode ter data futura.');
    if (p.date < acc.opening_balance_date) throw badRequest(`A data é anterior ao saldo inicial da conta ${acc.name} (${acc.opening_balance_date.split('-').reverse().join('/')}).`);
    if (p.direction < 0 && !p.allowNegative && !getFinanceSettings(db).allow_negative_balance) {
      const bal = accountBalance(db, acc.id);
      if (bal - p.amount < 0) throw new HttpError(422, `Saldo insuficiente em ${acc.name} (saldo ${(bal / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}).`);
    }
  }
  const row = db
    .prepare(
      `INSERT INTO financial_transactions (transaction_number, account_id, transaction_type, direction, amount, transaction_date, description, method,
         source_type, source_id, status, idempotency_key, reversal_of_id, performed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(
      nextNumber(db, 'FIN'), acc.id, p.type, p.direction, p.amount, p.date, p.description.slice(0, 300), p.method ?? null,
      p.source_type ?? null, p.source_id ?? null, status, p.idempotency_key ?? null, p.reversal_of_id ?? null, user?.id ?? null
    ) as { id: number };
  return row.id;
}

export function findByIdempotency(db: DB, table: 'financial_transactions' | 'financial_transfers', key: unknown): number | null {
  if (typeof key !== 'string' || !key.trim()) return null;
  const r = db.prepare(`SELECT id FROM ${table} WHERE idempotency_key = ?`).get(key.trim().slice(0, 100)) as { id: number } | undefined;
  return r?.id ?? null;
}

export const TX_SELECT = `
  SELECT t.*, a.name AS account_name, COALESCE(u.name, 'Sistema') AS performed_by_name,
    (SELECT r.id FROM financial_transactions r WHERE r.reversal_of_id = t.id) AS reversed_by_id,
    (t.statement_item_id IS NOT NULL) AS reconciled
  FROM financial_transactions t JOIN financial_accounts a ON a.id = t.account_id LEFT JOIN users u ON u.id = t.performed_by`;

export const text = (v: unknown, max = 500) => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t === '' ? null : t;
};

export const cents = (v: unknown, label = 'Valor', allowZero = true) => {
  const n = v === null || v === undefined || v === '' ? 0 : Number(v);
  if (!Number.isInteger(n) || n < 0 || (!allowZero && n === 0)) throw badRequest(`${label}: valor inválido.`);
  return n;
};
