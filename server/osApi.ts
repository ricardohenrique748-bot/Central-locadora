/**
 * Rotas /api/os (Ordens de Serviço). Login exigido antes (createApi); permissões conferidas nos serviços.
 */

import express, { Response } from 'express';
import { DB } from './db';
import { badRequest, forbidden, parseId } from './http';
import { osCan, typeRules } from '../shared/os/rules';
import { formatDateBR } from '../shared/orcamentos/dates';
import { createOrder, getOsSettings, saveOsSettings, updateOrder } from './services/os/core';
import { addMaterial, materialAction } from './services/os/materials';
import { addActivity, addService, serviceAction, voidActivity } from './services/os/labor';
import { answerChecklist, approveCost, changeStatus, getOrderDetail, releaseEquipment, setBlocking } from './services/os/lifecycle';
import { addMeterReading, generatePreventives, listPlans, listTemplates, savePlan, saveTemplate } from './services/os/preventive';
import { OS_REPORTS, addAttachment, equipmentHistory, getAttachment, listOrders, osDashboard, osReport, searchAssets } from './services/os/queries';

function sendCsv(res: Response, filename: string, rows: Record<string, unknown>[]) {
  const head = rows.length ? Object.keys(rows[0]) : ['sem_registros'];
  const fmt = (v: unknown) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(v).replace('.', ',');
    const s = String(v);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? formatDateBR(s) : s;
  };
  const esc = (v: unknown) => {
    const s = fmt(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + [head.join(';'), ...rows.map((r) => head.map((h) => esc(r[h])).join(';'))].join('\r\n'));
}

export function createOsApi(db: DB) {
  const r = express.Router();
  const q = (req: express.Request) => req.query as Record<string, string>;

  // preventivas: geradas uma vez por dia (idempotente)
  let lastGen = '';
  r.use((_req, _res, next) => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== lastGen) {
      generatePreventives(db, null);
      lastGen = today;
    }
    next();
  });

  r.get('/meta', (_req, res) =>
    res.json({
      settings: getOsSettings(db),
      types: typeRules(getOsSettings(db).custom_types),
      users: db.prepare("SELECT id, name, role FROM users WHERE active = 1 AND role IN ('admin','gestor','tecnico') ORDER BY name").all(),
      categories: (db.prepare("SELECT DISTINCT category FROM catalog_items WHERE category IS NOT NULL AND tracking = 'individual' ORDER BY category").all() as { category: string }[]).map((c) => c.category),
      reports: OS_REPORTS,
    })
  );
  r.put('/settings', (req, res) => res.json(saveOsSettings(db, req.user!, req.body)));
  r.get('/dashboard', (req, res) => res.json(osDashboard(db, req.user!, q(req))));
  r.get('/assets', (req, res) => res.json({ rows: searchAssets(db, String(req.query.q || ''), req.query.id ? parseId(req.query.id) : undefined) }));
  r.get('/equipment/:assetId/history', (req, res) => res.json({ rows: equipmentHistory(db, req.user!, parseId(req.params.assetId)) }));
  r.post('/equipment/:assetId/meter', (req, res) => res.status(201).json(addMeterReading(db, req.user!, parseId(req.params.assetId), req.body)));

  r.get('/orders', (req, res) => res.json(listOrders(db, req.user!, q(req))));
  r.get('/orders/export.csv', (req, res) => {
    if (!osCan.export(req.user!)) throw forbidden();
    sendCsv(
      res,
      'ordens-de-servico.csv',
      listOrders(db, req.user!, q(req), true).rows.map((o) => ({
        os: o.order_number, patrimonio: o.asset_tag, serie: o.serial_number, equipamento: o.item_description, tipo: o.order_type, servico: o.title, prioridade: o.priority,
        abertura: o.opened_at.slice(0, 10), prazo: o.due_date, responsavel: o.responsible_name, status: o.status, custo_realizado: o.actual_cost / 100,
      }))
    );
  });
  r.post('/orders', (req, res) => res.status(201).json({ id: createOrder(db, req.user!, req.body) }));
  r.get('/orders/:id', (req, res) => res.json(getOrderDetail(db, req.user!, parseId(req.params.id))));
  r.put('/orders/:id', (req, res) => {
    updateOrder(db, req.user!, parseId(req.params.id), req.body);
    res.json(getOrderDetail(db, req.user!, parseId(req.params.id)));
  });
  r.post('/orders/:id/status', (req, res) => {
    changeStatus(db, req.user!, parseId(req.params.id), req.body);
    res.json(getOrderDetail(db, req.user!, parseId(req.params.id)));
  });
  r.post('/orders/:id/approve-cost', (req, res) => (approveCost(db, req.user!, parseId(req.params.id), req.body), res.json({ ok: true })));
  r.post('/orders/:id/checklist', (req, res) => (answerChecklist(db, req.user!, parseId(req.params.id), req.body), res.json({ ok: true })));
  r.post('/orders/:id/blocking', (req, res) => (setBlocking(db, req.user!, parseId(req.params.id), req.body), res.json({ ok: true })));
  r.post('/orders/:id/release', (req, res) => (releaseEquipment(db, req.user!, parseId(req.params.id), req.body), res.json({ ok: true })));

  r.post('/orders/:id/materials', (req, res) => res.status(201).json(addMaterial(db, req.user!, parseId(req.params.id), req.body)));
  r.post('/orders/:id/materials/:mid/:action', (req, res) => res.json(materialAction(db, req.user!, parseId(req.params.id), parseId(req.params.mid), req.params.action, req.body)));
  r.post('/orders/:id/activities', (req, res) => res.status(201).json(addActivity(db, req.user!, parseId(req.params.id), req.body)));
  r.post('/orders/:id/activities/:aid/void', (req, res) => (voidActivity(db, req.user!, parseId(req.params.id), parseId(req.params.aid), req.body), res.json({ ok: true })));
  r.post('/orders/:id/services', (req, res) => res.status(201).json(addService(db, req.user!, parseId(req.params.id), req.body)));
  r.post('/orders/:id/services/:sid/:action', (req, res) => res.json(serviceAction(db, req.user!, parseId(req.params.id), parseId(req.params.sid), req.params.action, req.body)));

  r.post('/orders/:id/attachments', (req, res) => res.status(201).json(addAttachment(db, req.user!, parseId(req.params.id), req.body)));
  r.get('/orders/:id/attachments/:aid', (req, res) => {
    const f = getAttachment(db, parseId(req.params.id), parseId(req.params.aid));
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.name)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(f.buffer);
  });

  r.get('/plans', (_req, res) => res.json({ rows: listPlans(db) }));
  r.post('/plans', (req, res) => res.status(201).json(savePlan(db, req.user!, null, req.body)));
  r.put('/plans/:id', (req, res) => res.json(savePlan(db, req.user!, parseId(req.params.id), req.body)));
  r.post('/plans/generate', (req, res) => {
    if (!osCan.plans(req.user!)) throw forbidden();
    res.json(generatePreventives(db, req.user!));
  });
  r.get('/checklists', (_req, res) => res.json({ rows: listTemplates(db) }));
  r.post('/checklists', (req, res) => res.status(201).json(saveTemplate(db, req.user!, null, req.body)));
  r.put('/checklists/:id', (req, res) => res.json(saveTemplate(db, req.user!, parseId(req.params.id), req.body)));

  r.get('/reports/:kind', (req, res) => {
    const rows = osReport(db, req.user!, req.params.kind, q(req)) as any[] | null;
    if (!rows) throw badRequest('Relatório inválido.');
    if (req.query.format === 'csv') {
      if (!osCan.export(req.user!)) throw forbidden();
      return sendCsv(res, `os-${req.params.kind}.csv`, rows);
    }
    res.json({ rows });
  });

  return r;
}
