/**
 * Rotas /api/contracts. Login exigido antes (createApi); as permissões de cada ação são conferidas nos serviços.
 */

import express, { Response } from 'express';
import { DB, transaction } from './db';
import { badRequest, forbidden, parseId } from './http';
import { contractCan } from '../shared/contratos/rules';
import { ContractAction } from '../shared/contratos/types';
import { formatDateBR } from '../shared/orcamentos/dates';
import { getSettings } from './settings';
import { convertQuotation } from './services/quotations';
import { contractUsers, createContract, getContractSettings, listContracts, loadRaw, saveContractSettings, updateContract } from './services/contracts/core';
import { contractAction, deleteContract, getContractDetail, refreshContractStatuses } from './services/contracts/lifecycle';
import { deliver, reserveContract, returnItems } from './services/contracts/operations';
import { adjustChargeTx, cancelChargeTx, consolidateChargesTx, extraChargeTx } from './services/contracts/billing';
import { addAttachment, deleteDocument, documentFile, generateContractDocument, markDocumentSent } from './services/contracts/documents';
import { chargeInvoicePdf } from './services/contracts/invoice';
import { chargeMeasurementPdf } from './services/contracts/measurement';
import { CONTRACT_REPORTS, contractAlerts, contractDashboard, contractReport } from './services/contracts/reports';
import { availability } from './services/stock/rental';
import { text } from './services/contracts/core';

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

const ACTIONS: ContractAction[] = [
  'enviar_aprovacao', 'aprovar', 'rejeitar', 'reabrir', 'registrar_assinatura', 'ativar', 'gerar_cobrancas', 'prorrogar', 'reajustar', 'incluir_itens', 'iniciar_encerramento', 'encerrar', 'cancelar',
];

export function createContractsApi(db: DB) {
  const r = express.Router();
  const q = (req: express.Request) => req.query as Record<string, string>;

  r.use((req, _res, next) => (contractCan.view(req.user!) ? next() : next(forbidden('Seu perfil não tem acesso aos contratos.'))));

  // início de vigência / vencimento: revisado uma vez por dia
  let lastRefresh = '';
  r.use((_req, _res, next) => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== lastRefresh) {
      refreshContractStatuses(db);
      lastRefresh = today;
    }
    next();
  });

  r.get('/meta', (_req, res) => res.json({ users: contractUsers(db), settings: getContractSettings(db), reports: CONTRACT_REPORTS }));
  r.put('/settings', (req, res) => res.json(saveContractSettings(db, req.user!, req.body)));
  r.get('/dashboard', (req, res) => res.json(contractDashboard(db, req.user!)));
  r.get('/alerts', (req, res) => res.json({ rows: contractAlerts(db, req.user!, q(req)) }));

  r.get('/', (req, res) => res.json(listContracts(db, req.user!, q(req))));
  r.get('/export.csv', (req, res) => {
    if (!contractCan.export(req.user!)) throw forbidden();
    const rows = listContracts(db, req.user!, q(req), true).rows.map((c) => ({
      numero: c.contract_number, cliente: c.customer_name, documento: c.customer_document, tipo: c.contract_type, inicio: c.start_date, termino: c.end_date || 'indeterminado',
      valor: c.period_amount / 100, valor_estimado: c.estimated_total === null ? null : c.estimated_total / 100, status: c.status, responsavel: c.responsible_name,
    }));
    sendCsv(res, 'contratos.csv', rows);
  });
  r.post('/', (req, res) => res.status(201).json(createContract(db, req.user!, req.body)));

  // orçamentos de locação aprovados e ainda não convertidos
  r.get('/quotations-available', (req, res) => {
    if (!contractCan.create(req.user!)) throw forbidden();
    res.json({
      rows: db
        .prepare(
          `SELECT q.id, q.quotation_number, json_extract(q.customer_snapshot, '$.name') AS customer_name, q.start_date, q.end_date, q.total_amount, u.name AS responsible_name
           FROM quotations q LEFT JOIN users u ON u.id = q.responsible_user_id
           WHERE q.quotation_type = 'locacao' AND q.status IN ('aprovado_interno', 'enviado', 'em_negociacao', 'aprovado_cliente') AND q.converted_record_id IS NULL ORDER BY q.updated_at DESC LIMIT 100`
        )
        .all(),
    });
  });
  r.post('/from-quotation/:id', (req, res) => {
    if (!contractCan.create(req.user!)) throw forbidden();
    const out = convertQuotation(db, req.user!, parseId(req.params.id), getSettings(db));
    const c = db.prepare('SELECT id FROM contracts WHERE contract_number = ?').get(out.record_id) as { id: number } | undefined;
    if (!c) throw badRequest('O orçamento foi convertido em outro tipo de registro.');
    res.status(out.already ? 200 : 201).json({ id: c.id, contract_number: out.record_id, already: !!out.already });
  });

  // disponibilidade para escolher patrimônios no formulário (mesma regra do Estoque)
  r.get('/availability', (req, res) => res.json({ rows: availability(db, q(req)) }));

  r.get('/reports/:kind', (req, res) => {
    const rows = contractReport(db, req.user!, req.params.kind, q(req)) as any[] | null;
    if (!rows) throw badRequest('Relatório inválido.');
    if (req.query.format === 'csv') {
      if (!contractCan.export(req.user!)) throw forbidden();
      return sendCsv(res, `contratos-${req.params.kind}.csv`, rows);
    }
    res.json({ rows });
  });

  r.get('/:id', (req, res) => res.json(getContractDetail(db, req.user!, parseId(req.params.id))));
  r.put('/:id', (req, res) => res.json(updateContract(db, req.user!, parseId(req.params.id), req.body)));
  r.delete('/:id', (req, res) => res.json(deleteContract(db, req.user!, parseId(req.params.id))));
  r.post('/:id/action/:action', (req, res) => {
    const action = req.params.action as ContractAction;
    if (!ACTIONS.includes(action)) throw badRequest('Ação inválida.');
    const out = contractAction(db, req.user!, parseId(req.params.id), action, req.body);
    res.json({ ...out, contract: getContractDetail(db, req.user!, parseId(req.params.id)) });
  });
  r.post('/:id/reserve', (req, res) => res.json(reserveContract(db, req.user!, parseId(req.params.id))));
  r.post('/:id/deliveries', (req, res) => res.status(201).json(deliver(db, req.user!, parseId(req.params.id), req.body)));
  r.post('/:id/returns', (req, res) => res.status(201).json(returnItems(db, req.user!, parseId(req.params.id), req.body)));

  // cobranças
  r.post('/:id/charges/extra', (req, res) => {
    const id = parseId(req.params.id);
    res.status(201).json({ id: transaction(db, () => extraChargeTx(db, req.user!, loadRaw(db, id), req.body)) });
  });
  r.post('/:id/charges/consolidate', (req, res) => {
    const id = parseId(req.params.id);
    res.json({ generated: transaction(db, () => consolidateChargesTx(db, req.user!, loadRaw(db, id))) });
  });
  r.post('/:id/charges/:chargeId/adjust', (req, res) => {
    transaction(db, () => adjustChargeTx(db, req.user!, parseId(req.params.id), parseId(req.params.chargeId), Number(req.body?.amount), text(req.body?.reason, 500)));
    res.json({ ok: true });
  });
  r.post('/:id/charges/:chargeId/cancel', (req, res) => {
    if (!contractCan.charges(req.user!)) throw forbidden();
    const reason = text(req.body?.reason, 500);
    if (!reason) throw badRequest('Informe a justificativa.', { reason: 'Obrigatório.' });
    transaction(db, () => cancelChargeTx(db, req.user!, parseId(req.params.id), parseId(req.params.chargeId), reason));
    res.json({ ok: true });
  });

  // documentos
  r.post('/:id/documents/contract', (req, res) => res.status(201).json(generateContractDocument(db, req.user!, parseId(req.params.id))));
  r.post('/:id/documents/attachments', (req, res) => res.status(201).json(addAttachment(db, req.user!, parseId(req.params.id), req.body)));
  r.post('/:id/documents/:docId/sent', (req, res) => {
    markDocumentSent(db, req.user!, parseId(req.params.id), parseId(req.params.docId), req.body);
    res.json({ ok: true });
  });
  r.get('/:id/charges/:chargeId/:doc(invoice|measurement)', async (req, res, next) => {
    try {
      const f = await (req.params.doc === 'invoice' ? chargeInvoicePdf : chargeMeasurementPdf)(db, req.user!, parseId(req.params.id), parseId(req.params.chargeId));
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.name)}"`);
      res.send(f.buffer);
    } catch (e) {
      next(e);
    }
  });
  r.delete('/:id/documents/:docId', (req, res) => res.json(deleteDocument(db, req.user!, parseId(req.params.id), parseId(req.params.docId))));
  r.get('/:id/documents/:docId/file', async (req, res, next) => {
    try {
      const f = await documentFile(db, req.user!, parseId(req.params.id), parseId(req.params.docId));
      res.setHeader('Content-Type', f.mime);
      res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.name)}"`);
      res.send(f.buffer);
    } catch (e) {
      next(e);
    }
  });

  return r;
}
