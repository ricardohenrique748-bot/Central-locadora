/**
 * Liquidação (pagamentos e recebimentos), estornos e comprovante de recebimento.
 *
 * - Uma liquidação gera UMA movimentação efetiva na conta e alocações nas parcelas quitadas.
 * - Nunca acima do pendente (sem regra de crédito/adiantamento nesta versão).
 * - Reenvio da mesma operação (mesma chave de idempotência) devolve a liquidação já gravada.
 * - Estorno: movimentação inversa + alocações negativas; nada é apagado.
 */

import PDFDocument from 'pdfkit';
import { drawLogo } from '../../pdfLogo';
import { DB, audit, transaction } from '../../db';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { todayISO, formatDateBR } from '../../../shared/orcamentos/dates';
import { formatBRL } from '../../../shared/orcamentos/money';
import { formatDocument } from '../../../shared/orcamentos/validators';
import { financeCan, installmentStatus, updatedAmount } from '../../../shared/financeiro/rules';
import { ModuleSettings } from '../../../shared/orcamentos/types';
import { NOW_SQL, TX_SELECT, cents, findByIdempotency, insertTransaction, text } from './core';

export interface SettleInput {
  entry_id: number;
  account_id: number;
  date?: string;
  method?: string;
  notes?: string;
  idempotency_key?: string;
  /** Valor a liquidar por parcela; ausente = distribui `amount` das parcelas mais antigas para as mais novas. */
  allocations?: { installment_id: number; amount: number }[];
  amount?: number;
  /** Encargos/desconto aplicados nesta baixa, por parcela. */
  adjustments?: { installment_id: number; discount?: number; interest?: number; penalty?: number }[];
}

/** Liquidação dentro de transação já aberta (usada também pela conciliação). */
export function settleInTx(db: DB, user: AuthUser | null, s: SettleInput): number {
  const e = db.prepare('SELECT * FROM financial_entries WHERE id = ?').get(Number(s.entry_id)) as any;
  if (!e) throw notFound('Lançamento não encontrado.');
  if (e.status !== 'ativo') throw new HttpError(422, e.status === 'aguardando_aprovacao' ? 'Lançamento aguardando aprovação: não pode ser pago.' : e.status === 'rascunho' ? 'Lance o rascunho antes de liquidar.' : 'Lançamento cancelado.');
  const insts = db.prepare("SELECT * FROM financial_installments WHERE entry_id = ? AND status IN ('aberto','parcial') ORDER BY due_date, number").all(e.id) as any[];
  if (!insts.length) throw new HttpError(422, 'Não há saldo pendente neste lançamento.');

  // encargos/desconto desta baixa (auditados)
  for (const adj of s.adjustments || []) {
    const i = insts.find((x) => x.id === Number(adj.installment_id));
    if (!i) throw badRequest('Ajuste para parcela inválida.');
    const next = { original_amount: i.original_amount, discount: i.discount + cents(adj.discount, 'Desconto'), interest: i.interest + cents(adj.interest, 'Juros'), penalty: i.penalty + cents(adj.penalty, 'Multa'), additional: i.additional };
    if (updatedAmount(next) <= i.settled_amount) throw badRequest(`Parcela ${i.number}: desconto maior que o saldo pendente.`);
    if (next.discount !== i.discount || next.interest !== i.interest || next.penalty !== i.penalty) {
      db.prepare(`UPDATE financial_installments SET discount = ?, interest = ?, penalty = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`).run(next.discount, next.interest, next.penalty, i.id);
      audit(db, 'financial_entry', e.id, 'encargos_na_baixa', user?.id ?? null, { parcela: i.number, desconto: cents(adj.discount), juros: cents(adj.interest), multa: cents(adj.penalty) });
      Object.assign(i, next);
    }
  }

  let allocs: { installment_id: number; amount: number }[];
  if (s.allocations?.length) {
    allocs = s.allocations.map((a) => ({ installment_id: Number(a.installment_id), amount: Number(a.amount) })).filter((a) => a.amount !== 0);
  } else {
    let left = Number(s.amount);
    if (!Number.isInteger(left) || left <= 0) throw badRequest('Informe o valor.');
    allocs = [];
    for (const i of insts) {
      if (left <= 0) break;
      const pend = updatedAmount(i) - i.settled_amount;
      const take = Math.min(pend, left);
      if (take > 0) allocs.push({ installment_id: i.id, amount: take });
      left -= take;
    }
    if (left > 0) throw new HttpError(422, `Valor acima do saldo pendente em ${formatBRL(left)}. Pagamento a maior/adiantamento não é permitido.`);
  }
  if (!allocs.length) throw badRequest('Informe o valor a liquidar.');
  let total = 0;
  for (const a of allocs) {
    const i = insts.find((x) => x.id === a.installment_id);
    if (!i) throw badRequest('Parcela inválida ou já liquidada.');
    if (!Number.isInteger(a.amount) || a.amount <= 0) throw badRequest(`Parcela ${i.number}: valor inválido.`);
    const pend = updatedAmount(i) - i.settled_amount;
    if (a.amount > pend) throw new HttpError(422, `Parcela ${i.number}: valor ${formatBRL(a.amount)} acima do pendente ${formatBRL(pend)}.`);
    total += a.amount;
  }

  const isPay = e.entry_type === 'pagar';
  const txId = insertTransaction(db, user, {
    account_id: Number(s.account_id),
    type: isPay ? 'pagamento' : 'recebimento',
    direction: isPay ? -1 : 1,
    amount: total,
    date: s.date || todayISO(),
    description: `${isPay ? 'Pagamento' : 'Recebimento'} ${e.entry_number} — ${e.party_name}${s.notes ? ` (${text(s.notes, 120)})` : ''}`,
    method: text(s.method, 40),
    source_type: 'financial_entry',
    source_id: String(e.id),
    idempotency_key: text(s.idempotency_key, 100),
  });
  const ins = db.prepare('INSERT INTO financial_allocations (transaction_id, installment_id, amount) VALUES (?, ?, ?)');
  for (const a of allocs) {
    const i = insts.find((x) => x.id === a.installment_id)!;
    const settled = i.settled_amount + a.amount;
    ins.run(txId, i.id, a.amount);
    db.prepare(`UPDATE financial_installments SET settled_amount = ?, status = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`).run(settled, installmentStatus(updatedAmount(i), settled), i.id);
  }
  db.prepare(`UPDATE financial_entries SET row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`).run(e.id);
  audit(db, 'financial_entry', e.id, isPay ? 'pagamento' : 'recebimento', user?.id ?? null, { transacao: txId, total, parcelas: allocs.length });
  return txId;
}

export function settle(db: DB, user: AuthUser, s: SettleInput) {
  if (!financeCan.operate(user)) throw forbidden();
  const existing = findByIdempotency(db, 'financial_transactions', s.idempotency_key);
  if (existing) return { transaction_id: existing, duplicate: true };
  try {
    const id = transaction(db, () => settleInTx(db, user, s));
    return { transaction_id: id, duplicate: false };
  } catch (e: any) {
    // corrida: duas requisições iguais ao mesmo tempo → a segunda bate no índice único
    if (String(e?.message).includes('idempotency_key')) {
      const id = findByIdempotency(db, 'financial_transactions', s.idempotency_key);
      if (id) return { transaction_id: id, duplicate: true };
    }
    throw e;
  }
}

/** Estorno de pagamento/recebimento ou ajuste de caixa (transferências têm estorno próprio). */
export function reverseTransaction(db: DB, user: AuthUser, txId: number, reason: unknown) {
  if (!financeCan.reverse(user)) throw forbidden('Estornos são autorizados pelo administrador financeiro.');
  const why = text(reason, 500);
  if (!why) throw badRequest('Informe o motivo do estorno.', { reason: 'Obrigatório.' });
  return transaction(db, () => {
    const t = db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(txId) as any;
    if (!t) throw notFound('Movimentação não encontrada.');
    if (t.status !== 'efetivada') throw new HttpError(422, 'Somente movimentações efetivadas podem ser estornadas.');
    if (t.reversal_of_id) throw new HttpError(422, 'Um estorno não pode ser estornado. Lance uma nova operação.');
    if (db.prepare('SELECT 1 FROM financial_transactions WHERE reversal_of_id = ?').get(txId)) throw conflict('Esta movimentação já foi estornada.');
    if (t.transaction_type.startsWith('transferencia')) throw new HttpError(422, 'Transferências são estornadas pela tela de Transferências (as duas pontas juntas).');
    const revId = insertTransaction(db, user, {
      account_id: t.account_id,
      type: 'estorno',
      direction: (t.direction * -1) as 1 | -1,
      amount: t.amount,
      date: todayISO(),
      description: `Estorno de ${t.transaction_number}: ${why}`,
      source_type: t.source_type,
      source_id: t.source_id,
      reversal_of_id: t.id,
      allowNegative: true,
    });
    const allocs = db.prepare('SELECT * FROM financial_allocations WHERE transaction_id = ?').all(txId) as any[];
    for (const a of allocs) {
      const i = db.prepare('SELECT * FROM financial_installments WHERE id = ?').get(a.installment_id) as any;
      const settled = i.settled_amount - a.amount;
      db.prepare('INSERT INTO financial_allocations (transaction_id, installment_id, amount) VALUES (?, ?, ?)').run(revId, i.id, -a.amount);
      db.prepare(`UPDATE financial_installments SET settled_amount = ?, status = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`).run(settled, installmentStatus(updatedAmount(i), settled), i.id);
      audit(db, 'financial_entry', i.entry_id, 'estorno', user.id, { transacao: t.transaction_number, valor: a.amount, motivo: why });
    }
    // estorno desfaz a conciliação da movimentação original (o extrato volta a "não conciliado")
    if (t.statement_item_id) {
      db.prepare("UPDATE financial_statement_items SET status = 'pendente', matched_transaction_id = NULL, note = COALESCE(note || ' | ', '') || 'Movimentação estornada' WHERE id = ?").run(t.statement_item_id);
      db.prepare('UPDATE financial_transactions SET statement_item_id = NULL WHERE id = ?').run(txId);
    }
    audit(db, 'financial_transaction', txId, 'estorno', user.id, { estorno: revId, motivo: why });
    return revId;
  });
}

export function listTransactions(db: DB, f: Record<string, string | undefined>) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.account_id) {
    where.push('t.account_id = ?');
    params.push(Number(f.account_id));
  }
  if (f.type) {
    where.push('t.transaction_type = ?');
    params.push(f.type);
  }
  if (f.status) {
    where.push('t.status = ?');
    params.push(f.status);
  }
  if (f.from) {
    where.push('t.transaction_date >= ?');
    params.push(f.from);
  }
  if (f.to) {
    where.push('t.transaction_date <= ?');
    params.push(f.to);
  }
  if (f.reconciled === '1') where.push('t.statement_item_id IS NOT NULL');
  if (f.reconciled === '0') where.push("t.statement_item_id IS NULL AND t.status = 'efetivada'");
  if (f.q?.trim()) {
    where.push('(t.transaction_number LIKE ? OR t.description LIKE ?)');
    params.push(`%${f.q.trim()}%`, `%${f.q.trim()}%`);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) n FROM financial_transactions t ${w}`).get(...params) as { n: number }).n;
  const pageSize = f.all ? 10000 : Math.min(Math.max(Number(f.page_size) || 25, 5), 200);
  const page = f.all ? 1 : Math.max(Number(f.page) || 1, 1);
  const rows = db.prepare(`${TX_SELECT} ${w} ORDER BY t.transaction_date DESC, t.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as any[];
  // saldo após cada movimentação (somente com filtro de conta: o saldo é por conta)
  if (f.account_id) {
    const acc = db.prepare('SELECT opening_balance, opening_balance_date FROM financial_accounts WHERE id = ?').get(Number(f.account_id)) as any;
    for (const r of rows) {
      if (r.status !== 'efetivada') {
        r.balance_after = null;
        continue;
      }
      const s = db
        .prepare("SELECT COALESCE(SUM(direction * amount),0) s FROM financial_transactions WHERE account_id = ? AND status = 'efetivada' AND (transaction_date < ? OR (transaction_date = ? AND id <= ?))")
        .get(r.account_id, r.transaction_date, r.transaction_date, r.id) as { s: number };
      r.balance_after = (acc.opening_balance_date <= r.transaction_date ? acc.opening_balance : 0) + s.s;
    }
  }
  return { total, page, page_size: pageSize, rows: rows.map((r) => ({ ...r, reconciled: !!r.reconciled })) };
}

/** Comprovante de recebimento (PDF) de uma movimentação de recebimento. */
export function receiptPdf(db: DB, txId: number, company: ModuleSettings['company']): Promise<Buffer> {
  const t = db.prepare(`${TX_SELECT} WHERE t.id = ?`).get(txId) as any;
  if (!t) throw notFound('Movimentação não encontrada.');
  if (t.transaction_type !== 'recebimento') throw badRequest('Comprovante disponível apenas para recebimentos.');
  const items = db
    .prepare(
      `SELECT e.entry_number, e.description, e.party_name, e.party_document, i.number, i.due_date, al.amount
       FROM financial_allocations al JOIN financial_installments i ON i.id = al.installment_id JOIN financial_entries e ON e.id = i.entry_id WHERE al.transaction_id = ?`
    )
    .all(txId) as any[];
  const reversed = !!db.prepare('SELECT 1 FROM financial_transactions WHERE reversal_of_id = ?').get(txId);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', layout: 'landscape', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const W = doc.page.width - 72;
    const logoW = drawLogo(doc, company, 36, 36, [70, 43]);
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#1e3a5f').text(company.name, 36 + logoW, 36, { width: W - logoW });
    doc.font('Helvetica').fontSize(8).fillColor('#4b5563').text([company.legal_name, company.document && `CNPJ ${company.document}`, company.address].filter(Boolean).join(' • '), { width: W - logoW });
    doc.x = 36;
    doc.y = Math.max(doc.y, logoW ? 79 : 0);
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#111827').text('COMPROVANTE DE RECEBIMENTO', { align: 'center', width: W });
    doc.font('Helvetica').fontSize(9).fillColor('#4b5563').text(`${t.transaction_number} • ${formatDateBR(t.transaction_date)}`, { align: 'center', width: W });
    if (reversed) doc.font('Helvetica-Bold').fontSize(10).fillColor('#b91c1c').text('ESTORNADO — SEM VALIDADE', { align: 'center', width: W });
    doc.moveDown(1);
    const first = items[0];
    doc.font('Helvetica').fontSize(10).fillColor('#111827').text(
      `Recebemos de ${first?.party_name || '—'}${first?.party_document ? ` (${formatDocument(first.party_document)})` : ''} a importância de ${formatBRL(t.amount)}, referente a:`,
      { width: W }
    );
    doc.moveDown(0.5);
    for (const it of items) doc.fontSize(9).text(`• ${it.entry_number} — ${it.description} — parcela ${it.number} (venc. ${formatDateBR(it.due_date)}): ${formatBRL(it.amount)}`, { width: W });
    doc.moveDown(0.6);
    doc.fontSize(9).fillColor('#4b5563').text(`Forma: ${t.method || '—'} • Conta: ${t.account_name} • Registrado por ${t.performed_by_name}`, { width: W });
    const y = doc.page.height - 80;
    doc.moveTo(doc.page.width / 2 - 120, y).lineTo(doc.page.width / 2 + 120, y).strokeColor('#6b7280').stroke();
    doc.fontSize(8).fillColor('#4b5563').text(company.name, 36, y + 4, { width: W, align: 'center' });
    doc.end();
  });
}
