/**
 * Motor de notificações: configurações, processamento recorrente, destinatários, resolução automática e log.
 *
 * - Sem duplicidade: notifications.event_key é única; destinatário é único por notificação (UNIQUE).
 *   Reprocessar o mesmo evento não cria nada novo; uma nova janela/regra (ex.: antecedência de 3 → 1 dia) cria.
 * - Eventos persistentes somem sozinhos (resolved_at) quando a condição deixa de existir: pago, devolvido, liberado.
 *   Só são resolvidos os tipos cujo gerador rodou sem erro naquela execução.
 * - Destinatários: perfis configurados ∩ perfis com acesso ao módulo (financeiro só para quem vê o Financeiro);
 *   vendedor só recebe o que é dele; responsável pelo registro quando configurado.
 * - Canais externos: nenhum provedor configurado → entrega apenas na central (delivery_status = 'central').
 */

import { DB, audit, transaction } from '../../db';
import { HttpError, badRequest, forbidden } from '../../http';
import { AuthUser, Role } from '../../../shared/orcamentos/types';
import { todayISO, addDaysISO } from '../../../shared/orcamentos/dates';
import { contractCan } from '../../../shared/contratos/rules';
import { financeCan } from '../../../shared/financeiro/rules';
import { EVENTS, EVENT_BY_TYPE, EventSetting, NotificationGlobalSettings } from '../../../shared/notificacoes/types';
import { ModuleKey, hasModule, normalizeModules } from '../../../shared/acesso';
import { Candidate, GENERATORS, Generator } from './generators';

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const ROLES: Role[] = ['admin', 'gestor', 'vendedor', 'estoquista', 'financeiro', 'tecnico', 'consulta'];

// ------------------------------------------------ configurações

export const DEFAULT_GLOBAL: NotificationGlobalSettings = { interval_minutes: 15, retention_days: 90 };

export function getGlobal(db: DB): NotificationGlobalSettings {
  const r = db.prepare("SELECT value FROM settings WHERE key = 'notifications'").get() as { value: string } | undefined;
  return r ? { ...DEFAULT_GLOBAL, ...JSON.parse(r.value) } : DEFAULT_GLOBAL;
}

export function getEventSettings(db: DB): EventSetting[] {
  const rows = new Map((db.prepare('SELECT * FROM notification_settings').all() as any[]).map((r) => [r.event_type, r]));
  return EVENTS.map((e) => {
    const r = rows.get(e.type);
    return {
      event_type: e.type,
      enabled: e.critical ? true : r ? !!r.enabled : true,
      leads: e.leads ? (r?.leads ? JSON.parse(r.leads) : e.leads) : null,
      inactivity_days: e.inactivity !== undefined ? (r?.inactivity_days ?? e.inactivity) : null,
      roles: r ? JSON.parse(r.roles) : e.roles,
      notify_responsible: r ? !!r.notify_responsible : e.responsible,
      channels: ['central'],
    };
  });
}

export function saveSettings(db: DB, user: AuthUser, raw: any) {
  if (user.role !== 'admin') throw forbidden('Somente o administrador altera as configurações de alertas da empresa.');
  const events: any[] = Array.isArray(raw?.events) ? raw.events : [];
  transaction(db, () => {
    for (const e of events) {
      const def = EVENT_BY_TYPE[e?.event_type];
      if (!def) throw badRequest(`Evento desconhecido: ${e?.event_type}`);
      if (def.critical && e.enabled === false) throw new HttpError(422, `"${def.label}" é um alerta crítico e não pode ser desativado.`);
      const leads = def.leads ? (Array.isArray(e.leads) ? e.leads : String(e.leads || '').split(/[,; ]+/)).map(Number).filter((n: number) => Number.isInteger(n) && n > 0 && n <= 180) : null;
      if (def.leads && !leads!.length) throw badRequest(`${def.label}: informe ao menos uma antecedência (dias).`);
      const inactivity = def.inactivity !== undefined ? Number(e.inactivity_days) : null;
      if (inactivity !== null && !(Number.isInteger(inactivity) && inactivity >= 0 && inactivity <= 365)) throw badRequest(`${def.label}: período inválido.`);
      const roles = (Array.isArray(e.roles) ? e.roles : []).filter((r: Role) => ROLES.includes(r));
      if (def.critical && !roles.includes('admin')) roles.push('admin'); // crítico sempre chega ao administrador
      db.prepare(
        `INSERT INTO notification_settings (event_type, enabled, leads, inactivity_days, roles, notify_responsible, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ${NOW_SQL})
         ON CONFLICT(event_type) DO UPDATE SET enabled = excluded.enabled, leads = excluded.leads, inactivity_days = excluded.inactivity_days, roles = excluded.roles,
           notify_responsible = excluded.notify_responsible, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      ).run(def.type, e.enabled === false ? 0 : 1, leads ? JSON.stringify([...new Set<number>(leads)].sort((a, b) => b - a)) : null, inactivity, JSON.stringify([...new Set(roles)]), e.notify_responsible === false ? 0 : 1, user.id);
    }
    if (raw?.global) {
      const g = { interval_minutes: Number(raw.global.interval_minutes), retention_days: Number(raw.global.retention_days) };
      if (!(Number.isInteger(g.interval_minutes) && g.interval_minutes >= 5 && g.interval_minutes <= 1440)) throw badRequest('Frequência: entre 5 e 1440 minutos.');
      if (!(Number.isInteger(g.retention_days) && g.retention_days >= 7 && g.retention_days <= 730)) throw badRequest('Retenção: entre 7 e 730 dias.');
      db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('notifications', ?, ${NOW_SQL}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(JSON.stringify(g));
    }
  });
  audit(db, 'settings', 'notifications', 'update', user.id);
}

// ------------------------------------------------ quem pode receber o quê

/** Acesso ao módulo de origem: a notificação nunca vai para quem não pode ver o registro. */
export function canReceive(role: Role, eventType: string): boolean {
  const def = EVENT_BY_TYPE[eventType];
  if (!def) return false;
  const u = { id: 0, name: '', email: '', role, active: true } as AuthUser;
  if (eventType === 'contrato.pendencia_financeira') return financeCan.view(u);
  switch (def.category) {
    case 'financeiro':
      return financeCan.view(u);
    case 'contratos':
      return contractCan.view(u);
    case 'orcamentos':
      return ['admin', 'gestor', 'vendedor', 'estoquista', 'consulta'].includes(role);
    case 'sistema':
      return role === 'admin';
    default:
      return true; // estoque, OS e logística: todos os perfis consultam
  }
}

/** Aba que o usuário precisa ter para receber alertas de cada categoria. */
const CATEGORY_MODULES: Record<string, ModuleKey[]> = {
  contratos: ['contratos'],
  financeiro: ['financeiro'],
  estoque: ['estoque'],
  logistica: ['operacao'],
  orcamentos: ['orcamentos', 'manutencao'],
  manutencao: ['manutencao'],
};

function recipientsFor(users: { id: number; role: Role; modules: string | null }[], muted: Set<string>, c: Candidate, s: EventSetting): number[] {
  const def = EVENT_BY_TYPE[c.event_type];
  const ids = new Set<number>();
  for (const u of users) {
    if (!canReceive(u.role, c.event_type)) continue;
    const need = CATEGORY_MODULES[def.category];
    const access = { role: u.role, modules: u.modules ? normalizeModules(JSON.parse(u.modules)) : null };
    if (need && !need.some((m) => hasModule(access, m))) continue; // sem a aba, sem o alerta (crítico também)
    if (!def.critical && muted.has(`${u.id}:${def.category}`)) continue;
    const isResponsible = !!c.responsible_user_id && u.id === c.responsible_user_id;
    if (u.role === 'vendedor' && !isResponsible) continue; // vendedor só recebe o que é dele
    if (s.roles.includes(u.role) || (s.notify_responsible && isResponsible)) ids.add(u.id);
  }
  return [...ids];
}

// ------------------------------------------------ processamento

export interface RunResult {
  log_id: number | null;
  status: 'sucesso' | 'parcial' | 'erro' | 'ignorado';
  created: number;
  delivered: number;
  resolved: number;
  errors: string[];
}

let running = false;

export function runProcessing(db: DB, trigger: 'agendado' | 'manual' | 'evento' | 'inicializacao', opts: { user?: AuthUser | null; generators?: Generator[]; now?: Date } = {}): RunResult {
  if (running) return { log_id: null, status: 'ignorado', created: 0, delivered: 0, resolved: 0, errors: ['Processamento já em andamento.'] };
  // trava também entre processos: uma execução "executando" recente bloqueia outra
  const busy = db.prepare("SELECT id FROM notification_processing_logs WHERE status = 'executando' AND started_at > ?").get(new Date(Date.now() - 5 * 60_000).toISOString());
  if (busy) return { log_id: null, status: 'ignorado', created: 0, delivered: 0, resolved: 0, errors: ['Processamento já em andamento.'] };
  running = true;
  const nowDate = opts.now || new Date();
  const now = nowDate.toISOString();
  const today = todayISO(nowDate);
  const logId = (db.prepare("INSERT INTO notification_processing_logs (job_type, trigger, status, triggered_by) VALUES ('alertas', ?, 'executando', ?) RETURNING id").get(trigger, opts.user?.id ?? null) as { id: number }).id;
  const errors: string[] = [];
  let created = 0;
  let delivered = 0;
  let resolved = 0;
  try {
    const settings = new Map(getEventSettings(db).map((s) => [s.event_type, s]));
    const ctx = { today, now, setting: (t: string) => settings.get(t)! };
    const candidates: Candidate[] = [];
    const okTypes = new Set<string>();
    for (const g of opts.generators || GENERATORS) {
      try {
        candidates.push(...g.run(db, ctx));
        g.types.forEach((t) => okTypes.add(t));
      } catch (e: any) {
        errors.push(`${g.name}: ${e?.message || e}`);
      }
    }
    const users = db.prepare('SELECT id, role, modules FROM users WHERE active = 1').all() as { id: number; role: Role; modules: string | null }[];
    const muted = new Set((db.prepare('SELECT user_id, category FROM notification_user_prefs WHERE muted = 1').all() as any[]).map((r) => `${r.user_id}:${r.category}`));
    transaction(db, () => {
      const seen = new Set<string>();
      for (const c of candidates) {
        const s = settings.get(c.event_type);
        const def = EVENT_BY_TYPE[c.event_type];
        if (!s || !def || !s.enabled || seen.has(c.key)) continue;
        seen.add(c.key);
        let row = db.prepare('SELECT id, resolved_at FROM notifications WHERE event_key = ?').get(c.key) as { id: number; resolved_at: string | null } | undefined;
        if (!row) {
          row = db
            .prepare(
              `INSERT INTO notifications (event_type, event_key, category, title, message, priority, source_module, source_type, source_id, link, stateful, expires_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, resolved_at`
            )
            .get(c.event_type, c.key, def.category, c.title, c.message, def.priority, c.source_module, c.source_type, c.source_id, c.link ? JSON.stringify(c.link) : null, def.stateful ? 1 : 0, addDaysISO(today, getGlobal(db).retention_days)) as any;
          created++;
        } else if (row.resolved_at) {
          // a mesma condição voltou (ex.: estorno de um recebimento): reabre e volta a ser não lida
          db.prepare('UPDATE notifications SET resolved_at = NULL, title = ?, message = ? WHERE id = ?').run(c.title, c.message, row.id);
          db.prepare('UPDATE notification_recipients SET read_at = NULL WHERE notification_id = ?').run(row.id);
        } else {
          db.prepare('UPDATE notifications SET title = ?, message = ? WHERE id = ? AND (title != ? OR message != ?)').run(c.title, c.message, row.id, c.title, c.message);
        }
        for (const uid of recipientsFor(users, muted, c, s)) {
          const r = db.prepare("INSERT OR IGNORE INTO notification_recipients (notification_id, user_id, delivery_status) VALUES (?, ?, 'central')").run(row!.id, uid);
          delivered += Number(r.changes);
        }
      }
      // condição não existe mais → resolvida (só para tipos processados sem erro)
      const open = db.prepare('SELECT id, event_type, event_key FROM notifications WHERE stateful = 1 AND resolved_at IS NULL').all() as any[];
      for (const n of open)
        if (okTypes.has(n.event_type) && !seen.has(n.event_key)) {
          db.prepare(`UPDATE notifications SET resolved_at = ${NOW_SQL} WHERE id = ?`).run(n.id);
          resolved++;
        }
      // retenção
      db.prepare(`DELETE FROM notifications WHERE expires_at < ? AND (resolved_at IS NOT NULL OR stateful = 0)`).run(today);
    });
  } catch (e: any) {
    errors.push(`gravação: ${e?.message || e}`);
  } finally {
    running = false;
  }
  const status = errors.length === 0 ? 'sucesso' : created + delivered + resolved > 0 || errors.every((x) => !x.startsWith('gravação')) ? 'parcial' : 'erro';
  db.prepare(`UPDATE notification_processing_logs SET finished_at = ${NOW_SQL}, status = ?, created_count = ?, delivered_count = ?, resolved_count = ?, error_summary = ? WHERE id = ?`).run(
    status, created, delivered, resolved, errors.length ? errors.join(' | ').slice(0, 4000) : null, logId
  );
  if (errors.length) notifyFailure(db, logId, errors);
  return { log_id: logId, status, created, delivered, resolved, errors };
}

/** Falha de processamento vira notificação crítica para os administradores (e fica no log). */
function notifyFailure(db: DB, logId: number, errors: string[]) {
  try {
    const n = db
      .prepare(
        `INSERT OR IGNORE INTO notifications (event_type, event_key, category, title, message, priority, source_module, source_type, source_id, link, stateful)
         VALUES ('sistema.falha_processamento', ?, 'sistema', 'Falha no processamento de alertas', ?, 'critica', 'notificacoes', 'log', ?, ?, 0) RETURNING id`
      )
      .get(`sistema.falha:${logId}`, `Verificação com erro: ${errors.join(' | ').slice(0, 400)}. Detalhes no log de processamento.`, logId, JSON.stringify({ module: 'notificacoes', page: 'processamento' })) as { id: number } | undefined;
    if (!n) return;
    for (const u of db.prepare("SELECT id FROM users WHERE active = 1 AND role = 'admin'").all() as { id: number }[]) db.prepare('INSERT OR IGNORE INTO notification_recipients (notification_id, user_id) VALUES (?, ?)').run(n.id, u.id);
  } catch {
    /* o log já registra a falha */
  }
}

// ------------------------------------------------ agendamento (no próprio servidor)

export function isDue(db: DB, now = new Date()): boolean {
  const last = db.prepare("SELECT started_at FROM notification_processing_logs WHERE status != 'executando' ORDER BY id DESC LIMIT 1").get() as { started_at: string } | undefined;
  if (!last) return true;
  return now.getTime() - Date.parse(last.started_at) >= getGlobal(db).interval_minutes * 60_000;
}

let eventTimer: NodeJS.Timeout | null = null;
let inlineMode = false;
let pendingEvent = false;

/** Ambiente sem processo contínuo (ex.: Vercel): sem timers, o processamento roda via runPendingProcessing a cada requisição. */
export function useInlineProcessing() {
  inlineMode = true;
}

/** Modo inline: executa o reprocessamento pendente por evento ou, se vencido, o agendado. */
export function runPendingProcessing(db: DB) {
  const trigger = pendingEvent ? 'evento' : isDue(db) ? 'agendado' : null;
  pendingEvent = false;
  if (!trigger) return;
  try {
    runProcessing(db, trigger);
  } catch (e) {
    console.error(`[notificacoes] falha no processamento (${trigger}):`, e);
  }
}

/** Disparo por evento: após operações relevantes (gravações nos módulos), reprocessa com pequeno atraso agrupado. */
export function requestEventRun(db: DB) {
  if (inlineMode) {
    pendingEvent = true;
    return;
  }
  if (eventTimer) return;
  eventTimer = setTimeout(() => {
    eventTimer = null;
    try {
      runProcessing(db, 'evento');
    } catch (e) {
      console.error('[notificacoes] falha no processamento por evento:', e);
    }
  }, 3000);
  eventTimer.unref?.();
}

export function startNotificationScheduler(db: DB) {
  const first = setTimeout(() => {
    try {
      runProcessing(db, 'inicializacao');
    } catch (e) {
      console.error('[notificacoes] falha na inicialização:', e);
    }
  }, 5000);
  first.unref?.();
  const timer = setInterval(() => {
    try {
      if (isDue(db)) runProcessing(db, 'agendado');
    } catch (e) {
      console.error('[notificacoes] falha no processamento agendado:', e);
    }
  }, 60_000);
  timer.unref?.();
  return timer;
}
