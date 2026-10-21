/**
 * Painel, fluxo de caixa, DRE gerencial, inadimplência e relatórios financeiros.
 *
 * Metodologia (exibida também nas telas):
 * - REALIZADO (regime de caixa): alocações de pagamentos/recebimentos pela DATA DA MOVIMENTAÇÃO.
 *   Estornos entram com sinal negativo. Transferências e ajustes de caixa não são receita nem despesa.
 * - SALDO: saldo inicial + movimentações efetivadas (inclui transferências e ajustes, que mudam o caixa).
 * - EM ABERTO / VENCIDO: saldo pendente das parcelas (atualizado − liquidado) de títulos ativos; nunca somado ao saldo.
 * - PROJETADO: saldo atual + pendentes com vencimento de hoje até a data-limite. Vencidos ficam à parte (risco).
 * - DRE (competência): valor atualizado das parcelas não canceladas pela DATA DE COMPETÊNCIA do título.
 *   "Investimento" (compra de patrimônio) fica fora do resultado. Relatório gerencial, não contábil.
 * - Centro de custo: com rateio, o valor é proporcional à parte de cada centro no título.
 */

import { DB } from '../../db';
import { addDaysISO, daysBetween, isISODate, todayISO } from '../../../shared/orcamentos/dates';
import { DreGroup } from '../../../shared/financeiro/types';
import { listAccounts } from './registry';

const REVENUE_GROUPS = ['receita_venda', 'receita_locacao', 'receita_servico', 'outras_receitas'];

/** Fator do centro de custo (1 sem filtro; proporção do rateio com filtro). */
function ccFactor(cc?: string) {
  return cc ? `COALESCE((SELECT x.amount * 1.0 / e.original_amount FROM financial_entry_cost_centers x WHERE x.entry_id = e.id AND x.cost_center_id = ${Number(cc)}), 0)` : '1';
}

function filters(f: Record<string, string | undefined>) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.category_id) {
    where.push('(e.category_id = ? OR c.parent_id = ?)');
    params.push(Number(f.category_id), Number(f.category_id));
  }
  if (f.cost_center_id) where.push(`EXISTS (SELECT 1 FROM financial_entry_cost_centers x WHERE x.entry_id = e.id AND x.cost_center_id = ${Number(f.cost_center_id)})`);
  return { where, params };
}

/** Realizado por título (alocações) no período, por data da movimentação. */
function realized(db: DB, f: Record<string, string | undefined>, from: string, to: string, groupBy: string) {
  const { where, params } = filters(f);
  if (f.account_id) {
    where.push('t.account_id = ?');
    params.push(Number(f.account_id));
  }
  const w = where.length ? `AND ${where.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT ${groupBy} AS k, e.entry_type, COALESCE(SUM(al.amount * ${ccFactor(f.cost_center_id)}), 0) AS v
       FROM financial_allocations al JOIN financial_transactions t ON t.id = al.transaction_id
       JOIN financial_installments i ON i.id = al.installment_id JOIN financial_entries e ON e.id = i.entry_id JOIN financial_categories c ON c.id = e.category_id
       WHERE t.status = 'efetivada' AND t.transaction_date BETWEEN ? AND ? ${w}
       GROUP BY k, e.entry_type`
    )
    .all(from, to, ...params) as { k: string; entry_type: 'pagar' | 'receber'; v: number }[];
}

/** Pendências (saldo das parcelas) por vencimento. */
function pendingQuery(db: DB, f: Record<string, string | undefined>, cond: string, condParams: (string | number)[], groupBy = "'x'") {
  const { where, params } = filters(f);
  const w = where.length ? `AND ${where.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT ${groupBy} AS k, e.entry_type, COALESCE(SUM((i.original_amount - i.discount + i.interest + i.penalty + i.additional - i.settled_amount) * ${ccFactor(f.cost_center_id)}), 0) AS v, COUNT(*) n
       FROM financial_installments i JOIN financial_entries e ON e.id = i.entry_id JOIN financial_categories c ON c.id = e.category_id
       WHERE e.status = 'ativo' AND i.status IN ('aberto','parcial') ${cond} ${w}
       GROUP BY k, e.entry_type`
    )
    .all(...condParams, ...params) as { k: string; entry_type: 'pagar' | 'receber'; v: number; n: number }[];
}

const sumType = (rows: { entry_type: string; v: number }[], t: string) => Math.round(rows.filter((r) => r.entry_type === t).reduce((a, r) => a + r.v, 0));

function balanceAt(db: DB, date: string, accountId?: string) {
  const accs = db.prepare(`SELECT id, opening_balance, opening_balance_date FROM financial_accounts ${accountId ? 'WHERE id = ?' : 'WHERE active = 1'}`).all(...(accountId ? [Number(accountId)] : [])) as any[];
  let total = 0;
  for (const a of accs) {
    const s = db.prepare("SELECT COALESCE(SUM(direction * amount),0) s FROM financial_transactions WHERE account_id = ? AND status = 'efetivada' AND transaction_date <= ?").get(a.id, date) as { s: number };
    total += (a.opening_balance_date <= date ? a.opening_balance : 0) + s.s;
  }
  return total;
}

function buckets(from: string, to: string) {
  const span = daysBetween(from, to);
  const g = span <= 45 ? 'dia' : 'mes';
  const keys: string[] = [];
  if (g === 'dia') for (let d = from; d <= to && keys.length < 400; d = addDaysISO(d, 1)) keys.push(d);
  else {
    let [y, m] = from.slice(0, 7).split('-').map(Number);
    for (let i = 0; i < 120; i++) {
      const k = `${y}-${String(m).padStart(2, '0')}`;
      keys.push(k);
      if (k >= to.slice(0, 7)) break;
      m = m === 12 ? 1 : m + 1;
      if (m === 1) y++;
    }
  }
  return { g, keys, expr: (col: string) => (g === 'dia' ? col : `substr(${col}, 1, 7)`) };
}

export function financeDashboard(db: DB, f: Record<string, string | undefined>) {
  const today = todayISO();
  const from = isISODate(f.from) ? f.from! : `${today.slice(0, 8)}01`;
  const to = isISODate(f.to) ? f.to! : today;
  const opening = balanceAt(db, addDaysISO(from, -1), f.account_id);
  const current = balanceAt(db, today, f.account_id);
  const real = realized(db, f, from, to, 'c.dre_group');
  const income = sumType(real, 'receber');
  const expense = sumType(real, 'pagar');
  const byGroup = (g: DreGroup[]) => Math.round(real.filter((r) => g.includes(r.k as DreGroup)).reduce((a, r) => a + r.v, 0));

  const openAll = pendingQuery(db, f, '', []);
  const overdue = pendingQuery(db, f, 'AND i.due_date < ?', [today]);
  const forecast = pendingQuery(db, f, 'AND i.due_date BETWEEN ? AND ?', [from > today ? from : today, to]);
  const proj = (days: number) => {
    const p = pendingQuery(db, f, 'AND i.due_date BETWEEN ? AND ?', [today, addDaysISO(today, days)]);
    return current + sumType(p, 'receber') - sumType(p, 'pagar');
  };

  // séries
  const b = buckets(from, to);
  const realSeries = realized(db, f, from, to, b.expr('t.transaction_date'));
  const series = b.keys.map((k) => ({ bucket: k, receitas: Math.round(realSeries.filter((r) => r.k === k && r.entry_type === 'receber').reduce((a, r) => a + r.v, 0)), despesas: Math.round(realSeries.filter((r) => r.k === k && r.entry_type === 'pagar').reduce((a, r) => a + r.v, 0)) }));
  const balanceSeries = b.keys.map((k) => ({ bucket: k, saldo: balanceAt(db, b.g === 'dia' ? k : monthEnd(k) > today ? today : monthEnd(k), f.account_id) }));

  // realizado (passado) × projetado (próximos 30 dias), por semana
  const flowWeeks: { label: string; realizado: number | null; projetado: number | null }[] = [];
  for (let i = -4; i < 5; i++) {
    const s = addDaysISO(today, i * 7);
    const e = addDaysISO(s, 6);
    if (i < 0) {
      const r = realized(db, f, s, e, "'x'");
      flowWeeks.push({ label: s, realizado: sumType(r, 'receber') - sumType(r, 'pagar'), projetado: null });
    } else {
      const p = pendingQuery(db, f, 'AND i.due_date BETWEEN ? AND ?', [s, e]);
      flowWeeks.push({ label: s, realizado: null, projetado: sumType(p, 'receber') - sumType(p, 'pagar') });
    }
  }

  const expByCat = realized(db, f, from, to, 'COALESCE((SELECT p.name FROM financial_categories p WHERE p.id = c.parent_id), c.name)').filter((r) => r.entry_type === 'pagar').map((r) => ({ label: r.k, value: Math.round(r.v) })).sort((a, b2) => b2.value - a.value);
  const revByOrigin = realized(db, f, from, to, "COALESCE(e.origin, 'outras')").filter((r) => r.entry_type === 'receber').map((r) => ({ label: r.k, value: Math.round(r.v) })).sort((a, b2) => b2.value - a.value);

  // inadimplência ao fim de cada mês (últimos 6): parcelas a receber vencidas até a data e não liquidadas naquela data
  const delinquency: { bucket: string; value: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const m = addMonthsSimple(today.slice(0, 7), -i);
    const end = i === 0 ? today : monthEnd(m);
    const v = db
      .prepare(
        `SELECT COALESCE(SUM(i.original_amount - i.discount + i.interest + i.penalty + i.additional
            - COALESCE((SELECT SUM(al.amount) FROM financial_allocations al JOIN financial_transactions t ON t.id = al.transaction_id WHERE al.installment_id = i.id AND t.transaction_date <= ?), 0)), 0) v
         FROM financial_installments i JOIN financial_entries e ON e.id = i.entry_id
         WHERE e.entry_type = 'receber' AND e.status = 'ativo' AND i.status != 'cancelado' AND i.due_date < ? AND e.created_at <= ?`
      )
      .get(end, end, end + 'T23:59:59Z') as { v: number };
    delinquency.push({ bucket: m, value: Math.max(0, Math.round(v.v)) });
  }

  return {
    period: { from, to, granularity: b.g },
    kpis: {
      saldo_inicial: opening,
      saldo_atual: current,
      receitas_realizadas: income,
      despesas_realizadas: expense,
      resultado: income - expense,
      a_receber_aberto: sumType(openAll, 'receber'),
      a_pagar_aberto: sumType(openAll, 'pagar'),
      vencido_receber: sumType(overdue, 'receber'),
      vencido_pagar: sumType(overdue, 'pagar'),
      recebimentos_previstos: sumType(forecast, 'receber'),
      pagamentos_previstos: sumType(forecast, 'pagar'),
      projetado_7: proj(7),
      projetado_15: proj(15),
      projetado_30: proj(30),
      receitas_vendas: byGroup(['receita_venda']),
      receitas_locacao: byGroup(['receita_locacao']),
      despesas_operacionais: byGroup(['custo_operacional', 'despesa_operacional', 'despesa_administrativa']),
      despesas_compras_estoque: byGroup(['compra_estoque', 'investimento']),
    },
    series,
    balanceSeries,
    flowWeeks,
    expByCat,
    revByOrigin,
    delinquency,
    accounts: listAccounts(db).filter((a) => a.active),
  };
}

function monthEnd(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}
function addMonthsSimple(ym: string, n: number) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** Fluxo de caixa realizado (com saldos) e projetado (pendências por vencimento). */
export function cashFlow(db: DB, f: Record<string, string | undefined>) {
  const today = todayISO();
  const mode = f.mode === 'projetado' ? 'projetado' : 'realizado';
  if (mode === 'realizado') {
    const from = isISODate(f.from) ? f.from! : addDaysISO(today, -29);
    const to = isISODate(f.to) ? f.to! : today;
    const b = buckets(from, to);
    // entradas/saídas operacionais (títulos) + demais movimentações (transferências, ajustes) separadas
    const ops = realized(db, f, from, to, b.expr('t.transaction_date'));
    const otherWhere = f.account_id ? 'AND account_id = ?' : '';
    const other = f.category_id || f.cost_center_id
      ? []
      : (db
          .prepare(
            `SELECT ${b.expr('transaction_date')} k, COALESCE(SUM(CASE WHEN direction = 1 THEN amount END),0) inn, COALESCE(SUM(CASE WHEN direction = -1 THEN amount END),0) outt
             FROM financial_transactions WHERE status = 'efetivada' AND transaction_type IN ('transferencia_saida','transferencia_entrada','ajuste_caixa')
               AND (reversal_of_id IS NULL) AND transaction_date BETWEEN ? AND ? ${otherWhere} GROUP BY k`
          )
          .all(from, to, ...(f.account_id ? [Number(f.account_id)] : [])) as any[]);
    let bal = f.category_id || f.cost_center_id ? 0 : balanceAt(db, addDaysISO(from, -1), f.account_id);
    const rows = b.keys.map((k) => {
      const inn = Math.round(ops.filter((r) => r.k === k && r.entry_type === 'receber').reduce((a, r) => a + r.v, 0));
      const out = Math.round(ops.filter((r) => r.k === k && r.entry_type === 'pagar').reduce((a, r) => a + r.v, 0));
      const o = other.find((x) => x.k === k);
      const start = bal;
      bal = start + inn - out + (o ? o.inn - o.outt : 0);
      return { bucket: k, saldo_inicial: start, entradas: inn, saidas: out, outras_entradas: o?.inn || 0, outras_saidas: o?.outt || 0, saldo_final: bal };
    });
    return { mode, from, to, granularity: b.g, rows, filtered_by_category: !!(f.category_id || f.cost_center_id) };
  }
  const days = [7, 15, 30, 60, 90].includes(Number(f.horizon)) ? Number(f.horizon) : 30;
  const to = addDaysISO(today, days);
  const group = days <= 30 ? 'i.due_date' : "strftime('%Y-%W', i.due_date)";
  const pend = pendingQuery(db, f, 'AND i.due_date BETWEEN ? AND ?', [today, to], group);
  const overdue = pendingQuery(db, f, 'AND i.due_date < ?', [today]);
  let bal = f.category_id || f.cost_center_id ? 0 : balanceAt(db, today, f.account_id);
  const keys = [...new Set(pend.map((p) => p.k))].sort();
  const rows = keys.map((k) => {
    const inn = Math.round(pend.filter((p) => p.k === k && p.entry_type === 'receber').reduce((a, r) => a + r.v, 0));
    const out = Math.round(pend.filter((p) => p.k === k && p.entry_type === 'pagar').reduce((a, r) => a + r.v, 0));
    const start = bal;
    bal = start + inn - out;
    return { bucket: k, saldo_inicial: start, entradas: inn, saidas: out, saldo_final: bal };
  });
  return {
    mode,
    horizon: days,
    from: today,
    to,
    granularity: days <= 30 ? 'dia' : 'semana',
    rows,
    overdue: { receber: sumType(overdue, 'receber'), pagar: sumType(overdue, 'pagar') },
    min_balance: rows.length ? Math.min(...rows.map((r) => r.saldo_final)) : bal,
    filtered_by_category: !!(f.category_id || f.cost_center_id),
  };
}

/** DRE gerencial. Competência (padrão) ou caixa. Investimento em patrimônio fora do resultado. */
export function dre(db: DB, f: Record<string, string | undefined>) {
  const today = todayISO();
  const from = isISODate(f.from) ? f.from! : `${today.slice(0, 4)}-01-01`;
  const to = isISODate(f.to) ? f.to! : today;
  const regime = f.regime === 'caixa' ? 'caixa' : 'competencia';
  let rows: { dre_group: string; category: string; v: number }[];
  const cc = ccFactor(f.cost_center_id);
  const ccWhere = f.cost_center_id ? `AND EXISTS (SELECT 1 FROM financial_entry_cost_centers x WHERE x.entry_id = e.id AND x.cost_center_id = ${Number(f.cost_center_id)})` : '';
  if (regime === 'competencia') {
    rows = db
      .prepare(
        `SELECT c.dre_group, c.name AS category, COALESCE(SUM((i.original_amount - i.discount + i.interest + i.penalty + i.additional) * ${cc}),0) v
         FROM financial_installments i JOIN financial_entries e ON e.id = i.entry_id JOIN financial_categories c ON c.id = e.category_id
         WHERE e.status = 'ativo' AND i.status != 'cancelado' AND e.competence_date BETWEEN ? AND ? ${ccWhere}
         GROUP BY c.dre_group, c.name`
      )
      .all(from, to) as any[];
  } else {
    rows = db
      .prepare(
        `SELECT c.dre_group, c.name AS category, COALESCE(SUM(al.amount * ${cc}),0) v
         FROM financial_allocations al JOIN financial_transactions t ON t.id = al.transaction_id JOIN financial_installments i ON i.id = al.installment_id
         JOIN financial_entries e ON e.id = i.entry_id JOIN financial_categories c ON c.id = e.category_id
         WHERE t.status = 'efetivada' AND t.transaction_date BETWEEN ? AND ? ${ccWhere}
         GROUP BY c.dre_group, c.name`
      )
      .all(from, to) as any[];
  }
  const g = (groups: string[]) => Math.round(rows.filter((r) => groups.includes(r.dre_group)).reduce((a, r) => a + r.v, 0));
  const detail = (groups: string[]) => rows.filter((r) => groups.includes(r.dre_group) && Math.round(r.v) !== 0).map((r) => ({ category: r.category, value: Math.round(r.v) }));
  const receita_bruta = g(REVENUE_GROUPS);
  const custos = g(['custo_operacional', 'compra_estoque']);
  const despesas_operacionais = g(['despesa_operacional']);
  const despesas_administrativas = g(['despesa_administrativa']);
  const resultado_operacional = receita_bruta - custos - despesas_operacionais - despesas_administrativas;
  const resultado_financeiro = g(['receita_financeira']) - g(['despesa_financeira']);
  return {
    regime,
    from,
    to,
    lines: [
      { key: 'receita_venda', label: 'Receitas de vendas', value: g(['receita_venda']), detail: detail(['receita_venda']) },
      { key: 'receita_locacao', label: 'Receitas de locação', value: g(['receita_locacao']), detail: detail(['receita_locacao']) },
      { key: 'outras', label: 'Outras receitas (serviços, fretes, multas)', value: g(['receita_servico', 'outras_receitas']), detail: detail(['receita_servico', 'outras_receitas']) },
      { key: 'receita_bruta', label: '= Receita operacional', value: receita_bruta, total: true },
      { key: 'custos', label: '(−) Custos associados às operações', value: -custos, detail: detail(['custo_operacional', 'compra_estoque']) },
      { key: 'desp_op', label: '(−) Despesas operacionais', value: -despesas_operacionais, detail: detail(['despesa_operacional']) },
      { key: 'desp_adm', label: '(−) Despesas administrativas', value: -despesas_administrativas, detail: detail(['despesa_administrativa']) },
      { key: 'res_op', label: '= Resultado operacional gerencial', value: resultado_operacional, total: true },
      { key: 'res_fin', label: '(±) Resultado financeiro', value: resultado_financeiro, detail: [...detail(['receita_financeira']), ...detail(['despesa_financeira']).map((d) => ({ ...d, value: -d.value }))] },
      { key: 'res_final', label: '= Resultado final gerencial', value: resultado_operacional + resultado_financeiro, total: true },
    ],
    investimentos: { value: g(['investimento']), detail: detail(['investimento']) },
  };
}

/** Clientes com recebíveis vencidos, por faixa de atraso. */
export function delinquency(db: DB) {
  const today = todayISO();
  const rows = db
    .prepare(
      `SELECT e.customer_id, e.party_name, MIN(i.due_date) oldest,
         SUM(i.original_amount - i.discount + i.interest + i.penalty + i.additional - i.settled_amount) total, COUNT(*) parcelas,
         SUM(CASE WHEN julianday(?) - julianday(i.due_date) <= 30 THEN i.original_amount - i.discount + i.interest + i.penalty + i.additional - i.settled_amount ELSE 0 END) d30,
         SUM(CASE WHEN julianday(?) - julianday(i.due_date) BETWEEN 31 AND 60 THEN i.original_amount - i.discount + i.interest + i.penalty + i.additional - i.settled_amount ELSE 0 END) d60,
         SUM(CASE WHEN julianday(?) - julianday(i.due_date) BETWEEN 61 AND 90 THEN i.original_amount - i.discount + i.interest + i.penalty + i.additional - i.settled_amount ELSE 0 END) d90,
         SUM(CASE WHEN julianday(?) - julianday(i.due_date) > 90 THEN i.original_amount - i.discount + i.interest + i.penalty + i.additional - i.settled_amount ELSE 0 END) d90p
       FROM financial_installments i JOIN financial_entries e ON e.id = i.entry_id
       WHERE e.entry_type = 'receber' AND e.status = 'ativo' AND i.status IN ('aberto','parcial') AND i.due_date < ?
       GROUP BY COALESCE(e.customer_id, -e.id), e.party_name ORDER BY total DESC`
    )
    .all(today, today, today, today, today) as any[];
  const contacts = (id: number | null) => (id ? (db.prepare('SELECT phone, whatsapp, email FROM customers WHERE id = ?').get(id) as any) : null);
  return rows.map((r) => ({ ...r, days: daysBetween(r.oldest, today), contact: contacts(r.customer_id) }));
}

/** Relatórios tabulares (todos com período explícito). */
export function financeReport(db: DB, kind: string, f: Record<string, string | undefined>) {
  const today = todayISO();
  const from = isISODate(f.from) ? f.from! : `${today.slice(0, 8)}01`;
  const to = isISODate(f.to) ? f.to! : today;
  const inst = `SELECT e.entry_number, e.entry_type, e.party_name, e.description, c.name AS category, i.number, i.due_date,
      i.original_amount - i.discount + i.interest + i.penalty + i.additional AS updated, i.settled_amount,
      i.original_amount - i.discount + i.interest + i.penalty + i.additional - i.settled_amount AS pending, i.status
    FROM financial_installments i JOIN financial_entries e ON e.id = i.entry_id JOIN financial_categories c ON c.id = e.category_id`;
  const realizedBy = (groupExpr: string, type: 'pagar' | 'receber') =>
    db
      .prepare(
        `SELECT ${groupExpr} AS label, COALESCE(SUM(al.amount),0) AS value, COUNT(DISTINCT t.id) AS movimentos
         FROM financial_allocations al JOIN financial_transactions t ON t.id = al.transaction_id JOIN financial_installments i ON i.id = al.installment_id
         JOIN financial_entries e ON e.id = i.entry_id JOIN financial_categories c ON c.id = e.category_id
         WHERE t.status = 'efetivada' AND e.entry_type = ? AND t.transaction_date BETWEEN ? AND ? GROUP BY label ORDER BY value DESC`
      )
      .all(type, from, to);
  const realizedByCC = (type: 'pagar' | 'receber') =>
    db
      .prepare(
        `SELECT COALESCE(cc.code || ' — ' || cc.name, 'Sem centro de custo') AS label,
           COALESCE(SUM(al.amount * COALESCE(x.amount * 1.0 / e.original_amount, 1)),0) AS value
         FROM financial_allocations al JOIN financial_transactions t ON t.id = al.transaction_id JOIN financial_installments i ON i.id = al.installment_id
         JOIN financial_entries e ON e.id = i.entry_id LEFT JOIN financial_entry_cost_centers x ON x.entry_id = e.id LEFT JOIN cost_centers cc ON cc.id = x.cost_center_id
         WHERE t.status = 'efetivada' AND e.entry_type = ? AND t.transaction_date BETWEEN ? AND ? GROUP BY label ORDER BY value DESC`
      )
      .all(type, from, to)
      .map((r: any) => ({ ...r, value: Math.round(r.value) }));
  switch (kind) {
    case 'pagar_periodo':
    case 'receber_periodo':
      return db.prepare(`${inst} WHERE e.entry_type = ? AND e.status = 'ativo' AND i.status != 'cancelado' AND i.due_date BETWEEN ? AND ? ORDER BY i.due_date`).all(kind === 'pagar_periodo' ? 'pagar' : 'receber', from, to);
    case 'vencidas':
      return db.prepare(`${inst} WHERE e.status = 'ativo' AND i.status IN ('aberto','parcial') AND i.due_date < ? ORDER BY i.due_date`).all(today);
    case 'a_vencer':
      return db.prepare(`${inst} WHERE e.status = 'ativo' AND i.status IN ('aberto','parcial') AND i.due_date BETWEEN ? AND ? ORDER BY i.due_date`).all(today, addDaysISO(today, Math.min(Math.max(Number(f.days) || 15, 1), 90)));
    case 'recebimentos_cliente':
      return realizedBy('e.party_name', 'receber');
    case 'pagamentos_fornecedor':
      return realizedBy('e.party_name', 'pagar');
    case 'receitas_categoria':
      return realizedBy('c.name', 'receber');
    case 'despesas_categoria':
      return realizedBy('c.name', 'pagar');
    case 'receitas_cc':
      return realizedByCC('receber');
    case 'despesas_cc':
      return realizedByCC('pagar');
    case 'fluxo_realizado':
      return cashFlow(db, { ...f, mode: 'realizado', from, to }).rows;
    case 'fluxo_projetado':
      return cashFlow(db, { ...f, mode: 'projetado' }).rows;
    case 'movimentacoes_conta':
      return db
        .prepare(
          `SELECT t.transaction_number, t.transaction_date, a.name AS account, t.transaction_type, t.description, t.direction * t.amount AS amount, t.status,
             CASE WHEN t.statement_item_id IS NOT NULL THEN 'sim' ELSE 'não' END AS conciliada
           FROM financial_transactions t JOIN financial_accounts a ON a.id = t.account_id
           WHERE t.transaction_date BETWEEN ? AND ? ${f.account_id ? 'AND t.account_id = ?' : ''} ORDER BY t.transaction_date, t.id`
        )
        .all(from, to, ...(f.account_id ? [Number(f.account_id)] : []));
    case 'transferencias':
      return db
        .prepare(`SELECT t.number, t.transfer_date, s.name AS origem, d.name AS destino, t.amount, t.status, t.reference FROM financial_transfers t JOIN financial_accounts s ON s.id = t.source_account_id JOIN financial_accounts d ON d.id = t.destination_account_id WHERE t.transfer_date BETWEEN ? AND ? ORDER BY t.transfer_date`)
        .all(from, to);
    case 'conciliacao':
      return db
        .prepare(`SELECT s.transaction_date, a.name AS account, s.description, s.amount, s.status, t.transaction_number AS movimentacao, s.note FROM financial_statement_items s JOIN financial_accounts a ON a.id = s.account_id LEFT JOIN financial_transactions t ON t.id = s.matched_transaction_id WHERE s.transaction_date BETWEEN ? AND ? ORDER BY s.transaction_date`)
        .all(from, to);
    case 'inadimplencia':
      return delinquency(db).map((r) => ({ cliente: r.party_name, mais_antigo: r.oldest, dias: r.days, parcelas: r.parcelas, total: r.total, ate_30: r.d30, de_31_60: r.d60, de_61_90: r.d90, acima_90: r.d90p }));
    case 'dre':
      return dre(db, { ...f, from, to }).lines.map((l) => ({ linha: l.label, valor: l.value }));
    case 'historico_venda':
    case 'historico_contrato':
      return db
        .prepare(
          `SELECT e.source_ref AS origem, e.entry_number, e.party_name, i.number, i.due_date, i.original_amount - i.discount + i.interest + i.penalty + i.additional AS updated, i.settled_amount, i.status
           FROM financial_entries e JOIN financial_installments i ON i.entry_id = e.id WHERE e.source_type = ? ${f.q ? 'AND (e.source_ref LIKE ? OR e.party_name LIKE ?)' : ''} ORDER BY e.id DESC, i.number`
        )
        .all(kind === 'historico_venda' ? 'venda' : 'contrato', ...(f.q ? [`%${f.q}%`, `%${f.q}%`] : []));
    default:
      return null;
  }
}
