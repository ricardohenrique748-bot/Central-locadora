import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { DB, openDatabase } from './db';
import { hashPassword, login } from './auth';
import { createApi } from './api';
import { createCustomer } from './services/customers';
import { createQuotation, listQuotations } from './services/quotations';
import { DEFAULT_SETTINGS } from './settings';
import { addDaysISO, todayISO } from '../shared/orcamentos/dates';
import { hasModule, quotationScope } from '../shared/acesso';
import { AuthUser } from '../shared/orcamentos/types';

let db: DB;
let server: Server;
let base = '';
let customer = 0;
const users: Record<string, AuthUser> = {};

function mkUser(name: string, role: AuthUser['role'], modules: string[] | null = null): AuthUser {
  const row = db.prepare('INSERT INTO users (name, email, password_hash, role, modules) VALUES (?, ?, ?, ?, ?) RETURNING id').get(name, `${name}@t.com`, hashPassword('senha-segura-1'), role, modules ? JSON.stringify(modules) : null) as { id: number };
  return { id: row.id, name, email: `${name}@t.com`, role, active: true, modules: modules as any };
}
async function call(user: string, method: string, path: string, body?: unknown) {
  const s = login(db, `${user}@t.com`, 'senha-segura-1', false)!;
  const r = await fetch(base + '/api' + path, {
    method,
    headers: { cookie: `cl_session=${s.token}`, 'Content-Type': 'application/json', 'X-CL-Request': '1' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: (await r.json().catch(() => null)) as any };
}

before(async () => {
  db = openDatabase(':memory:');
  users.admin = mkUser('admin', 'admin');
  users.livre = mkUser('livre', 'gestor'); // sem restrição: vale o perfil
  users.manut = mkUser('manut', 'gestor', ['manutencao']);
  users.fin = mkUser('fin', 'gestor', ['financeiro']);
  users.cli = mkUser('cli', 'vendedor', ['clientes']);
  customer = createCustomer(db, users.admin, { person_type: 'PJ', name: 'Construtora Teste', document: '11222333000181', phone: '17991234567', street: 'Rua A', street_number: '1', city: 'SJRP', state: 'SP' }).id;
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', createApi(db));
  await new Promise<void>((ok) => (server = app.listen(0, '127.0.0.1', ok)));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

test('regra de abas: admin e "todas" acessam tudo; quem tem abas marcadas só elas', () => {
  assert.equal(hasModule(users.admin, 'financeiro'), true);
  assert.equal(hasModule(users.livre, 'financeiro'), true);
  assert.equal(hasModule(users.manut, 'financeiro'), false);
  assert.equal(quotationScope(users.manut), 'manutencao');
  assert.equal(quotationScope(users.fin), 'nenhum');
  assert.equal(quotationScope(users.livre), 'todos');
});

test('servidor bloqueia aba não liberada, inclusive pelo endereço direto', async () => {
  assert.equal((await call('manut', 'GET', '/finance/dashboard')).status, 403);
  assert.equal((await call('manut', 'GET', '/contracts')).status, 403);
  assert.equal((await call('manut', 'GET', '/logistics/dashboard')).status, 403);
  assert.equal((await call('fin', 'GET', '/quotations')).status, 403);
  assert.equal((await call('fin', 'GET', '/finance/dashboard')).status, 200);
  assert.equal((await call('livre', 'GET', '/finance/dashboard')).status, 200);
  // cadastros compartilhados: consulta liberada, alteração só com a aba
  assert.equal((await call('fin', 'GET', '/customers')).status, 200);
  assert.equal((await call('fin', 'POST', '/customers', { person_type: 'PF', name: 'Fulano de Tal' })).status, 403);
  assert.equal((await call('cli', 'POST', '/customers', { person_type: 'PF', name: 'Fulano de Tal', document: '52998224725', phone: '17991234567', street: 'Rua B', street_number: '2', city: 'SJRP', state: 'SP' })).status, 201);
  assert.equal((await call('manut', 'POST', '/stock/locations', { code: 'X', name: 'X', location_type: 'deposito' })).status, 403);
  // sessão devolve as abas para o menu
  const me = await call('manut', 'GET', '/auth/me');
  assert.deepEqual(me.data.user.modules, ['manutencao']);
});

test('só Manutenção: vê e cria apenas orçamentos de manutenção', async () => {
  const exp = addDaysISO(todayISO(), 10);
  const comercial = createQuotation(db, users.admin, { customer_id: customer, quotation_type: 'venda', expiration_date: exp, items: [{ catalog_item_id: null, item_code_snapshot: 'AVULSO', description_snapshot: 'Produto', unit: 'un', quantity: 1, unit_price: 1000 }] }, DEFAULT_SETTINGS);
  const manut = createQuotation(db, users.admin, { customer_id: customer, quotation_type: 'venda', category: 'manutencao', equipment_info: { description: 'Betoneira' }, expiration_date: exp, items: [{ catalog_item_id: null, item_code_snapshot: 'SERVICO', description_snapshot: 'Mão de obra', unit: 'h', quantity: 1, unit_price: 5000 }] }, DEFAULT_SETTINGS);
  assert.deepEqual(listQuotations(db, users.manut, {} as any).rows.map((r) => r.id), [manut.id]);
  assert.equal((await call('manut', 'GET', `/quotations/${comercial.id}`)).status, 403);
  assert.equal((await call('manut', 'GET', `/quotations/${manut.id}`)).status, 200);
  assert.equal((await call('manut', 'POST', '/quotations', { customer_id: customer, quotation_type: 'venda', expiration_date: exp, items: [] })).status, 403);
});

test('admin define as abas; administrador não pode ser restringido', async () => {
  assert.equal((await call('livre', 'PUT', `/users/${users.fin.id}/modules`, { modules: ['estoque'] })).status, 403);
  assert.equal((await call('admin', 'PUT', `/users/${users.admin.id}/modules`, { modules: ['estoque'] })).status, 400);
  const r = await call('admin', 'PUT', `/users/${users.fin.id}/modules`, { modules: ['financeiro', 'estoque', 'inexistente'] });
  assert.deepEqual(r.data.modules, ['financeiro', 'estoque']);
  assert.equal((await call('fin', 'GET', '/finance/dashboard')).status, 200);
  await call('admin', 'PUT', `/users/${users.fin.id}/modules`, { modules: null });
  assert.equal((await call('fin', 'GET', '/quotations')).status, 200, 'de volta a "todas"');
});
