/**
 * Consultas das Ordens de Serviço: lista, painel, relatórios, histórico do equipamento e anexos.
 * Estimativas nunca aparecem como valores realizados.
 */

import { DB, transaction } from '../../db';
import { badRequest, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { todayISO } from '../../../shared/orcamentos/dates';
import { ORDER_STATUS_LABELS, OrderListRow, PRIORITY_LABELS } from '../../../shared/os/types';
import { osCan } from '../../../shared/os/rules';
import { assertOpen, loadRawOrder, orderEvent, orderTypeLabel, text } from './core';
import { preventiveAlerts } from './preventive';

const OPEN_SQL = "('concluida','cancelada')";

export function listOrders(db: DB, user: AuthUser, f: Record<string, string | undefined>, all = false) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const today = todayISO();
  if (f.status === 'abertas') where.push(`w.status NOT IN ${OPEN_SQL}`);
  else if (f.status === 'atrasadas') {
    where.push(`w.status NOT IN ${OPEN_SQL} AND w.due_date < ?`);
    params.push(today);
  } else if (f.status === 'atendimento') where.push("w.status IN ('aberta','aguardando_avaliacao','programada')");
  else if (f.status) {
    const st = f.status.split(',');
    where.push(`w.status IN (${st.map(() => '?').join(',')})`);
    params.push(...st);
  }
  for (const [k, col] of [['priority', 'w.priority'], ['order_type', 'w.order_type']] as const)
    if (f[k]) {
      where.push(`${col} = ?`);
      params.push(f[k]!);
    }
  if (f.responsible_id) {
    where.push('w.responsible_user_id = ?');
    params.push(Number(f.responsible_id));
  }
  if (f.asset_id) {
    where.push('w.asset_id = ?');
    params.push(Number(f.asset_id));
  }
  if (f.category) {
    where.push("json_extract(w.asset_snapshot, '$.category') = ?");
    params.push(f.category);
  }
  if (f.from) {
    where.push('substr(w.opened_at,1,10) >= ?');
    params.push(f.from);
  }
  if (f.to) {
    where.push('substr(w.opened_at,1,10) <= ?');
    params.push(f.to);
  }
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    where.push("(w.order_number LIKE ? OR w.title LIKE ? OR json_extract(w.asset_snapshot, '$.asset_tag') LIKE ? OR json_extract(w.asset_snapshot, '$.serial_number') LIKE ? OR json_extract(w.asset_snapshot, '$.description') LIKE ?)");
    params.push(q, q, q, q, q);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const SORTS: Record<string, string> = { numero: 'w.id', abertura: 'w.opened_at', prazo: 'w.due_date', prioridade: "CASE w.priority WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END", status: 'w.status', custo: 'w.actual_cost' };
  const sort = SORTS[f.sort || ''] || 'w.id';
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  const total = (db.prepare(`SELECT COUNT(*) n FROM work_orders w ${w}`).get(...params) as { n: number }).n;
  const pageSize = all ? 5000 : Math.min(Math.max(Number(f.page_size) || 20, 5), 100);
  const page = all ? 1 : Math.max(Number(f.page) || 1, 1);
  const costs = osCan.viewCosts(user);
  const rows = (
    db
      .prepare(
        `SELECT w.id, w.order_number, w.asset_id, json_extract(w.asset_snapshot, '$.asset_tag') AS asset_tag, json_extract(w.asset_snapshot, '$.serial_number') AS serial_number,
           json_extract(w.asset_snapshot, '$.description') AS item_description, w.order_type, w.title, w.priority, w.opened_at, w.due_date, u.name AS responsible_name, w.status, w.actual_cost, w.blocks_equipment
         FROM work_orders w LEFT JOIN users u ON u.id = w.responsible_user_id ${w} ORDER BY ${sort} ${dir}, w.id DESC LIMIT ? OFFSET ?`
      )
      .all(...params, pageSize, (page - 1) * pageSize) as any[]
  ).map(
    (r): OrderListRow => ({
      ...r,
      blocks_equipment: !!r.blocks_equipment,
      actual_cost: costs ? r.actual_cost : 0,
      overdue: !!r.due_date && r.due_date < today && !['concluida', 'cancelada'].includes(r.status),
      order_type: orderTypeLabel(db, r.order_type),
    })
  );
  return { total, page, page_size: pageSize, rows };
}

export function osDashboard(db: DB, user: AuthUser, f: Record<string, string | undefined>) {
  const today = todayISO();
  const month = today.slice(0, 7);
  const n = (sql: string, ...p: (string | number)[]) => (db.prepare(sql).get(...p) as { n: number }).n;
  const costs = osCan.viewCosts(user);
  // custo realizado no mês: peças aplicadas + mão de obra + serviços concluídos + outros, pelas datas de cada lançamento
  const monthCost = costs
    ? n(
        `SELECT
           COALESCE((SELECT SUM(ROUND(mv.quantity * m.withdrawn_cost * 1.0 / NULLIF(m.quantity_withdrawn,0))) FROM work_order_material_moves mv JOIN work_order_materials m ON m.id = mv.material_id WHERE mv.move_type = 'utilizacao' AND substr(mv.created_at,1,7) = ?),0)
         + COALESCE((SELECT SUM(labor_cost) FROM work_order_activities WHERE voided = 0 AND substr(started_at,1,7) = ?),0)
         + COALESCE((SELECT SUM(actual_cost) FROM work_order_services WHERE status = 'concluido' AND substr(completed_date,1,7) = ?),0)
         + COALESCE((SELECT SUM(actual_other) FROM work_orders WHERE substr(COALESCE(completed_at, updated_at),1,7) = ?),0) AS n`,
        month, month, month, month
      )
    : null;
  const avg = db
    .prepare(
      `SELECT AVG((julianday(completed_at) - julianday(opened_at)) * 24) total_h, AVG(execution_min + testing_min) / 60.0 exec_h, COUNT(*) n
       FROM work_orders WHERE status = 'concluida' AND substr(completed_at,1,10) BETWEEN ? AND ?`
    )
    .get(f.from || `${month}-01`, f.to || today) as { total_h: number | null; exec_h: number | null; n: number };
  return {
    abertas: n(`SELECT COUNT(*) n FROM work_orders WHERE status NOT IN ${OPEN_SQL}`),
    aguardando_atendimento: n("SELECT COUNT(*) n FROM work_orders WHERE status IN ('aberta','aguardando_avaliacao','programada')"),
    em_execucao: n("SELECT COUNT(*) n FROM work_orders WHERE status IN ('em_execucao','em_testes')"),
    aguardando_pecas: n("SELECT COUNT(*) n FROM work_orders WHERE status = 'aguardando_pecas'"),
    aguardando_fornecedor: n("SELECT COUNT(*) n FROM work_orders WHERE status = 'aguardando_fornecedor'"),
    aguardando_aprovacao: n("SELECT COUNT(*) n FROM work_orders WHERE status = 'aguardando_aprovacao'"),
    concluidas_mes: n("SELECT COUNT(*) n FROM work_orders WHERE status = 'concluida' AND substr(completed_at,1,7) = ?", month),
    atrasadas: n(`SELECT COUNT(*) n FROM work_orders WHERE status NOT IN ${OPEN_SQL} AND due_date < ?`, today),
    indisponiveis: n("SELECT COUNT(*) n FROM stock_assets WHERE operational_status IN ('em_manutencao','danificado','aguardando_inspecao')"),
    custo_mes: monthCost,
    tempo_medio_h: avg.total_h === null ? null : Math.round(avg.total_h * 10) / 10,
    tempo_execucao_h: avg.exec_h === null ? null : Math.round(avg.exec_h * 10) / 10,
    concluidas_periodo: avg.n,
    preventivas: preventiveAlerts(db),
  };
}

/** Histórico de manutenção do equipamento (fotografia gravada em cada OS). */
export function equipmentHistory(db: DB, user: AuthUser, assetId: number) {
  const costs = osCan.viewCosts(user);
  return (
    db
      .prepare(
        `SELECT w.id, w.order_number, w.order_type, w.status, w.title, w.diagnosis, w.procedures, w.opened_at, w.completed_at, w.actual_cost, w.test_result, w.downtime_start, w.downtime_end,
           u.name AS responsible_name, w.asset_snapshot,
           (SELECT group_concat(m.description_snapshot || ' × ' || m.quantity_used, '; ') FROM work_order_materials m WHERE m.work_order_id = w.id AND m.quantity_used > 0) AS parts
         FROM work_orders w LEFT JOIN users u ON u.id = w.responsible_user_id WHERE w.asset_id = ? ORDER BY w.opened_at DESC`
      )
      .all(assetId) as any[]
  ).map((r) => ({
    ...r,
    order_type: orderTypeLabel(db, r.order_type),
    actual_cost: costs ? r.actual_cost : null,
    downtime_hours: r.downtime_start ? Math.round(((Date.parse(r.downtime_end || new Date().toISOString()) - Date.parse(r.downtime_start)) / 3_600_000) * 10) / 10 : null,
    asset_snapshot: JSON.parse(r.asset_snapshot),
  }));
}

/** Equipamentos para abrir OS: dados do cadastro do Estoque + locação em curso. */
export function searchAssets(db: DB, q: string, id?: number) {
  const like = `%${q.trim()}%`;
  return db
    .prepare(
      `SELECT a.id, a.asset_tag, a.serial_number, a.operational_status, a.rental_status, i.internal_code AS item_code, i.description, i.brand, i.model, i.category, l.name AS location_name,
         (SELECT r.contract_ref FROM stock_reservations r WHERE r.asset_id = a.id AND r.status = 'em_uso' LIMIT 1) AS contract_ref,
         (SELECT r.customer_name FROM stock_reservations r WHERE r.asset_id = a.id AND r.status = 'em_uso' LIMIT 1) AS customer_name,
         (SELECT order_number FROM work_orders w WHERE w.asset_id = a.id AND w.status NOT IN ${OPEN_SQL} LIMIT 1) AS open_order
       FROM stock_assets a JOIN catalog_items i ON i.id = a.item_id LEFT JOIN stock_locations l ON l.id = a.location_id
       WHERE a.operational_status != 'baixado' AND ${id ? 'a.id = ?' : '(a.asset_tag LIKE ? OR a.serial_number LIKE ? OR i.description LIKE ? OR i.internal_code LIKE ?)'}
       ORDER BY a.asset_tag LIMIT 15`
    )
    .all(...(id ? [id] : [like, like, like, like]));
}

// ------------------------------------------------ anexos (servidos só pela API autenticada)

const MAX_FILE = 2_000_000;

export function addAttachment(db: DB, user: AuthUser, orderId: number, raw: any) {
  if (!osCan.open(user) && !osCan.edit(user)) throw forbidden();
  const m = (typeof raw?.content === 'string' ? raw.content : '').match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!m) throw badRequest('Arquivo inválido.');
  if (m[2].length > MAX_FILE) throw badRequest('Arquivo muito grande (máx. ~1,4 MB).');
  if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(m[1])) throw badRequest('Envie PDF ou imagem (PNG, JPG, WEBP).');
  const name = text(raw?.file_name, 120) || 'arquivo';
  return transaction(db, () => {
    const o = loadRawOrder(db, orderId);
    // anexos que chegam depois (ex.: nota fiscal) só por técnico/gestor em OS encerrada
    if (!osCan.edit(user)) assertOpen(o);
    const id = (
      db.prepare('INSERT INTO work_order_attachments (work_order_id, category, title, file_name, mime_type, file_data, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id').get(
        orderId, text(raw?.category, 40) || 'outro', text(raw?.title, 120) || name, name, m[1], m[2], user.id
      ) as { id: number }
    ).id;
    orderEvent(db, orderId, 'anexo', `Anexo incluído: ${text(raw?.title, 120) || name}.`, user);
    return { id };
  });
}

export function getAttachment(db: DB, orderId: number, attId: number) {
  const a = db.prepare('SELECT file_name, mime_type, file_data FROM work_order_attachments WHERE id = ? AND work_order_id = ?').get(attId, orderId) as any;
  if (!a) throw notFound('Anexo não encontrado.');
  return { name: a.file_name, mime: a.mime_type, buffer: Buffer.from(a.file_data, 'base64') };
}

// ------------------------------------------------ relatórios

export const OS_REPORTS: Record<string, string> = {
  por_status: 'OS por status',
  por_equipamento: 'OS por equipamento',
  por_tecnico: 'OS por técnico (horas trabalhadas)',
  por_tipo: 'OS por tipo de manutenção',
  atrasadas: 'Manutenções atrasadas',
  preventivas: 'Preventivas programadas',
  custo_equipamento: 'Custo de manutenção por equipamento',
  custo_periodo: 'Custo de manutenção por mês',
  pecas: 'Peças mais utilizadas',
  tempo_reparo: 'Tempo médio de reparo',
  indisponibilidade: 'Tempo de indisponibilidade',
  previsto_realizado: 'Previsto × realizado',
  reincidencia: 'Reincidência de defeitos',
};

export function osReport(db: DB, user: AuthUser, kind: string, f: Record<string, string | undefined>) {
  const today = todayISO();
  const from = f.from || `${today.slice(0, 4)}-01-01`;
  const to = f.to || today;
  const costs = osCan.viewCosts(user);
  const money = (v: number | null) => (costs && v !== null && v !== undefined ? v / 100 : null);
  const period = "substr(w.opened_at,1,10) BETWEEN ? AND ?";
  const tag = "json_extract(w.asset_snapshot, '$.asset_tag')";
  const desc = "json_extract(w.asset_snapshot, '$.description')";
  if (['custo_equipamento', 'custo_periodo', 'previsto_realizado'].includes(kind) && !costs) throw forbidden('Seu perfil não consulta custos.');
  switch (kind) {
    case 'por_status':
      return (db.prepare(`SELECT w.status AS situacao, COUNT(*) AS os FROM work_orders w WHERE ${period} GROUP BY w.status ORDER BY os DESC`).all(from, to) as any[]).map((r) => ({ ...r, situacao: ORDER_STATUS_LABELS[r.situacao as 'aberta'] }));
    case 'por_equipamento':
      return db.prepare(`SELECT ${tag} AS patrimonio, ${desc} AS equipamento, COUNT(*) AS os, SUM(w.status = 'concluida') AS concluidas, SUM(w.status NOT IN ${OPEN_SQL}) AS abertas FROM work_orders w WHERE ${period} GROUP BY w.asset_id ORDER BY os DESC`).all(from, to);
    case 'por_tecnico':
      return db
        .prepare(
          `SELECT a.technician_name AS tecnico, COUNT(DISTINCT a.work_order_id) AS os, ROUND(SUM(a.duration_minutes) / 60.0, 1) AS horas, SUM(a.labor_cost) AS custo
           FROM work_order_activities a WHERE a.voided = 0 AND substr(a.started_at,1,10) BETWEEN ? AND ? GROUP BY a.technician_name ORDER BY horas DESC`
        )
        .all(from, to)
        .map((r: any) => ({ ...r, custo: money(r.custo) }));
    case 'por_tipo':
      return (db.prepare(`SELECT w.order_type AS tipo, COUNT(*) AS os, SUM(w.status = 'concluida') AS concluidas FROM work_orders w WHERE ${period} GROUP BY w.order_type ORDER BY os DESC`).all(from, to) as any[]).map((r) => ({ ...r, tipo: orderTypeLabel(db, r.tipo) }));
    case 'atrasadas':
      return (
        db
          .prepare(`SELECT w.order_number AS os, ${tag} AS patrimonio, w.title AS servico, w.priority AS prioridade, w.due_date AS prazo, CAST(julianday(?) - julianday(w.due_date) AS INTEGER) AS dias_atraso, w.status AS situacao, u.name AS responsavel FROM work_orders w LEFT JOIN users u ON u.id = w.responsible_user_id WHERE w.status NOT IN ${OPEN_SQL} AND w.due_date < ? ORDER BY w.due_date`)
          .all(today, today) as any[]
      ).map((r) => ({ ...r, prioridade: PRIORITY_LABELS[r.prioridade as 'alta'], situacao: ORDER_STATUS_LABELS[r.situacao as 'aberta'] }));
    case 'preventivas':
      return preventiveAlerts(db).map((p) => ({ plano: p.plan, patrimonio: p.asset_tag, proxima_data: p.next_due_date, proximo_medidor: p.next_due_meter, medidor_atual: p.current_meter, situacao: p.overdue ? 'atrasada' : 'próxima', os_aberta: p.open_order }));
    case 'custo_equipamento':
      return (db.prepare(`SELECT ${tag} AS patrimonio, ${desc} AS equipamento, json_extract(w.asset_snapshot, '$.category') AS categoria, COUNT(*) AS os, SUM(w.actual_cost) AS custo_realizado FROM work_orders w WHERE w.status != 'cancelada' AND ${period} GROUP BY w.asset_id ORDER BY custo_realizado DESC`).all(from, to) as any[]).map((r) => ({ ...r, custo_realizado: money(r.custo_realizado) }));
    case 'custo_periodo':
      return (db.prepare(`SELECT substr(w.completed_at,1,7) AS mes, COUNT(*) AS os, SUM(w.estimated_cost) AS previsto, SUM(w.actual_cost) AS realizado FROM work_orders w WHERE w.status = 'concluida' AND substr(w.completed_at,1,10) BETWEEN ? AND ? GROUP BY mes ORDER BY mes`).all(from, to) as any[]).map((r) => ({ ...r, previsto: money(r.previsto), realizado: money(r.realizado) }));
    case 'pecas':
      return (
        db
          .prepare(
            `SELECT i.internal_code AS codigo, i.description AS descricao, i.unit AS unidade, SUM(m.quantity_used) AS quantidade_utilizada, COUNT(DISTINCT m.work_order_id) AS os,
               SUM(ROUND(m.quantity_used * m.withdrawn_cost * 1.0 / NULLIF(m.quantity_withdrawn,0))) AS custo
             FROM work_order_materials m JOIN catalog_items i ON i.id = m.item_id JOIN work_orders w ON w.id = m.work_order_id WHERE m.quantity_used > 0 AND ${period}
             GROUP BY m.item_id ORDER BY quantidade_utilizada DESC`
          )
          .all(from, to) as any[]
      ).map((r) => ({ ...r, custo: money(r.custo) }));
    case 'tempo_reparo':
      return (
        db
          .prepare(
            `SELECT w.order_type AS tipo, COUNT(*) AS os, ROUND(AVG((julianday(w.completed_at) - julianday(w.opened_at)) * 24), 1) AS horas_total, ROUND(AVG(w.execution_min + w.testing_min) / 60.0, 1) AS horas_execucao,
               ROUND(AVG(w.wait_parts_min + w.wait_supplier_min + w.wait_approval_min) / 60.0, 1) AS horas_espera
             FROM work_orders w WHERE w.status = 'concluida' AND substr(w.completed_at,1,10) BETWEEN ? AND ? GROUP BY w.order_type`
          )
          .all(from, to) as any[]
      ).map((r) => ({ ...r, tipo: orderTypeLabel(db, r.tipo) }));
    case 'indisponibilidade':
      return db
        .prepare(
          `SELECT ${tag} AS patrimonio, ${desc} AS equipamento, COUNT(*) AS bloqueios,
             ROUND(SUM((julianday(COALESCE(w.downtime_end, ?)) - julianday(w.downtime_start)) * 24), 1) AS horas_indisponivel
           FROM work_orders w WHERE w.downtime_start IS NOT NULL AND ${period} GROUP BY w.asset_id ORDER BY horas_indisponivel DESC`
        )
        .all(new Date().toISOString(), from, to);
    case 'previsto_realizado':
      return (
        db
          .prepare(`SELECT w.order_number AS os, ${tag} AS patrimonio, w.title AS servico, w.status AS situacao, w.estimated_cost AS previsto, w.actual_cost AS realizado, w.actual_cost - w.estimated_cost AS diferenca FROM work_orders w WHERE w.status != 'cancelada' AND ${period} ORDER BY ABS(w.actual_cost - w.estimated_cost) DESC`)
          .all(from, to) as any[]
      ).map((r) => ({ ...r, situacao: ORDER_STATUS_LABELS[r.situacao as 'aberta'], previsto: money(r.previsto), realizado: money(r.realizado), diferenca: money(r.diferenca) }));
    case 'reincidencia':
      return db
        .prepare(
          `SELECT ${tag} AS patrimonio, ${desc} AS equipamento, COALESCE(w.defect_category, '(sem categoria)') AS defeito, COUNT(*) AS ocorrencias, MIN(substr(w.opened_at,1,10)) AS primeira, MAX(substr(w.opened_at,1,10)) AS ultima,
             group_concat(w.order_number, ', ') AS ordens
           FROM work_orders w WHERE w.status != 'cancelada' AND w.order_type NOT IN ('preventiva','revisao','inspecao') AND ${period}
           GROUP BY w.asset_id, COALESCE(w.defect_category, '') HAVING COUNT(*) > 1 ORDER BY ocorrencias DESC`
        )
        .all(from, to);
    default:
      return null;
  }
}

