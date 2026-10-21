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
import { chargeInvoicePdf } from './services/contracts/invoice';
import { chargeMeasurement, chargeMeasurementPdf } from './services/contracts/measurement';
import { deliver } from './services/contracts/operations';
import { listRentalInvoices } from './services/finance/invoices';

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


test('fatura da cobrança: PDF com o número do título, só para quem vê valores, nunca de cobrança cancelada', async () => {
  const c = createContract(db, vendedor, { contract_type: 'locacao', customer_id: customer, start_date: today, end_date: addDaysISO(today, 20), responsible_user_id: vendedor.id, billing_frequency: 'mensal', items: [{ item_id: betoneira, asset_id: bet1, unit_price: 100000 }] });
  contractAction(db, vendedor, c.id, 'enviar_aprovacao', {});
  contractAction(db, gestor, c.id, 'aprovar', {});
  generateContractDocument(db, vendedor, c.id);
  contractAction(db, gestor, c.id, 'registrar_assinatura', { signature_method: 'presencial', signed_at: today, signed_by_names: 'Cliente', signature_evidence: 'Via física' });
  contractAction(db, gestor, c.id, 'ativar', { generate_charges: true });
  const ch = db.prepare('SELECT * FROM contract_charges WHERE contract_id = ?').get(c.id) as any;
  assert.ok(ch?.financial_entry_id, 'ativação gera a cobrança no Financeiro');
  const entry = (db.prepare('SELECT entry_number FROM financial_entries WHERE id = ?').get(ch.financial_entry_id) as any).entry_number;

  const f = await chargeInvoicePdf(db, gestor, c.id, ch.id);
  assert.equal(f.buffer.subarray(0, 4).toString(), '%PDF');
  assert.equal(f.name, `Fatura ${entry}.pdf`);
  await assert.rejects(chargeInvoicePdf(db, estoquista, c.id, ch.id), (e: any) => e.status === 403);
  await assert.rejects(chargeInvoicePdf(db, tecnico, c.id, ch.id), (e: any) => e.status === 403);
  await assert.rejects(chargeInvoicePdf(db, gestor, c.id + 99, ch.id), (e: any) => e.status === 404);

  db.prepare("UPDATE contract_charges SET status = 'cancelado' WHERE id = ?").run(ch.id);
  await assert.rejects(chargeInvoicePdf(db, gestor, c.id, ch.id), (e: any) => e.status === 404);
});

test('medição: diárias a partir da entrega; listagem de faturas no Financeiro', async () => {
  const c = createContract(db, vendedor, { contract_type: 'locacao', customer_id: customer, start_date: today, end_date: addDaysISO(today, 20), responsible_user_id: vendedor.id, billing_frequency: 'mensal', freight_delivery: 5000, items: [{ item_id: betoneira, asset_id: bet1, unit_price: 100000 }] });
  contractAction(db, vendedor, c.id, 'enviar_aprovacao', {});
  contractAction(db, gestor, c.id, 'aprovar', {});
  generateContractDocument(db, vendedor, c.id);
  contractAction(db, gestor, c.id, 'registrar_assinatura', { signature_method: 'presencial', signed_at: today, signed_by_names: 'Cliente', signature_evidence: 'Via física' });
  contractAction(db, gestor, c.id, 'ativar', { generate_charges: true });
  const ch = db.prepare("SELECT * FROM contract_charges WHERE contract_id = ? AND kind = 'periodo'").get(c.id) as any;
  const frete = db.prepare("SELECT * FROM contract_charges WHERE contract_id = ? AND kind = 'frete'").get(c.id) as any;

  // sem entrega: nada em uso
  assert.equal(chargeMeasurement(db, gestor, c.id, ch.id).lines[0].unit_days, 0);
  const item = db.prepare('SELECT id FROM contract_items WHERE contract_id = ?').get(c.id) as any;
  deliver(db, estoquista, c.id, { idempotency_key: 'k-med', lines: [{ contract_item_id: item.id, quantity: 1 }] });
  const m = chargeMeasurement(db, gestor, c.id, ch.id);
  assert.equal(m.number, `${c.contract_number}-M01`);
  assert.equal(m.lines[0].period_days, 20);
  assert.equal(m.lines[0].days_in_use, 20);
  assert.equal(m.lines[0].delivered, 1);
  assert.equal(m.movements.length, 1);
  const f = await chargeMeasurementPdf(db, gestor, c.id, ch.id);
  assert.equal(f.buffer.subarray(0, 4).toString(), '%PDF');
  assert.throws(() => chargeMeasurement(db, estoquista, c.id, ch.id), (e: any) => e.status === 403);
  assert.throws(() => chargeMeasurement(db, gestor, c.id, frete.id), (e: any) => e.status === 422);

  const all = listRentalInvoices(db, {});
  assert.equal(all.total, 2);
  assert.deepEqual(all.rows.map((r: any) => [r.kind, r.measurable, r.display_status]).sort(), [['frete', false, 'em_aberto'], ['periodo', true, 'em_aberto']]);
  assert.equal(listRentalInvoices(db, { kind: 'medicao' }).total, 1);
  assert.equal(listRentalInvoices(db, { status: 'pago' }).total, 0);
  assert.equal(listRentalInvoices(db, { q: c.contract_number }).total, 2);
});
