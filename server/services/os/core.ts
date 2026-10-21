/**
 * Núcleo das Ordens de Serviço: configurações, eventos, abertura/edição, bloqueio do equipamento,
 * cálculo de custos e leitura.
 *
 * - O equipamento é o patrimônio do Estoque (stock_assets); a OS guarda uma fotografia dele.
 * - Bloqueio só quando a OS é impeditiva: usa o estado "em manutenção" do Estoque e fica no histórico do ativo.
 * - Custo técnico (previsto/realizado) é distinto da obrigação financeira (conta a pagar).
 */

import { DB, audit, transaction } from '../../db';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { isISODate, todayISO, addDaysISO } from '../../../shared/orcamentos/dates';
import { INSPECTION_CHECKLIST } from '../../../shared/estoque/types';
import { CostSummary, OPEN_STATUSES, OrderStatus, OsSettings, Priority } from '../../../shared/os/types';
import { TIME_BUCKET, minutesBetween, osCan, typeRules } from '../../../shared/os/rules';
import { assetEvent, nextNumber, refreshAssetRental } from '../stock/core';

export const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
export const nowIso = () => new Date().toISOString();

export const text = (v: unknown, max = 500) => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t === '' ? null : t;
};
export const cents = (v: unknown, label: string) => {
  const n = Number(v ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > 10_000_000_00) throw badRequest(`${label}: valor inválido.`);
  return n;
};

// ------------------------------------------------ configurações

export const DEFAULT_OS_SETTINGS: OsSettings = {
  approval_limit: 0,
  maintenance_category_id: null,
  custom_types: [],
  due_days: { urgente: 1, alta: 3, media: 7, baixa: 15 },
  preventive_lead_days: 7,
};

export function getOsSettings(db: DB): OsSettings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'os'").get() as { value: string } | undefined;
  const s = row ? { ...DEFAULT_OS_SETTINGS, ...JSON.parse(row.value) } : { ...DEFAULT_OS_SETTINGS };
  if (!s.maintenance_category_id) {
    const c = db.prepare("SELECT id FROM financial_categories WHERE name = 'Manutenção' AND category_type = 'despesa' AND active = 1").get() as { id: number } | undefined;
    s.maintenance_category_id = c?.id ?? null;
  }
  return s;
}

export function saveOsSettings(db: DB, user: AuthUser, raw: any): OsSettings {
  if (!osCan.configure(user)) throw forbidden('Somente o administrador altera as configurações de manutenção.');
  const int = (v: unknown, min: number, max: number, label: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${label}: informe um número entre ${min} e ${max}.`);
    return n;
  };
  const custom = (Array.isArray(raw?.custom_types) ? raw.custom_types : [])
    .map((t: any) => ({ key: String(text(t?.label, 60) || '').toLowerCase().normalize('NFD').replace(/[^\w]+/g, '_').replace(/^_|_$/g, ''), label: text(t?.label, 60) || '', requires_diagnosis: !!t?.requires_diagnosis, requires_checklist: !!t?.requires_checklist }))
    .filter((t: any) => t.key && t.label)
    .slice(0, 20);
  const catId = raw?.maintenance_category_id ? Number(raw.maintenance_category_id) : null;
  if (catId && !db.prepare("SELECT 1 FROM financial_categories WHERE id = ? AND category_type = 'despesa'").get(catId)) throw badRequest('Categoria financeira inválida (use uma categoria de despesa).');
  const s: OsSettings = {
    approval_limit: cents(raw?.approval_limit, 'Alçada de aprovação'),
    maintenance_category_id: catId,
    custom_types: custom.map((t: any) => ({ ...t, key: `x_${t.key}` })),
    due_days: {
      urgente: int(raw?.due_days?.urgente, 0, 90, 'Prazo urgente'),
      alta: int(raw?.due_days?.alta, 0, 90, 'Prazo alta'),
      media: int(raw?.due_days?.media, 0, 180, 'Prazo média'),
      baixa: int(raw?.due_days?.baixa, 0, 365, 'Prazo baixa'),
    },
    preventive_lead_days: int(raw?.preventive_lead_days, 0, 90, 'Antecedência das preventivas'),
  };
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('os', ?, ${NOW_SQL}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(JSON.stringify(s));
  audit(db, 'settings', 'os', 'update', user.id, s);
  return s;
}

/** Modelo de checklist padrão (os itens de inspeção do Estoque), criado se não houver nenhum. */
export function seedOsIfEmpty(db: DB) {
  if ((db.prepare('SELECT COUNT(*) n FROM checklist_templates').get() as { n: number }).n) return;
  db.prepare('INSERT INTO checklist_templates (name, category, items) VALUES (?, NULL, ?)').run(
    'Inspeção geral de equipamento',
    JSON.stringify([...INSPECTION_CHECKLIST.map((c) => ({ label: c.label, required: true })), { label: 'Teste final de funcionamento em carga', required: true }, { label: 'Peças substituídas registradas', required: false }])
  );
}

// ------------------------------------------------ eventos e status

export function orderEvent(db: DB, orderId: number, type: string, description: string, user: AuthUser | null, prev: OrderStatus | null = null, next: OrderStatus | null = null, metadata?: unknown) {
  db.prepare('INSERT INTO work_order_events (work_order_id, event_type, previous_status, new_status, description, metadata, performed_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    orderId, type, prev, next, description, metadata === undefined ? null : JSON.stringify(metadata), user?.id ?? null
  );
}

const BUCKET_COL = { waiting_evaluation: 'wait_evaluation_min', waiting_approval: 'wait_approval_min', waiting_parts: 'wait_parts_min', waiting_supplier: 'wait_supplier_min', execution: 'execution_min', testing: 'testing_min' } as const;

/**
 * Troca de status com trava otimista e contabilização do tempo no status anterior
 * (espera por avaliação/aprovação/peças/fornecedor separada do tempo em execução).
 */
export function setOrderStatus(db: DB, o: { id: number; status: OrderStatus; status_since: string }, to: OrderStatus, user: AuthUser | null, description: string, extraSql = '', extraParams: (string | number | null)[] = []) {
  const bucket = TIME_BUCKET[o.status];
  const mins = minutesBetween(o.status_since, nowIso());
  const res = db
    .prepare(
      `UPDATE work_orders SET status = ?, status_since = ${NOW_SQL}, ${bucket ? `${BUCKET_COL[bucket]} = ${BUCKET_COL[bucket]} + ${mins},` : ''} ${extraSql ? `${extraSql},` : ''}
         updated_by = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ? AND status = ?`
    )
    .run(to, ...extraParams, user?.id ?? null, o.id, o.status);
  if (!res.changes) throw conflict('A OS foi alterada por outra pessoa. Atualize a tela e tente novamente.');
  orderEvent(db, o.id, 'status', description, user, o.status, to);
}

export function loadRawOrder(db: DB, id: number) {
  const o = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(id) as any;
  if (!o) throw notFound('Ordem de serviço não encontrada.');
  return o;
}

export function assertOpen(o: any) {
  if (!OPEN_STATUSES.includes(o.status)) throw new HttpError(422, 'OS encerrada: não aceita alterações. Correções são feitas em uma nova OS.');
}

// ------------------------------------------------ bloqueio do equipamento (Estoque)

/** Bloqueia o equipamento para locação (estado "em manutenção"). Dentro de transação. */
export function blockAssetTx(db: DB, user: AuthUser | null, o: any) {
  const a = db.prepare('SELECT asset_tag, operational_status FROM stock_assets WHERE id = ?').get(o.asset_id) as any;
  if (a.operational_status === 'baixado') throw new HttpError(422, `${a.asset_tag} está baixado.`);
  const prev = a.operational_status;
  if (prev !== 'em_manutencao') db.prepare(`UPDATE stock_assets SET operational_status = 'em_manutencao', updated_at = ${NOW_SQL} WHERE id = ?`).run(o.asset_id);
  db.prepare(`UPDATE work_orders SET blocks_equipment = 1, blocked_previous_status = ?, downtime_start = COALESCE(downtime_start, ${NOW_SQL}), downtime_end = NULL WHERE id = ?`).run(prev, o.id);
  assetEvent(db, o.asset_id, 'manutencao', `Bloqueado para locação pela ordem de serviço ${o.order_number}.`, user, { from: prev, to: 'em_manutencao', os: o.order_number });
  refreshAssetRental(db, o.asset_id);
}

const otherBlocking = (db: DB, o: any) =>
  !!db.prepare("SELECT 1 FROM work_orders WHERE asset_id = ? AND id != ? AND blocks_equipment = 1 AND status NOT IN ('concluida','cancelada')").get(o.asset_id, o.id);

/**
 * Fim do bloqueio. Conclusão (ou desbloqueio de OS aberta): o equipamento vai para "aguardando inspeção" —
 * só volta a ser locável após a inspeção aprovada. Cancelamento: volta ao estado anterior à OS.
 */
export function unblockAssetTx(db: DB, user: AuthUser | null, o: any, mode: 'concluir' | 'cancelar' | 'desbloquear') {
  if (!o.blocks_equipment || otherBlocking(db, o)) return;
  const a = db.prepare('SELECT operational_status FROM stock_assets WHERE id = ?').get(o.asset_id) as any;
  if (a.operational_status !== 'em_manutencao') return;
  const to = mode === 'cancelar' && o.blocked_previous_status && o.blocked_previous_status !== 'em_manutencao' ? o.blocked_previous_status : 'aguardando_inspecao';
  db.prepare(`UPDATE stock_assets SET operational_status = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(to, o.asset_id);
  if (to !== 'aguardando_inspecao' || mode === 'cancelar') db.prepare(`UPDATE work_orders SET downtime_end = ${NOW_SQL} WHERE id = ?`).run(o.id);
  assetEvent(db, o.asset_id, mode === 'cancelar' ? 'status' : 'manutencao', mode === 'cancelar' ? `OS ${o.order_number} cancelada: bloqueio retirado.` : `Manutenção da OS ${o.order_number} encerrada: aguardando inspeção para liberação.`, user, { from: 'em_manutencao', to });
  refreshAssetRental(db, o.asset_id);
}

// ------------------------------------------------ abertura e edição

const PRIORITIES: Priority[] = ['baixa', 'media', 'alta', 'urgente'];

export function orderTypeLabel(db: DB, key: string) {
  return typeRules(getOsSettings(db).custom_types).find((t) => t.key === key)?.label || key;
}

function assetSnapshot(db: DB, assetId: number) {
  const a = db
    .prepare(
      `SELECT a.id AS asset_id, a.item_id, i.internal_code AS item_code, i.description, a.asset_tag, a.serial_number, i.brand, i.model, i.category, l.name AS location_name, a.operational_status
       FROM stock_assets a JOIN catalog_items i ON i.id = a.item_id LEFT JOIN stock_locations l ON l.id = a.location_id WHERE a.id = ?`
    )
    .get(assetId) as any;
  if (!a) throw badRequest('Selecione o equipamento.', { asset_id: 'Obrigatório.' });
  return a;
}

/** Locação em curso do equipamento (contrato e cliente), sem alterar o contrato. */
export function currentRental(db: DB, assetId: number) {
  return db
    .prepare(
      `SELECT r.contract_id, r.customer_id, r.contract_ref FROM stock_reservations r WHERE r.asset_id = ? AND r.status = 'em_uso' ORDER BY r.id DESC LIMIT 1`
    )
    .get(assetId) as { contract_id: number | null; customer_id: number | null; contract_ref: string | null } | undefined;
}

function normalizeOrder(db: DB, raw: any, creating: boolean) {
  const errors: Record<string, string> = {};
  const s = getOsSettings(db);
  const rules = typeRules(s.custom_types);
  const order_type = String(raw?.order_type || '');
  const rule = rules.find((r) => r.key === order_type);
  if (!rule) errors.order_type = 'Selecione o tipo de OS.';
  const priority: Priority = PRIORITIES.includes(raw?.priority) ? raw.priority : 'media';
  const title = text(raw?.title, 160);
  if (!title || title.length < 3) errors.title = 'Descreva o defeito ou serviço solicitado.';
  const due_date = raw?.due_date || (creating ? addDaysISO(todayISO(), s.due_days[priority]) : null);
  if (due_date && !isISODate(due_date)) errors.due_date = 'Data inválida.';
  const responsible_user_id = raw?.responsible_user_id ? Number(raw.responsible_user_id) : null;
  if (responsible_user_id && !db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1 AND role IN ('admin','gestor','tecnico')").get(responsible_user_id)) errors.responsible_user_id = 'Responsável deve ser técnico, gestor ou administrador.';
  const risk = ['nenhum', 'baixo', 'medio', 'alto'].includes(raw?.operational_risk) ? raw.operational_risk : 'baixo';
  if (Object.keys(errors).length) throw badRequest('Revise os campos destacados.', errors);
  return {
    order_type,
    origin: ['interna', 'cliente', 'devolucao', 'preventiva', 'contrato', 'outra'].includes(raw?.origin) ? raw.origin : 'interna',
    requester: text(raw?.requester, 120),
    responsible_user_id,
    priority,
    due_date,
    title: title!,
    description: text(raw?.description, 4000),
    symptoms: text(raw?.symptoms, 2000),
    defect_category: text(raw?.defect_category, 80),
    probable_cause: text(raw?.probable_cause, 2000),
    requested_service: text(raw?.requested_service, 2000),
    operational_risk: risk,
    notes: text(raw?.notes, 4000),
    estimated_labor: cents(raw?.estimated_labor, 'Mão de obra prevista'),
    estimated_other: cents(raw?.estimated_other, 'Outros custos previstos'),
    requires_checklist: raw?.requires_checklist === undefined ? rule!.requires_checklist : !!raw.requires_checklist,
  };
}

/** Copia o modelo de checklist (da categoria do equipamento ou o geral) para a OS. */
export function attachChecklistTx(db: DB, orderId: number, category: string | null, templateId?: number | null) {
  if (db.prepare('SELECT 1 FROM work_order_checklist WHERE work_order_id = ?').get(orderId)) return;
  const t = (templateId
    ? db.prepare('SELECT items FROM checklist_templates WHERE id = ?').get(templateId)
    : db.prepare('SELECT items FROM checklist_templates WHERE active = 1 AND (category = ? OR category IS NULL) ORDER BY category IS NULL, id LIMIT 1').get(category)) as { items: string } | undefined;
  if (!t) return;
  const ins = db.prepare('INSERT INTO work_order_checklist (work_order_id, position, label, required) VALUES (?, ?, ?, ?)');
  (JSON.parse(t.items) as { label: string; required: boolean }[]).forEach((it, i) => ins.run(orderId, i + 1, it.label, it.required ? 1 : 0));
}

/** Abre a OS (DENTRO de transação). */
export function insertOrderTx(db: DB, user: AuthUser | null, raw: any, extra: { plan_id?: number | null; plan_due_key?: string | null; checklist_template_id?: number | null } = {}): number {
  const n = normalizeOrder(db, raw, true);
  const snap = assetSnapshot(db, Number(raw?.asset_id));
  if (snap.operational_status === 'baixado') throw new HttpError(422, `${snap.asset_tag} está baixado: não recebe OS.`);
  const rental = currentRental(db, snap.asset_id);
  const blocks = raw?.blocks_equipment === undefined ? n.operational_risk === 'alto' : !!raw.blocks_equipment;
  const { operational_status, ...snapshot } = snap;
  const row = db
    .prepare(
      `INSERT INTO work_orders (order_number, asset_id, asset_snapshot, contract_id, customer_id, plan_id, plan_due_key, order_type, origin, requester, responsible_user_id, priority, status,
         title, description, symptoms, defect_category, probable_cause, requested_service, operational_risk, requires_checklist, due_date, notes, estimated_labor, estimated_other, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberta', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, order_number`
    )
    .get(
      nextNumber(db, 'OS'), snap.asset_id, JSON.stringify(snapshot), rental?.contract_id ?? null, rental?.customer_id ?? null, extra.plan_id ?? null, extra.plan_due_key ?? null, n.order_type, n.origin, n.requester,
      n.responsible_user_id, n.priority, n.title, n.description, n.symptoms, n.defect_category, n.probable_cause, n.requested_service, n.operational_risk, n.requires_checklist ? 1 : 0, n.due_date, n.notes,
      n.estimated_labor, n.estimated_other, user?.id ?? 0, user?.id ?? null
    ) as { id: number; order_number: string };
  orderEvent(db, row.id, 'abertura', `OS aberta${rental?.contract_ref ? ` — equipamento locado no contrato ${rental.contract_ref}` : ''}.`, user, null, 'aberta');
  if (n.requires_checklist) attachChecklistTx(db, row.id, snap.category, extra.checklist_template_id);
  if (blocks) blockAssetTx(db, user, { id: row.id, order_number: row.order_number, asset_id: snap.asset_id });
  recalcCostsTx(db, row.id);
  return row.id;
}

export function createOrder(db: DB, user: AuthUser, raw: any) {
  if (!osCan.open(user)) throw forbidden();
  if (raw?.order_type === 'preventiva' && raw?.plan_id) throw badRequest('Preventivas de plano são geradas pela programação.');
  return transaction(db, () => insertOrderTx(db, user, raw));
}

export function updateOrder(db: DB, user: AuthUser, id: number, raw: any) {
  if (!osCan.edit(user)) throw forbidden();
  transaction(db, () => {
    const o = loadRawOrder(db, id);
    assertOpen(o);
    if (raw?.row_version !== undefined && Number(raw.row_version) !== o.row_version) throw conflict('A OS foi alterada por outra pessoa. Recarregue antes de salvar.');
    const n = normalizeOrder(db, { ...raw, order_type: raw?.order_type || o.order_type }, false);
    db.prepare(
      `UPDATE work_orders SET order_type = ?, origin = ?, requester = ?, responsible_user_id = ?, priority = ?, due_date = ?, title = ?, description = ?, symptoms = ?, defect_category = ?,
         probable_cause = ?, requested_service = ?, operational_risk = ?, notes = ?, estimated_labor = ?, estimated_other = ?, requires_checklist = ?,
         diagnosis = ?, root_cause = ?, procedures = ?, test_result = ?, safety_notes = ?, recommendations = ?, actual_other = ?, actual_other_description = ?, meter_reading = ?,
         updated_by = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`
    ).run(
      n.order_type, n.origin, n.requester, n.responsible_user_id, n.priority, n.due_date, n.title, n.description, n.symptoms, n.defect_category, n.probable_cause, n.requested_service, n.operational_risk,
      n.notes, n.estimated_labor, n.estimated_other, n.requires_checklist ? 1 : 0, text(raw?.diagnosis, 4000), text(raw?.root_cause, 2000), text(raw?.procedures, 4000), text(raw?.test_result, 2000),
      text(raw?.safety_notes, 2000), text(raw?.recommendations, 2000), cents(raw?.actual_other, 'Outros custos realizados'), text(raw?.actual_other_description, 200),
      raw?.meter_reading === null || raw?.meter_reading === undefined || raw?.meter_reading === '' ? null : Number(raw.meter_reading), user.id, id
    );
    if (n.requires_checklist) attachChecklistTx(db, id, JSON.parse(o.asset_snapshot).category);
    recalcCostsTx(db, id);
    orderEvent(db, id, 'edicao', 'Dados técnicos/identificação atualizados.', user);
  });
}

// ------------------------------------------------ custos

export function costSummary(db: DB, id: number): CostSummary {
  const o = db.prepare('SELECT estimated_labor, estimated_other, actual_other FROM work_orders WHERE id = ?').get(id) as any;
  const mats = db
    .prepare(
      `SELECT m.*, i.kind, i.average_cost FROM work_order_materials m JOIN catalog_items i ON i.id = m.item_id WHERE m.work_order_id = ? AND m.status = 'ativo'`
    )
    .all(id) as any[];
  let ep = 0, em = 0, ap = 0, am = 0;
  for (const m of mats) {
    const unitWithdrawn = m.quantity_withdrawn > 0 ? m.withdrawn_cost / m.quantity_withdrawn : null;
    const est = Math.round(m.quantity_requested * (m.estimated_unit_cost ?? m.average_cost ?? 0));
    const act = Math.round(m.quantity_used * (unitWithdrawn ?? 0));
    if (m.kind === 'peca') (ep += est), (ap += act);
    else (em += est), (am += act);
  }
  const labor = (db.prepare('SELECT COALESCE(SUM(labor_cost),0) v FROM work_order_activities WHERE work_order_id = ? AND voided = 0').get(id) as { v: number }).v;
  const srv = db.prepare("SELECT COALESCE(SUM(CASE WHEN status NOT IN ('reprovado','cancelado') THEN COALESCE(approved_cost, estimated_cost) END),0) est, COALESCE(SUM(CASE WHEN status = 'concluido' THEN actual_cost END),0) act FROM work_order_services WHERE work_order_id = ?").get(id) as { est: number; act: number };
  const payable = (db.prepare("SELECT COALESCE(SUM(e.original_amount),0) v FROM work_order_services s JOIN financial_entries e ON e.id = s.financial_entry_id WHERE s.work_order_id = ? AND e.status != 'cancelado'").get(id) as { v: number }).v;
  const estimated = { parts: ep, materials: em, labor: o.estimated_labor, services: srv.est, other: o.estimated_other, total: 0 };
  estimated.total = estimated.parts + estimated.materials + estimated.labor + estimated.services + estimated.other;
  const actual = { parts: ap, materials: am, labor, services: srv.act, other: o.actual_other, total: 0 };
  actual.total = actual.parts + actual.materials + actual.labor + actual.services + actual.other;
  return { estimated, actual, difference: actual.total - estimated.total, payable };
}

/** Recalcula os totais gravados na OS (usados em listas, relatórios e alçada). */
export function recalcCostsTx(db: DB, id: number) {
  const c = costSummary(db, id);
  db.prepare('UPDATE work_orders SET estimated_cost = ?, actual_cost = ? WHERE id = ? AND status NOT IN (\'concluida\',\'cancelada\')').run(c.estimated.total, c.actual.total, id);
  return c;
}
