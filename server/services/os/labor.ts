/**
 * Mão de obra (atividades) e serviços terceirizados da OS.
 *
 * - Atividade registra o tempo efetivamente trabalhado; correção por estorno (nunca exclusão).
 * - Serviço terceirizado: previsto → aprovado → concluído (realizado). Previsto não é despesa.
 * - Encaminhar ao Financeiro cria UMA conta a pagar por serviço (origem os_servico:<id>), sujeita à alçada do Financeiro.
 */

import { DB, transaction } from '../../db';
import { HttpError, badRequest, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { addDaysISO, isISODate, todayISO } from '../../../shared/orcamentos/dates';
import { Activity, OutsourcedService } from '../../../shared/os/types';
import { laborCost, minutesBetween, osCan } from '../../../shared/os/rules';
import { insertEntry, normalizeEntry } from '../finance/entries';
import { NOW_SQL, assertOpen, cents, getOsSettings, loadRawOrder, orderEvent, recalcCostsTx, text } from './core';

// ------------------------------------------------ atividades

export function addActivity(db: DB, user: AuthUser, orderId: number, raw: any) {
  if (!osCan.labor(user)) throw forbidden();
  const description = text(raw?.description, 1000);
  if (!description) throw badRequest('Descreva a atividade.', { description: 'Obrigatório.' });
  const started = raw?.started_at;
  const ended = raw?.ended_at;
  if (!started || !ended || Number.isNaN(Date.parse(started)) || Number.isNaN(Date.parse(ended))) throw badRequest('Informe início e término.', { started_at: 'Obrigatório.' });
  const mins = minutesBetween(started, ended);
  if (mins <= 0) throw badRequest('O término deve ser posterior ao início.', { ended_at: 'Data inválida.' });
  if (mins > 24 * 60) throw badRequest('Atividade acima de 24 h: registre em mais de um lançamento.', { ended_at: 'Período muito longo.' });
  if (Date.parse(ended) > Date.now() + 5 * 60_000) throw badRequest('Não registre atividade futura.', { ended_at: 'Data futura.' });
  const rate = cents(raw?.hourly_rate, 'Valor por hora');
  let techId: number | null = raw?.technician_user_id ? Number(raw.technician_user_id) : null;
  let techName = text(raw?.technician_name, 120);
  if (techId) {
    const u = db.prepare('SELECT name FROM users WHERE id = ? AND active = 1').get(techId) as { name: string } | undefined;
    if (!u) throw badRequest('Técnico inválido.');
    techName = u.name;
  }
  if (!techName) throw badRequest('Informe o técnico ou prestador.', { technician_name: 'Obrigatório.' });
  return transaction(db, () => {
    const o = loadRawOrder(db, orderId);
    assertOpen(o);
    const row = db
      .prepare(
        `INSERT INTO work_order_activities (work_order_id, description, technician_user_id, technician_name, started_at, ended_at, duration_minutes, hourly_rate, labor_cost, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
      )
      .get(orderId, description, techId, techName, new Date(started).toISOString(), new Date(ended).toISOString(), mins, rate, laborCost(rate, mins), text(raw?.notes, 1000), user.id) as { id: number };
    if (!o.started_at) db.prepare('UPDATE work_orders SET started_at = ? WHERE id = ?').run(new Date(started).toISOString(), orderId);
    orderEvent(db, orderId, 'atividade', `Atividade registrada: ${description} (${techName}, ${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}).`, user);
    recalcCostsTx(db, orderId);
    return { id: row.id };
  });
}

export function voidActivity(db: DB, user: AuthUser, orderId: number, activityId: number, raw: any) {
  if (!osCan.labor(user)) throw forbidden();
  const reason = text(raw?.reason, 500);
  if (!reason) throw badRequest('Informe o motivo do estorno.', { reason: 'Obrigatório.' });
  transaction(db, () => {
    const o = loadRawOrder(db, orderId);
    assertOpen(o);
    const a = db.prepare('SELECT * FROM work_order_activities WHERE id = ? AND work_order_id = ?').get(activityId, orderId) as any;
    if (!a) throw notFound('Atividade não encontrada.');
    if (a.voided) throw new HttpError(422, 'Atividade já estornada.');
    db.prepare('UPDATE work_order_activities SET voided = 1, void_reason = ? WHERE id = ?').run(reason, activityId);
    orderEvent(db, orderId, 'atividade', `Atividade estornada: ${a.description}. Motivo: ${reason}`, user);
    recalcCostsTx(db, orderId);
  });
}

export function listActivities(db: DB, orderId: number): Activity[] {
  return (db.prepare('SELECT * FROM work_order_activities WHERE work_order_id = ? ORDER BY started_at, id').all(orderId) as any[]).map((a) => ({ ...a, voided: !!a.voided }));
}

// ------------------------------------------------ serviços terceirizados

export function addService(db: DB, user: AuthUser, orderId: number, raw: any) {
  if (!osCan.edit(user)) throw forbidden();
  const description = text(raw?.description, 500);
  if (!description) throw badRequest('Descreva o serviço contratado.', { description: 'Obrigatório.' });
  const supplier = db.prepare('SELECT id, name, active FROM suppliers WHERE id = ?').get(Number(raw?.supplier_id)) as any;
  if (!supplier) throw badRequest('Selecione o fornecedor.', { supplier_id: 'Obrigatório.' });
  if (!supplier.active) throw badRequest('Fornecedor inativo.');
  const est = cents(raw?.estimated_cost, 'Valor previsto');
  if (raw?.expected_date && !isISODate(raw.expected_date)) throw badRequest('Data prevista inválida.');
  return transaction(db, () => {
    const o = loadRawOrder(db, orderId);
    assertOpen(o);
    const row = db
      .prepare(
        `INSERT INTO work_order_services (work_order_id, supplier_id, description, supplier_document, estimated_cost, expected_date, status, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, 'pendente_aprovacao', ?, ?) RETURNING id`
      )
      .get(orderId, supplier.id, description, text(raw?.supplier_document, 60), est, raw?.expected_date || null, text(raw?.notes, 1000), user.id) as { id: number };
    orderEvent(db, orderId, 'servico', `Serviço terceirizado previsto: ${description} (${supplier.name}).`, user);
    recalcCostsTx(db, orderId);
    return { id: row.id };
  });
}

export function serviceAction(db: DB, user: AuthUser, orderId: number, serviceId: number, action: string, raw: any) {
  return transaction(db, () => {
    const o = loadRawOrder(db, orderId);
    const s = db.prepare('SELECT s.*, f.name AS supplier_name FROM work_order_services s JOIN suppliers f ON f.id = s.supplier_id WHERE s.id = ? AND s.work_order_id = ?').get(serviceId, orderId) as any;
    if (!s) throw notFound('Serviço não encontrado.');
    const need = (st: string[]) => {
      if (!st.includes(s.status)) throw new HttpError(422, 'Ação indisponível para o serviço no status atual.');
    };
    switch (action) {
      case 'aprovar': {
        if (!osCan.approve(user)) throw forbidden('Aprovação de custos exige gestor ou administrador.');
        assertOpen(o);
        need(['pendente_aprovacao']);
        const approved = cents(raw?.approved_cost ?? s.estimated_cost, 'Valor aprovado');
        db.prepare(`UPDATE work_order_services SET status = 'aprovado', approved_cost = ?, approved_by = ?, approved_at = ${NOW_SQL}, updated_at = ${NOW_SQL} WHERE id = ?`).run(approved, user.id, serviceId);
        orderEvent(db, orderId, 'servico', `Serviço aprovado: ${s.description} — ${(approved / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`, user);
        break;
      }
      case 'reprovar': {
        if (!osCan.approve(user)) throw forbidden();
        assertOpen(o);
        need(['pendente_aprovacao']);
        const reason = text(raw?.reason, 500);
        if (!reason) throw badRequest('Informe o motivo.', { reason: 'Obrigatório.' });
        db.prepare(`UPDATE work_order_services SET status = 'reprovado', notes = COALESCE(notes || char(10), '') || ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(`Reprovado: ${reason}`, serviceId);
        orderEvent(db, orderId, 'servico', `Serviço reprovado: ${s.description}. ${reason}`, user);
        break;
      }
      case 'concluir': {
        if (!osCan.edit(user)) throw forbidden();
        assertOpen(o);
        need(['aprovado']);
        const actual = cents(raw?.actual_cost, 'Valor realizado');
        if (actual <= 0) throw badRequest('Informe o valor realizado.', { actual_cost: 'Obrigatório.' });
        const date = raw?.completed_date || todayISO();
        if (!isISODate(date) || date > todayISO()) throw badRequest('Data de conclusão inválida.');
        db.prepare(`UPDATE work_order_services SET status = 'concluido', actual_cost = ?, completed_date = ?, supplier_document = COALESCE(?, supplier_document), updated_at = ${NOW_SQL} WHERE id = ?`).run(actual, date, text(raw?.supplier_document, 60), serviceId);
        orderEvent(db, orderId, 'servico', `Serviço concluído: ${s.description} — realizado ${(actual / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}${s.approved_cost && actual > s.approved_cost ? ' (acima do aprovado)' : ''}.`, user);
        break;
      }
      case 'cancelar': {
        if (!osCan.edit(user)) throw forbidden();
        need(['pendente_aprovacao', 'aprovado', 'reprovado']);
        if (s.financial_entry_id) throw new HttpError(422, 'Serviço já encaminhado ao Financeiro.');
        const reason = text(raw?.reason, 500);
        if (!reason) throw badRequest('Informe o motivo.', { reason: 'Obrigatório.' });
        db.prepare(`UPDATE work_order_services SET status = 'cancelado', notes = COALESCE(notes || char(10), '') || ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(`Cancelado: ${reason}`, serviceId);
        orderEvent(db, orderId, 'servico', `Serviço cancelado: ${s.description}. ${reason}`, user);
        break;
      }
      case 'financeiro': {
        if (!osCan.forwardFinance(user)) throw forbidden();
        need(['concluido']);
        // idempotente: o mesmo serviço nunca gera duas contas a pagar
        const dup = db.prepare("SELECT id, entry_number FROM financial_entries WHERE source_type = 'os_servico' AND source_id = ?").get(String(serviceId)) as { id: number; entry_number: string } | undefined;
        if (dup) {
          if (!s.financial_entry_id) db.prepare('UPDATE work_order_services SET financial_entry_id = ? WHERE id = ?').run(dup.id, serviceId);
          return { entry_id: dup.id, entry_number: dup.entry_number, already: true };
        }
        const cat = getOsSettings(db).maintenance_category_id;
        if (!cat) throw new HttpError(422, 'Defina a categoria financeira de manutenção em OS › Configurações.');
        const e = normalizeEntry(
          db,
          {
            description: `${s.description} — OS ${o.order_number}`.slice(0, 200),
            party_type: 'fornecedor',
            supplier_id: s.supplier_id,
            category_id: cat,
            document_ref: s.supplier_document,
            issue_date: s.completed_date || todayISO(),
            competence_date: s.completed_date || todayISO(),
            original_amount: s.actual_cost,
            plan: { total: s.actual_cost, count: 1, first_due: raw?.due_date && isISODate(raw.due_date) ? raw.due_date : addDaysISO(todayISO(), 30) },
            notes: `Serviço terceirizado da ordem de serviço ${o.order_number}.`,
            source_type: 'os_servico',
            source_id: String(serviceId),
            source_ref: o.order_number,
          },
          'pagar'
        );
        const entryId = insertEntry(db, user, e);
        db.prepare(`UPDATE work_order_services SET financial_entry_id = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(entryId, serviceId);
        const num = (db.prepare('SELECT entry_number, status FROM financial_entries WHERE id = ?').get(entryId) as { entry_number: string; status: string });
        orderEvent(db, orderId, 'financeiro', `Despesa encaminhada ao Financeiro: conta a pagar ${num.entry_number}${num.status === 'aguardando_aprovacao' ? ' (aguardando aprovação pela alçada do Financeiro)' : ''}.`, user);
        return { entry_id: entryId, entry_number: num.entry_number, already: false };
      }
      default:
        throw badRequest('Ação inválida.');
    }
    if (!['concluida', 'cancelada'].includes(o.status)) recalcCostsTx(db, orderId);
    return {};
  });
}

export function listServices(db: DB, orderId: number): OutsourcedService[] {
  return db
    .prepare(
      `SELECT s.*, f.name AS supplier_name, u.name AS approved_by_name, e.entry_number
       FROM work_order_services s JOIN suppliers f ON f.id = s.supplier_id LEFT JOIN users u ON u.id = s.approved_by LEFT JOIN financial_entries e ON e.id = s.financial_entry_id
       WHERE s.work_order_id = ? ORDER BY s.id`
    )
    .all(orderId) as any[];
}

