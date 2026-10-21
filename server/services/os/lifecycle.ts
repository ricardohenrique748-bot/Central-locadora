/**
 * Ciclo de vida da OS: transições controladas, aprovação de custos, checklist, conclusão,
 * cancelamento, bloqueio/liberação do equipamento e leitura completa (detalhe).
 */

import { DB, audit, transaction } from '../../db';
import { HttpError, badRequest, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { INSPECTION_CHECKLIST } from '../../../shared/estoque/types';
import { ChecklistItem, OPEN_STATUSES, ORDER_STATUS_LABELS, OrderDetail, OrderStatus } from '../../../shared/os/types';
import { ORDER_TRANSITIONS, minutesBetween, nextPreventive, osCan, typeRules } from '../../../shared/os/rules';
import { inspectAssetTx } from '../stock/rental';
import {
  NOW_SQL, assertOpen, blockAssetTx, costSummary, getOsSettings, loadRawOrder, nowIso, orderEvent, orderTypeLabel, recalcCostsTx, setOrderStatus, text, unblockAssetTx,
} from './core';
import { listMaterials, releaseAllReservationsTx } from './materials';
import { listActivities, listServices } from './labor';

const WAIT_NEEDS_REASON: OrderStatus[] = ['aguardando_pecas', 'aguardando_fornecedor', 'aguardando_aprovacao'];

function needsCostApproval(db: DB, o: any) {
  const limit = getOsSettings(db).approval_limit;
  return limit > 0 && o.estimated_cost > limit && !o.cost_approved_at;
}

/** Pendências que impedem concluir, conforme as regras do tipo de OS. */
export function conclusionBlockers(db: DB, o: any): string[] {
  const out: string[] = [];
  const rule = typeRules(getOsSettings(db).custom_types).find((r) => r.key === o.order_type);
  if (rule?.requires_diagnosis && !o.diagnosis) out.push('Registre o diagnóstico técnico.');
  if (!o.procedures && !db.prepare('SELECT 1 FROM work_order_activities WHERE work_order_id = ? AND voided = 0').get(o.id) && !db.prepare("SELECT 1 FROM work_order_services WHERE work_order_id = ? AND status = 'concluido'").get(o.id))
    out.push('Registre os procedimentos executados (atividade, serviço concluído ou descrição).');
  if (!o.test_result) out.push('Registre o resultado dos testes.');
  if (o.requires_checklist) {
    const items = db.prepare('SELECT label, required, result FROM work_order_checklist WHERE work_order_id = ?').all(o.id) as any[];
    if (!items.length) out.push('A OS exige checklist, mas nenhum item foi definido.');
    const missing = items.filter((i) => i.required && i.result !== 'aprovado');
    if (missing.length) out.push(`Checklist obrigatório pendente ou reprovado: ${missing.map((i) => i.label).join('; ')}.`);
  }
  const pendingMat = db
    .prepare("SELECT description_snapshot FROM work_order_materials WHERE work_order_id = ? AND status = 'ativo' AND quantity_withdrawn - quantity_returned - quantity_used > 0.0000001")
    .all(o.id) as { description_snapshot: string }[];
  if (pendingMat.length) out.push(`Material retirado sem registro de utilização ou devolução: ${pendingMat.map((m) => m.description_snapshot).join('; ')}.`);
  const openSrv = db.prepare("SELECT description FROM work_order_services WHERE work_order_id = ? AND status IN ('pendente_aprovacao','aprovado')").all(o.id) as { description: string }[];
  if (openSrv.length) out.push(`Serviço terceirizado em aberto: ${openSrv.map((s) => s.description).join('; ')}.`);
  if (o.status !== 'em_testes') out.push('A conclusão acontece a partir de "Em testes".');
  return out;
}

export function changeStatus(db: DB, user: AuthUser, id: number, raw: any) {
  const to = raw?.to as OrderStatus;
  const reason = text(raw?.reason, 1000);
  transaction(db, () => {
    const o = loadRawOrder(db, id);
    if (raw?.row_version !== undefined && Number(raw.row_version) !== o.row_version) throw new HttpError(409, 'A OS foi alterada por outra pessoa. Atualize a tela.');
    if (!ORDER_TRANSITIONS[o.status as OrderStatus]?.includes(to)) throw new HttpError(422, `Não é possível passar de "${ORDER_STATUS_LABELS[o.status as OrderStatus]}" para "${ORDER_STATUS_LABELS[to] || to}".`);
    if (to === 'cancelada') {
      if (!osCan.cancel(user)) throw forbidden('Cancelamento exige gestor ou administrador.');
      if (!reason) throw badRequest('Informe a justificativa do cancelamento.', { reason: 'Obrigatório.' });
      const withdrawn = db.prepare("SELECT 1 FROM work_order_materials WHERE work_order_id = ? AND status = 'ativo' AND quantity_withdrawn - quantity_returned - quantity_used > 0.0000001").get(id);
      if (withdrawn) throw new HttpError(422, 'Há material retirado: devolva ao estoque ou registre a utilização antes de cancelar.');
      releaseAllReservationsTx(db, user, id);
      for (const s of db.prepare("SELECT id FROM work_order_services WHERE work_order_id = ? AND status IN ('pendente_aprovacao','aprovado')").all(id) as { id: number }[])
        db.prepare(`UPDATE work_order_services SET status = 'cancelado', notes = COALESCE(notes || char(10), '') || 'Cancelado com a OS' WHERE id = ?`).run(s.id);
      recalcCostsTx(db, id);
      setOrderStatus(db, o, 'cancelada', user, `OS cancelada: ${reason}`, `cancelled_at = ${NOW_SQL}, cancellation_reason = ?`, [reason]);
      unblockAssetTx(db, user, o, 'cancelar');
      return;
    }
    if (to === 'concluida') {
      if (!osCan.conclude(user)) throw forbidden();
      const b = conclusionBlockers(db, o);
      if (b.length) throw new HttpError(422, `Não é possível concluir: ${b.join(' ')}`);
      releaseAllReservationsTx(db, user, id);
      recalcCostsTx(db, id);
      setOrderStatus(db, o, 'concluida', user, `OS concluída${reason ? `: ${reason}` : ''}.`, `completed_at = ${NOW_SQL}`);
      unblockAssetTx(db, user, o, 'concluir');
      if (o.meter_reading !== null && o.meter_reading !== undefined) {
        const plan = o.plan_id ? (db.prepare('SELECT interval_hours, interval_cycles FROM maintenance_plans WHERE id = ?').get(o.plan_id) as any) : null;
        db.prepare("INSERT INTO asset_meter_readings (asset_id, kind, reading, read_at, work_order_id, recorded_by) VALUES (?, ?, ?, ?, ?, ?)").run(o.asset_id, plan?.interval_cycles && !plan?.interval_hours ? 'ciclos' : 'horas', o.meter_reading, nowIso(), id, user.id);
      }
      if (o.plan_id) {
        // preventiva concluída: recalcula a próxima pela regra do plano
        const plan = db.prepare('SELECT * FROM maintenance_plans WHERE id = ?').get(o.plan_id) as any;
        const next = nextPreventive(plan, nowIso().slice(0, 10), o.meter_reading ?? null);
        db.prepare(`UPDATE maintenance_schedules SET last_done_at = ?, last_meter = COALESCE(?, last_meter), next_due_date = ?, next_due_meter = COALESCE(?, next_due_meter), updated_at = ${NOW_SQL} WHERE plan_id = ? AND asset_id = ?`).run(
          nowIso().slice(0, 10), o.meter_reading ?? null, next.next_due_date, next.next_due_meter, o.plan_id, o.asset_id
        );
        orderEvent(db, id, 'preventiva', `Próxima preventiva: ${next.next_due_date ? next.next_due_date.split('-').reverse().join('/') : ''}${next.next_due_meter !== null ? ` / ${next.next_due_meter} no medidor` : ''}.`, user);
      }
      return;
    }
    if (!osCan.schedule(user)) throw forbidden();
    if (WAIT_NEEDS_REASON.includes(to) && !reason) throw badRequest('Informe o motivo (a pausa fica registrada; o tempo trabalhado é preservado).', { reason: 'Obrigatório.' });
    if (to === 'programada') {
      const at = raw?.scheduled_at;
      if (!at || Number.isNaN(Date.parse(at))) throw badRequest('Informe a data do atendimento.', { scheduled_at: 'Obrigatório.' });
      setOrderStatus(db, o, to, user, `Atendimento programado para ${new Date(at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}${reason ? `: ${reason}` : ''}.`, 'scheduled_at = ?', [new Date(at).toISOString()]);
      return;
    }
    if (to === 'em_execucao' && needsCostApproval(db, o)) throw new HttpError(422, 'O custo previsto passa da alçada: a OS precisa de aprovação antes da execução.');
    setOrderStatus(db, o, to, user, `${ORDER_STATUS_LABELS[to]}${reason ? `: ${reason}` : ''}.`, to === 'em_execucao' ? `started_at = COALESCE(started_at, ${NOW_SQL})` : '');
  });
  audit(db, 'work_order', id, `status:${to}`, user.id);
}

/** Aprovação do custo previsto da OS (alçada). */
export function approveCost(db: DB, user: AuthUser, id: number, raw: any) {
  if (!osCan.approve(user)) throw forbidden('Aprovação de custos exige gestor ou administrador.');
  transaction(db, () => {
    const o = loadRawOrder(db, id);
    assertOpen(o);
    const c = recalcCostsTx(db, id);
    db.prepare(`UPDATE work_orders SET cost_approved_by = ?, cost_approved_at = ${NOW_SQL}, approved_estimate = ? WHERE id = ?`).run(user.id, c.estimated.total, id);
    orderEvent(db, id, 'aprovacao', `Custo previsto aprovado: ${(c.estimated.total / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}${text(raw?.notes, 300) ? ` — ${text(raw.notes, 300)}` : ''}.`, user);
    // aprovada em espera de aprovação: segue para execução se pedido; senão o responsável define o próximo passo
    if (o.status === 'aguardando_aprovacao' && raw?.next === 'em_execucao') setOrderStatus(db, o, 'em_execucao', user, 'Aprovação registrada: execução iniciada.', `started_at = COALESCE(started_at, ${NOW_SQL})`);
  });
}

export function answerChecklist(db: DB, user: AuthUser, id: number, raw: any) {
  if (!osCan.edit(user)) throw forbidden();
  const answers: { id: number; result: string | null; notes?: string }[] = Array.isArray(raw?.answers) ? raw.answers : [];
  transaction(db, () => {
    const o = loadRawOrder(db, id);
    assertOpen(o);
    for (const a of answers) {
      const it = db.prepare('SELECT * FROM work_order_checklist WHERE id = ? AND work_order_id = ?').get(a.id, id) as any;
      if (!it) throw notFound('Item de checklist não encontrado.');
      const result = a.result && ['aprovado', 'reprovado', 'nao_aplicavel'].includes(a.result) ? a.result : null;
      if (result === 'nao_aplicavel' && it.required) throw badRequest(`"${it.label}" é obrigatório: não pode ser "não aplicável".`);
      if (result === 'reprovado' && !text(a.notes, 500)) throw badRequest(`Descreva a reprovação de "${it.label}".`);
      db.prepare(`UPDATE work_order_checklist SET result = ?, notes = ?, answered_by = ?, answered_at = ${NOW_SQL} WHERE id = ?`).run(result, text(a.notes, 500), result ? user.id : null, a.id);
    }
    if (raw?.add_item && text(raw.add_item.label, 200)) {
      const pos = ((db.prepare('SELECT MAX(position) p FROM work_order_checklist WHERE work_order_id = ?').get(id) as { p: number | null }).p || 0) + 1;
      db.prepare('INSERT INTO work_order_checklist (work_order_id, position, label, required) VALUES (?, ?, ?, ?)').run(id, pos, text(raw.add_item.label, 200), raw.add_item.required ? 1 : 0);
    }
    orderEvent(db, id, 'checklist', 'Checklist atualizado.', user);
  });
}

/** Bloqueio/desbloqueio manual (classificação de impacto alterada), com justificativa. */
export function setBlocking(db: DB, user: AuthUser, id: number, raw: any) {
  if (!osCan.edit(user)) throw forbidden();
  const reason = text(raw?.reason, 500);
  if (!reason) throw badRequest('Informe a justificativa.', { reason: 'Obrigatório.' });
  transaction(db, () => {
    const o = loadRawOrder(db, id);
    assertOpen(o);
    if (raw?.block) {
      if (o.blocks_equipment) throw new HttpError(422, 'O equipamento já está bloqueado por esta OS.');
      blockAssetTx(db, user, o);
      orderEvent(db, id, 'bloqueio', `Equipamento bloqueado para locação: ${reason}`, user);
    } else {
      if (!o.blocks_equipment) throw new HttpError(422, 'Esta OS não bloqueia o equipamento.');
      unblockAssetTx(db, user, o, 'desbloquear');
      db.prepare('UPDATE work_orders SET blocks_equipment = 0 WHERE id = ?').run(id);
      orderEvent(db, id, 'bloqueio', `Bloqueio retirado (equipamento segue para inspeção antes de voltar à locação): ${reason}`, user);
    }
  });
}

/**
 * Liberação técnica após a OS: registra a inspeção aprovada no Estoque (checklist de inspeção completo)
 * e o equipamento volta a ser locável. Exige OS concluída e checklist da OS aprovado, quando houver.
 */
export function releaseEquipment(db: DB, user: AuthUser, id: number, raw: any) {
  if (!osCan.conclude(user)) throw forbidden();
  transaction(db, () => {
    const o = loadRawOrder(db, id);
    if (o.status !== 'concluida') throw new HttpError(422, 'A liberação acontece após a conclusão da OS.');
    const a = db.prepare('SELECT operational_status FROM stock_assets WHERE id = ?').get(o.asset_id) as { operational_status: string };
    if (a.operational_status !== 'aguardando_inspecao') throw new HttpError(422, 'O equipamento não está aguardando inspeção.');
    const checklist: Record<string, boolean> = {};
    for (const c of INSPECTION_CHECKLIST) checklist[c.key] = !!raw?.checklist?.[c.key];
    inspectAssetTx(db, user, o.asset_id, { result: 'aprovado', checklist, notes: `Liberado após a OS ${o.order_number}. ${text(raw?.notes, 500) || ''}`.trim() });
    db.prepare(`UPDATE work_orders SET downtime_end = COALESCE(downtime_end, ${NOW_SQL}) WHERE id = ?`).run(id);
    orderEvent(db, id, 'liberacao', 'Inspeção aprovada: equipamento liberado para locação.', user);
  });
}

// ------------------------------------------------ detalhe

export function availableActions(db: DB, o: any, user: AuthUser) {
  const actions: string[] = [];
  const blockers: Record<string, string> = {};
  const open = OPEN_STATUSES.includes(o.status);
  if (open && osCan.edit(user)) actions.push('editar', o.blocks_equipment ? 'desbloquear' : 'bloquear');
  if (open && osCan.approve(user) && getOsSettings(db).approval_limit > 0 && o.estimated_cost > getOsSettings(db).approval_limit && !o.cost_approved_at) actions.push('aprovar_custo');
  if (open && osCan.materials(user)) actions.push('materiais');
  if (open && osCan.labor(user)) actions.push('atividade');
  if (open && osCan.edit(user)) actions.push('servico');
  const transitions = (ORDER_TRANSITIONS[o.status as OrderStatus] || []).filter((t) => (t === 'cancelada' ? osCan.cancel(user) : t === 'concluida' ? osCan.conclude(user) : osCan.schedule(user)));
  if (transitions.includes('concluida')) {
    const b = conclusionBlockers(db, o);
    if (b.length) blockers.concluida = b.join(' ');
  }
  if (transitions.includes('em_execucao') && needsCostApproval(db, o)) blockers.em_execucao = 'Custo previsto acima da alçada: aguarde a aprovação.';
  if (o.status === 'concluida' && osCan.conclude(user)) {
    const a = db.prepare('SELECT operational_status FROM stock_assets WHERE id = ?').get(o.asset_id) as { operational_status: string };
    if (a.operational_status === 'aguardando_inspecao') actions.push('liberar');
  }
  return { transitions, actions, blockers };
}

export function getOrderDetail(db: DB, user: AuthUser, id: number): OrderDetail {
  if (!osCan.view(user)) throw forbidden();
  const o = db
    .prepare(
      `SELECT w.*, ur.name AS responsible_name, uc.name AS created_by_name, ua.name AS cost_approved_by_name, c.contract_number, json_extract(c.customer_snapshot, '$.name') AS contract_customer,
         p.name AS plan_name, a.operational_status, a.rental_status, l.name AS location_now
       FROM work_orders w LEFT JOIN users ur ON ur.id = w.responsible_user_id LEFT JOIN users uc ON uc.id = w.created_by LEFT JOIN users ua ON ua.id = w.cost_approved_by
       LEFT JOIN contracts c ON c.id = w.contract_id LEFT JOIN maintenance_plans p ON p.id = w.plan_id
       JOIN stock_assets a ON a.id = w.asset_id LEFT JOIN stock_locations l ON l.id = a.location_id WHERE w.id = ?`
    )
    .get(id) as any;
  if (!o) throw notFound('Ordem de serviço não encontrada.');
  const { transitions, actions, blockers } = availableActions(db, o, user);
  const now = o.status_since && OPEN_STATUSES.includes(o.status) ? minutesBetween(o.status_since, nowIso()) : 0;
  const bucketNow = (s: string) => (o.status === s ? now : 0);
  const worked = (db.prepare('SELECT COALESCE(SUM(duration_minutes),0) v FROM work_order_activities WHERE work_order_id = ? AND voided = 0').get(id) as { v: number }).v;
  const costs = osCan.viewCosts(user) ? costSummary(db, id) : null;
  const materials = listMaterials(db, id);
  return {
    id: o.id, order_number: o.order_number, status: o.status, order_type: o.order_type, order_type_label: orderTypeLabel(db, o.order_type), origin: o.origin, requester: o.requester,
    responsible_user_id: o.responsible_user_id, responsible_name: o.responsible_name, priority: o.priority, due_date: o.due_date, scheduled_at: o.scheduled_at, title: o.title,
    description: o.description, symptoms: o.symptoms, defect_category: o.defect_category, probable_cause: o.probable_cause, diagnosis: o.diagnosis, root_cause: o.root_cause,
    requested_service: o.requested_service, procedures: o.procedures, operational_risk: o.operational_risk, blocks_equipment: !!o.blocks_equipment, requires_checklist: !!o.requires_checklist,
    test_result: o.test_result, safety_notes: o.safety_notes, recommendations: o.recommendations, notes: o.notes, meter_reading: o.meter_reading,
    estimated_labor: costs ? o.estimated_labor : 0, estimated_other: costs ? o.estimated_other : 0, actual_other: costs ? o.actual_other : 0, actual_other_description: o.actual_other_description,
    cost_approved_by_name: o.cost_approved_by_name, cost_approved_at: o.cost_approved_at,
    asset: JSON.parse(o.asset_snapshot), asset_now: { operational_status: o.operational_status, rental_status: o.rental_status, location_name: o.location_now },
    contract: o.contract_id ? { id: o.contract_id, contract_number: o.contract_number, customer_name: o.contract_customer } : null,
    plan: o.plan_id ? { id: o.plan_id, name: o.plan_name } : null,
    opened_at: o.opened_at, started_at: o.started_at, completed_at: o.completed_at, downtime_start: o.downtime_start, downtime_end: o.downtime_end,
    cancelled_at: o.cancelled_at, cancellation_reason: o.cancellation_reason, created_by_name: o.created_by_name, row_version: o.row_version,
    materials: costs ? materials : materials.map((m) => ({ ...m, unit_cost: null, estimated_unit_cost: null })),
    activities: listActivities(db, id).map((a) => (costs ? a : { ...a, hourly_rate: 0, labor_cost: 0 })),
    services: listServices(db, id).map((s) => (costs ? s : { ...s, estimated_cost: 0, approved_cost: null, actual_cost: null })),
    checklist: (db.prepare('SELECT c.*, u.name AS answered_by_name FROM work_order_checklist c LEFT JOIN users u ON u.id = c.answered_by WHERE c.work_order_id = ? ORDER BY c.position').all(id) as any[]).map(
      (c): ChecklistItem => ({ id: c.id, label: c.label, required: !!c.required, result: c.result, notes: c.notes, answered_by_name: c.answered_by_name, answered_at: c.answered_at })
    ),
    attachments: db.prepare('SELECT t.id, t.category, t.title, t.file_name, t.mime_type, u.name AS uploaded_by_name, t.created_at FROM work_order_attachments t LEFT JOIN users u ON u.id = t.uploaded_by WHERE t.work_order_id = ? ORDER BY t.id DESC').all(id) as any[],
    events: db.prepare('SELECT e.*, u.name AS performed_by_name FROM work_order_events e LEFT JOIN users u ON u.id = e.performed_by WHERE e.work_order_id = ? ORDER BY e.id DESC').all(id) as any[],
    costs,
    times: {
      waiting_evaluation_min: o.wait_evaluation_min + bucketNow('aberta') + bucketNow('aguardando_avaliacao') + bucketNow('programada'),
      waiting_approval_min: o.wait_approval_min + bucketNow('aguardando_aprovacao'),
      waiting_parts_min: o.wait_parts_min + bucketNow('aguardando_pecas'),
      waiting_supplier_min: o.wait_supplier_min + bucketNow('aguardando_fornecedor'),
      execution_status_min: o.execution_min + bucketNow('em_execucao'),
      testing_min: o.testing_min + bucketNow('em_testes'),
      worked_min: worked,
      downtime_min: o.downtime_start ? minutesBetween(o.downtime_start, o.downtime_end || nowIso()) : null,
    },
    affected_reservations:
      o.blocks_equipment && OPEN_STATUSES.includes(o.status)
        ? (db.prepare("SELECT number, start_date, end_date, contract_ref, status FROM stock_reservations WHERE asset_id = ? AND status IN ('confirmada','em_uso') ORDER BY start_date").all(o.asset_id) as any[])
        : [],
    transitions,
    actions,
    blockers,
  };
}
