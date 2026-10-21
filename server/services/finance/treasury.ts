/**
 * Tesouraria: transferências entre contas próprias e fechamento de caixa físico.
 * Transferência nunca é receita nem despesa: são duas movimentações (saída + entrada) gravadas juntas.
 */

import { DB, audit, transaction } from '../../db';
import { HttpError, badRequest, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { isISODate, todayISO } from '../../../shared/orcamentos/dates';
import { formatBRL } from '../../../shared/orcamentos/money';
import { financeCan } from '../../../shared/financeiro/rules';
import { NOW_SQL, accountBalance, assertAccount, findByIdempotency, insertTransaction, nextNumber, text } from './core';

const TRANSFER_SELECT = `
  SELECT t.*, s.name AS source_name, d.name AS destination_name, COALESCE(u.name,'Sistema') AS performed_by_name, c.name AS confirmed_by_name
  FROM financial_transfers t JOIN financial_accounts s ON s.id = t.source_account_id JOIN financial_accounts d ON d.id = t.destination_account_id
  LEFT JOIN users u ON u.id = t.performed_by LEFT JOIN users c ON c.id = t.confirmed_by`;

export function listTransfers(db: DB, f: Record<string, string | undefined>) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.status) {
    where.push('t.status = ?');
    params.push(f.status);
  }
  if (f.account_id) {
    where.push('(t.source_account_id = ? OR t.destination_account_id = ?)');
    params.push(Number(f.account_id), Number(f.account_id));
  }
  if (f.from) {
    where.push('t.transfer_date >= ?');
    params.push(f.from);
  }
  if (f.to) {
    where.push('t.transfer_date <= ?');
    params.push(f.to);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return { rows: db.prepare(`${TRANSFER_SELECT} ${w} ORDER BY t.id DESC LIMIT 500`).all(...params) };
}

function effectuate(db: DB, user: AuthUser, t: any) {
  const out = insertTransaction(db, user, {
    account_id: t.source_account_id, type: 'transferencia_saida', direction: -1, amount: t.amount, date: t.transfer_date,
    description: `Transferência ${t.number} para ${t.destination_name}${t.description ? ` — ${t.description}` : ''}`, source_type: 'transferencia', source_id: String(t.id),
  });
  const inn = insertTransaction(db, user, {
    account_id: t.destination_account_id, type: 'transferencia_entrada', direction: 1, amount: t.amount, date: t.transfer_date,
    description: `Transferência ${t.number} de ${t.source_name}${t.description ? ` — ${t.description}` : ''}`, source_type: 'transferencia', source_id: String(t.id),
  });
  db.prepare(`UPDATE financial_transfers SET status = 'efetivada', out_tx_id = ?, in_tx_id = ?, confirmed_by = ? WHERE id = ?`).run(out, inn, user.id, t.id);
}

export function createTransfer(db: DB, user: AuthUser, raw: any) {
  if (!financeCan.operate(user)) throw forbidden();
  const key = text(raw?.idempotency_key, 100);
  const dup = findByIdempotency(db, 'financial_transfers', key);
  if (dup) return { ...(db.prepare(`${TRANSFER_SELECT} WHERE t.id = ?`).get(dup) as any), duplicate: true };
  const src = assertAccount(db, raw?.source_account_id, 'Conta de origem');
  const dst = assertAccount(db, raw?.destination_account_id, 'Conta de destino');
  if (src.id === dst.id) throw badRequest('Origem e destino devem ser contas diferentes.');
  const amount = Number(raw?.amount);
  if (!Number.isInteger(amount) || amount <= 0) throw badRequest('Informe o valor.', { amount: 'Inválido.' });
  const date = raw?.transfer_date || todayISO();
  if (!isISODate(date)) throw badRequest('Data inválida.');
  const pending = raw?.status === 'pendente' || date > todayISO();
  const id = transaction(db, () => {
    const row = db
      .prepare(
        `INSERT INTO financial_transfers (number, source_account_id, destination_account_id, amount, transfer_date, status, description, reference, idempotency_key, performed_by)
         VALUES (?, ?, ?, ?, ?, 'pendente', ?, ?, ?, ?) RETURNING id`
      )
      .get(nextNumber(db, 'TRA'), src.id, dst.id, amount, date, text(raw?.description, 200), text(raw?.reference, 80), key, user.id) as { id: number };
    const t = db.prepare(`${TRANSFER_SELECT} WHERE t.id = ?`).get(row.id) as any;
    if (!pending) effectuate(db, user, t);
    audit(db, 'financial_transfer', row.id, 'create', user.id, { amount, src: src.id, dst: dst.id, pending });
    return row.id;
  });
  return db.prepare(`${TRANSFER_SELECT} WHERE t.id = ?`).get(id);
}

export function transferAction(db: DB, user: AuthUser, id: number, action: string, raw: any) {
  transaction(db, () => {
    const t = db.prepare(`${TRANSFER_SELECT} WHERE t.id = ?`).get(id) as any;
    if (!t) throw notFound('Transferência não encontrada.');
    if (action === 'efetivar') {
      if (!financeCan.operate(user)) throw forbidden();
      if (t.status !== 'pendente') throw new HttpError(422, 'Somente transferências pendentes podem ser efetivadas.');
      if (t.transfer_date > todayISO()) db.prepare('UPDATE financial_transfers SET transfer_date = ? WHERE id = ?').run(todayISO(), id), (t.transfer_date = todayISO());
      effectuate(db, user, t);
    } else if (action === 'cancelar') {
      if (!financeCan.operate(user)) throw forbidden();
      if (t.status !== 'pendente') throw new HttpError(422, 'Somente transferências pendentes podem ser canceladas. Efetivadas são estornadas.');
      db.prepare("UPDATE financial_transfers SET status = 'cancelada' WHERE id = ?").run(id);
    } else if (action === 'estornar') {
      if (!financeCan.reverse(user)) throw forbidden('Estornos são autorizados pelo administrador financeiro.');
      if (t.status !== 'efetivada') throw new HttpError(422, 'Somente transferências efetivadas podem ser estornadas.');
      const why = text(raw?.reason, 300);
      if (!why) throw badRequest('Informe o motivo do estorno.', { reason: 'Obrigatório.' });
      // devolve o valor: entrada na origem e saída no destino, vinculadas às movimentações originais
      insertTransaction(db, user, { account_id: t.destination_account_id, type: 'estorno', direction: -1, amount: t.amount, date: todayISO(), description: `Estorno da transferência ${t.number}: ${why}`, source_type: 'transferencia', source_id: String(id), reversal_of_id: t.in_tx_id, allowNegative: true });
      insertTransaction(db, user, { account_id: t.source_account_id, type: 'estorno', direction: 1, amount: t.amount, date: todayISO(), description: `Estorno da transferência ${t.number}: ${why}`, source_type: 'transferencia', source_id: String(id), reversal_of_id: t.out_tx_id, allowNegative: true });
      db.prepare("UPDATE financial_transfers SET status = 'estornada' WHERE id = ?").run(id);
    } else throw badRequest('Ação inválida.');
    audit(db, 'financial_transfer', id, action, user.id, { reason: raw?.reason });
  });
  return db.prepare(`${TRANSFER_SELECT} WHERE t.id = ?`).get(id);
}

// ------------------------------------------------ fechamento de caixa

/** Entradas/saídas da sessão: movimentações com número sequencial após a abertura (exato, sem depender de horário). */
function sessionTotals(db: DB, s: any) {
  return db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN direction = 1 THEN amount END),0) inflows, COALESCE(SUM(CASE WHEN direction = -1 THEN amount END),0) outflows
       FROM financial_transactions WHERE account_id = ? AND status = 'efetivada' AND id > ? AND id <= ? AND id != ?`
    )
    .get(s.account_id, s.opening_tx_id, s.closing_tx_id ?? Number.MAX_SAFE_INTEGER, s.difference_tx_id ?? 0) as { inflows: number; outflows: number };
}

const lastTxId = (db: DB) => (db.prepare('SELECT COALESCE(MAX(id),0) m FROM financial_transactions').get() as { m: number }).m;

export function listCashSessions(db: DB, accountId?: number) {
  const rows = db
    .prepare(
      `SELECT s.*, a.name AS account_name, COALESCE(uo.name,'Sistema') AS opened_by_name, uc.name AS closed_by_name
       FROM cash_sessions s JOIN financial_accounts a ON a.id = s.account_id LEFT JOIN users uo ON uo.id = s.opened_by LEFT JOIN users uc ON uc.id = s.closed_by
       ${accountId ? 'WHERE s.account_id = ?' : ''} ORDER BY s.id DESC LIMIT 200`
    )
    .all(...(accountId ? [accountId] : [])) as any[];
  return rows.map((s) => {
    const t = sessionTotals(db, s);
    return { ...s, inflows: t.inflows, outflows: t.outflows, expected_balance: s.status === 'fechado' ? s.expected_balance : s.opening_balance + t.inflows - t.outflows };
  });
}

export function openCash(db: DB, user: AuthUser, accountId: number) {
  if (!financeCan.operate(user)) throw forbidden();
  const acc = assertAccount(db, accountId);
  if (acc.account_type !== 'caixa') throw badRequest('Abertura/fechamento se aplica a contas do tipo caixa físico.');
  return transaction(db, () => {
    if (db.prepare("SELECT 1 FROM cash_sessions WHERE account_id = ? AND status = 'aberto'").get(acc.id)) throw new HttpError(409, 'Já existe um caixa aberto para esta conta.');
    const row = db.prepare("INSERT INTO cash_sessions (account_id, status, opened_by, opening_balance, opening_tx_id) VALUES (?, 'aberto', ?, ?, ?) RETURNING id").get(acc.id, user.id, accountBalance(db, acc.id), lastTxId(db)) as { id: number };
    audit(db, 'cash_session', row.id, 'open', user.id);
    return row.id;
  });
}

export function closeCash(db: DB, user: AuthUser, sessionId: number, raw: any) {
  if (!financeCan.operate(user)) throw forbidden();
  const counted = Number(raw?.counted_amount);
  if (!Number.isInteger(counted) || counted < 0) throw badRequest('Informe o valor contado.', { counted_amount: 'Inválido.' });
  transaction(db, () => {
    const s = db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(sessionId) as any;
    if (!s) throw notFound('Sessão de caixa não encontrada.');
    if (s.status !== 'aberto') throw new HttpError(422, 'Este caixa já foi fechado.');
    s.closing_tx_id = lastTxId(db);
    const t = sessionTotals(db, s);
    const expected = s.opening_balance + t.inflows - t.outflows;
    const diff = counted - expected;
    const why = text(raw?.justification, 1000);
    if (diff !== 0 && !why) throw badRequest(`Diferença de ${formatBRL(diff)}: informe a justificativa.`, { justification: 'Obrigatório.' });
    let diffTx: number | null = null;
    if (diff !== 0) {
      // sobra/falta vira movimentação auditável: o saldo do sistema passa a refletir o valor contado
      diffTx = insertTransaction(db, user, {
        account_id: s.account_id, type: 'ajuste_caixa', direction: diff > 0 ? 1 : -1, amount: Math.abs(diff), date: todayISO(),
        description: `Fechamento de caixa #${s.id}: ${diff > 0 ? 'sobra' : 'falta'} — ${why}`, source_type: 'cash_session', source_id: String(s.id), allowNegative: true,
      });
    }
    db.prepare(`UPDATE cash_sessions SET status = 'fechado', closed_by = ?, closed_at = ${NOW_SQL}, expected_balance = ?, counted_amount = ?, difference = ?, justification = ?, difference_tx_id = ?, closing_tx_id = ? WHERE id = ?`).run(
      user.id, expected, counted, diff, why, diffTx, diffTx ?? s.closing_tx_id, sessionId
    );
    audit(db, 'cash_session', sessionId, 'close', user.id, { expected, counted, diff, why });
  });
  return listCashSessions(db).find((x) => x.id === sessionId);
}
