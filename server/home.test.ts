import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DB, openDatabase } from './db';
import { hashPassword } from './auth';
import { AuthUser } from '../shared/orcamentos/types';
import { addDaysISO, todayISO } from '../shared/orcamentos/dates';
import { createCatalogItem } from './services/catalog';
import { createSupplier, saveLocation } from './services/stock/registry';
import { confirmEntry, saveEntry } from './services/stock/documents';
import { createCustomer } from './services/customers';
import { seedFinanceIfEmpty } from './services/finance/registry';
import { createContract } from './services/contracts/core';
import { contractAction } from './services/contracts/lifecycle';
import { generateContractDocument } from './services/contracts/documents';
import { deliver, returnItems } from './services/contracts/operations';
import { homeDashboard } from './services/home';

let db: DB;
let admin: AuthUser, gestor: AuthUser, vendedor: AuthUser, estoquista: AuthUser, tecnico: AuthUser;
let customer: number, betoneira: number, bet1: number;
const today = todayISO();

function mkUser(name: string, role: AuthUser['role']): AuthUser {
  const row = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?) RETURNING id').get(name, `${name}@t.com`, hashPassword('senha-segura'), role) as { id: number };
  return { id: row.id, name, email: `${name}@t.com`, role, active: true };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  admin = mkUser('admin', 'admin');
  gestor = mkUser('gestor', 'gestor');
  vendedor = mkUser('vendedor', 'vendedor');
  estoquista = mkUser('estoquista', 'estoquista');
  tecnico = mkUser('tecnico', 'tecnico');
  seedFinanceIfEmpty(db);
  const dep = saveLocation(db, admin, null, { code: 'DEP', name: 'Depósito', location_type: 'deposito' }).id;
  const supplier = createSupplier(db, estoquista, { name: 'Fornecedor Ltda' }).id;
  customer = createCustomer(db, admin, { person_type: 'PJ', name: 'Construtora Teste', document: '11222333000181', phone: '17991234567', street: 'Rua A', street_number: '1', city: 'SJRP', state: 'SP' }).id;
  betoneira = createCatalogItem(db, estoquista, { description: 'Betoneira', kind: 'equipamento_locacao', tracking: 'individual', unit: 'un', monthly_rental_price: 100000, default_location_id: dep }).id;
  const e = saveEntry(db, estoquista, null, { entry_kind: 'compra', supplier_id: supplier, location_id: dep, items: [{ item_id: betoneira, quantity: 2, unit_cost: 350000, units: [{ asset_tag: 'BET-1' }, { asset_tag: 'BET-2' }] }] });
  confirmEntry(db, estoquista, e.id);
  bet1 = (db.prepare("SELECT id FROM stock_assets WHERE asset_tag = 'BET-1'").get() as any).id;
});

test('painel sem movimento: tudo zerado, sem agenda nem alertas, nada inventado', () => {
  const h = homeDashboard(db, admin);
  assert.equal(h.contratos!.ativos, 0);
  assert.equal(h.financeiro!.a_receber_aberto, 0);
  assert.equal(h.agenda.length, 0);
  assert.equal(h.alertas.length, 0);
  assert.equal(h.ocupacao!.percentual, 0);
  assert.equal(h.estoque!.eq_disponiveis, 2);
});

test('painel respeita o perfil: financeiro, contratos, valores e ações', () => {
  assert.equal(homeDashboard(db, vendedor).financeiro, null);
  assert.equal(homeDashboard(db, estoquista).financeiro, null);
  assert.equal(homeDashboard(db, estoquista).orcamentos!.valor_aprovado, null);
  assert.equal(homeDashboard(db, estoquista).contratos!.valor_mensal_ativo, null);
  const t = homeDashboard(db, tecnico);
  assert.equal(t.contratos, null);
  assert.deepEqual(t.acoes, { novo_orcamento: false, novo_contrato: false, nova_entrega: false, estoque: true });
  assert.ok(homeDashboard(db, gestor).financeiro);
});

test('agenda e ocupação refletem a devolução prevista e somem após devolver', () => {
  const c = createContract(db, vendedor, { contract_type: 'locacao', customer_id: customer, start_date: today, end_date: addDaysISO(today, 10), responsible_user_id: vendedor.id, billing_frequency: 'unico', items: [{ item_id: betoneira, asset_id: bet1, unit_price: 100000 }] });
  contractAction(db, vendedor, c.id, 'enviar_aprovacao', {});
  contractAction(db, gestor, c.id, 'aprovar', {});
  generateContractDocument(db, vendedor, c.id);
  contractAction(db, gestor, c.id, 'registrar_assinatura', { signature_method: 'presencial', signed_at: today, signed_by_names: 'Cliente', signature_evidence: 'Via física' });
  contractAction(db, gestor, c.id, 'ativar', { generate_charges: false });
  const line = (db.prepare('SELECT id FROM contract_items WHERE contract_id = ?').get(c.id) as any).id;
  deliver(db, estoquista, c.id, { idempotency_key: 'k1', lines: [{ contract_item_id: line, quantity: 1 }] });
  db.prepare('UPDATE stock_reservations SET end_date = ? WHERE contract_id = ?').run(today, c.id); // devolução prevista para hoje

  const h = homeDashboard(db, gestor);
  assert.equal(h.ocupacao!.percentual, 50);
  const dev = h.agenda.find((a) => a.kind === 'devolucao');
  assert.ok(dev && !dev.late && dev.link.id === c.id);
  assert.equal(homeDashboard(db, tecnico).agenda.some((a) => a.kind === 'devolucao'), false, 'técnico não vê contratos');

  returnItems(db, estoquista, c.id, { idempotency_key: 'k2', lines: [{ contract_item_id: line, returned: true }] });
  const after = homeDashboard(db, gestor);
  assert.equal(after.agenda.some((a) => a.kind === 'devolucao'), false);
  assert.equal(after.ocupacao!.percentual, 0);
});
