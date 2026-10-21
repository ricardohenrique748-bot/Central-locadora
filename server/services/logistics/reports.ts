/**
 * Lista, painel, alertas e relatórios da Logística (dados reais; estimado ≠ realizado).
 */

import { DB } from '../../db';
import { forbidden } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { addDaysISO, todayISO } from '../../../shared/orcamentos/dates';
import { OCCURRENCE_TYPE_LABELS, OP_STATUS_LABELS, OP_TYPE_LABELS, OpRow } from '../../../shared/logistica/types';
import { logCan } from '../../../shared/logistica/rules';

const DONE = "('entregue','entregue_parcialmente','concluida','cancelada')";
const nowIso = () => new Date().toISOString();

export function listOperations(db: DB, user: AuthUser, f: Record<string, string | undefined>, all = false) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const today = todayISO();
  if (f.type === 'entrega') where.push("o.op_type = 'entrega'");
  else if (f.type === 'retorno') where.push("o.op_type IN ('retirada','devolucao')");
  else if (f.type) {
    where.push('o.op_type = ?');
    params.push(f.type);
  }
  if (f.status === 'abertas') where.push(`o.status NOT IN ${DONE}`);
  else if (f.status === 'hoje') {
    where.push(`substr(o.scheduled_at,1,10) = ? AND o.status NOT IN ${DONE}`);
    params.push(today);
  } else if (f.status === 'atrasadas') {
    where.push(`o.scheduled_at < ? AND o.status IN ('rascunho','programada','em_separacao','pronta','em_transporte','em_andamento')`);
    params.push(nowIso());
  } else if (f.status === 'pendencias') where.push(`(o.status IN ('entregue_parcialmente','recebida_parcialmente','recebida','aguardando_inspecao','em_conferencia') OR EXISTS (SELECT 1 FROM logistics_occurrences x WHERE x.order_id = o.id AND x.status NOT IN ('resolvida','nao_cobravel')))`);
  else if (f.status) {
    const st = f.status.split(',');
    where.push(`o.status IN (${st.map(() => '?').join(',')})`);
    params.push(...st);
  }
  for (const [k, col] of [['contract_id', 'o.contract_id'], ['customer_id', 'o.customer_id'], ['responsible_id', 'o.responsible_user_id'], ['driver_id', 'o.driver_id']] as const)
    if (f[k]) {
      where.push(`${col} = ?`);
      params.push(Number(f[k]));
    }
  if (f.from) {
    where.push('substr(o.scheduled_at,1,10) >= ?');
    params.push(f.from);
  }
  if (f.to) {
    where.push('substr(o.scheduled_at,1,10) <= ?');
    params.push(f.to);
  }
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    where.push(`(o.number LIKE ? OR c.contract_number LIKE ? OR json_extract(c.customer_snapshot, '$.name') LIKE ? OR o.address LIKE ?
      OR EXISTS (SELECT 1 FROM logistics_order_items li JOIN contract_items ci ON ci.id = li.contract_item_id LEFT JOIN stock_assets a ON a.id = li.asset_id WHERE li.order_id = o.id AND (a.asset_tag LIKE ? OR ci.item_code_snapshot LIKE ? OR ci.description_snapshot LIKE ?)))`);
    params.push(q, q, q, q, q, q, q);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const SORTS: Record<string, string> = { numero: 'o.id', data: 'o.scheduled_at', cliente: "json_extract(c.customer_snapshot, '$.name')", status: 'o.status' };
  const sort = SORTS[f.sort || ''] || 'o.scheduled_at';
  const dir = f.dir === 'desc' ? 'DESC' : 'ASC';
  const total = (db.prepare(`SELECT COUNT(*) n FROM logistics_orders o JOIN contracts c ON c.id = o.contract_id ${w}`).get(...params) as { n: number }).n;
  const pageSize = all ? 5000 : Math.min(Math.max(Number(f.page_size) || 20, 5), 100);
  const page = all ? 1 : Math.max(Number(f.page) || 1, 1);
  const rows = (
    db
      .prepare(
        `SELECT o.id, o.number, o.op_type, o.status, o.contract_id, c.contract_number, json_extract(c.customer_snapshot, '$.name') AS customer_name, o.address, o.scheduled_at,
           u.name AS responsible_name, d.name AS driver_name,
           (SELECT COUNT(*) FROM logistics_order_items li WHERE li.order_id = o.id AND li.quantity_original > 0) AS items_count,
           (SELECT COALESCE(SUM(quantity_planned),0) FROM logistics_order_items li WHERE li.order_id = o.id) AS quantity_total,
           (SELECT COUNT(*) FROM logistics_occurrences x WHERE x.order_id = o.id AND x.status NOT IN ('resolvida','nao_cobravel')) AS open_occ,
           CASE WHEN o.op_type = 'entrega' THEN 0 ELSE (SELECT COALESCE(SUM(quantity_processed - quantity_inspected),0) FROM logistics_order_items li WHERE li.order_id = o.id) END AS to_inspect
         FROM logistics_orders o JOIN contracts c ON c.id = o.contract_id LEFT JOIN users u ON u.id = o.responsible_user_id LEFT JOIN logistics_drivers d ON d.id = o.driver_id
         ${w} ORDER BY ${sort} ${dir}, o.id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, (page - 1) * pageSize) as any[]
  ).map((r): OpRow => {
    const late = r.scheduled_at < nowIso() && ['rascunho', 'programada', 'em_separacao', 'pronta', 'em_transporte', 'em_andamento'].includes(r.status);
    const pend = [late && 'Atrasada', r.status === 'entregue_parcialmente' && 'Entrega incompleta', r.to_inspect > 0 && `${r.to_inspect} a inspecionar`, r.open_occ > 0 && `${r.open_occ} ocorrência(s)`].filter(Boolean).join(' • ');
    return { ...r, late, pending: pend || null };
  });
  return { total, page, page_size: pageSize, rows };
}

export function logisticsDashboard(db: DB) {
  const today = todayISO();
  const n = (sql: string, ...p: (string | number)[]) => (db.prepare(sql).get(...p) as { n: number }).n;
  return {
    entregas_hoje: n(`SELECT COUNT(*) n FROM logistics_orders WHERE op_type = 'entrega' AND substr(scheduled_at,1,10) = ? AND status NOT IN ('cancelada')`, today),
    entregas_pendentes: n("SELECT COUNT(*) n FROM logistics_orders WHERE op_type = 'entrega' AND status IN ('rascunho','programada','em_separacao','pronta')"),
    entregas_andamento: n("SELECT COUNT(*) n FROM logistics_orders WHERE op_type = 'entrega' AND status = 'em_transporte'"),
    entregas_concluidas: n("SELECT COUNT(*) n FROM logistics_orders WHERE op_type = 'entrega' AND status IN ('entregue','entregue_parcialmente') AND substr(completed_at,1,7) = ?", today.slice(0, 7)),
    retiradas_programadas: n("SELECT COUNT(*) n FROM logistics_orders WHERE op_type IN ('retirada','devolucao') AND status IN ('programada','em_andamento')"),
    devolucoes_hoje: n("SELECT COUNT(*) n FROM stock_reservations WHERE contract_id IS NOT NULL AND status = 'em_uso' AND end_date = ?", today),
    devolucoes_atrasadas: n("SELECT COUNT(DISTINCT contract_id) n FROM stock_reservations WHERE contract_id IS NOT NULL AND status = 'em_uso' AND end_date < ?", today),
    aguardando_conferencia: n("SELECT COUNT(*) n FROM logistics_orders WHERE status IN ('recebida','recebida_parcialmente','aguardando_inspecao','em_conferencia')"),
    avarias: n("SELECT COUNT(*) n FROM logistics_occurrences WHERE occurrence_type IN ('avaria','incompleto') AND status NOT IN ('resolvida','nao_cobravel')"),
    pendencias: n(`SELECT COUNT(*) n FROM logistics_orders o WHERE o.status IN ('entregue_parcialmente','recebida_parcialmente','recebida','aguardando_inspecao','em_conferencia') OR EXISTS (SELECT 1 FROM logistics_occurrences x WHERE x.order_id = o.id AND x.status NOT IN ('resolvida','nao_cobravel'))`),
  };
}

export function logisticsAlerts(db: DB) {
  const today = todayISO();
  const now = nowIso();
  const out: { kind: string; label: string; priority: 'alta' | 'media' | 'baixa'; order_id: number | null; occurrence_id: number | null; contract_id: number | null; ref: string; text: string }[] = [];
  const ops = db.prepare(`SELECT o.id, o.number, o.op_type, o.status, o.scheduled_at, o.contract_id, c.contract_number, json_extract(c.customer_snapshot, '$.name') AS customer FROM logistics_orders o JOIN contracts c ON c.id = o.contract_id WHERE o.status NOT IN ('concluida','cancelada')`).all() as any[];
  for (const o of ops) {
    const late = o.scheduled_at < now && ['rascunho', 'programada', 'em_separacao', 'pronta', 'em_transporte', 'em_andamento'].includes(o.status);
    const base = { order_id: o.id, occurrence_id: null, contract_id: o.contract_id, ref: `${o.number} • ${o.customer}` };
    if (late) out.push({ ...base, kind: o.op_type === 'entrega' ? 'entrega_atrasada' : 'retirada_atrasada', label: o.op_type === 'entrega' ? 'Entrega atrasada' : 'Retirada atrasada', priority: 'alta', text: `Programada para ${new Date(o.scheduled_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}` });
    else if (o.scheduled_at.slice(0, 10) === today && !['entregue', 'entregue_parcialmente'].includes(o.status)) out.push({ ...base, kind: o.op_type === 'entrega' ? 'entrega_hoje' : 'retirada_hoje', label: o.op_type === 'entrega' ? 'Entrega hoje' : 'Retirada/devolução hoje', priority: 'media', text: OP_STATUS_LABELS[o.status as 'programada'] });
    if (o.status === 'entregue_parcialmente') out.push({ ...base, kind: 'entrega_incompleta', label: 'Entrega incompleta', priority: 'media', text: 'Parte dos itens não foi entregue' });
    if (['recebida', 'recebida_parcialmente', 'aguardando_inspecao', 'em_conferencia'].includes(o.status)) out.push({ ...base, kind: 'aguardando_inspecao', label: 'Equipamentos aguardando inspeção', priority: 'media', text: 'Itens recebidos ainda não liberados' });
    if (['entregue', 'entregue_parcialmente'].includes(o.status) && !db.prepare("SELECT 1 FROM logistics_attachments WHERE order_id = ? AND phase IN ('entrega','documento')").get(o.id))
      out.push({ ...base, kind: 'documento_pendente', label: 'Comprovante pendente', priority: 'baixa', text: 'Entrega sem comprovante/foto anexado' });
  }
  for (const r of db.prepare("SELECT c.id, c.contract_number, json_extract(c.customer_snapshot, '$.name') AS customer, MIN(r.end_date) AS end_date FROM stock_reservations r JOIN contracts c ON c.id = r.contract_id WHERE r.status = 'em_uso' AND r.end_date <= ? GROUP BY c.id").all(addDaysISO(today, 3)) as any[])
    out.push({ kind: r.end_date < today ? 'devolucao_atrasada' : 'devolucao_proxima', label: r.end_date < today ? 'Devolução atrasada' : 'Devolução próxima', priority: r.end_date < today ? 'alta' : 'baixa', order_id: null, occurrence_id: null, contract_id: r.id, ref: `${r.contract_number} • ${r.customer}`, text: `Prevista para ${r.end_date.split('-').reverse().join('/')}` });
  for (const x of db.prepare("SELECT oc.id, oc.number, oc.occurrence_type, oc.order_id, oc.contract_id, c.contract_number FROM logistics_occurrences oc JOIN contracts c ON c.id = oc.contract_id WHERE oc.status = 'registrada'").all() as any[])
    out.push({ kind: x.occurrence_type === 'divergencia' ? 'divergencia' : 'avaria_nao_analisada', label: x.occurrence_type === 'divergencia' ? 'Divergência de quantidade' : 'Avaria não analisada', priority: 'media', order_id: x.order_id, occurrence_id: x.id, contract_id: x.contract_id, ref: `${x.number} • ${x.contract_number}`, text: OCCURRENCE_TYPE_LABELS[x.occurrence_type as 'avaria'] });
  for (const a of db.prepare("SELECT a.id, a.asset_tag, a.operational_status FROM stock_assets a WHERE a.operational_status IN ('danificado','em_manutencao')").all() as any[])
    out.push({ kind: 'bloqueado', label: 'Equipamento bloqueado', priority: 'baixa', order_id: null, occurrence_id: null, contract_id: null, ref: a.asset_tag, text: a.operational_status === 'danificado' ? 'Danificado' : 'Em manutenção' });
  const prio = { alta: 0, media: 1, baixa: 2 };
  return out.sort((a, b) => prio[a.priority] - prio[b.priority]);
}

export const LOG_REPORTS: Record<string, string> = {
  entregas: 'Entregas por período',
  devolucoes: 'Retiradas e devoluções por período',
  pendentes: 'Operações pendentes',
  pontualidade: 'Entregas no prazo × atrasadas',
  devolucoes_atrasadas: 'Devoluções atrasadas',
  com_clientes: 'Equipamentos com clientes',
  aguardando_inspecao: 'Equipamentos aguardando inspeção',
  avarias_equipamento: 'Avarias por equipamento',
  ocorrencias_contrato: 'Ocorrências por contrato',
  custos_transporte: 'Custos de transporte (estimado × realizado)',
  tempo_liberacao: 'Tempo entre devolução e liberação',
  parciais: 'Operações parciais',
  divergencias: 'Divergências de quantidade/acessórios',
};

export function logisticsReport(db: DB, user: AuthUser, kind: string, f: Record<string, string | undefined>) {
  const today = todayISO();
  const from = f.from || `${today.slice(0, 7)}-01`;
  const to = f.to || today;
  const period = 'substr(o.scheduled_at,1,10) BETWEEN ? AND ?';
  const cust = "json_extract(c.customer_snapshot, '$.name')";
  const lbl = (r: any) => ({ ...r, tipo: r.tipo ? OP_TYPE_LABELS[r.tipo as 'entrega'] : undefined, situacao: r.situacao ? OP_STATUS_LABELS[r.situacao as 'entregue'] || r.situacao : undefined });
  const extra = (alias = 'o') => {
    const w: string[] = [];
    const p: (string | number)[] = [];
    if (f.contract_id) (w.push(`${alias}.contract_id = ?`), p.push(Number(f.contract_id)));
    if (f.responsible_id) (w.push(`${alias}.responsible_user_id = ?`), p.push(Number(f.responsible_id)));
    return { sql: w.length ? ` AND ${w.join(' AND ')}` : '', p };
  };
  const x = extra();
  switch (kind) {
    case 'entregas':
    case 'devolucoes':
      return (
        db
          .prepare(
            `SELECT o.number AS operacao, o.op_type AS tipo, c.contract_number AS contrato, ${cust} AS cliente, o.scheduled_at AS programada, o.completed_at AS realizada, o.status AS situacao,
               (SELECT SUM(quantity_processed) FROM logistics_order_items li WHERE li.order_id = o.id) AS quantidade
             FROM logistics_orders o JOIN contracts c ON c.id = o.contract_id WHERE ${kind === 'entregas' ? "o.op_type = 'entrega'" : "o.op_type IN ('retirada','devolucao')"} AND ${period}${x.sql} ORDER BY o.scheduled_at`
          )
          .all(from, to, ...x.p) as any[]
      ).map(lbl);
    case 'pendentes':
      return (db.prepare(`SELECT o.number AS operacao, o.op_type AS tipo, c.contract_number AS contrato, ${cust} AS cliente, o.scheduled_at AS programada, o.status AS situacao FROM logistics_orders o JOIN contracts c ON c.id = o.contract_id WHERE o.status NOT IN ${DONE}${x.sql} ORDER BY o.scheduled_at`).all(...x.p) as any[]).map(lbl);
    case 'pontualidade':
      return db
        .prepare(
          `SELECT substr(o.scheduled_at,1,10) AS dia, COUNT(*) AS entregas, SUM(substr(o.completed_at,1,10) <= substr(o.scheduled_at,1,10)) AS no_prazo, SUM(substr(o.completed_at,1,10) > substr(o.scheduled_at,1,10)) AS atrasadas
           FROM logistics_orders o WHERE o.op_type = 'entrega' AND o.status IN ('entregue','entregue_parcialmente') AND ${period}${x.sql} GROUP BY dia ORDER BY dia`
        )
        .all(from, to, ...x.p);
    case 'devolucoes_atrasadas':
      return db
        .prepare(
          `SELECT c.contract_number AS contrato, ${cust} AS cliente, i.internal_code AS codigo, a.asset_tag AS patrimonio, r.quantity AS quantidade, r.end_date AS prevista, CAST(julianday(?) - julianday(r.end_date) AS INTEGER) AS dias_atraso
           FROM stock_reservations r JOIN contracts c ON c.id = r.contract_id JOIN catalog_items i ON i.id = r.item_id LEFT JOIN stock_assets a ON a.id = r.asset_id WHERE r.status = 'em_uso' AND r.end_date < ? ORDER BY r.end_date`
        )
        .all(today, today);
    case 'com_clientes':
      return db
        .prepare(
          `SELECT c.contract_number AS contrato, ${cust} AS cliente, i.internal_code AS codigo, i.description AS descricao, a.asset_tag AS patrimonio, r.quantity AS quantidade, r.end_date AS devolucao_prevista
           FROM stock_reservations r JOIN contracts c ON c.id = r.contract_id JOIN catalog_items i ON i.id = r.item_id LEFT JOIN stock_assets a ON a.id = r.asset_id WHERE r.status = 'em_uso' ORDER BY c.contract_number`
        )
        .all()
        .map((r: any) => ({ ...r, devolucao_prevista: r.devolucao_prevista === '2099-12-31' ? 'indeterminado' : r.devolucao_prevista }));
    case 'aguardando_inspecao':
      return db
        .prepare(
          `SELECT o.number AS operacao, c.contract_number AS contrato, ci.item_code_snapshot AS codigo, a.asset_tag AS patrimonio, li.quantity_processed - li.quantity_inspected AS quantidade, o.completed_at AS recebida
           FROM logistics_order_items li JOIN logistics_orders o ON o.id = li.order_id JOIN contracts c ON c.id = o.contract_id JOIN contract_items ci ON ci.id = li.contract_item_id LEFT JOIN stock_assets a ON a.id = li.asset_id
           WHERE li.quantity_processed - li.quantity_inspected > 0.0000001 ORDER BY o.completed_at`
        )
        .all();
    case 'avarias_equipamento':
      return db
        .prepare(
          `SELECT COALESCE(a.asset_tag, i.internal_code) AS equipamento, COUNT(*) AS ocorrencias, SUM(oc.status = 'aprovada_cobranca') AS aprovadas_cobranca, SUM(oc.status = 'nao_cobravel') AS nao_cobraveis
           FROM logistics_occurrences oc LEFT JOIN stock_assets a ON a.id = oc.asset_id LEFT JOIN catalog_items i ON i.id = oc.item_id
           WHERE oc.occurrence_type IN ('avaria','incompleto','perda') AND substr(oc.created_at,1,10) BETWEEN ? AND ? GROUP BY equipamento ORDER BY ocorrencias DESC`
        )
        .all(from, to);
    case 'ocorrencias_contrato':
      return db
        .prepare(
          `SELECT c.contract_number AS contrato, ${cust} AS cliente, COUNT(*) AS ocorrencias, SUM(oc.status NOT IN ('resolvida','nao_cobravel')) AS abertas, SUM(oc.contract_charge_id IS NOT NULL) AS enviadas_financeiro
           FROM logistics_occurrences oc JOIN contracts c ON c.id = oc.contract_id WHERE substr(oc.created_at,1,10) BETWEEN ? AND ? GROUP BY oc.contract_id ORDER BY ocorrencias DESC`
        )
        .all(from, to);
    case 'custos_transporte':
      if (!logCan.viewCosts(user)) throw forbidden('Seu perfil não consulta custos.');
      return (
        db
          .prepare(`SELECT o.number AS operacao, o.op_type AS tipo, c.contract_number AS contrato, o.transport_type AS transporte, o.transport_cost_estimated AS estimado, o.transport_cost_actual AS realizado, e.entry_number AS conta_pagar FROM logistics_orders o JOIN contracts c ON c.id = o.contract_id LEFT JOIN financial_entries e ON e.id = o.transport_entry_id WHERE ${period}${x.sql} AND (o.transport_cost_estimated IS NOT NULL OR o.transport_cost_actual IS NOT NULL) ORDER BY o.scheduled_at`)
          .all(from, to, ...x.p) as any[]
      ).map((r) => ({ ...lbl(r), estimado: r.estimado === null ? null : r.estimado / 100, realizado: r.realizado === null ? null : r.realizado / 100 }));
    case 'tempo_liberacao':
      return db
        .prepare(
          `SELECT o.number AS operacao, COALESCE(a.asset_tag, ci.item_code_snapshot) AS equipamento, o.completed_at AS recebida, ins.inspected_at AS inspecionada, ins.result AS resultado,
             ROUND((julianday(ins.inspected_at) - julianday(o.completed_at)) * 24, 1) AS horas
           FROM logistics_inspections ins JOIN logistics_order_items li ON li.id = ins.order_item_id JOIN logistics_orders o ON o.id = li.order_id JOIN contract_items ci ON ci.id = li.contract_item_id
           LEFT JOIN stock_assets a ON a.id = ins.asset_id WHERE ins.result = 'aprovado' AND substr(ins.inspected_at,1,10) BETWEEN ? AND ? ORDER BY ins.inspected_at`
        )
        .all(from, to);
    case 'parciais':
      return (db.prepare(`SELECT o.number AS operacao, o.op_type AS tipo, c.contract_number AS contrato, o.status AS situacao, o.completed_at AS data FROM logistics_orders o JOIN contracts c ON c.id = o.contract_id WHERE (o.status IN ('entregue_parcialmente','recebida_parcialmente') OR EXISTS (SELECT 1 FROM logistics_order_items li WHERE li.order_id = o.id AND li.quantity_processed > 0 AND li.quantity_processed < li.quantity_original)) AND ${period}${x.sql}`).all(from, to, ...x.p) as any[]).map(lbl);
    case 'divergencias':
      return db
        .prepare(
          `SELECT o.number AS operacao, c.contract_number AS contrato, ci.item_code_snapshot AS codigo, li.quantity_original AS programado, li.quantity_processed AS realizado, li.quantity_missing AS faltante, li.adjust_reason AS justificativa
           FROM logistics_order_items li JOIN logistics_orders o ON o.id = li.order_id JOIN contracts c ON c.id = o.contract_id JOIN contract_items ci ON ci.id = li.contract_item_id
           WHERE (li.quantity_missing > 0 OR li.adjust_reason IS NOT NULL) AND ${period}${x.sql} ORDER BY o.scheduled_at`
        )
        .all(from, to, ...x.p);
    default:
      return null;
  }
}
