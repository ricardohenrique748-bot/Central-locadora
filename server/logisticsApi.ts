/**
 * Rotas /api/logistics (Entregas e Devoluções). Login exigido antes (createApi); permissões nos serviços.
 */

import express, { Response } from 'express';
import { DB } from './db';
import { badRequest, forbidden, parseId } from './http';
import { logCan } from '../shared/logistica/rules';
import { OpType } from '../shared/logistica/types';
import { formatDateBR } from '../shared/orcamentos/dates';
import { getSettings } from './settings';
import { addAttachment, contractPlanning, createOperation, getAttachment, getOperation, listRegistry, saveDriver, saveVehicle, updateOperation } from './services/logistics/core';
import { availableActions, opAction } from './services/logistics/flow';
import { createOccurrence, inspectItem, listOccurrences, occurrenceAction } from './services/logistics/inspection';
import { LOG_REPORTS, listOperations, logisticsAlerts, logisticsDashboard, logisticsReport } from './services/logistics/reports';
import { renderOperationPdf } from './services/logistics/pdf';

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

export function createLogisticsApi(db: DB) {
  const r = express.Router();
  const q = (req: express.Request) => req.query as Record<string, string>;
  const detail = (req: express.Request, id: number) => getOperation(db, req.user!, id, (o) => availableActions(db, o, req.user!));

  r.get('/meta', (_req, res) =>
    res.json({
      ...listRegistry(db),
      users: db.prepare("SELECT id, name, role FROM users WHERE active = 1 AND role IN ('admin','gestor','estoquista','tecnico','vendedor') ORDER BY name").all(),
      suppliers: db.prepare('SELECT id, name FROM suppliers WHERE active = 1 ORDER BY name').all(),
      locations: db.prepare('SELECT id, code, name FROM stock_locations WHERE active = 1 ORDER BY code').all(),
      reports: LOG_REPORTS,
    })
  );
  r.post('/drivers', (req, res) => res.status(201).json(saveDriver(db, req.user!, null, req.body)));
  r.put('/drivers/:id', (req, res) => res.json(saveDriver(db, req.user!, parseId(req.params.id), req.body)));
  r.post('/vehicles', (req, res) => res.status(201).json(saveVehicle(db, req.user!, null, req.body)));
  r.put('/vehicles/:id', (req, res) => res.json(saveVehicle(db, req.user!, parseId(req.params.id), req.body)));

  r.get('/dashboard', (_req, res) => res.json(logisticsDashboard(db)));
  r.get('/alerts', (_req, res) => res.json({ rows: logisticsAlerts(db) }));

  // contratos aptos e saldo para programar
  r.get('/contracts', (req, res) => {
    const type = req.query.type === 'entrega' ? 'entrega' : 'retorno';
    const like = `%${String(req.query.q || '').trim()}%`;
    res.json({
      rows: db
        .prepare(
          `SELECT c.id, c.contract_number, c.contract_type, c.status, json_extract(c.customer_snapshot, '$.name') AS customer_name, c.start_date, c.end_date
           FROM contracts c WHERE c.status IN (${type === 'entrega' ? "'agendado','ativo'" : "'agendado','ativo','vencido','pendente_devolucao'"}) ${type === 'retorno' ? "AND c.contract_type = 'locacao'" : ''}
             AND (c.contract_number LIKE ? OR json_extract(c.customer_snapshot, '$.name') LIKE ?) ORDER BY c.id DESC LIMIT 30`
        )
        .all(like, like),
    });
  });
  r.get('/contracts/:id/planning', (req, res) => {
    const type = (['entrega', 'retirada', 'devolucao'].includes(String(req.query.type)) ? req.query.type : 'entrega') as OpType;
    const p = contractPlanning(db, parseId(req.params.id), type);
    const snap = JSON.parse(p.contract.customer_snapshot);
    res.json({ contract: { id: p.contract.id, contract_number: p.contract.contract_number, status: p.contract.status, contract_type: p.contract.contract_type, start_date: p.contract.start_date, end_date: p.contract.end_date, delivery_address: p.contract.delivery_address, customer: snap }, items: p.items });
  });

  r.get('/operations', (req, res) => res.json(listOperations(db, req.user!, q(req))));
  r.get('/operations/export.csv', (req, res) => {
    if (!logCan.export(req.user!)) throw forbidden();
    sendCsv(res, 'operacoes-logisticas.csv', listOperations(db, req.user!, q(req), true).rows.map((o) => ({ operacao: o.number, tipo: o.op_type, contrato: o.contract_number, cliente: o.customer_name, endereco: o.address, programada: o.scheduled_at, responsavel: o.responsible_name, motorista: o.driver_name, status: o.status, itens: o.items_count, quantidade: o.quantity_total, pendencias: o.pending })));
  });
  r.post('/operations', (req, res) => res.status(201).json(createOperation(db, req.user!, req.body?.op_type, req.body)));
  r.get('/operations/:id', (req, res) => res.json(detail(req, parseId(req.params.id))));
  r.put('/operations/:id', (req, res) => {
    updateOperation(db, req.user!, parseId(req.params.id), req.body);
    res.json(detail(req, parseId(req.params.id)));
  });
  r.post('/operations/:id/action/:action', (req, res) => {
    const out = opAction(db, req.user!, parseId(req.params.id), req.params.action, req.body);
    res.json({ ...out, operation: detail(req, parseId(req.params.id)) });
  });
  r.post('/operations/:id/inspections', (req, res) => res.status(201).json(inspectItem(db, req.user!, parseId(req.params.id), req.body)));
  r.post('/operations/:id/attachments', (req, res) => res.status(201).json(addAttachment(db, req.user!, { order_id: parseId(req.params.id), occurrence_id: req.body?.occurrence_id ? Number(req.body.occurrence_id) : null }, req.body)));
  r.get('/attachments/:id', (req, res) => {
    const f = getAttachment(db, parseId(req.params.id));
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.name)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(f.buffer);
  });
  r.get('/operations/:id/pdf', async (req, res, next) => {
    try {
      const o = detail(req, parseId(req.params.id));
      const pdf = await renderOperationPdf(o, getSettings(db).company, logCan.viewCosts(req.user!));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${o.number}.pdf"`);
      res.send(pdf);
    } catch (e) {
      next(e);
    }
  });

  r.get('/occurrences', (req, res) => res.json({ rows: listOccurrences(db, req.user!, q(req)) }));
  r.post('/occurrences', (req, res) => res.status(201).json(createOccurrence(db, req.user!, req.body)));
  r.post('/occurrences/:id/:action', (req, res) => res.json(occurrenceAction(db, req.user!, parseId(req.params.id), req.params.action, req.body)));
  r.post('/occurrences/:id/attachments', (req, res) => res.status(201).json(addAttachment(db, req.user!, { occurrence_id: parseId(req.params.id) }, req.body)));

  r.get('/reports/:kind', (req, res) => {
    const rows = logisticsReport(db, req.user!, req.params.kind, q(req)) as any[] | null;
    if (!rows) throw badRequest('Relatório inválido.');
    if (req.query.format === 'csv') {
      if (!logCan.export(req.user!)) throw forbidden();
      return sendCsv(res, `logistica-${req.params.kind}.csv`, rows);
    }
    res.json({ rows });
  });
  return r;
}
