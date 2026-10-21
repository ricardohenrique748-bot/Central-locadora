/**
 * Rotas da API /api. Toda regra de permissão é aplicada aqui/nos serviços — a interface apenas esconde botões.
 */

import express, { Request, Response, NextFunction } from 'express';
import { DB, audit } from './db';
import { SESSION_COOKIE, hashPassword, login, logout, requireAuth, requireRole, userFromToken, validatePasswordStrength, verifyPassword } from './auth';
import { HttpError, badRequest, conflict, forbidden, notFound, parseId } from './http';
import { getSettings, sanitizeSettings, saveSettings } from './settings';
import { createCustomer, getCustomer, listCustomers, updateCustomer } from './services/customers';
import { createCatalogItem, getCatalogItem, listCatalog, updateCatalogItem } from './services/catalog';
import {
  addContactNote,
  convertQuotation,
  createQuotation,
  duplicateQuotation,
  deleteQuotation,
  getQuotationDetail,
  getQuotationForView,
  getVersionSnapshot,
  listQuotations,
  recordAvailabilityCheck,
  recordPdfGenerated,
  transitionQuotation,
  updateQuotation,
} from './services/quotations';
import { dashboard, notifications, reports } from './services/reports';
import { homeDashboard } from './services/home';
import { renderQuotationPdf } from './pdf';
import { INTEGRATION_STATUS, registerConversionAdapter, setAvailabilityAdapter } from './integrations';
import { createStockApi } from './stockApi';
import { createFinanceApi } from './financeApi';
import { createContractsApi } from './contractsApi';
import { createOsApi } from './osApi';
import { createLogisticsApi } from './logisticsApi';
import { createNotificationsApi } from './notificationsApi';
import { requestEventRun } from './services/notifications/engine';
import { contractFromQuotation } from './services/contracts/fromQuotation';
import { convertSale } from './services/finance/integrations';
import { checkQuotationAvailability } from './services/stock/rental';
import { QuotationAction, Role, ROLE_LABELS, TEMPLATE_FIELD_LABELS } from '../shared/orcamentos/types';
import { STATUS_LABELS } from '../shared/orcamentos/status';
import { isValidEmail } from '../shared/orcamentos/validators';
import { ModuleKey, hasModule, normalizeModules } from '../shared/acesso';
import { formatDateBR, formatDateTimeBR } from '../shared/orcamentos/dates';

// ------------------------------------------------ proteção simples contra força bruta no login
const attempts = new Map<string, { count: number; until: number }>();
function loginThrottle(key: string) {
  const a = attempts.get(key);
  if (a && a.until > Date.now() && a.count >= 8) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.');
}
function loginFailed(key: string) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { count: 1, until: Date.now() + 15 * 60_000 });
  else a.count++;
}

/** Converte valores em centavos para "1234,56" nos CSVs. */
const csvMoney = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
function sendCsv(res: Response, filename: string, header: string[], rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + body);
}

const ROLES: Role[] = ['admin', 'gestor', 'vendedor', 'estoquista', 'financeiro', 'tecnico', 'consulta'];

export function createApi(db: DB) {
  const api = express.Router();

  // Venda efetivada (conversão do orçamento): baixa o estoque e gera a conta a receber — idempotente
  registerConversionAdapter({ type: 'venda', convert: (q, user) => convertSale(db, q, user) });
  // Orçamento de locação aprovado → contrato em rascunho (sem reservar nem cobrar) — idempotente
  registerConversionAdapter({ type: 'contrato_locacao', convert: (q, user) => contractFromQuotation(db, q, user) });

  // Orçamentos consultam a disponibilidade no Estoque (somente leitura, sem reservar)
  setAvailabilityAdapter({
    check: (items, start, end) =>
      checkQuotationAvailability(db, items.map((i) => ({ catalog_item_id: i.catalog_item_id, quantity: i.quantity })), start, end).map((r) => ({
        catalog_item_id: r.catalog_item_id,
        status: r.status,
      })),
  });

  // Mutações exigem cabeçalho próprio: formulários de outros sites não conseguem enviá-lo (proteção CSRF)
  api.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('X-CL-Request') !== '1') return next(forbidden('Requisição inválida.'));
    next();
  });

  // ------------------------------------------------ autenticação
  api.post('/auth/login', (req, res) => {
    const { email, password, remember } = req.body || {};
    const key = `${req.ip}|${String(email || '').toLowerCase()}`;
    loginThrottle(key);
    const result = login(db, email, password, !!remember);
    if (!result) {
      loginFailed(key);
      throw new HttpError(401, 'E-mail ou senha inválidos.');
    }
    attempts.delete(key);
    res.cookie(SESSION_COOKIE, result.token, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: result.maxAge, path: '/' });
    res.json({ user: result.user });
  });

  api.post('/auth/logout', (req, res) => {
    logout(db, req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  api.get('/auth/me', (req, res) => {
    const user = userFromToken(db, req.cookies?.[SESSION_COOKIE]);
    if (!user) throw new HttpError(401, 'Não autenticado.');
    res.json({ user });
  });

  api.use(requireAuth(db));
  // operações gravadas nos módulos disparam a verificação de alertas (agrupada); o agendamento cobre os prazos
  api.use((req, res, next) => {
    if (req.method !== 'GET' && !req.path.startsWith('/notification-center')) res.on('finish', () => res.statusCode < 400 && requestEventRun(db));
    next();
  });
  // bloqueio por aba: módulos inteiros (inclusive leitura) e alterações em cadastros compartilhados
  api.use((req, _res, next) => {
    const u = req.user!;
    const p = req.path;
    const write = req.method !== 'GET';
    const any = (...ms: ModuleKey[]) => ms.some((m) => hasModule(u, m));
    let ok = true;
    if (p.startsWith('/finance')) ok = any('financeiro');
    else if (p.startsWith('/contracts')) ok = any('contratos');
    else if (p.startsWith('/logistics')) ok = any('operacao');
    else if (p.startsWith('/os')) ok = any('manutencao');
    else if (/^\/(quotations|templates|reports|dashboard|notifications)(\/|$|\.)/.test(p)) ok = any('orcamentos', 'manutencao');
    else if (p.startsWith('/stock')) ok = !write || any('estoque');
    else if (p.startsWith('/catalog')) ok = !write || any('estoque', 'orcamentos', 'manutencao');
    else if (p.startsWith('/customers')) ok = !write || any('clientes', 'orcamentos', 'manutencao', 'contratos');
    next(ok ? undefined : forbidden('Você não tem acesso a esta aba. Peça ao administrador.'));
  });
  api.use('/notification-center', createNotificationsApi(db));
  api.use('/stock', createStockApi(db));
  api.use('/finance', createFinanceApi(db));
  api.use('/contracts', createContractsApi(db));
  api.use('/os', createOsApi(db));
  api.use('/logistics', createLogisticsApi(db));

  api.put('/auth/password', (req, res) => {
    const { current_password, new_password } = req.body || {};
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as { password_hash: string };
    if (!verifyPassword(String(current_password || ''), row.password_hash)) throw badRequest('Senha atual incorreta.', { current_password: 'Incorreta.' });
    const err = validatePasswordStrength(new_password);
    if (err) throw badRequest(err, { new_password: err });
    db.prepare(`UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(hashPassword(new_password), req.user!.id);
    audit(db, 'user', req.user!.id, 'change_password', req.user!.id);
    res.json({ ok: true });
  });

  // ------------------------------------------------ configurações, modelos, usuários
  api.get('/settings', (_req, res) => {
    res.json({ settings: getSettings(db), integrations: INTEGRATION_STATUS() });
  });

  api.put('/settings', requireRole('admin'), (req, res) => {
    let s;
    try {
      s = sanitizeSettings(req.body);
    } catch (e: any) {
      throw badRequest(e.message);
    }
    saveSettings(db, s);
    audit(db, 'settings', 'module', 'update', req.user!.id, { ...s, company: { ...s.company, logo_data: s.company.logo_data ? '[logo]' : null } });
    res.json({ settings: s });
  });

  api.get('/templates', (_req, res) => {
    res.json({ rows: db.prepare('SELECT * FROM text_templates ORDER BY field, title').all() });
  });

  const templateBody = (b: any) => {
    const field = String(b?.field || '');
    if (!(field in TEMPLATE_FIELD_LABELS)) throw badRequest('Campo do modelo inválido.', { field: 'Inválido.' });
    const title = String(b?.title || '').trim().slice(0, 80);
    const body = String(b?.body || '').trim().slice(0, 4000);
    if (!title) throw badRequest('Informe o título.', { title: 'Obrigatório.' });
    if (!body) throw badRequest('Informe o texto.', { body: 'Obrigatório.' });
    const qt = b?.quotation_type === 'venda' || b?.quotation_type === 'locacao' ? b.quotation_type : null;
    return [field, title, body, qt] as const;
  };

  api.post('/templates', requireRole('admin'), (req, res) => {
    const row = db.prepare('INSERT INTO text_templates (field, title, body, quotation_type) VALUES (?, ?, ?, ?) RETURNING *').get(...templateBody(req.body));
    audit(db, 'template', (row as any).id, 'create', req.user!.id);
    res.status(201).json(row);
  });

  api.put('/templates/:id', requireRole('admin'), (req, res) => {
    const id = parseId(req.params.id);
    const row = db
      .prepare(`UPDATE text_templates SET field = ?, title = ?, body = ?, quotation_type = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? RETURNING *`)
      .get(...templateBody(req.body), id);
    if (!row) throw notFound();
    audit(db, 'template', id, 'update', req.user!.id);
    res.json(row);
  });

  api.delete('/templates/:id', requireRole('admin'), (req, res) => {
    const id = parseId(req.params.id);
    db.prepare('DELETE FROM text_templates WHERE id = ?').run(id);
    audit(db, 'template', id, 'delete', req.user!.id);
    res.json({ ok: true });
  });

  /** Lista resumida para filtros (responsável) — todos os perfis. */
  api.get('/users/options', (_req, res) => {
    res.json({ rows: db.prepare('SELECT id, name, role FROM users ORDER BY name').all() });
  });

  api.get('/users', requireRole('admin'), (_req, res) => {
    const rows = db.prepare('SELECT id, name, email, role, active, created_at, modules FROM users ORDER BY name').all() as any[];
    res.json({ rows: rows.map((r) => ({ ...r, active: !!r.active, modules: r.modules ? normalizeModules(JSON.parse(r.modules)) : null })) });
  });

  const userBody = (b: any, isNew: boolean) => {
    const errors: Record<string, string> = {};
    const name = String(b?.name || '').trim().slice(0, 100);
    const email = String(b?.email || '').trim().toLowerCase();
    const role = b?.role as Role;
    if (name.length < 3) errors.name = 'Informe o nome.';
    if (!isValidEmail(email)) errors.email = 'E-mail inválido.';
    if (!ROLES.includes(role)) errors.role = 'Perfil inválido.';
    if (isNew || b?.password) {
      const pe = validatePasswordStrength(b?.password);
      if (pe) errors.password = pe;
    }
    if (Object.keys(errors).length) throw badRequest('Verifique os campos destacados.', errors);
    return { name, email, role, active: b?.active === undefined ? true : !!b.active, password: b?.password as string | undefined };
  };

  api.post('/users', requireRole('admin'), (req, res) => {
    const u = userBody(req.body, true);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(u.email)) throw conflict('Já existe um usuário com este e-mail.');
    const row = db
      .prepare('INSERT INTO users (name, email, password_hash, role, active) VALUES (?, ?, ?, ?, 1) RETURNING id, name, email, role, active')
      .get(u.name, u.email, hashPassword(u.password!), u.role) as any;
    audit(db, 'user', row.id, 'create', req.user!.id, { name: u.name, email: u.email, role: u.role });
    res.status(201).json({ ...row, active: !!row.active });
  });

  /** Abas que o usuário acessa (null = as do perfil). Administrador sempre acessa tudo. */
  api.put('/users/:id/modules', requireRole('admin'), (req, res) => {
    const id = parseId(req.params.id);
    const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as { id: number; role: Role } | undefined;
    if (!u) throw notFound('Usuário não encontrado.');
    const modules = normalizeModules(req.body?.modules);
    if (u.role === 'admin' && modules) throw badRequest('O administrador sempre acessa todas as abas.');
    db.prepare(`UPDATE users SET modules = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(modules ? JSON.stringify(modules) : null, id);
    audit(db, 'user', id, 'modules', req.user!.id, { modules });
    res.json({ id, modules });
  });

  api.put('/users/:id', requireRole('admin'), (req, res) => {
    const id = parseId(req.params.id);
    const before = db.prepare('SELECT id, role, active FROM users WHERE id = ?').get(id) as { id: number; role: Role; active: number } | undefined;
    if (!before) throw notFound('Usuário não encontrado.');
    const u = userBody(req.body, false);
    if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(u.email, id)) throw conflict('Já existe um usuário com este e-mail.');
    const losingAdmin = before.role === 'admin' && before.active && (u.role !== 'admin' || !u.active);
    if (losingAdmin) {
      const admins = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get() as { n: number }).n;
      if (admins <= 1) throw badRequest('É necessário manter ao menos um administrador ativo.');
    }
    if (id === req.user!.id && !u.active) throw badRequest('Você não pode inativar o próprio usuário.');
    db.prepare(`UPDATE users SET name = ?, email = ?, role = ?, active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(
      u.name,
      u.email,
      u.role,
      u.active ? 1 : 0,
      id
    );
    if (u.password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(u.password), id);
    if (!u.active || u.password) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    audit(db, 'user', id, 'update', req.user!.id, { name: u.name, email: u.email, role: u.role, active: u.active, password_reset: !!u.password });
    res.json({ id, name: u.name, email: u.email, role: u.role, active: u.active });
  });

  // ------------------------------------------------ clientes
  api.get('/customers', (req, res) => {
    const q = req.query as Record<string, string>;
    res.json(listCustomers(db, { q: q.q, active: q.active, limit: Number(q.limit), offset: Number(q.offset) }));
  });
  api.get('/customers/:id', (req, res) => res.json(getCustomer(db, parseId(req.params.id))));
  api.post('/customers', (req, res) => res.status(201).json(createCustomer(db, req.user!, req.body)));
  api.put('/customers/:id', (req, res) => res.json(updateCustomer(db, req.user!, parseId(req.params.id), req.body)));

  // ------------------------------------------------ catálogo
  api.get('/catalog', (req, res) => {
    const q = req.query as Record<string, string>;
    res.json(
      listCatalog(db, {
        q: q.q,
        category: q.category,
        item_type: q.item_type,
        modality: q.modality,
        active: q.active,
        limit: Number(q.limit),
        offset: Number(q.offset),
        withImages: q.images === '1',
      })
    );
  });
  api.get('/catalog/:id', (req, res) => res.json(getCatalogItem(db, parseId(req.params.id))));
  api.post('/catalog', (req, res) => res.status(201).json(createCatalogItem(db, req.user!, req.body)));
  api.put('/catalog/:id', (req, res) => res.json(updateCatalogItem(db, req.user!, parseId(req.params.id), req.body)));

  // ------------------------------------------------ orçamentos
  api.get('/quotations', (req, res) => res.json(listQuotations(db, req.user!, req.query as any)));

  api.get('/quotations/export.csv', (req, res) => {
    const { rows } = listQuotations(db, req.user!, req.query as any, true);
    sendCsv(
      res,
      'orcamentos.csv',
      ['Número', 'Criação', 'Cliente', 'CPF/CNPJ', 'Modalidade', 'Responsável', 'Valor total (R$)', 'Validade', 'Status', 'Versão', 'Última atualização'],
      rows.map((r) => [
        r.quotation_number,
        formatDateTimeBR(r.created_at),
        r.customer_name,
        r.customer_document,
        r.category === 'manutencao' ? 'Manutenção' : r.quotation_type === 'venda' ? 'Venda' : 'Locação',
        r.responsible_name,
        csvMoney(r.total_amount),
        formatDateBR(r.expiration_date),
        STATUS_LABELS[r.status],
        r.version,
        formatDateTimeBR(r.updated_at),
      ])
    );
  });

  api.post('/quotations', (req, res) => res.status(201).json(createQuotation(db, req.user!, req.body, getSettings(db))));
  api.get('/quotations/:id', (req, res) => res.json(getQuotationDetail(db, req.user!, parseId(req.params.id), getSettings(db))));
  api.put('/quotations/:id', (req, res) => res.json(updateQuotation(db, req.user!, parseId(req.params.id), req.body, getSettings(db))));
  api.post('/quotations/:id/actions/:action', (req, res) => {
    const q = transitionQuotation(db, req.user!, parseId(req.params.id), req.params.action as QuotationAction, req.body || {}, getSettings(db));
    res.json(q);
  });
  api.delete('/quotations/:id', (req, res) => res.json(deleteQuotation(db, req.user!, parseId(req.params.id))));
  api.post('/quotations/:id/duplicate', (req, res) => res.status(201).json(duplicateQuotation(db, req.user!, parseId(req.params.id), getSettings(db))));
  api.post('/quotations/:id/convert', (req, res) => res.json(convertQuotation(db, req.user!, parseId(req.params.id), getSettings(db))));
  api.post('/quotations/:id/activities', (req, res) => {
    addContactNote(db, req.user!, parseId(req.params.id), req.body?.description, getSettings(db));
    res.status(201).json({ ok: true });
  });
  /** Consulta o Estoque (sem reservar) e grava o resultado no orçamento de locação. */
  api.post('/quotations/:id/availability', (req, res) => {
    res.json(recordAvailabilityCheck(db, req.user!, parseId(req.params.id), (q) =>
      checkQuotationAvailability(db, q.items.filter((i) => i.catalog_item_id).map((i) => ({ catalog_item_id: i.catalog_item_id!, quantity: i.quantity })), q.start_date, q.end_date)
    ));
  });

  api.get('/quotations/:id/versions/:version', (req, res) => {
    res.json(getVersionSnapshot(db, req.user!, parseId(req.params.id), parseId(req.params.version)));
  });

  api.get('/quotations/:id/pdf', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      const settings = getSettings(db);
      const current = getQuotationForView(db, req.user!, id);
      const version = req.query.version ? parseId(req.query.version) : null;
      const q = version && version !== current.version ? getVersionSnapshot(db, req.user!, id, version) : current;
      const pdf = await renderQuotationPdf(q, settings);
      recordPdfGenerated(db, req.user!, id, q.version);
      const filename = `${q.quotation_number}-v${q.version}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${filename}"`);
      res.send(pdf);
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------------ painel, relatórios, notificações
  api.get('/home', (req, res) => res.json(homeDashboard(db, req.user!)));
  api.get('/dashboard', (req, res) => res.json(dashboard(db, req.user!, req.query as any, getSettings(db).expiring_soon_days)));
  api.get('/reports', (req, res) => res.json(reports(db, req.user!, req.query as any, getSettings(db).expiring_soon_days)));
  api.get('/reports/export.csv', (req, res) => {
    const kind = String(req.query.kind || '');
    const data = reports(db, req.user!, req.query as any, getSettings(db).expiring_soon_days) as any;
    const groups: Record<string, string> = { byCustomer: 'Cliente', byResponsible: 'Responsável', byType: 'Modalidade', byPeriod: 'Mês' };
    if (groups[kind]) {
      sendCsv(
        res,
        `relatorio-${kind}.csv`,
        [groups[kind], 'Orçamentos', 'Valor proposto (R$)', 'Aprovados', 'Valor aprovado (R$)', 'Enviados', 'Taxa de conversão (%)'],
        data[kind].map((r: any) => [
          kind === 'byType' ? (r.label === 'venda' ? 'Venda' : 'Locação') : r.label,
          r.count,
          csvMoney(r.value),
          r.won,
          csvMoney(r.won_value),
          r.sent,
          r.sent ? ((r.won_sent / r.sent) * 100).toFixed(1).replace('.', ',') : '',
        ])
      );
      return;
    }
    if (kind === 'expired' || kind === 'expiring') {
      sendCsv(
        res,
        `relatorio-${kind}.csv`,
        ['Número', 'Cliente', 'Responsável', 'Validade', 'Valor (R$)', 'Status'],
        data[kind].map((r: any) => [r.quotation_number, r.customer_name, r.responsible_name, formatDateBR(r.expiration_date), csvMoney(r.total_amount), STATUS_LABELS[r.status as keyof typeof STATUS_LABELS]])
      );
      return;
    }
    if (kind === 'refusalReasons') {
      sendCsv(res, 'relatorio-motivos-recusa.csv', ['Motivo', 'Quantidade', 'Valor (R$)'], data.refusalReasons.map((r: any) => [r.label, r.count, csvMoney(r.value)]));
      return;
    }
    if (kind === 'byStatus') {
      sendCsv(res, 'relatorio-status.csv', ['Status', 'Quantidade', 'Valor (R$)'], data.byStatus.map((r: any) => [STATUS_LABELS[r.label as keyof typeof STATUS_LABELS], r.count, csvMoney(r.value)]));
      return;
    }
    throw badRequest('Relatório inválido.');
  });
  api.get('/notifications', (req, res) => res.json({ rows: notifications(db, req.user!, getSettings(db).expiring_soon_days) }));

  api.get('/meta', (_req, res) => res.json({ roles: ROLE_LABELS }));

  api.use((_req, _res, next) => next(notFound('Rota não encontrada.')));
  return api;
}
