/**
 * Rotas /api/finance. Login exigido antes (createApi); perfis sem acesso ao Financeiro recebem 403 aqui;
 * permissões de operação conferidas também nos serviços.
 */

import express, { Response } from 'express';
import { DB } from './db';
import { badRequest, forbidden, parseId } from './http';
import { financeCan } from '../shared/financeiro/rules';
import { DISPLAY_LABELS, EntryType, TRANSACTION_LABELS, TransactionType } from '../shared/financeiro/types';
import { formatDateBR } from '../shared/orcamentos/dates';
import { getSettings } from './settings';
import {
  getFinanceSettings, listAccounts, listCategories, listCostCenters, saveAccount, saveCategory, saveCostCenter, saveFinanceSettings,
} from './services/finance/registry';
import {
  addAttachment, adjustInstallment, createEntry, createRecurrence, entryAction, generateRecurrences, getAttachment, getEntryDetail, listEntries,
  listRecurrences, setRecurrenceActive, updateEntry,
} from './services/finance/entries';
import { listTransactions, receiptPdf, reverseTransaction, settle } from './services/finance/settlement';
import { closeCash, createTransfer, listCashSessions, listTransfers, openCash, transferAction } from './services/finance/treasury';
import { importStatement, listImports, listStatementItems, statementAction } from './services/finance/reconciliation';
import { cashFlow, delinquency, dre, financeDashboard, financeReport } from './services/finance/reports';
import { financialHistory, financialLinkForStockEntry, payableFromStockEntry, stockEntriesWithoutPayable } from './services/finance/integrations';
import { listRentalInvoices } from './services/finance/invoices';
import { CHARGE_KIND_LABELS, CHARGE_STATUS_LABELS } from '../shared/contratos/types';

const money = (c: number | null | undefined) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));

function sendCsv(res: Response, filename: string, rows: Record<string, unknown>[]) {
  const head = rows.length ? Object.keys(rows[0]) : ['sem_registros'];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + [head.join(';'), ...rows.map((r) => head.map((h) => esc(r[h])).join(';'))].join('\r\n'));
}

/** Colunas monetárias em centavos → "1234,56" e datas → dd/mm/aaaa no CSV. */
const MONEY_KEYS = /^(updated|settled_amount|pending|value|amount|saldo_inicial|entradas|saidas|outras_entradas|outras_saidas|saldo_final|total|ate_30|de_31_60|de_61_90|acima_90|valor)$/;
const DATE_KEYS = /(date|_at|mais_antigo|bucket)$/;
const csvRows = (rows: any[]) =>
  rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' && MONEY_KEYS.test(k) ? money(v) : typeof v === 'string' && DATE_KEYS.test(k) && /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDateBR(v) : v])));

export function createFinanceApi(db: DB) {
  const r = express.Router();
  const q = (req: express.Request) => req.query as Record<string, string>;

  r.use((req, _res, next) => (financeCan.view(req.user!) ? next() : next(forbidden('Seu perfil não tem acesso ao Financeiro.'))));

  // recorrências: gera as ocorrências do horizonte uma vez por dia
  let lastGen = '';
  r.use((_req, _res, next) => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== lastGen) {
      generateRecurrences(db);
      lastGen = today;
    }
    next();
  });

  r.get('/dashboard', (req, res) => res.json(financeDashboard(db, q(req))));
  r.get('/cashflow', (req, res) => res.json(cashFlow(db, q(req))));
  r.get('/dre', (req, res) => res.json(dre(db, q(req))));
  r.get('/delinquency', (_req, res) => res.json({ rows: delinquency(db) }));

  // cadastros
  r.get('/settings', (_req, res) => res.json(getFinanceSettings(db)));
  r.put('/settings', (req, res) => res.json(saveFinanceSettings(db, req.user!, req.body)));
  r.get('/categories', (_req, res) => res.json({ rows: listCategories(db) }));
  r.post('/categories', (req, res) => res.status(201).json(saveCategory(db, req.user!, null, req.body)));
  r.put('/categories/:id', (req, res) => res.json(saveCategory(db, req.user!, parseId(req.params.id), req.body)));
  r.get('/cost-centers', (_req, res) => res.json({ rows: listCostCenters(db) }));
  r.post('/cost-centers', (req, res) => res.status(201).json(saveCostCenter(db, req.user!, null, req.body)));
  r.put('/cost-centers/:id', (req, res) => res.json(saveCostCenter(db, req.user!, parseId(req.params.id), req.body)));
  r.get('/accounts', (_req, res) => res.json({ rows: listAccounts(db) }));
  r.post('/accounts', (req, res) => res.status(201).json(saveAccount(db, req.user!, null, req.body)));
  r.put('/accounts/:id', (req, res) => res.json(saveAccount(db, req.user!, parseId(req.params.id), req.body)));

  // títulos
  const type = (v: string): EntryType => {
    if (v !== 'pagar' && v !== 'receber') throw badRequest('Tipo inválido.');
    return v;
  };
  r.get('/entries/:type(pagar|receber)', (req, res) => res.json(listEntries(db, req.user!, type(req.params.type), q(req))));
  r.get('/entries/:type(pagar|receber)/export.csv', (req, res) => {
    const t = type(req.params.type);
    const { rows } = listEntries(db, req.user!, t, { ...q(req), all: '1' });
    sendCsv(
      res,
      `contas-a-${t}.csv`,
      rows.map((e: any) => ({
        numero: e.entry_number, descricao: e.description, [t === 'pagar' ? 'favorecido' : 'cliente']: e.party_name, categoria: e.category_name,
        emissao: formatDateBR(e.issue_date), competencia: formatDateBR(e.competence_date), proximo_vencimento: formatDateBR(e.next_due_date),
        parcelas: e.installments_count, valor_atualizado: money(e.updated_amount), liquidado: money(e.settled_amount), pendente: money(e.pending_amount),
        situacao: DISPLAY_LABELS[t][e.display_status as keyof (typeof DISPLAY_LABELS)['pagar']], documento: e.document_ref,
      }))
    );
  });
  r.post('/entries/:type(pagar|receber)', (req, res) => res.status(201).json(createEntry(db, req.user!, type(req.params.type), req.body)));
  r.get('/entry/:id', (req, res) => res.json(getEntryDetail(db, req.user!, parseId(req.params.id))));
  r.put('/entry/:id', (req, res) => res.json(updateEntry(db, req.user!, parseId(req.params.id), req.body)));
  r.post('/entry/:id/action/:action', (req, res) => res.json(entryAction(db, req.user!, parseId(req.params.id), req.params.action, req.body || {})));
  r.post('/entry/:id/settle', (req, res) => {
    const out = settle(db, req.user!, { ...req.body, entry_id: parseId(req.params.id) });
    res.status(out.duplicate ? 200 : 201).json({ ...out, entry: getEntryDetail(db, req.user!, parseId(req.params.id)) });
  });
  r.put('/installment/:id/adjust', (req, res) => res.json(adjustInstallment(db, req.user!, parseId(req.params.id), req.body)));
  r.post('/entry/:id/attachments', (req, res) => {
    addAttachment(db, req.user!, 'entry', parseId(req.params.id), req.body);
    res.status(201).json(getEntryDetail(db, req.user!, parseId(req.params.id)));
  });
  r.get('/attachments/:id', (req, res) => {
    const f = getAttachment(db, parseId(req.params.id));
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.name)}"`);
    res.send(Buffer.from(String(f.data).split(',')[1], 'base64'));
  });

  // recorrências
  r.get('/recurrences', (req, res) => res.json({ rows: listRecurrences(db, req.query.type as EntryType | undefined) }));
  r.post('/recurrences/:type(pagar|receber)', (req, res) => res.status(201).json({ id: createRecurrence(db, req.user!, type(req.params.type), req.body) }));
  r.post('/recurrences/:id/:state(ativar|desativar)', (req, res) => {
    setRecurrenceActive(db, req.user!, parseId(req.params.id), req.params.state === 'ativar');
    res.json({ ok: true });
  });

  // movimentações
  r.get('/transactions', (req, res) => res.json(listTransactions(db, q(req))));
  r.get('/transactions/export.csv', (req, res) => {
    const { rows } = listTransactions(db, { ...q(req), all: '1' });
    sendCsv(
      res,
      'movimentacoes-financeiras.csv',
      rows.map((t: any) => ({
        numero: t.transaction_number, data: formatDateBR(t.transaction_date), conta: t.account_name, tipo: TRANSACTION_LABELS[t.transaction_type as TransactionType] || t.transaction_type,
        descricao: t.description, entrada: t.direction > 0 ? money(t.amount) : '', saida: t.direction < 0 ? money(t.amount) : '', saldo_apos: money(t.balance_after),
        status: t.status, conciliada: t.reconciled ? 'sim' : 'não', estornada: t.reversed_by_id ? 'sim' : 'não', usuario: t.performed_by_name,
      }))
    );
  });
  r.post('/transactions/:id/reverse', (req, res) => res.json({ id: reverseTransaction(db, req.user!, parseId(req.params.id), req.body?.reason) }));
  r.get('/transactions/:id/receipt', async (req, res, next) => {
    try {
      const pdf = await receiptPdf(db, parseId(req.params.id), getSettings(db).company);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="comprovante-${req.params.id}.pdf"`);
      res.send(pdf);
    } catch (e) {
      next(e);
    }
  });

  // transferências e caixa
  r.get('/transfers', (req, res) => res.json(listTransfers(db, q(req))));
  r.post('/transfers', (req, res) => res.status(201).json(createTransfer(db, req.user!, req.body)));
  r.post('/transfers/:id/:action', (req, res) => res.json(transferAction(db, req.user!, parseId(req.params.id), req.params.action, req.body || {})));
  r.get('/cash-sessions', (req, res) => res.json({ rows: listCashSessions(db, req.query.account_id ? Number(req.query.account_id) : undefined) }));
  r.post('/cash-sessions', (req, res) => res.status(201).json({ id: openCash(db, req.user!, Number(req.body?.account_id)) }));
  r.post('/cash-sessions/:id/close', (req, res) => res.json(closeCash(db, req.user!, parseId(req.params.id), req.body)));

  // conciliação
  r.get('/reconciliation/imports', (_req, res) => res.json(listImports(db)));
  r.post('/reconciliation/import', (req, res) => res.status(201).json(importStatement(db, req.user!, req.body)));
  r.get('/reconciliation/items', (req, res) => res.json(listStatementItems(db, q(req))));
  r.post('/reconciliation/items/:id/:action', (req, res) => {
    statementAction(db, req.user!, parseId(req.params.id), req.params.action, req.body || {});
    res.json({ ok: true });
  });

  // faturas de locação e medições (PDFs gerados em /api/contracts/:id/charges/:chargeId/{invoice,measurement})
  r.get('/invoices', (req, res) => res.json(listRentalInvoices(db, q(req))));
  r.get('/invoices/export.csv', (req, res) => {
    const { rows } = listRentalInvoices(db, { ...q(req), all: '1' });
    sendCsv(
      res,
      'faturas-de-locacao.csv',
      rows.map((f: any) => ({
        fatura: f.entry_number, contrato: f.contract_number, cliente: f.customer_name, tipo: CHARGE_KIND_LABELS[f.kind as keyof typeof CHARGE_KIND_LABELS] || f.kind, descricao: f.description,
        periodo_inicio: formatDateBR(f.period_start), periodo_fim: formatDateBR(f.period_end), vencimento: formatDateBR(f.due_date),
        valor: money(f.updated_amount), recebido: money(f.settled_amount), situacao: CHARGE_STATUS_LABELS[f.display_status as keyof typeof CHARGE_STATUS_LABELS],
      }))
    );
  });

  // integrações
  r.get('/integrations/stock-entries', (_req, res) => res.json(stockEntriesWithoutPayable(db)));
  r.get('/integrations/stock-entries/:id', (req, res) => res.json({ link: financialLinkForStockEntry(db, parseId(req.params.id)) }));
  r.post('/integrations/stock-entries/:id/payable', (req, res) => res.status(201).json(payableFromStockEntry(db, req.user!, parseId(req.params.id), req.body)));
  r.get('/integrations/quotation/:id', (req, res) => res.json({ rows: financialHistory(db, 'venda', String(parseId(req.params.id))) }));

  // relatórios
  r.get('/reports/:kind', (req, res) => {
    const rows = financeReport(db, req.params.kind, q(req)) as any[] | null;
    if (!rows) throw badRequest('Relatório inválido.');
    if (req.query.format === 'csv') return sendCsv(res, `financeiro-${req.params.kind}.csv`, csvRows(rows));
    res.json({ rows });
  });

  return r;
}
