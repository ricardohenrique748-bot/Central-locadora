/**
 * Central do usuário: só enxerga as próprias notificações (notification_recipients.user_id = usuário logado).
 */

import { DB } from '../../db';
import { badRequest, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { CATEGORY_LABELS, Category, EVENTS, NotificationItem } from '../../../shared/notificacoes/types';

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const SELECT = `SELECT r.id, r.notification_id, r.read_at, n.event_type, n.category, n.title, n.message, n.priority, n.source_module, n.link, n.created_at, n.resolved_at
  FROM notification_recipients r JOIN notifications n ON n.id = r.notification_id`;
const map = (r: any): NotificationItem => ({ ...r, link: r.link ? JSON.parse(r.link) : null });

export function summary(db: DB, user: AuthUser) {
  const unread = (db.prepare('SELECT COUNT(*) n FROM notification_recipients r JOIN notifications n ON n.id = r.notification_id WHERE r.user_id = ? AND r.read_at IS NULL AND n.resolved_at IS NULL').get(user.id) as { n: number }).n;
  const critical = (db.prepare("SELECT COUNT(*) n FROM notification_recipients r JOIN notifications n ON n.id = r.notification_id WHERE r.user_id = ? AND r.read_at IS NULL AND n.resolved_at IS NULL AND n.priority = 'critica'").get(user.id) as { n: number }).n;
  const recent = (db.prepare(`${SELECT} WHERE r.user_id = ? AND n.resolved_at IS NULL ORDER BY r.read_at IS NOT NULL, CASE n.priority WHEN 'critica' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END, n.created_at DESC LIMIT 8`).all(user.id) as any[]).map(map);
  return { unread, critical, recent };
}

export function listMine(db: DB, user: AuthUser, f: Record<string, string | undefined>) {
  const where = ['r.user_id = ?'];
  const params: (string | number)[] = [user.id];
  if (f.status === 'unread') where.push('r.read_at IS NULL');
  if (f.status === 'read') where.push('r.read_at IS NOT NULL');
  if (f.resolved !== 'include') where.push(f.resolved === 'only' ? 'n.resolved_at IS NOT NULL' : 'n.resolved_at IS NULL');
  if (f.category) {
    where.push('n.category = ?');
    params.push(f.category);
  }
  if (f.priority) {
    where.push('n.priority = ?');
    params.push(f.priority);
  }
  if (f.q?.trim()) {
    where.push('(n.title LIKE ? OR n.message LIKE ?)');
    params.push(`%${f.q.trim()}%`, `%${f.q.trim()}%`);
  }
  if (f.from) {
    where.push('substr(n.created_at,1,10) >= ?');
    params.push(f.from);
  }
  const w = `WHERE ${where.join(' AND ')}`;
  const total = (db.prepare(`SELECT COUNT(*) n FROM notification_recipients r JOIN notifications n ON n.id = r.notification_id ${w}`).get(...params) as { n: number }).n;
  const pageSize = Math.min(Math.max(Number(f.page_size) || 30, 5), 100);
  const page = Math.max(Number(f.page) || 1, 1);
  const rows = (db.prepare(`${SELECT} ${w} ORDER BY n.created_at DESC, r.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as any[]).map(map);
  const byCategory = db
    .prepare('SELECT n.category, COUNT(*) n FROM notification_recipients r JOIN notifications n ON n.id = r.notification_id WHERE r.user_id = ? AND r.read_at IS NULL AND n.resolved_at IS NULL GROUP BY n.category')
    .all(user.id) as { category: Category; n: number }[];
  return { total, page, page_size: pageSize, rows, unread_by_category: byCategory };
}

/** Marca como lida/não lida — só a própria notificação (outro usuário recebe 404). */
export function markRead(db: DB, user: AuthUser, recipientId: number, read: boolean) {
  const r = db.prepare(`UPDATE notification_recipients SET read_at = ${read ? NOW_SQL : 'NULL'} WHERE id = ? AND user_id = ?`).run(recipientId, user.id);
  if (!r.changes) throw notFound('Notificação não encontrada.');
}

export function markAllRead(db: DB, user: AuthUser, category?: string) {
  if (category && !(category in CATEGORY_LABELS)) throw badRequest('Categoria inválida.');
  const r = db
    .prepare(`UPDATE notification_recipients SET read_at = ${NOW_SQL} WHERE user_id = ? AND read_at IS NULL ${category ? 'AND notification_id IN (SELECT id FROM notifications WHERE category = ?)' : ''}`)
    .run(...([user.id, ...(category ? [category] : [])] as (string | number)[]));
  return { updated: Number(r.changes) };
}

/** Preferências pessoais: silenciar categorias não críticas para si (alertas críticos continuam chegando). */
export function getPrefs(db: DB, user: AuthUser) {
  return (db.prepare('SELECT category FROM notification_user_prefs WHERE user_id = ? AND muted = 1').all(user.id) as { category: string }[]).map((r) => r.category);
}

export function savePrefs(db: DB, user: AuthUser, raw: any) {
  const muted: string[] = (Array.isArray(raw?.muted) ? raw.muted : []).filter((c: string) => c in CATEGORY_LABELS && c !== 'sistema');
  db.prepare('DELETE FROM notification_user_prefs WHERE user_id = ?').run(user.id);
  for (const c of muted) db.prepare('INSERT INTO notification_user_prefs (user_id, category, muted) VALUES (?, ?, 1)').run(user.id, c);
  return { muted, critical_always: EVENTS.filter((e) => e.critical).map((e) => e.label) };
}

export function listLogs(db: DB) {
  return db.prepare('SELECT l.*, u.name AS triggered_by_name FROM notification_processing_logs l LEFT JOIN users u ON u.id = l.triggered_by ORDER BY l.id DESC LIMIT 50').all();
}
