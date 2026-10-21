/**
 * Conciliação bancária: importação de extrato (CSV/OFX), sugestões de correspondência e confirmação.
 *
 * - Valor igual NÃO basta: a sugestão pondera data, descrição e referência, na mesma conta.
 * - Conciliar só vincula o item do extrato a uma movimentação já existente — não cria receita/despesa.
 * - "Criar lançamento" (tarifa, rendimento...) cria o título já liquidado E o vincula: um único registro.
 * - Conciliação automática só com a regra ligada e correspondência exata e única (mesma data, valor, alta pontuação).
 */

import crypto from 'node:crypto';
import { DB, audit, transaction } from '../../db';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { StatementItem } from '../../../shared/financeiro/types';
import { financeCan, matchScore, parseStatementCSV, parseStatementOFX } from '../../../shared/financeiro/rules';
import { NOW_SQL, assertAccount, text } from './core';
import { getFinanceSettings } from './registry';
import { insertEntry, normalizeEntry } from './entries';
import { settleInTx } from './settlement';

const fingerprint = (accountId: number, l: { transaction_date: string; amount: number; description: string; external_reference: string | null }) =>
  crypto.createHash('sha1').update([accountId, l.transaction_date, l.amount, l.external_reference || l.description.toLowerCase().replace(/\s+/g, ' ').trim()].join('|')).digest('hex');

export function importStatement(db: DB, user: AuthUser, raw: any) {
  if (!financeCan.operate(user)) throw forbidden();
  const acc = assertAccount(db, raw?.account_id);
  const content = String(raw?.content || '');
  if (!content.trim()) throw badRequest('Arquivo vazio.');
  if (content.length > 3_000_000) throw badRequest('Arquivo muito grande.');
  const fileName = text(raw?.file_name, 120) || 'extrato';
  const isOfx = /\.ofx$/i.test(fileName) || /<OFX>|<STMTTRN>/i.test(content);
  const parsed = isOfx ? parseStatementOFX(content) : parseStatementCSV(content);
  if (!parsed.lines.length) throw badRequest(parsed.errors[0] || 'Nenhuma transação válida encontrada.');
  const auto = getFinanceSettings(db).auto_reconcile_exact;
  return transaction(db, () => {
    const rec = db.prepare('INSERT INTO financial_reconciliations (account_id, file_name, statement_reference, imported_by) VALUES (?, ?, ?, ?) RETURNING id').get(acc.id, fileName, text(raw?.statement_reference, 80), user.id) as { id: number };
    let imported = 0;
    let duplicates = 0;
    let autoMatched = 0;
    const seen = new Set<string>();
    for (const l of parsed.lines) {
      const fp = fingerprint(acc.id, l);
      const dup = seen.has(fp) || !!db.prepare("SELECT 1 FROM financial_statement_items WHERE account_id = ? AND fingerprint = ? AND status != 'duplicado'").get(acc.id, fp);
      seen.add(fp);
      const row = db
        .prepare('INSERT INTO financial_statement_items (reconciliation_id, account_id, transaction_date, description, amount, external_reference, fingerprint, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
        .get(rec.id, acc.id, l.transaction_date, l.description, l.amount, l.external_reference, fp, dup ? 'duplicado' : 'pendente') as { id: number };
      if (dup) {
        duplicates++;
        continue;
      }
      imported++;
      if (auto) {
        const cands = candidates(db, acc.id, { ...l, id: row.id } as any).filter((c) => c.transaction_date === l.transaction_date && c.score >= 90);
        if (cands.length === 1) {
          link(db, user, row.id, cands[0].transaction_id, 'Conciliação automática (regra: mesma data, mesmo valor, correspondência única)');
          autoMatched++;
        }
      }
    }
    audit(db, 'financial_reconciliation', rec.id, 'import', user.id, { fileName, imported, duplicates, autoMatched, ignored: parsed.errors.length });
    return { reconciliation_id: rec.id, imported, duplicates, auto_matched: autoMatched, warnings: parsed.errors.slice(0, 20) };
  });
}

function candidates(db: DB, accountId: number, st: { id?: number; transaction_date: string; amount: number; description: string; external_reference: string | null }) {
  const rows = db
    .prepare(
      `SELECT id, transaction_number, transaction_date, description, direction * amount AS amount FROM financial_transactions
       WHERE account_id = ? AND status = 'efetivada' AND statement_item_id IS NULL AND direction * amount = ?
         AND transaction_date BETWEEN date(?, '-5 days') AND date(?, '+5 days')`
    )
    .all(accountId, st.amount, st.transaction_date, st.transaction_date) as any[];
  return rows
    .map((t) => ({ transaction_id: t.id, transaction_number: t.transaction_number, transaction_date: t.transaction_date, description: t.description, amount: t.amount, score: matchScore(st, t) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export function listStatementItems(db: DB, f: Record<string, string | undefined>): { rows: StatementItem[]; summary: any } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.account_id) {
    where.push('s.account_id = ?');
    params.push(Number(f.account_id));
  }
  if (f.status) {
    where.push('s.status = ?');
    params.push(f.status);
  }
  if (f.reconciliation_id) {
    where.push('s.reconciliation_id = ?');
    params.push(Number(f.reconciliation_id));
  }
  if (f.from) {
    where.push('s.transaction_date >= ?');
    params.push(f.from);
  }
  if (f.to) {
    where.push('s.transaction_date <= ?');
    params.push(f.to);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT s.*, t.transaction_number AS matched_transaction_number FROM financial_statement_items s LEFT JOIN financial_transactions t ON t.id = s.matched_transaction_id ${w} ORDER BY s.transaction_date DESC, s.id DESC LIMIT 500`)
    .all(...params) as any[];
  for (const r of rows) if (r.status === 'pendente') r.suggestions = candidates(db, r.account_id, r);
  const summary = db
    .prepare(`SELECT status, COUNT(*) n, COALESCE(SUM(amount),0) total FROM financial_statement_items s ${w} GROUP BY status`)
    .all(...params);
  return { rows, summary };
}

function link(db: DB, user: AuthUser, itemId: number, txId: number, note?: string) {
  const it = db.prepare('SELECT * FROM financial_statement_items WHERE id = ?').get(itemId) as any;
  if (!it) throw notFound('Item do extrato não encontrado.');
  if (it.status === 'conciliado') throw conflict('Este item já está conciliado.');
  if (it.status === 'duplicado') throw new HttpError(422, 'Item marcado como duplicado no extrato.');
  const t = db.prepare('SELECT * FROM financial_transactions WHERE id = ?').get(txId) as any;
  if (!t) throw notFound('Movimentação não encontrada.');
  if (t.account_id !== it.account_id) throw new HttpError(422, 'A movimentação é de outra conta.');
  if (t.status !== 'efetivada') throw new HttpError(422, 'A movimentação ainda não foi efetivada.');
  if (t.statement_item_id) throw conflict('A movimentação já está conciliada com outro item do extrato.');
  if (t.direction * t.amount !== it.amount) throw new HttpError(422, 'Valores diferentes: registre como divergência ou ajuste o lançamento antes de conciliar.');
  db.prepare(`UPDATE financial_statement_items SET status = 'conciliado', matched_transaction_id = ?, matched_by = ?, matched_at = ${NOW_SQL}, note = COALESCE(?, note) WHERE id = ?`).run(txId, user.id, note ?? null, itemId);
  db.prepare('UPDATE financial_transactions SET statement_item_id = ? WHERE id = ?').run(itemId, txId);
  audit(db, 'financial_statement_item', itemId, 'conciliar', user.id, { transaction: t.transaction_number, note });
}

export function statementAction(db: DB, user: AuthUser, itemId: number, action: string, raw: any) {
  if (!financeCan.operate(user)) throw forbidden();
  transaction(db, () => {
    const it = db.prepare('SELECT * FROM financial_statement_items WHERE id = ?').get(itemId) as any;
    if (!it) throw notFound('Item do extrato não encontrado.');
    if (action === 'conciliar') link(db, user, itemId, Number(raw?.transaction_id), text(raw?.note, 300) ?? undefined);
    else if (action === 'desfazer') {
      if (it.status !== 'conciliado') throw new HttpError(422, 'Item não está conciliado.');
      db.prepare('UPDATE financial_transactions SET statement_item_id = NULL WHERE id = ?').run(it.matched_transaction_id);
      db.prepare("UPDATE financial_statement_items SET status = 'pendente', matched_transaction_id = NULL, matched_by = NULL, matched_at = NULL WHERE id = ?").run(itemId);
    } else if (action === 'divergente' || action === 'ignorar') {
      const note = text(raw?.note, 500);
      if (!note) throw badRequest('Descreva o motivo.', { note: 'Obrigatório.' });
      if (it.status === 'conciliado') throw new HttpError(422, 'Desfaça a conciliação antes.');
      db.prepare('UPDATE financial_statement_items SET status = ?, note = ? WHERE id = ?').run(action === 'divergente' ? 'divergente' : 'ignorado', note, itemId);
    } else if (action === 'reabrir') {
      if (!['divergente', 'ignorado', 'duplicado'].includes(it.status)) throw new HttpError(422, 'Item não pode ser reaberto.');
      db.prepare("UPDATE financial_statement_items SET status = 'pendente' WHERE id = ?").run(itemId);
    } else if (action === 'criar_lancamento') {
      // ex.: tarifa bancária ou rendimento que só apareceu no extrato
      if (it.status !== 'pendente') throw new HttpError(422, 'Somente itens não conciliados.');
      const type = it.amount < 0 ? 'pagar' : 'receber';
      const e = normalizeEntry(
        db,
        {
          description: text(raw?.description, 200) || it.description,
          party_type: 'outro',
          party_name: text(raw?.party_name, 200) || 'Banco / extrato',
          category_id: raw?.category_id,
          cost_centers: raw?.cost_center_id ? [{ cost_center_id: raw.cost_center_id, amount: Math.abs(it.amount) }] : [],
          issue_date: it.transaction_date,
          competence_date: it.transaction_date,
          plan: { total: Math.abs(it.amount), count: 1, first_due: it.transaction_date },
          source_type: 'extrato',
          source_id: String(it.id),
          source_ref: `Extrato: ${it.description}`,
          origin: 'outras',
        },
        type
      );
      const entryId = insertEntry(db, user, e);
      db.prepare("UPDATE financial_entries SET status = 'ativo' WHERE id = ?").run(entryId); // já ocorreu no banco: não passa por alçada
      const txId = settleInTx(db, user, { entry_id: entryId, account_id: it.account_id, date: it.transaction_date, amount: Math.abs(it.amount), method: 'Débito/crédito em conta' });
      link(db, user, itemId, txId, 'Lançamento criado a partir do extrato');
    } else throw badRequest('Ação inválida.');
    if (action !== 'conciliar') audit(db, 'financial_statement_item', itemId, action, user.id, { note: raw?.note });
  });
}

export function listImports(db: DB) {
  return {
    rows: db
      .prepare(
        `SELECT r.*, a.name AS account_name, COALESCE(u.name,'Sistema') AS imported_by_name,
          (SELECT COUNT(*) FROM financial_statement_items s WHERE s.reconciliation_id = r.id) items,
          (SELECT COUNT(*) FROM financial_statement_items s WHERE s.reconciliation_id = r.id AND s.status = 'conciliado') matched,
          (SELECT COUNT(*) FROM financial_statement_items s WHERE s.reconciliation_id = r.id AND s.status = 'pendente') pending
         FROM financial_reconciliations r JOIN financial_accounts a ON a.id = r.account_id LEFT JOIN users u ON u.id = r.imported_by ORDER BY r.id DESC LIMIT 100`
      )
      .all(),
  };
}
