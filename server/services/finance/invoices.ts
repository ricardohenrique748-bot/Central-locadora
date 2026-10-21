/**
 * Faturas de locação: cobranças dos contratos de locação, com a situação lida do título no Financeiro.
 * Só leitura; o PDF da fatura e o da medição são gerados pelo módulo de Contratos.
 */

import { DB } from '../../db';
import { todayISO } from '../../../shared/orcamentos/dates';

const DISPLAY = `CASE
  WHEN ch.status = 'cancelado' OR e.status = 'cancelado' OR i.status = 'cancelado' THEN 'cancelado'
  WHEN e.id IS NULL THEN 'previsto'
  WHEN i.status = 'liquidado' THEN 'pago'
  WHEN i.status = 'parcial' THEN 'parcial'
  WHEN i.due_date < @today THEN 'vencido'
  ELSE 'em_aberto' END`;

const SELECT = `
  SELECT ch.id, ch.contract_id, ch.kind, ch.description, ch.period_start, ch.period_end, ch.financial_entry_id,
    c.contract_number, c.customer_id, json_extract(c.customer_snapshot, '$.name') AS customer_name,
    e.entry_number, COALESCE(i.due_date, ch.due_date) AS due_date,
    COALESCE(i.original_amount - i.discount + i.interest + i.penalty + i.additional, ch.amount) AS updated_amount,
    COALESCE(i.settled_amount, 0) AS settled_amount,
    ${DISPLAY} AS display_status,
    ch.kind IN ('periodo','unico') AS measurable
  FROM contract_charges ch
  JOIN contracts c ON c.id = ch.contract_id
  LEFT JOIN financial_entries e ON e.id = ch.financial_entry_id
  LEFT JOIN financial_installments i ON i.id = (SELECT id FROM financial_installments WHERE entry_id = e.id ORDER BY number LIMIT 1)
  WHERE c.contract_type = 'locacao'`;

export function listRentalInvoices(db: DB, f: Record<string, string | undefined>) {
  const where: string[] = [];
  const p: Record<string, string | number> = { today: todayISO() };
  if (f.q?.trim()) {
    where.push('(contract_number LIKE @q OR customer_name LIKE @q OR entry_number LIKE @q OR description LIKE @q)');
    p.q = `%${f.q.trim()}%`;
  }
  if (f.status === 'pendente') where.push("display_status IN ('em_aberto','vencido','parcial')");
  else if (f.status) {
    where.push('display_status = @status');
    p.status = f.status;
  }
  if (f.kind === 'medicao') where.push('measurable = 1');
  else if (f.kind === 'outras') where.push('measurable = 0');
  for (const [k, sql] of [['due_from', 'due_date >= @due_from'], ['due_to', 'due_date <= @due_to'], ['period_from', 'period_end >= @period_from'], ['period_to', 'period_start <= @period_to']] as const) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(f[k] || '')) {
      where.push(sql);
      p[k] = f[k]!;
    }
  }
  if (f.contract_id) {
    where.push('contract_id = @contract_id');
    p.contract_id = Number(f.contract_id);
  }
  const base = `SELECT * FROM (${SELECT}) ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`;
  const total = (db.prepare(`SELECT COUNT(*) n FROM (${base})`).get(p) as { n: number }).n;
  const totals = db
    .prepare(`SELECT COALESCE(SUM(updated_amount), 0) AS updated, COALESCE(SUM(settled_amount), 0) AS settled FROM (${base}) WHERE display_status NOT IN ('cancelado','previsto')`)
    .get(p) as { updated: number; settled: number };
  const pageSize = f.all ? 10000 : Math.min(Math.max(Number(f.page_size) || 25, 5), 100);
  const page = f.all ? 1 : Math.max(Number(f.page) || 1, 1);
  const rows = (db.prepare(`${base} ORDER BY due_date DESC, id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`).all(p) as any[]).map((r) => ({ ...r, measurable: !!r.measurable }));
  return { total, page_size: pageSize, rows, totals: { ...totals, pending: Math.max(0, totals.updated - totals.settled) } };
}
