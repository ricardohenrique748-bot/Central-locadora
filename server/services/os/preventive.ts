/**
 * Manutenção preventiva: planos por equipamento ou por categoria, programação por equipamento,
 * leituras de medidor (horímetro/ciclos — só quando o equipamento tem) e geração de OS sem duplicidade.
 */

import { DB, audit, transaction } from '../../db';
import { badRequest, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { addDaysISO, isISODate, todayISO } from '../../../shared/orcamentos/dates';
import { ChecklistTemplate, MaintenancePlan } from '../../../shared/os/types';
import { osCan, preventiveDue } from '../../../shared/os/rules';
import { NOW_SQL, getOsSettings, insertOrderTx, text } from './core';

// ------------------------------------------------ modelos de checklist

export function listTemplates(db: DB): ChecklistTemplate[] {
  return (db.prepare('SELECT * FROM checklist_templates ORDER BY active DESC, category IS NOT NULL, name').all() as any[]).map((t) => ({ ...t, items: JSON.parse(t.items), active: !!t.active }));
}

export function saveTemplate(db: DB, user: AuthUser, id: number | null, raw: any): ChecklistTemplate {
  if (!osCan.plans(user)) throw forbidden();
  const name = text(raw?.name, 120);
  if (!name) throw badRequest('Informe o nome do checklist.', { name: 'Obrigatório.' });
  const items = (Array.isArray(raw?.items) ? raw.items : []).map((i: any) => ({ label: text(i?.label, 200), required: !!i?.required })).filter((i: any) => i.label);
  if (!items.length) throw badRequest('Inclua ao menos um item.', { items: 'Obrigatório.' });
  const category = text(raw?.category, 80);
  const tid = transaction(db, () => {
    if (id) {
      if (!db.prepare('SELECT 1 FROM checklist_templates WHERE id = ?').get(id)) throw notFound();
      db.prepare(`UPDATE checklist_templates SET name = ?, category = ?, items = ?, active = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(name, category, JSON.stringify(items), raw?.active === false ? 0 : 1, id);
      return id;
    }
    return (db.prepare('INSERT INTO checklist_templates (name, category, items) VALUES (?, ?, ?) RETURNING id').get(name, category, JSON.stringify(items)) as { id: number }).id;
  });
  audit(db, 'checklist_template', tid, id ? 'update' : 'create', user.id);
  return listTemplates(db).find((t) => t.id === tid)!;
}

// ------------------------------------------------ medidores

export function currentMeter(db: DB, assetId: number, kind: 'horas' | 'ciclos'): number | null {
  const r = db.prepare('SELECT reading FROM asset_meter_readings WHERE asset_id = ? AND kind = ? ORDER BY id DESC LIMIT 1').get(assetId, kind) as { reading: number } | undefined;
  return r?.reading ?? null;
}

export function addMeterReading(db: DB, user: AuthUser, assetId: number, raw: any) {
  if (!osCan.edit(user) && !osCan.materials(user)) throw forbidden();
  const kind = raw?.kind === 'ciclos' ? 'ciclos' : 'horas';
  const reading = Number(raw?.reading);
  if (!Number.isFinite(reading) || reading < 0) throw badRequest('Leitura inválida.', { reading: 'Obrigatório.' });
  if (!db.prepare('SELECT 1 FROM stock_assets WHERE id = ?').get(assetId)) throw notFound('Equipamento não encontrado.');
  const last = currentMeter(db, assetId, kind);
  if (last !== null && reading < last) throw badRequest(`A leitura não pode ser menor que a anterior (${last}).`, { reading: 'Menor que a anterior.' });
  db.prepare('INSERT INTO asset_meter_readings (asset_id, kind, reading, read_at, recorded_by) VALUES (?, ?, ?, ?, ?)').run(assetId, kind, reading, new Date().toISOString(), user.id);
  return { reading };
}

// ------------------------------------------------ planos

function planAssets(db: DB, p: { asset_id: number | null; category: string | null }) {
  return p.asset_id
    ? (db.prepare("SELECT id FROM stock_assets WHERE id = ? AND operational_status != 'baixado'").all(p.asset_id) as { id: number }[])
    : (db.prepare("SELECT a.id FROM stock_assets a JOIN catalog_items i ON i.id = a.item_id WHERE i.category = ? AND a.operational_status != 'baixado'").all(p.category) as { id: number }[]);
}

/** Garante uma linha de programação por equipamento do plano (novos equipamentos da categoria entram sozinhos). */
function syncSchedules(db: DB, planId: number, firstDue: string | null) {
  const p = db.prepare('SELECT * FROM maintenance_plans WHERE id = ?').get(planId) as any;
  for (const a of planAssets(db, p)) {
    const meter = p.interval_hours ? currentMeter(db, a.id, 'horas') : p.interval_cycles ? currentMeter(db, a.id, 'ciclos') : null;
    db.prepare(
      `INSERT INTO maintenance_schedules (plan_id, asset_id, next_due_date, next_due_meter, last_meter) VALUES (?, ?, ?, ?, ?) ON CONFLICT(plan_id, asset_id) DO NOTHING`
    ).run(planId, a.id, p.interval_days ? firstDue || addDaysISO(todayISO(), p.interval_days) : null, meter !== null ? meter + (p.interval_hours || p.interval_cycles) : null, meter);
  }
}

export function savePlan(db: DB, user: AuthUser, id: number | null, raw: any) {
  if (!osCan.plans(user)) throw forbidden('Planos preventivos são gerenciados por gestor ou administrador.');
  const name = text(raw?.name, 120);
  if (!name) throw badRequest('Informe o nome do plano.', { name: 'Obrigatório.' });
  const asset_id = raw?.scope === 'categoria' ? null : raw?.asset_id ? Number(raw.asset_id) : null;
  const category = raw?.scope === 'categoria' ? text(raw?.category, 80) : null;
  if (!asset_id && !category) throw badRequest('Escolha o equipamento ou a categoria.', { asset_id: 'Obrigatório.' });
  if (asset_id && !db.prepare('SELECT 1 FROM stock_assets WHERE id = ?').get(asset_id)) throw badRequest('Equipamento inválido.');
  const num = (v: unknown, label: string) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw badRequest(`${label}: valor inválido.`);
    return n;
  };
  const interval_days = num(raw?.interval_days, 'Periodicidade em dias');
  const interval_hours = num(raw?.interval_hours, 'Periodicidade em horas');
  const interval_cycles = num(raw?.interval_cycles, 'Periodicidade em ciclos');
  if (!interval_days && !interval_hours && !interval_cycles) throw badRequest('Informe ao menos uma periodicidade (dias, horas de uso ou ciclos).', { interval_days: 'Obrigatório.' });
  if (interval_days && !Number.isInteger(interval_days)) throw badRequest('Periodicidade em dias deve ser inteira.');
  const first_due = raw?.first_due_date && isISODate(raw.first_due_date) ? raw.first_due_date : null;
  const vals = [
    name, text(raw?.description, 2000), asset_id, category, interval_days, interval_hours, interval_cycles, raw?.checklist_template_id ? Number(raw.checklist_template_id) : null,
    raw?.responsible_user_id ? Number(raw.responsible_user_id) : null, raw?.estimated_minutes ? Number(raw.estimated_minutes) : null,
    Number.isInteger(Number(raw?.lead_days)) ? Number(raw.lead_days) : getOsSettings(db).preventive_lead_days, raw?.active === false ? 0 : 1, text(raw?.notes, 2000),
  ];
  const pid = transaction(db, () => {
    let planId = id;
    if (id) {
      if (!db.prepare('SELECT 1 FROM maintenance_plans WHERE id = ?').get(id)) throw notFound();
      db.prepare(
        `UPDATE maintenance_plans SET name = ?, description = ?, asset_id = ?, category = ?, interval_days = ?, interval_hours = ?, interval_cycles = ?, checklist_template_id = ?,
           responsible_user_id = ?, estimated_minutes = ?, lead_days = ?, active = ?, notes = ?, updated_at = ${NOW_SQL} WHERE id = ?`
      ).run(...vals, id);
    } else {
      planId = (
        db.prepare(
          `INSERT INTO maintenance_plans (name, description, asset_id, category, interval_days, interval_hours, interval_cycles, checklist_template_id, responsible_user_id, estimated_minutes, lead_days, active, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
        ).get(...vals, user.id) as { id: number }
      ).id;
    }
    syncSchedules(db, planId!, first_due);
    return planId!;
  });
  audit(db, 'maintenance_plan', pid, id ? 'update' : 'create', user.id);
  return listPlans(db).find((p) => p.id === pid)!;
}

export function listPlans(db: DB): MaintenancePlan[] {
  const plans = db.prepare('SELECT p.*, a.asset_tag, u.name AS responsible_name FROM maintenance_plans p LEFT JOIN stock_assets a ON a.id = p.asset_id LEFT JOIN users u ON u.id = p.responsible_user_id ORDER BY p.active DESC, p.name').all() as any[];
  return plans.map((p) => ({
    ...p,
    active: !!p.active,
    schedules: (
      db
        .prepare(
          `SELECT s.*, a.asset_tag,
             (SELECT order_number FROM work_orders w WHERE w.plan_id = s.plan_id AND w.asset_id = s.asset_id AND w.status NOT IN ('concluida','cancelada') LIMIT 1) AS open_order
           FROM maintenance_schedules s JOIN stock_assets a ON a.id = s.asset_id WHERE s.plan_id = ? ORDER BY s.next_due_date, a.asset_tag`
        )
        .all(p.id) as any[]
    ).map((s) => ({ ...s, current_meter: p.interval_hours ? currentMeter(db, s.asset_id, 'horas') : p.interval_cycles ? currentMeter(db, s.asset_id, 'ciclos') : null })),
  }));
}

/**
 * Gera as OS preventivas vencidas ou próximas (antecedência do plano). Idempotente:
 * uma OS por (plano, equipamento, vencimento) — índice único — e nada se já houver OS aberta do plano.
 */
export function generatePreventives(db: DB, user: AuthUser | null, today = todayISO()) {
  const plans = db.prepare('SELECT * FROM maintenance_plans WHERE active = 1').all() as any[];
  let created = 0;
  transaction(db, () => {
    for (const p of plans) {
      syncSchedules(db, p.id, null);
      const actor = user || ({ id: p.created_by, name: 'Programação preventiva', email: '', role: 'gestor', active: true } as AuthUser);
      for (const s of db.prepare('SELECT s.*, a.operational_status FROM maintenance_schedules s JOIN stock_assets a ON a.id = s.asset_id WHERE s.plan_id = ?').all(p.id) as any[]) {
        if (s.operational_status === 'baixado') continue;
        const meter = p.interval_hours ? currentMeter(db, s.asset_id, 'horas') : p.interval_cycles ? currentMeter(db, s.asset_id, 'ciclos') : null;
        const due = preventiveDue(s, today, p.lead_days, meter);
        if (!due.due) continue;
        if (db.prepare("SELECT 1 FROM work_orders WHERE plan_id = ? AND asset_id = ? AND (plan_due_key = ? OR status NOT IN ('concluida','cancelada'))").get(p.id, s.asset_id, due.key)) continue;
        insertOrderTx(
          db,
          actor,
          {
            asset_id: s.asset_id,
            order_type: 'preventiva',
            origin: 'preventiva',
            priority: s.next_due_date && s.next_due_date < today ? 'alta' : 'media',
            title: `Preventiva: ${p.name}`,
            description: p.description,
            requested_service: p.notes,
            responsible_user_id: p.responsible_user_id,
            due_date: s.next_due_date && s.next_due_date >= today ? s.next_due_date : today,
            requires_checklist: true,
            blocks_equipment: false,
            requester: 'Programação preventiva',
          },
          { plan_id: p.id, plan_due_key: due.key, checklist_template_id: p.checklist_template_id }
        );
        created++;
      }
    }
  });
  return { created };
}

export function preventiveAlerts(db: DB, today = todayISO()) {
  return listPlans(db)
    .filter((p) => p.active)
    .flatMap((p) =>
      p.schedules
        .filter((s) => (s.next_due_date && s.next_due_date <= addDaysISO(today, p.lead_days)) || (s.next_due_meter !== null && s.current_meter !== null && s.current_meter >= s.next_due_meter))
        .map((s) => ({ plan_id: p.id, plan: p.name, asset_id: s.asset_id, asset_tag: s.asset_tag, next_due_date: s.next_due_date, next_due_meter: s.next_due_meter, current_meter: s.current_meter, overdue: !!s.next_due_date && s.next_due_date < today, open_order: s.open_order }))
    );
}

