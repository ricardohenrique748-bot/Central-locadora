/**
 * Painel e relatórios — sempre calculados a partir dos dados gravados, respeitando o escopo do perfil
 * (vendedor só vê os próprios orçamentos).
 *
 * Definições:
 * - Em elaboração: rascunho, em revisão, aguardando aprovação, aprovado internamente (ainda não enviado).
 * - Aguardando resposta: enviado ou em negociação.
 * - Aprovados: aprovado pelo cliente ou convertido. Recusados/cancelados/expirados nunca contam como fechados.
 * - Valor total das propostas: soma dos totais, exceto canceladas.
 * - Taxa de conversão: aprovados ÷ propostas que chegaram a ser enviadas ao cliente,
 *   ambos dentro do MESMO conjunto filtrado (período de criação, modalidade, responsável).
 */

import { DB } from '../db';
import { AuthUser } from '../../shared/orcamentos/types';
import { addDaysISO, daysBetween, isISODate, todayISO } from '../../shared/orcamentos/dates';
import { ListFilters, buildQuotationWhere, sweepExpired } from './quotations';

const ELABORATION = ['rascunho', 'em_revisao', 'aguardando_aprovacao', 'aprovado_interno'];
const AWAITING = ['enviado', 'em_negociacao'];
const WON = ['aprovado_cliente', 'convertido'];
const inList = (l: string[]) => l.map((s) => `'${s}'`).join(',');

export function dashboard(db: DB, user: AuthUser, f: ListFilters, expiringDays: number) {
  sweepExpired(db);
  const { where, params } = buildQuotationWhere(user, f);
  const and = where ? `${where} AND` : 'WHERE';
  const today = todayISO();

  const k = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(status IN (${inList(ELABORATION)})) AS elaboracao,
        SUM(sent_at IS NOT NULL) AS enviados,
        SUM(status IN (${inList(AWAITING)})) AS aguardando,
        SUM(status IN (${inList(WON)})) AS aprovados,
        SUM(status = 'recusado') AS recusados,
        SUM(status = 'expirado') AS expirados,
        SUM(status = 'cancelado') AS cancelados,
        SUM(status = 'aguardando_aprovacao') AS aguardando_aprovacao_interna,
        COALESCE(SUM(CASE WHEN status != 'cancelado' THEN total_amount END), 0) AS valor_total,
        COALESCE(SUM(CASE WHEN status IN (${inList(WON)}) THEN total_amount END), 0) AS valor_aprovado,
        SUM(sent_at IS NOT NULL AND status IN (${inList(WON)})) AS aprovados_enviados
      FROM quotations q ${where}`
    )
    .get(...params) as Record<string, number | null>;
  const n = (v: number | null | undefined) => Number(v || 0);
  const enviados = n(k.enviados);
  const kpis = {
    total: n(k.total),
    elaboracao: n(k.elaboracao),
    enviados,
    aguardando: n(k.aguardando),
    aprovados: n(k.aprovados),
    recusados: n(k.recusados),
    expirados: n(k.expirados),
    cancelados: n(k.cancelados),
    aguardando_aprovacao_interna: n(k.aguardando_aprovacao_interna),
    valor_total: n(k.valor_total),
    valor_aprovado: n(k.valor_aprovado),
    taxa_conversao: enviados > 0 ? n(k.aprovados_enviados) / enviados : null,
    base_conversao: enviados,
  };

  const expiring = db
    .prepare(
      `SELECT q.id, q.quotation_number, json_extract(q.customer_snapshot, '$.name') AS customer_name, q.expiration_date, q.total_amount, q.status
       FROM quotations q ${and} q.status IN ('aprovado_interno','enviado','em_negociacao') AND q.expiration_date BETWEEN ? AND ?
       ORDER BY q.expiration_date LIMIT 20`
    )
    .all(...params, today, addDaysISO(today, expiringDays));

  const byStatus = db.prepare(`SELECT status, COUNT(*) AS count FROM quotations q ${where} GROUP BY status`).all(...params);
  const byType = db
    .prepare(
      `SELECT quotation_type, COUNT(*) AS count, COALESCE(SUM(CASE WHEN status != 'cancelado' THEN total_amount END),0) AS value,
        COALESCE(SUM(CASE WHEN status IN (${inList(WON)}) THEN total_amount END),0) AS won_value
       FROM quotations q ${where} GROUP BY quotation_type`
    )
    .all(...params);

  // Agrupamento: por dia se o período for curto, senão por mês
  const span = isISODate(f.created_from) && isISODate(f.created_to) ? daysBetween(f.created_from, f.created_to) : 9999;
  const bucket = span <= 45 ? "date(q.created_at, '-3 hours')" : "strftime('%Y-%m', q.created_at, '-3 hours')";
  const createdSeries = db
    .prepare(`SELECT ${bucket} AS bucket, COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS value FROM quotations q ${where} GROUP BY bucket ORDER BY bucket`)
    .all(...params);
  // Valores aprovados pela data em que o cliente aprovou
  const approvedBucket = span <= 45 ? "date(h.created_at, '-3 hours')" : "strftime('%Y-%m', h.created_at, '-3 hours')";
  const approvedSeries = db
    .prepare(
      `SELECT ${approvedBucket} AS bucket, COUNT(*) AS count, COALESCE(SUM(q.total_amount),0) AS value
       FROM quotations q JOIN quotation_status_history h ON h.quotation_id = q.id AND h.new_status = 'aprovado_cliente'
       ${and} q.status IN (${inList(WON)})
       GROUP BY bucket ORDER BY bucket`
    )
    .all(...params);

  return { kpis, expiring, byStatus, byType, createdSeries, approvedSeries, granularity: span <= 45 ? 'dia' : 'mes' };
}

export function reports(db: DB, user: AuthUser, f: ListFilters, expiringDays: number) {
  sweepExpired(db);
  const { where, params } = buildQuotationWhere(user, f);
  const and = where ? `${where} AND` : 'WHERE';
  const today = todayISO();
  const groupCols = `COUNT(*) AS count,
    COALESCE(SUM(CASE WHEN status != 'cancelado' THEN total_amount END),0) AS value,
    SUM(status IN (${inList(WON)})) AS won,
    COALESCE(SUM(CASE WHEN status IN (${inList(WON)}) THEN total_amount END),0) AS won_value,
    SUM(sent_at IS NOT NULL) AS sent,
    SUM(sent_at IS NOT NULL AND status IN (${inList(WON)})) AS won_sent`;

  const byCustomer = db
    .prepare(
      `SELECT q.customer_id AS key, json_extract(q.customer_snapshot, '$.name') AS label, ${groupCols}
       FROM quotations q ${where} GROUP BY q.customer_id ORDER BY value DESC LIMIT 100`
    )
    .all(...params);
  const byResponsible = db
    .prepare(`SELECT q.responsible_user_id AS key, u.name AS label, ${groupCols} FROM quotations q JOIN users u ON u.id = q.responsible_user_id ${where} GROUP BY q.responsible_user_id ORDER BY value DESC`)
    .all(...params);
  const byType = db.prepare(`SELECT quotation_type AS key, quotation_type AS label, ${groupCols} FROM quotations q ${where} GROUP BY quotation_type`).all(...params);
  const byStatus = db.prepare(`SELECT status AS key, status AS label, COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS value FROM quotations q ${where} GROUP BY status ORDER BY count DESC`).all(...params);
  const byPeriod = db
    .prepare(`SELECT strftime('%Y-%m', q.created_at, '-3 hours') AS key, strftime('%Y-%m', q.created_at, '-3 hours') AS label, ${groupCols} FROM quotations q ${where} GROUP BY key ORDER BY key DESC`)
    .all(...params);
  const refusalReasons = db
    .prepare(
      `SELECT CASE WHEN instr(refusal_reason, ':') > 0 THEN substr(refusal_reason, 1, instr(refusal_reason, ':') - 1) ELSE refusal_reason END AS label,
        COUNT(*) AS count, COALESCE(SUM(total_amount),0) AS value
       FROM quotations q ${and} q.status = 'recusado' AND refusal_reason IS NOT NULL GROUP BY label ORDER BY count DESC`
    )
    .all(...params);
  const listCols = `q.id, q.quotation_number, json_extract(q.customer_snapshot, '$.name') AS customer_name, u.name AS responsible_name, q.expiration_date, q.total_amount, q.status`;
  const expired = db
    .prepare(`SELECT ${listCols} FROM quotations q JOIN users u ON u.id = q.responsible_user_id ${and} q.status = 'expirado' ORDER BY q.expiration_date DESC LIMIT 200`)
    .all(...params);
  const expiring = db
    .prepare(
      `SELECT ${listCols} FROM quotations q JOIN users u ON u.id = q.responsible_user_id
       ${and} q.status IN ('aprovado_interno','enviado','em_negociacao') AND q.expiration_date BETWEEN ? AND ? ORDER BY q.expiration_date LIMIT 200`
    )
    .all(...params, today, addDaysISO(today, expiringDays));

  return { byCustomer, byResponsible, byType, byStatus, byPeriod, refusalReasons, expired, expiring };
}

/** Notificações do cabeçalho: aprovações pendentes (gestor/admin) e propostas vencendo. */
export function notifications(db: DB, user: AuthUser, expiringDays: number) {
  sweepExpired(db);
  const { where, params } = buildQuotationWhere(user, {});
  const and = where ? `${where} AND` : 'WHERE';
  const today = todayISO();
  const items: { id: number; quotation_number: string; kind: 'aprovacao' | 'vencendo'; text: string }[] = [];
  if (user.role === 'admin' || user.role === 'gestor') {
    const rows = db
      .prepare(`SELECT q.id, q.quotation_number, q.effective_discount_percent FROM quotations q ${and} q.status = 'aguardando_aprovacao' ORDER BY q.updated_at LIMIT 20`)
      .all(...params) as { id: number; quotation_number: string; effective_discount_percent: number }[];
    for (const r of rows) items.push({ id: r.id, quotation_number: r.quotation_number, kind: 'aprovacao', text: `Aguardando sua aprovação (desconto ${r.effective_discount_percent.toLocaleString('pt-BR')}%)` });
  }
  const exp = db
    .prepare(
      `SELECT q.id, q.quotation_number, q.expiration_date FROM quotations q
       ${and} q.status IN ('aprovado_interno','enviado','em_negociacao') AND q.expiration_date BETWEEN ? AND ? ORDER BY q.expiration_date LIMIT 20`
    )
    .all(...params, today, addDaysISO(today, expiringDays)) as { id: number; quotation_number: string; expiration_date: string }[];
  for (const r of exp) {
    const d = daysBetween(today, r.expiration_date);
    items.push({ id: r.id, quotation_number: r.quotation_number, kind: 'vencendo', text: d === 0 ? 'Vence hoje' : `Vence em ${d} dia(s)` });
  }
  return items;
}
