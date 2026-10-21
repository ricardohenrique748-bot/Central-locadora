/**
 * Rotas /api/notification-center (central de notificações). Login exigido antes (createApi).
 * Configurações da empresa, log e reprocessamento: somente administrador.
 */

import express from 'express';
import { DB } from './db';
import { forbidden, parseId } from './http';
import { EVENTS } from '../shared/notificacoes/types';
import { getEventSettings, getGlobal, runProcessing, saveSettings } from './services/notifications/engine';
import { getPrefs, listLogs, listMine, markAllRead, markRead, savePrefs, summary } from './services/notifications/center';

export function createNotificationsApi(db: DB) {
  const r = express.Router();
  const admin = (req: express.Request) => {
    if (req.user!.role !== 'admin') throw forbidden('Somente o administrador.');
  };

  r.get('/summary', (req, res) => res.json(summary(db, req.user!)));
  r.get('/', (req, res) => res.json(listMine(db, req.user!, req.query as Record<string, string>)));
  r.post('/read-all', (req, res) => res.json(markAllRead(db, req.user!, req.body?.category || undefined)));
  r.post('/:id/read', (req, res) => (markRead(db, req.user!, parseId(req.params.id), true), res.json({ ok: true })));
  r.post('/:id/unread', (req, res) => (markRead(db, req.user!, parseId(req.params.id), false), res.json({ ok: true })));

  r.get('/prefs', (req, res) => res.json({ muted: getPrefs(db, req.user!) }));
  r.put('/prefs', (req, res) => res.json(savePrefs(db, req.user!, req.body)));

  r.get('/settings', (req, res) => {
    const last = db.prepare("SELECT * FROM notification_processing_logs WHERE status != 'executando' ORDER BY id DESC LIMIT 1").get();
    res.json({
      events: EVENTS,
      settings: getEventSettings(db),
      global: getGlobal(db),
      last_run: last || null,
      can_edit: req.user!.role === 'admin',
      channels: [
        { key: 'central', label: 'Central do sistema', configured: true },
        { key: 'email', label: 'E-mail', configured: false, note: 'Nenhum provedor de e-mail configurado no servidor.' },
        { key: 'whatsapp', label: 'WhatsApp', configured: false, note: 'Nenhuma integração oficial (API do WhatsApp Business) configurada.' },
      ],
    });
  });
  r.put('/settings', (req, res) => (saveSettings(db, req.user!, req.body), res.json({ ok: true })));
  r.get('/logs', (req, res) => (admin(req), res.json({ rows: listLogs(db) })));
  r.post('/process', (req, res) => {
    admin(req);
    res.json(runProcessing(db, 'manual', { user: req.user! }));
  });
  return r;
}
