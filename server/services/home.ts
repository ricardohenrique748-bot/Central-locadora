/**
 * Painel geral: junta os resumos que cada módulo já calcula (contratos, financeiro, estoque,
 * logística, orçamentos) com a agenda do dia e os alertas da central. Cada bloco só vem para quem
 * pode ver aquele módulo; valores financeiros só para perfis autorizados.
 */

import { DB } from '../db';
import { todayISO } from '../../shared/orcamentos/dates';
import { AuthUser } from '../../shared/orcamentos/types';
import { contractCan } from '../../shared/contratos/rules';
import { financeCan } from '../../shared/financeiro/rules';
import { stockCan } from '../../shared/estoque/rules';
import { logCan } from '../../shared/logistica/rules';
import { canCreateQuotation } from '../../shared/orcamentos/permissions';
import { contractDashboard } from './contracts/reports';
import { financeDashboard } from './finance/reports';
import { stockDashboard } from './stock/reports';
import { logisticsDashboard } from './logistics/reports';
import { dashboard as quotationDashboard } from './reports';
import { hasModule, quotationScope } from '../../shared/acesso';
import { getSettings } from '../settings';

const RENTAL_KINDS = "('equipamento_locacao','venda_locacao')";
const OPEN_AMOUNT = 'i.original_amount - i.discount + i.interest + i.penalty + i.additional - i.settled_amount';

export function homeDashboard(db: DB, user: AuthUser) {
  const today = todayISO();
  // bloco só aparece se o perfil permite e a aba está liberada para o usuário
  const canContracts = contractCan.view(user) && hasModule(user, 'contratos');
  const canFinance = financeCan.view(user) && hasModule(user, 'financeiro');
  const canStock = stockCan.view(user) && hasModule(user, 'estoque');
  const canLog = hasModule(user, 'operacao');
  const canQuotes = quotationScope(user) !== 'nenhum';

  const contratos = canContracts ? contractDashboard(db, user) : null;

  let financeiro = null;
  if (canFinance) {
    const k = financeDashboard(db, {}).kpis;
    const due = (type: string) =>
      db
        .prepare(
          `SELECT COUNT(*) n, COALESCE(SUM(${OPEN_AMOUNT}),0) v FROM financial_installments i JOIN financial_entries e ON e.id = i.entry_id
           WHERE e.entry_type = ? AND e.status IN ('ativo','aguardando_aprovacao') AND i.status IN ('aberto','parcial') AND i.due_date = ?`
        )
        .get(type, today) as { n: number; v: number };
    financeiro = {
      saldo_atual: k.saldo_atual,
      a_receber_aberto: k.a_receber_aberto,
      a_pagar_aberto: k.a_pagar_aberto,
      vencido_receber: k.vencido_receber,
      vencido_pagar: k.vencido_pagar,
      receber_hoje: due('receber'),
      pagar_hoje: due('pagar'),
    };
  }

  const sk = stockDashboard(db, {}).kpis;
  const estoque = {
    abaixo_minimo: sk.abaixo_minimo,
    sem_saldo: sk.sem_saldo,
    eq_disponiveis: sk.eq_disponiveis,
    eq_alugados: sk.eq_alugados,
    eq_reservados: sk.eq_reservados,
    eq_manutencao: sk.eq_manutencao,
    eq_inspecao: sk.eq_inspecao,
    eq_danificados: sk.eq_danificados,
  };

  // Ocupação da frota de locação: itens por quantidade (em uso ÷ saldo + em uso) e patrimônios (alugados ÷ ativos).
  const ocupacao = db
    .prepare(
      `SELECT i.id, i.internal_code, i.description, i.tracking,
         CASE WHEN i.tracking = 'individual'
           THEN (SELECT COUNT(*) FROM stock_assets a WHERE a.item_id = i.id AND a.rental_status = 'alugado' AND a.operational_status != 'baixado')
           ELSE COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.item_id = i.id AND r.status = 'em_uso' AND r.asset_id IS NULL),0) END AS em_uso,
         CASE WHEN i.tracking = 'individual'
           THEN (SELECT COUNT(*) FROM stock_assets a WHERE a.item_id = i.id AND a.operational_status != 'baixado')
           ELSE COALESCE((SELECT SUM(b.quantity) FROM stock_balances b WHERE b.item_id = i.id),0)
              + COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r WHERE r.item_id = i.id AND r.status = 'em_uso' AND r.asset_id IS NULL),0) END AS total
       FROM catalog_items i WHERE i.active = 1 AND i.kind IN ${RENTAL_KINDS}`
    )
    .all() as { id: number; internal_code: string; description: string; tracking: string; em_uso: number; total: number }[];
  const frota = ocupacao.filter((o) => o.total > 0);
  const somaUso = frota.reduce((a, o) => a + o.em_uso, 0);
  const somaTotal = frota.reduce((a, o) => a + o.total, 0);
  const ocupacaoResumo = {
    percentual: somaTotal ? Math.round((somaUso / somaTotal) * 1000) / 10 : null,
    itens: frota
      .map((o) => ({ ...o, percentual: Math.round((o.em_uso / o.total) * 1000) / 10 }))
      .sort((a, b) => b.percentual - a.percentual || b.em_uso - a.em_uso)
      .slice(0, 8),
  };

  const logistica = canLog ? logisticsDashboard(db) : null;

  const qk = quotationDashboard(db, user, {}, getSettings(db).expiring_soon_days).kpis;
  const orcamentos = {
    elaboracao: qk.elaboracao,
    aguardando: qk.aguardando,
    aguardando_aprovacao_interna: qk.aguardando_aprovacao_interna,
    aprovados: qk.aprovados,
    taxa_conversao: qk.taxa_conversao,
    valor_aprovado: contractCan.viewValues(user) ? qk.valor_aprovado : null,
  };

  // Agenda de hoje (e atrasos ainda abertos), só com registros reais.
  type AgendaItem = { kind: string; label: string; time: string | null; ref: string; text: string; late: boolean; link: { module: string; page: string; id?: number } };
  const agenda: AgendaItem[] = [];
  if (canLog) for (const o of db
    .prepare(
      `SELECT o.id, o.number, o.op_type, o.status, o.scheduled_at, c.contract_number, json_extract(c.customer_snapshot, '$.name') AS customer
       FROM logistics_orders o JOIN contracts c ON c.id = o.contract_id
       WHERE o.status IN ('rascunho','programada','em_separacao','pronta','em_transporte','em_andamento') AND substr(o.scheduled_at,1,10) <= ?
       ORDER BY o.scheduled_at`
    )
    .all(today) as any[]) {
    const late = o.scheduled_at.slice(0, 10) < today;
    agenda.push({
      kind: o.op_type === 'entrega' ? 'entrega' : 'retirada',
      label: o.op_type === 'entrega' ? 'Entrega' : 'Retirada',
      time: late ? null : o.scheduled_at,
      ref: `${o.number} • ${o.customer || o.contract_number}`,
      text: late ? `Atrasada — programada para ${o.scheduled_at.slice(0, 10).split('-').reverse().join('/')}` : `Contrato ${o.contract_number}`,
      late,
      link: { module: 'logistica', page: 'detalhe', id: o.id },
    });
  }
  if (canContracts) {
    for (const c of db
      .prepare(
        `SELECT c.id, c.contract_number, json_extract(c.customer_snapshot, '$.name') AS customer, MIN(r.end_date) AS end_date
         FROM stock_reservations r JOIN contracts c ON c.id = r.contract_id WHERE r.status = 'em_uso' AND r.end_date <= ? GROUP BY c.id ORDER BY end_date`
      )
      .all(today) as any[]) {
      const late = c.end_date < today;
      agenda.push({ kind: 'devolucao', label: 'Devolução', time: null, ref: `${c.contract_number} • ${c.customer}`, text: late ? `Atrasada desde ${c.end_date.split('-').reverse().join('/')}` : 'Prevista para hoje', late, link: { module: 'contratos', page: 'detalhe', id: c.id } });
    }
    for (const c of db
      .prepare(`SELECT c.id, c.contract_number, json_extract(c.customer_snapshot, '$.name') AS customer FROM contracts c WHERE c.status IN ('ativo','agendado') AND c.end_date = ?`)
      .all(today) as any[])
      agenda.push({ kind: 'vencimento', label: 'Contrato vence', time: null, ref: `${c.contract_number} • ${c.customer}`, text: 'Último dia do contrato', late: false, link: { module: 'contratos', page: 'detalhe', id: c.id } });
  }
  if (canFinance) {
    for (const t of ['receber', 'pagar'] as const) {
      const d = financeiro![t === 'receber' ? 'receber_hoje' : 'pagar_hoje'];
      if (d.n) agenda.push({ kind: `financeiro_${t}`, label: t === 'receber' ? 'A receber hoje' : 'A pagar hoje', time: null, ref: `${d.n} parcela(s)`, text: `Total em aberto: ${(d.v / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, late: false, link: { module: 'financeiro', page: t } });
    }
  }
  agenda.sort((a, b) => Number(b.late) - Number(a.late) || (a.time || '').localeCompare(b.time || ''));

  // Alertas críticos/altos da central para este usuário (já filtrados por permissão na geração).
  const alertas = (
    db
      .prepare(
        `SELECT r.id, n.title, n.message, n.priority, n.category, n.link, n.created_at FROM notification_recipients r JOIN notifications n ON n.id = r.notification_id
         WHERE r.user_id = ? AND n.resolved_at IS NULL AND n.priority IN ('critica','alta')
         ORDER BY CASE n.priority WHEN 'critica' THEN 0 ELSE 1 END, r.read_at IS NOT NULL, n.created_at DESC LIMIT 8`
      )
      .all(user.id) as any[]
  ).map((a) => ({ ...a, link: a.link ? JSON.parse(a.link) : null }));

  return {
    today,
    contratos,
    financeiro,
    estoque: canStock ? estoque : null,
    ocupacao: canStock ? ocupacaoResumo : null,
    logistica,
    orcamentos: canQuotes ? orcamentos : null,
    agenda,
    alertas,
    acoes: {
      novo_orcamento: canCreateQuotation(user) && hasModule(user, 'orcamentos'),
      novo_contrato: contractCan.create(user) && canContracts,
      nova_entrega: logCan.create(user) && canLog,
      estoque: canStock,
    },
  };
}
