import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DB, openDatabase } from './db';
import { hashPassword } from './auth';
import { HttpError } from './http';
import { AuthUser } from '../shared/orcamentos/types';
import { addDaysISO, todayISO } from '../shared/orcamentos/dates';
import { createCatalogItem } from './services/catalog';
import { createSupplier, saveLocation } from './services/stock/registry';
import { confirmEntry, saveEntry } from './services/stock/documents';
import { createCustomer } from './services/customers';
import { seedFinanceIfEmpty } from './services/finance/registry';
import { createEntry } from './services/finance/entries';
import { settle } from './services/finance/settlement';
import { createContract } from './services/contracts/core';
import { contractAction } from './services/contracts/lifecycle';
import { generateContractDocument } from './services/contracts/documents';
import { deliver, returnItems } from './services/contracts/operations';
import { isDue, runProcessing, saveSettings } from './services/notifications/engine';
import { listMine, markRead, summary } from './services/notifications/center';

let db: DB;
let admin: AuthUser, gestor: AuthUser, vendedor: AuthUser, vendedor2: AuthUser, estoquista: AuthUser, fin: AuthUser, tecnico: AuthUser, consulta: AuthUser;
let customer: number, betoneira: number, bet1: number, bet2: number, caixa: number;
const today = todayISO();
const d = (n: number) => addDaysISO(today, n);

function mkUser(name: string, role: AuthUser['role']): AuthUser {
  const row = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?) RETURNING id').get(name, `${name}@t.com`, hashPassword('senha-segura'), role) as { id: number };
  return { id: row.id, name, email: `${name}@t.com`, role, active: true };
}
function expectHttp(fn: () => unknown, status: number) {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof HttpError, String(e));
    assert.equal(e.status, status, e.message);
    return;
  }
  assert.fail(`esperava erro HTTP ${status}`);
}
function activeContract(owner: AuthUser, end: string, asset = bet1) {
  const c = createContract(db, owner, { contract_type: 'locacao', customer_id: customer, start_date: today, end_date: end, responsible_user_id: owner.id, billing_frequency: 'unico', items: [{ item_id: betoneira, asset_id: asset, unit_price: 100000 }] });
  contractAction(db, owner, c.id, 'enviar_aprovacao', {});
  contractAction(db, gestor, c.id, 'aprovar', {});
  generateContractDocument(db, owner, c.id);
  contractAction(db, gestor, c.id, 'registrar_assinatura', { signature_method: 'presencial', signed_at: today, signed_by_names: 'Cliente', signature_evidence: 'Via física' });
  contractAction(db, gestor, c.id, 'ativar', { generate_charges: false });
  return c;
}
const recipientsOf = (type: string) => (db.prepare('SELECT u.name FROM notification_recipients r JOIN notifications n ON n.id = r.notification_id JOIN users u ON u.id = r.user_id WHERE n.event_type = ? AND n.resolved_at IS NULL ORDER BY u.name').all(type) as any[]).map((r) => r.name);
const active = (type: string) => db.prepare('SELECT * FROM notifications WHERE event_type = ? AND resolved_at IS NULL').all(type) as any[];
const counts = () => ({ n: (db.prepare('SELECT COUNT(*) n FROM notifications').get() as any).n, r: (db.prepare('SELECT COUNT(*) n FROM notification_recipients').get() as any).n });

beforeEach(() => {
  db = openDatabase(':memory:');
  admin = mkUser('admin', 'admin');
  gestor = mkUser('gestor', 'gestor');
  vendedor = mkUser('vendedor', 'vendedor');
  vendedor2 = mkUser('vendedor2', 'vendedor');
  estoquista = mkUser('estoquista', 'estoquista');
  fin = mkUser('fin', 'financeiro');
  tecnico = mkUser('tecnico', 'tecnico');
  consulta = mkUser('consulta', 'consulta');
  seedFinanceIfEmpty(db);
  caixa = (db.prepare("SELECT id FROM financial_accounts WHERE account_type = 'caixa'").get() as any).id;
  const dep = saveLocation(db, admin, null, { code: 'DEP', name: 'Depósito', location_type: 'deposito' }).id;
  const supplier = createSupplier(db, estoquista, { name: 'Fornecedor Ltda' }).id;
  customer = createCustomer(db, admin, { person_type: 'PJ', name: 'Construtora Teste', document: '11222333000181', phone: '17991234567', street: 'Rua A', street_number: '1', city: 'SJRP', state: 'SP' }).id;
  betoneira = createCatalogItem(db, estoquista, { description: 'Betoneira', kind: 'equipamento_locacao', tracking: 'individual', unit: 'un', monthly_rental_price: 100000, default_location_id: dep }).id;
  const e = saveEntry(db, estoquista, null, { entry_kind: 'compra', supplier_id: supplier, location_id: dep, items: [{ item_id: betoneira, quantity: 2, unit_cost: 350000, units: [{ asset_tag: 'BET-1' }, { asset_tag: 'BET-2' }] }] });
  confirmEntry(db, estoquista, e.id);
  bet1 = (db.prepare("SELECT id FROM stock_assets WHERE asset_tag = 'BET-1'").get() as any).id;
  bet2 = (db.prepare("SELECT id FROM stock_assets WHERE asset_tag = 'BET-2'").get() as any).id;
});

test('12. sem notificações: processamento roda e a central fica vazia', () => {
  const r = runProcessing(db, 'manual');
  assert.equal(r.status, 'sucesso');
  assert.deepEqual(summary(db, gestor), { unread: 0, critical: 0, recent: [] });
  assert.equal(listMine(db, gestor, {}).total, 0);
});

test('1. contrato perto do vencimento gera alerta na antecedência configurada (e a regra é configurável)', () => {
  const c = activeContract(vendedor, d(3));
  runProcessing(db, 'agendado');
  const n = active('contrato.vencendo');
  assert.equal(n.length, 1);
  assert.match(n[0].event_key, new RegExp(`contrato.vencendo:${c.id}:${d(3)}:3$`));
  assert.deepEqual(recipientsOf('contrato.vencendo'), ['admin', 'gestor', 'vendedor']); // perfis + responsável
  saveSettings(db, admin, { events: [{ event_type: 'contrato.vencendo', enabled: true, leads: [10, 5], roles: ['admin', 'gestor'], notify_responsible: true }] });
  runProcessing(db, 'agendado');
  const after = active('contrato.vencendo');
  assert.equal(after.length, 1);
  assert.match(after[0].event_key, /:5$/); // nova regra, nova notificação; a antiga foi resolvida
  saveSettings(db, admin, { events: [{ event_type: 'contrato.vencendo', enabled: false, leads: [5], roles: [], notify_responsible: false }] });
  runProcessing(db, 'agendado');
  assert.equal(active('contrato.vencendo').length, 0);
  expectHttp(() => saveSettings(db, admin, { events: [{ event_type: 'contrato.devolucao_atrasada', enabled: false, roles: ['admin'] }] }), 422); // crítico
  expectHttp(() => saveSettings(db, gestor, { events: [] }), 403);
});

test('2/10. conta recebida deixa de ser alertada; filtros e link para o registro', () => {
  const e = createEntry(db, fin, 'receber', { description: 'Locação avulsa', party_type: 'cliente', customer_id: customer, category_id: (db.prepare("SELECT id FROM financial_categories WHERE name = 'Locação de equipamentos'").get() as any).id, origin: 'locacao', original_amount: 50000, plan: { count: 1, first_due: d(1) } });
  runProcessing(db, 'agendado');
  assert.equal(active('financeiro.receber_vencendo').length, 1);
  const list = listMine(db, fin, { category: 'financeiro' });
  assert.equal(list.rows.length, 1);
  assert.deepEqual(list.rows[0].link, { module: 'financeiro', page: 'titulo', id: e.id });
  assert.match(list.rows[0].message, /R\$\s?500,00/);
  assert.equal(listMine(db, fin, { category: 'contratos' }).total, 0);
  settle(db, fin, { entry_id: e.id, account_id: caixa, allocations: [{ installment_id: e.installments[0].id, amount: 50000 }] });
  runProcessing(db, 'agendado');
  assert.equal(active('financeiro.receber_vencendo').length, 0);
  assert.equal(summary(db, fin).unread, 0);
  assert.equal(listMine(db, fin, { resolved: 'only' }).total, 1); // histórico preservado como resolvido
});

test('3/4. devolução registrada encerra o alerta de atraso; reprocessar não duplica', () => {
  const c = activeContract(vendedor, d(5));
  const line = (db.prepare('SELECT id FROM contract_items WHERE contract_id = ?').get(c.id) as any).id;
  deliver(db, estoquista, c.id, { idempotency_key: 'k1', lines: [{ contract_item_id: line, quantity: 1 }] });
  db.prepare("UPDATE stock_reservations SET start_date = ?, end_date = ? WHERE contract_id = ?").run(d(-10), d(-2), c.id); // simula término passado
  runProcessing(db, 'agendado');
  assert.equal(active('contrato.devolucao_atrasada').length, 1);
  const before = counts();
  runProcessing(db, 'agendado');
  runProcessing(db, 'evento');
  assert.deepEqual(counts(), before); // mesmo evento, mesmos destinatários: nada novo
  returnItems(db, estoquista, c.id, { idempotency_key: 'k2', lines: [{ contract_item_id: line, returned: true }] });
  runProcessing(db, 'evento');
  assert.equal(active('contrato.devolucao_atrasada').length, 0);
});

test('5/6/7. leitura, contador e permissões por destinatário', () => {
  activeContract(vendedor, d(2));
  activeContract(vendedor2, d(40), bet2);
  createEntry(db, fin, 'pagar', { description: 'Aluguel galpão', party_type: 'outro', party_name: 'Imobiliária', category_id: (db.prepare("SELECT id FROM financial_categories WHERE name = 'Aluguel'").get() as any).id, original_amount: 90000, plan: { count: 1, first_due: d(-1) } });
  runProcessing(db, 'agendado');
  // financeiro só para quem vê o Financeiro
  assert.deepEqual(recipientsOf('financeiro.pagar_vencido'), ['admin', 'fin', 'gestor']);
  for (const u of [estoquista, vendedor, tecnico, consulta]) assert.equal(listMine(db, u, { category: 'financeiro' }).total, 0);
  // vendedor só recebe o que é dele
  assert.ok(listMine(db, vendedor, {}).rows.some((n) => n.event_type === 'contrato.vencendo'));
  assert.equal(listMine(db, vendedor2, {}).rows.filter((n) => n.event_type === 'contrato.vencendo').length, 0);
  const mine = listMine(db, gestor, { status: 'unread' });
  assert.equal(summary(db, gestor).unread, mine.total);
  markRead(db, gestor, mine.rows[0].id, true);
  assert.equal(summary(db, gestor).unread, mine.total - 1);
  assert.equal(listMine(db, gestor, { status: 'read' }).total, 1);
  expectHttp(() => markRead(db, vendedor, mine.rows[1].id, true), 404); // notificação de outro usuário
});

test('8. agendamento gera os alertas sem ninguém abrir a tela', () => {
  activeContract(vendedor, d(1));
  assert.equal(isDue(db), true);
  runProcessing(db, 'agendado');
  assert.equal(isDue(db), false);
  assert.equal(isDue(db, new Date(Date.now() + 16 * 60_000)), true); // intervalo padrão de 15 min
  const log = db.prepare('SELECT * FROM notification_processing_logs ORDER BY id DESC LIMIT 1').get() as any;
  assert.equal(log.trigger, 'agendado');
  assert.equal(log.status, 'sucesso');
  assert.ok(log.created_count >= 1);
});

test('9. falha num gerador fica no log, avisa o administrador e não apaga alertas daquele tipo', () => {
  activeContract(vendedor, d(1));
  runProcessing(db, 'agendado');
  const vencendo = active('contrato.vencendo').length;
  const broken = { name: 'contratos', types: ['contrato.vencendo'], run: () => { throw new Error('consulta indisponível'); } };
  const r = runProcessing(db, 'agendado', { generators: [broken] });
  assert.equal(r.status, 'parcial');
  const log = db.prepare('SELECT * FROM notification_processing_logs WHERE id = ?').get(r.log_id) as any;
  assert.match(log.error_summary, /contratos: consulta indisponível/);
  assert.equal(active('contrato.vencendo').length, vencendo); // não resolvido por engano
  assert.ok(listMine(db, admin, { category: 'sistema' }).total >= 1);
  assert.equal(listMine(db, gestor, { category: 'sistema' }).total, 0);
});

test('11. multiempresa: não se aplica (empresa única, sem coluna de empresa)', () => {
  const cols = (db.prepare("SELECT name FROM pragma_table_info('notifications')").all() as { name: string }[]).map((c) => c.name);
  assert.ok(!cols.some((c) => /company|empresa|tenant/.test(c)));
});
