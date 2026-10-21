/**
 * Indicadores, central de alertas e relatórios de contratos.
 * Valor contratado ≠ previsto para cobrança ≠ recebido (o recebido vem do Financeiro).
 */

import { DB } from '../../db';
import { forbidden } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { todayISO } from '../../../shared/orcamentos/dates';
import { CONTRACT_STATUS_LABELS, CONTRACT_TYPE_LABELS, ContractAlert, AMENDMENT_LABELS } from '../../../shared/contratos/types';
import { contractCan } from '../../../shared/contratos/rules';
import { addDays, getContractSettings } from './core';
import { refreshContractStatuses } from './lifecycle';

const n = (db: DB, sql: string, ...p: (string | number)[]) => (db.prepare(sql).get(...p) as { n: number }).n;

export function contractDashboard(db: DB, user: AuthUser) {
  if (!contractCan.view(user)) throw forbidden();
  refreshContractStatuses(db);
  const today = todayISO();
  const s = getContractSettings(db);
  const horizon = addDays(today, Math.max(...s.alert_days));
  const values = contractCan.viewValues(user);
  return {
    total: n(db, "SELECT COUNT(*) n FROM contracts WHERE status != 'cancelado'"),
    em_elaboracao: n(db, "SELECT COUNT(*) n FROM contracts WHERE status IN ('rascunho','aguardando_aprovacao')"),
    aguardando_assinatura: n(db, "SELECT COUNT(*) n FROM contracts WHERE status = 'aguardando_assinatura'"),
    ativos: n(db, "SELECT COUNT(*) n FROM contracts WHERE status IN ('ativo','agendado')"),
    vencendo: n(db, "SELECT COUNT(*) n FROM contracts WHERE status IN ('ativo','agendado') AND end_date BETWEEN ? AND ?", today, horizon),
    vencidos: n(db, "SELECT COUNT(*) n FROM contracts WHERE status IN ('vencido','pendente_devolucao')"),
    encerrados: n(db, "SELECT COUNT(*) n FROM contracts WHERE status = 'encerrado'"),
    valor_mensal_ativo: values ? n(db, "SELECT COALESCE(SUM(monthly_equivalent),0) n FROM contracts WHERE contract_type = 'locacao' AND status IN ('ativo','vencido','pendente_devolucao')") : null,
    alert_horizon_days: Math.max(...s.alert_days),
  };
}

export function contractAlerts(db: DB, user: AuthUser, f: Record<string, string | undefined> = {}): ContractAlert[] {
  if (!contractCan.view(user)) throw forbidden();
  refreshContractStatuses(db);
  const today = todayISO();
  const s = getContractSettings(db);
  const maxDays = Math.max(...s.alert_days);
  const out: ContractAlert[] = [];
  const base = `SELECT c.id, c.contract_number, json_extract(c.customer_snapshot, '$.name') AS customer_name, c.responsible_user_id, u.name AS responsible_name, c.end_date, c.start_date
    FROM contracts c LEFT JOIN users u ON u.id = c.responsible_user_id`;
  const push = (r: any, kind: string, label: string, priority: ContractAlert['priority'], date: string | null, txt: string) =>
    out.push({ kind, label, priority, contract_id: r.id, contract_number: r.contract_number, customer_name: r.customer_name, responsible_user_id: r.responsible_user_id, responsible_name: r.responsible_name, date, text: txt });
  const days = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);

  for (const r of db.prepare(`${base} WHERE c.status IN ('ativo','agendado') AND c.end_date BETWEEN ? AND ?`).all(today, addDays(today, maxDays)) as any[]) {
    const d = days(r.end_date);
    const threshold = [...s.alert_days].sort((a, b) => a - b).find((x) => d <= x) ?? maxDays;
    push(r, 'vencendo', 'Próximo do vencimento', d <= 7 ? 'alta' : d <= 15 ? 'media' : 'baixa', r.end_date, d === 0 ? 'Termina hoje' : `Termina em ${d} dia(s) (alerta de ${threshold} dias)`);
  }
  for (const r of db.prepare(`${base} WHERE c.status IN ('vencido','pendente_devolucao') AND EXISTS (SELECT 1 FROM stock_reservations x WHERE x.contract_id = c.id AND x.status = 'em_uso')`).all() as any[])
    push(r, 'vencido_com_equipamento', 'Vencido com equipamento no cliente', 'alta', r.end_date, `Prazo ${r.end_date ? `encerrado em ${r.end_date.split('-').reverse().join('/')}` : 'em encerramento'} e equipamentos ainda com o cliente`);
  for (const r of db.prepare(`${base} WHERE c.status = 'vencido'`).all() as any[]) push(r, 'renovacao', 'Renovação pendente', 'media', r.end_date, 'Prazo vencido sem prorrogação ou encerramento registrado');
  for (const r of db
    .prepare(`${base} JOIN stock_reservations x ON x.contract_id = c.id WHERE x.status = 'confirmada' AND x.start_date BETWEEN ? AND ? AND c.status NOT IN ('cancelado','encerrado') GROUP BY c.id`)
    .all(addDays(today, -30), addDays(today, 7)) as any[])
    push(r, 'entrega', 'Entrega programada', r.start_date < today ? 'alta' : 'media', r.start_date, r.start_date < today ? 'Entrega prevista já passou e não foi registrada' : `Entrega prevista para ${r.start_date.split('-').reverse().join('/')}`);
  for (const r of db
    .prepare(`${base} JOIN stock_reservations x ON x.contract_id = c.id WHERE x.status = 'em_uso' AND x.end_date BETWEEN ? AND ? GROUP BY c.id`)
    .all(today, addDays(today, 7)) as any[])
    push(r, 'devolucao', 'Devolução programada', 'baixa', r.end_date, `Devolução prevista até ${r.end_date?.split('-').reverse().join('/')}`);
  for (const r of db.prepare(`${base} JOIN stock_reservations x ON x.contract_id = c.id WHERE x.status = 'em_uso' AND x.end_date < ? GROUP BY c.id`).all(today) as any[])
    push(r, 'devolucao_atrasada', 'Devolução atrasada', 'alta', r.end_date, 'Equipamentos não devolvidos após o término');
  if (contractCan.viewFinance(user))
    for (const r of db
      .prepare(
        `${base} JOIN contract_charges ch ON ch.contract_id = c.id JOIN financial_installments i ON i.entry_id = ch.financial_entry_id
         WHERE ch.status = 'gerado' AND i.status IN ('aberto','parcial') AND i.due_date < ? GROUP BY c.id`
      )
      .all(today) as any[])
      push(r, 'cobranca_vencida', 'Cobrança vencida', 'alta', null, 'Há cobranças do contrato vencidas no Financeiro');
  for (const r of db.prepare(`${base} WHERE c.status = 'aguardando_aprovacao'`).all() as any[]) push(r, 'aprovacao', 'Aguardando aprovação', 'media', null, 'Contrato aguardando aprovação interna');
  for (const r of db.prepare(`${base} WHERE c.status = 'aguardando_assinatura'`).all() as any[]) push(r, 'assinatura', 'Aguardando assinatura', 'media', null, 'Documento gerado, assinatura ainda não registrada');
  for (const r of db
    .prepare(
      `${base} JOIN contract_operations o ON o.contract_id = c.id JOIN contract_operation_items oi ON oi.operation_id = o.id
       WHERE o.operation_type = 'devolucao' AND (oi.classification IN ('avaria','manutencao') OR oi.damaged_qty > 0 OR oi.maintenance_qty > 0 OR oi.missing_qty > 0) AND o.performed_at >= ? GROUP BY c.id`
    )
    .all(addDays(today, -30)) as any[])
    push(r, 'avaria', 'Devolução com avaria', 'media', null, 'Equipamentos devolvidos com avaria, manutenção ou faltantes nos últimos 30 dias');

  const prio = { alta: 0, media: 1, baixa: 2 };
  return out
    .filter((a) => (!f.priority || a.priority === f.priority) && (!f.kind || a.kind === f.kind) && (!f.responsible_id || a.responsible_user_id === Number(f.responsible_id)) && (!f.until || !a.date || a.date <= f.until))
    .sort((a, b) => prio[a.priority] - prio[b.priority] || (a.date || '').localeCompare(b.date || ''));
}

export const CONTRACT_REPORTS: Record<string, string> = {
  ativos_periodo: 'Contratos ativos no período',
  por_cliente: 'Contratos por cliente',
  vencendo: 'Próximos do vencimento',
  vencidos: 'Contratos vencidos',
  encerrados_cancelados: 'Encerrados e cancelados',
  valor_contratado: 'Valor contratado por período',
  receita_recorrente: 'Receita recorrente prevista',
  cobrancas_abertas: 'Cobranças em aberto',
  equipamentos: 'Equipamentos vinculados',
  devolucoes_atrasadas: 'Devoluções atrasadas',
  renovacoes: 'Histórico de renovações e reajustes',
  avarias: 'Avarias em devoluções',
};

const money = (v: number | null) => (v === null || v === undefined ? null : v / 100);

export function contractReport(db: DB, user: AuthUser, kind: string, f: Record<string, string | undefined>) {
  if (!contractCan.view(user)) throw forbidden();
  const today = todayISO();
  const from = f.from || `${today.slice(0, 4)}-01-01`;
  const to = f.to || today;
  const values = contractCan.viewValues(user);
  const v = (x: number | null) => (values ? money(x) : null);
  const lbl = (r: any) => ({ ...r, status: CONTRACT_STATUS_LABELS[r.status as 'ativo'] || r.status, tipo: CONTRACT_TYPE_LABELS[r.tipo as 'venda'] || r.tipo });
  const cols = `c.contract_number AS numero, json_extract(c.customer_snapshot, '$.name') AS cliente, c.contract_type AS tipo, c.status, c.start_date AS inicio, c.end_date AS termino`;
  switch (kind) {
    case 'ativos_periodo':
      return (db.prepare(`SELECT ${cols}, c.period_amount AS valor_periodo, c.monthly_equivalent AS mensal_equivalente FROM contracts c WHERE c.status NOT IN ('rascunho','aguardando_aprovacao','aprovado','aguardando_assinatura','cancelado') AND c.start_date <= ? AND COALESCE(c.end_date, '9999-12-31') >= ? ORDER BY c.start_date`).all(to, from) as any[]).map((r) => lbl({ ...r, valor_periodo: v(r.valor_periodo), mensal_equivalente: v(r.mensal_equivalente) }));
    case 'por_cliente':
      return (db.prepare(`SELECT json_extract(c.customer_snapshot, '$.name') AS cliente, COUNT(*) AS contratos, SUM(c.status IN ('ativo','agendado','vencido','pendente_devolucao')) AS vigentes, SUM(c.status = 'encerrado') AS encerrados, SUM(COALESCE(c.estimated_total,0)) AS valor_contratado FROM contracts c WHERE c.status != 'cancelado' GROUP BY c.customer_id ORDER BY contratos DESC`).all() as any[]).map((r) => ({ ...r, valor_contratado: v(r.valor_contratado) }));
    case 'vencendo': {
      const s = getContractSettings(db);
      return (db.prepare(`SELECT ${cols}, u.name AS responsavel FROM contracts c LEFT JOIN users u ON u.id = c.responsible_user_id WHERE c.status IN ('ativo','agendado') AND c.end_date BETWEEN ? AND ? ORDER BY c.end_date`).all(today, addDays(today, Math.max(...s.alert_days))) as any[]).map(lbl);
    }
    case 'vencidos':
      return (db.prepare(`SELECT ${cols}, (SELECT COALESCE(SUM(quantity),0) FROM stock_reservations x WHERE x.contract_id = c.id AND x.status = 'em_uso') AS unidades_com_cliente FROM contracts c WHERE c.status IN ('vencido','pendente_devolucao') ORDER BY c.end_date`).all() as any[]).map(lbl);
    case 'encerrados_cancelados':
      return (db.prepare(`SELECT ${cols}, COALESCE(c.closed_at, c.cancelled_at) AS data, c.cancellation_reason AS motivo FROM contracts c WHERE c.status IN ('encerrado','cancelado') AND substr(COALESCE(c.closed_at, c.cancelled_at),1,10) BETWEEN ? AND ? ORDER BY data DESC`).all(from, to) as any[]).map(lbl);
    case 'valor_contratado':
      return (db.prepare(`SELECT substr(c.activated_at,1,7) AS mes, COUNT(*) AS contratos, SUM(COALESCE(c.estimated_total,0)) AS valor_contratado, SUM(c.estimated_total IS NULL) AS prazo_indeterminado FROM contracts c WHERE c.activated_at IS NOT NULL AND substr(c.activated_at,1,10) BETWEEN ? AND ? GROUP BY mes ORDER BY mes`).all(from, to) as any[]).map((r) => ({ ...r, valor_contratado: v(r.valor_contratado) }));
    case 'receita_recorrente':
      return (db.prepare(`SELECT ${cols}, c.billing_frequency AS periodicidade, c.period_amount AS valor_periodo, c.monthly_equivalent AS mensal_equivalente FROM contracts c WHERE c.contract_type = 'locacao' AND c.status IN ('ativo','agendado','vencido','pendente_devolucao') AND c.billing_frequency != 'unico' ORDER BY c.monthly_equivalent DESC`).all() as any[]).map((r) => lbl({ ...r, valor_periodo: v(r.valor_periodo), mensal_equivalente: v(r.mensal_equivalente) }));
    case 'cobrancas_abertas':
      if (!contractCan.viewFinance(user)) throw forbidden();
      return (
        db
          .prepare(
            `SELECT c.contract_number AS numero, json_extract(c.customer_snapshot, '$.name') AS cliente, ch.description AS cobranca, e.entry_number AS titulo, i.due_date AS vencimento,
               i.original_amount - i.discount + i.interest + i.penalty + i.additional AS valor, i.settled_amount AS recebido, i.status AS situacao
             FROM contract_charges ch JOIN contracts c ON c.id = ch.contract_id JOIN financial_entries e ON e.id = ch.financial_entry_id JOIN financial_installments i ON i.entry_id = e.id
             WHERE ch.status = 'gerado' AND i.status IN ('aberto','parcial') ORDER BY i.due_date`
          )
          .all() as any[]
      ).map((r) => ({ ...r, valor: money(r.valor), recebido: money(r.recebido), pendente: money(r.valor - r.recebido), situacao: r.vencimento < today ? 'vencida' : r.situacao }));
    case 'equipamentos':
      return db
        .prepare(
          `SELECT c.contract_number AS numero, json_extract(c.customer_snapshot, '$.name') AS cliente, i.internal_code AS codigo, i.description AS descricao, a.asset_tag AS patrimonio,
             r.quantity AS quantidade, r.status AS situacao, r.start_date AS inicio, r.end_date AS termino
           FROM stock_reservations r JOIN contracts c ON c.id = r.contract_id JOIN catalog_items i ON i.id = r.item_id LEFT JOIN stock_assets a ON a.id = r.asset_id
           WHERE r.status IN ('confirmada','em_uso') ORDER BY c.contract_number`
        )
        .all()
        .map((r: any) => ({ ...r, situacao: r.situacao === 'em_uso' ? 'com o cliente' : 'reservado', termino: r.termino === '2099-12-31' ? 'indeterminado' : r.termino }));
    case 'devolucoes_atrasadas':
      return db
        .prepare(
          `SELECT c.contract_number AS numero, json_extract(c.customer_snapshot, '$.name') AS cliente, i.internal_code AS codigo, a.asset_tag AS patrimonio, r.quantity AS quantidade, r.end_date AS devolucao_prevista,
             CAST(julianday(?) - julianday(r.end_date) AS INTEGER) AS dias_atraso
           FROM stock_reservations r JOIN contracts c ON c.id = r.contract_id JOIN catalog_items i ON i.id = r.item_id LEFT JOIN stock_assets a ON a.id = r.asset_id
           WHERE r.status = 'em_uso' AND r.end_date < ? ORDER BY r.end_date`
        )
        .all(today, today);
    case 'renovacoes':
      return (
        db
          .prepare(
            `SELECT c.contract_number AS numero, json_extract(c.customer_snapshot, '$.name') AS cliente, a.number AS aditivo, a.amendment_type AS tipo_aditivo, a.previous_end AS termino_anterior,
               a.new_end AS novo_termino, a.previous_amount AS valor_anterior, a.new_amount AS novo_valor, a.reason AS justificativa, u.name AS registrado_por, a.created_at AS data
             FROM contract_amendments a JOIN contracts c ON c.id = a.contract_id LEFT JOIN users u ON u.id = a.created_by WHERE substr(a.created_at,1,10) BETWEEN ? AND ? ORDER BY a.created_at DESC`
          )
          .all(from, to) as any[]
      ).map((r) => ({ ...r, tipo_aditivo: AMENDMENT_LABELS[r.tipo_aditivo as 'reajuste'], valor_anterior: v(r.valor_anterior), novo_valor: v(r.novo_valor) }));
    case 'avarias':
      return db
        .prepare(
          `SELECT c.contract_number AS numero, json_extract(c.customer_snapshot, '$.name') AS cliente, o.number AS devolucao, substr(o.performed_at,1,10) AS data, ci.item_code_snapshot AS codigo,
             a.asset_tag AS patrimonio, oi.classification AS situacao, oi.damaged_qty AS avariadas, oi.maintenance_qty AS manutencao, oi.missing_qty AS faltantes, oi.notes AS descricao
           FROM contract_operation_items oi JOIN contract_operations o ON o.id = oi.operation_id JOIN contracts c ON c.id = o.contract_id JOIN contract_items ci ON ci.id = oi.contract_item_id
           LEFT JOIN stock_assets a ON a.id = oi.asset_id
           WHERE o.operation_type = 'devolucao' AND (oi.classification IN ('avaria','manutencao') OR oi.damaged_qty > 0 OR oi.maintenance_qty > 0 OR oi.missing_qty > 0)
             AND substr(o.performed_at,1,10) BETWEEN ? AND ? ORDER BY o.performed_at DESC`
        )
        .all(from, to);
    default:
      return null;
  }
}
