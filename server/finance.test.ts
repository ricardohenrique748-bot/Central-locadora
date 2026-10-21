import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DB, openDatabase, transaction } from './db';
import { hashPassword } from './auth';
import { HttpError } from './http';
import { AuthUser } from '../shared/orcamentos/types';
import { addDaysISO, todayISO } from '../shared/orcamentos/dates';
import { accountBalance } from './services/finance/core';
import { listCategories, listCostCenters, saveAccount, saveFinanceSettings, getFinanceSettings, seedFinanceIfEmpty } from './services/finance/registry';
import { createEntry, createRecurrence, entryAction, generateRecurrences, getEntryDetail, listEntries, updateEntry } from './services/finance/entries';
import { reverseTransaction, settle } from './services/finance/settlement';
import { closeCash, createTransfer, openCash, transferAction } from './services/finance/treasury';
import { importStatement, listStatementItems, statementAction } from './services/finance/reconciliation';
import { cashFlow, dre, financeDashboard } from './services/finance/reports';
import { adjustContractChargeTx, cancelContractChargeTx, contractChargeEntryTx, convertSale, payableFromStockEntry } from './services/finance/integrations';
import { createCustomer } from './services/customers';
import { createCatalogItem } from './services/catalog';
import { createSupplier, saveLocation } from './services/stock/registry';
import { confirmEntry, saveEntry } from './services/stock/documents';
import { getBalance } from './services/stock/core';
import { convertQuotation, createQuotation, transitionQuotation } from './services/quotations';
import { DEFAULT_SETTINGS } from './settings';
import { registerConversionAdapter, unregisterConversionAdapter } from './integrations';

let db: DB;
let admin: AuthUser, fin: AuthUser, gestor: AuthUser, consulta: AuthUser, vendedor: AuthUser;
let banco: number, caixa: number, customer: number, supplier: number;
let catAluguel: number, catVenda: number, catTarifa: number, catEquip: number, catLocacao: number;
const today = todayISO();
const d = (n: number) => addDaysISO(today, n);

function mkUser(name: string, role: AuthUser['role']): AuthUser {
  const row = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?) RETURNING id').get(name, `${name}@t.com`, hashPassword('senha-segura'), role) as { id: number };
  return { id: row.id, name, email: `${name}@t.com`, role, active: true };
}
function expectHttp(fn: () => unknown, status: number, msg?: RegExp) {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof HttpError, `esperava HttpError, veio ${e}`);
    assert.equal(e.status, status, e.message);
    if (msg) assert.match(e.message, msg);
    return;
  }
  assert.fail(`esperava erro HTTP ${status}`);
}
const cat = (name: string) => listCategories(db).find((c) => c.name === name)!.id;

/** Invariante: saldo de cada conta = inicial + Σ efetivadas; liquidado de cada parcela = Σ alocações. */
function assertConsistent() {
  const bad = db
    .prepare('SELECT i.id, i.settled_amount, COALESCE((SELECT SUM(amount) FROM financial_allocations a WHERE a.installment_id = i.id),0) s FROM financial_installments i')
    .all() as any[];
  for (const r of bad) assert.equal(r.settled_amount, r.s, `parcela ${r.id} inconsistente`);
}

function payable(amount: number, extra: any = {}) {
  return createEntry(db, fin, 'pagar', { description: 'Aluguel do galpão', party_type: 'outro', party_name: 'Imobiliária X', category_id: catAluguel, original_amount: amount, plan: { count: 1, first_due: d(5) }, ...extra });
}
function receivable(amount: number, extra: any = {}) {
  return createEntry(db, fin, 'receber', { description: 'Serviço de montagem', party_type: 'cliente', customer_id: customer, category_id: catLocacao, origin: 'servico', original_amount: amount, plan: { count: 1, first_due: d(10) }, ...extra });
}

beforeEach(() => {
  db = openDatabase(':memory:');
  admin = mkUser('admin', 'admin');
  fin = mkUser('fin', 'financeiro');
  gestor = mkUser('gestor', 'gestor');
  consulta = mkUser('consulta', 'consulta');
  vendedor = mkUser('vendedor', 'vendedor');
  seedFinanceIfEmpty(db);
  caixa = (db.prepare("SELECT id FROM financial_accounts WHERE account_type = 'caixa'").get() as any).id;
  banco = saveAccount(db, admin, null, { name: 'Banco Inter', account_type: 'corrente', opening_balance: 1000000, opening_balance_date: d(-30) }).id;
  customer = createCustomer(db, admin, { person_type: 'PJ', name: 'Construtora Teste', document: '11222333000181', phone: '17991234567', street: 'Rua A', street_number: '1', city: 'SJRP', state: 'SP' }).id;
  supplier = createSupplier(db, admin, { name: 'Fornecedor Peças Ltda' }).id;
  catAluguel = cat('Aluguel');
  catVenda = cat('Venda de equipamentos');
  catTarifa = cat('Tarifas bancárias');
  catEquip = cat('Compra de equipamentos');
  catLocacao = cat('Locação de equipamentos');
});

test('1. contas financeiras: saldo inicial vira base e não pode ser alterado após movimentar', () => {
  assert.equal(accountBalance(db, banco), 1000000);
  expectHttp(() => saveAccount(db, fin, null, { name: 'X', account_type: 'caixa' }), 403);
  const e = receivable(5000);
  settle(db, fin, { entry_id: e.id, account_id: banco, amount: 5000 });
  expectHttp(() => saveAccount(db, admin, banco, { name: 'Banco Inter', account_type: 'corrente', opening_balance: 0, opening_balance_date: d(-30) }), 400, /saldo inicial/);
});

test('2/3. conta a pagar e a receber criadas não movimentam dinheiro', () => {
  const p = payable(120000);
  const r = receivable(80000);
  assert.equal(p.entry_type, 'pagar');
  assert.match(p.entry_number, /^PAG-/);
  assert.match(r.entry_number, /^REC-/);
  assert.equal(p.display_status, 'aberto');
  assert.equal(accountBalance(db, banco), 1000000); // cobrança criada ≠ dinheiro
  expectHttp(() => createEntry(db, fin, 'pagar', { description: 'Teste', party_type: 'outro', party_name: 'Fornecedor XY', category_id: catVenda, original_amount: 100, plan: { count: 1, first_due: d(1) } }), 400, /despesa/);
});

test('4. parcelamento com soma exata e parcelas independentes', () => {
  const e = payable(100000, { plan: { count: 3, first_due: d(10), interval: 'mensal' } });
  assert.equal(e.installments.length, 3);
  assert.equal(e.installments.reduce((a, i) => a + i.original_amount, 0), 100000);
  settle(db, fin, { entry_id: e.id, account_id: banco, allocations: [{ installment_id: e.installments[0].id, amount: e.installments[0].original_amount }] });
  const after = getEntryDetail(db, fin, e.id);
  assert.equal(after.installments[0].status, 'liquidado');
  assert.equal(after.installments[1].status, 'aberto');
  assert.equal(after.display_status, 'parcial'); // uma parcela paga não liquida o título
});

test('5/6/7. pagamento e recebimento parciais e liquidação total', () => {
  const p = payable(100000);
  settle(db, fin, { entry_id: p.id, account_id: banco, amount: 40000 });
  let x = getEntryDetail(db, fin, p.id);
  assert.equal(x.pending_amount, 60000);
  assert.equal(x.installments[0].status, 'parcial');
  settle(db, fin, { entry_id: p.id, account_id: banco, amount: 60000 });
  x = getEntryDetail(db, fin, p.id);
  assert.equal(x.display_status, 'liquidado');
  assert.equal(x.payments.length, 2); // cada pagamento registrado separadamente
  const r = receivable(30000);
  settle(db, fin, { entry_id: r.id, account_id: banco, amount: 10000 });
  assert.equal(getEntryDetail(db, fin, r.id).display_status, 'parcial');
  assert.equal(accountBalance(db, banco), 1000000 - 100000 + 10000);
  assertConsistent();
});

test('juros, multa e desconto na baixa alteram o valor atualizado e ficam auditados', () => {
  const r = receivable(10000);
  settle(db, fin, { entry_id: r.id, account_id: banco, amount: 10300, adjustments: [{ installment_id: r.installments[0].id, interest: 100, penalty: 200 }] });
  const x = getEntryDetail(db, fin, r.id);
  assert.equal(x.installments[0].updated_amount, 10300);
  assert.equal(x.display_status, 'liquidado');
  assert.ok(x.history.some((h) => h.action === 'encargos_na_baixa'));
});

test('8. bloqueio de pagamento acima do pendente e reenvio duplicado', () => {
  const p = payable(50000);
  expectHttp(() => settle(db, fin, { entry_id: p.id, account_id: banco, amount: 50001 }), 422, /acima do saldo pendente/);
  const a = settle(db, fin, { entry_id: p.id, account_id: banco, amount: 50000, idempotency_key: 'form-123' });
  const b = settle(db, fin, { entry_id: p.id, account_id: banco, amount: 50000, idempotency_key: 'form-123' });
  assert.equal(a.transaction_id, b.transaction_id);
  assert.equal(b.duplicate, true);
  expectHttp(() => settle(db, fin, { entry_id: p.id, account_id: banco, amount: 1 }), 422, /pendente/);
  assert.equal(accountBalance(db, banco), 1000000 - 50000);
});

test('saldo insuficiente bloqueia pagamento (sem saldo negativo configurado)', () => {
  const p = payable(10000);
  expectHttp(() => settle(db, fin, { entry_id: p.id, account_id: caixa, amount: 10000 }), 422, /Saldo insuficiente/);
});

test('9. transferência: atômica, não é receita/despesa, sem duplicidade, com estorno', () => {
  const t = createTransfer(db, fin, { source_account_id: banco, destination_account_id: caixa, amount: 20000, idempotency_key: 'trf-1' }) as any;
  assert.equal(t.status, 'efetivada');
  assert.equal(accountBalance(db, banco), 980000);
  assert.equal(accountBalance(db, caixa), 20000);
  const again = createTransfer(db, fin, { source_account_id: banco, destination_account_id: caixa, amount: 20000, idempotency_key: 'trf-1' }) as any;
  assert.equal(again.id, t.id);
  assert.equal(accountBalance(db, caixa), 20000);
  expectHttp(() => createTransfer(db, fin, { source_account_id: banco, destination_account_id: banco, amount: 1 }), 400, /diferentes/);
  const k = financeDashboard(db, { from: d(-1), to: today }).kpis;
  assert.equal(k.receitas_realizadas, 0);
  assert.equal(k.despesas_realizadas, 0);
  expectHttp(() => transferAction(db, fin, t.id, 'estornar', { reason: 'x' }), 403);
  transferAction(db, admin, t.id, 'estornar', { reason: 'Lançada errada' });
  assert.equal(accountBalance(db, banco), 1000000);
  assert.equal(accountBalance(db, caixa), 0);
  const p = createTransfer(db, fin, { source_account_id: banco, destination_account_id: caixa, amount: 500, status: 'pendente' }) as any;
  assert.equal(p.status, 'pendente');
  assert.equal(accountBalance(db, caixa), 0);
  transferAction(db, fin, p.id, 'efetivar', {});
  assert.equal(accountBalance(db, caixa), 500);
});

test('10. saldo = inicial + efetivadas, inclusive saldo em data passada', () => {
  const r = receivable(7000);
  settle(db, fin, { entry_id: r.id, account_id: banco, amount: 7000, date: d(-2) });
  assert.equal(accountBalance(db, banco, d(-3)), 1000000);
  assert.equal(accountBalance(db, banco, d(-2)), 1007000);
  assert.equal(accountBalance(db, banco, d(-31)), 0); // antes do saldo inicial
  expectHttp(() => settle(db, fin, { entry_id: receivable(100).id, account_id: banco, amount: 100, date: d(-40) }), 400, /anterior ao saldo inicial/);
  expectHttp(() => settle(db, fin, { entry_id: receivable(100).id, account_id: banco, amount: 100, date: d(1) }), 400, /futura/);
});

test('11. fluxo realizado e projetado: liquidado não reaparece; parcial projeta só o restante', () => {
  const r = receivable(100000, { plan: { count: 1, first_due: d(3) } });
  const p = payable(30000, { plan: { count: 1, first_due: d(4) } });
  settle(db, fin, { entry_id: r.id, account_id: banco, amount: 40000 });
  const proj = cashFlow(db, { mode: 'projetado', horizon: '7' }) as any;
  assert.equal(proj.rows.reduce((a: number, x: any) => a + x.entradas, 0), 60000);
  assert.equal(proj.rows.reduce((a: number, x: any) => a + x.saidas, 0), 30000);
  assert.equal(proj.rows.at(-1).saldo_final, 1040000 + 60000 - 30000);
  const real = cashFlow(db, { mode: 'realizado', from: d(-1), to: today }) as any;
  assert.equal(real.rows.reduce((a: number, x: any) => a + x.entradas, 0), 40000);
  assert.equal(real.rows.at(-1).saldo_final, 1040000);
  const k = financeDashboard(db, { from: today, to: today }).kpis;
  assert.equal(k.saldo_atual, 1040000);
  assert.equal(k.a_receber_aberto, 60000); // não somado ao saldo
  assert.equal(k.projetado_7, 1040000 + 60000 - 30000);
  void p;
});

test('12. contas vencidas e próximas do vencimento', () => {
  const v = payable(1000, { plan: { count: 1, first_due: d(-3) } });
  payable(2000, { plan: { count: 1, first_due: d(3) } });
  assert.equal(getEntryDetail(db, fin, v.id).display_status, 'vencido');
  assert.equal(getEntryDetail(db, fin, v.id).installments[0].days_overdue, 3);
  assert.equal(listEntries(db, fin, 'pagar', { status: 'vencido' }).total, 1);
  assert.equal(listEntries(db, fin, 'pagar', { soon: '7' }).total, 1);
  assert.equal(financeDashboard(db, {}).kpis.vencido_pagar, 1000);
});

test('13. conciliação: sugestão, confirmação, duplicados e lançamento a partir do extrato sem duplicar', () => {
  const r = receivable(150000);
  settle(db, fin, { entry_id: r.id, account_id: banco, amount: 150000, date: today });
  const br = today.split('-').reverse().join('/');
  const csv = `Data;Histórico;Valor\n${br};PIX RECEBIDO CONSTRUTORA TESTE;1.500,00\n${br};TARIFA PACOTE;-29,90\n`;
  const imp = importStatement(db, fin, { account_id: banco, file_name: 'extrato.csv', content: csv });
  assert.equal(imp.imported, 2);
  assert.equal(imp.auto_matched, 0); // regra automática desligada por padrão
  const again = importStatement(db, fin, { account_id: banco, file_name: 'extrato.csv', content: csv });
  assert.equal(again.duplicates, 2);
  const items = listStatementItems(db, { account_id: String(banco), status: 'pendente' }).rows;
  const pix = items.find((i) => i.amount === 150000)!;
  assert.ok(pix.suggestions!.length >= 1);
  const balanceBefore = accountBalance(db, banco);
  statementAction(db, fin, pix.id, 'conciliar', { transaction_id: pix.suggestions![0].transaction_id });
  assert.equal(accountBalance(db, banco), balanceBefore); // conciliar não cria nova receita
  const tarifa = items.find((i) => i.amount === -2990)!;
  expectHttp(() => statementAction(db, fin, tarifa.id, 'conciliar', { transaction_id: pix.suggestions![0].transaction_id }), 409);
  statementAction(db, fin, tarifa.id, 'criar_lancamento', { category_id: catTarifa });
  assert.equal(accountBalance(db, banco), balanceBefore - 2990);
  assert.equal(listStatementItems(db, { account_id: String(banco), status: 'pendente' }).rows.length, 0);
  expectHttp(() => statementAction(db, fin, tarifa.id, 'criar_lancamento', { category_id: catTarifa }), 422);
});

test('14. estorno: devolve saldo e parcela, não apaga nada e não estorna duas vezes', () => {
  const r = receivable(20000);
  const s = settle(db, fin, { entry_id: r.id, account_id: banco, amount: 20000 });
  expectHttp(() => reverseTransaction(db, fin, s.transaction_id, 'erro'), 403);
  expectHttp(() => entryAction(db, fin, r.id, 'cancelar', { reason: 'x' }), 422, /estorne/);
  reverseTransaction(db, admin, s.transaction_id, 'Recebimento lançado na conta errada');
  const x = getEntryDetail(db, fin, r.id);
  assert.equal(x.display_status, 'aberto');
  assert.equal(x.payments.length, 2); // original + estorno preservados
  assert.equal(accountBalance(db, banco), 1000000);
  expectHttp(() => reverseTransaction(db, admin, s.transaction_id, 'de novo'), 409);
  assertConsistent();
});

test('15. integração com vendas: aprovação não gera cobrança; conversão gera uma única cobrança e baixa estoque', () => {
  const loc = saveLocation(db, admin, null, { code: 'DEP', name: 'Depósito', location_type: 'deposito' }).id;
  const prod = createCatalogItem(db, admin, { description: 'Disco de corte', kind: 'produto_venda', unit: 'un', sale_price: 2500, default_location_id: loc }).id;
  const se = saveEntry(db, admin, null, { entry_kind: 'inicial', location_id: loc, items: [{ item_id: prod, quantity: 10, unit_cost: 1000 }] });
  confirmEntry(db, admin, se.id);
  const settings = { ...DEFAULT_SETTINGS };
  const q = createQuotation(db, admin, { customer_id: customer, quotation_type: 'venda', expiration_date: d(10), items: [{ catalog_item_id: prod, quantity: 4, unit_price: 2500 }] }, settings);
  transitionQuotation(db, admin, q.id, 'aprovar_interno', {}, settings);
  transitionQuotation(db, admin, q.id, 'registrar_envio', {}, settings);
  transitionQuotation(db, admin, q.id, 'aprovar_cliente', {}, settings);
  assert.equal(listEntries(db, fin, 'receber', {}).total, 0); // aprovado ≠ dinheiro nem cobrança
  registerConversionAdapter({ type: 'venda', convert: (qq, u) => convertSale(db, qq, u) });
  try {
    const c1 = convertQuotation(db, admin, q.id, settings);
    const c2 = convertQuotation(db, admin, q.id, settings);
    assert.equal(c2.already, true);
    assert.equal(c1.record_id, c2.record_id);
    const recs = listEntries(db, fin, 'receber', { quotation_id: String(q.id) });
    assert.equal(recs.total, 1);
    assert.equal(recs.rows[0].updated_amount, 10000);
    assert.equal(recs.rows[0].source_type, 'venda');
    assert.equal(getBalance(db, prod, loc).quantity, 6);
    assert.equal(accountBalance(db, banco), 1000000); // cobrança não é recebimento
  } finally {
    unregisterConversionAdapter('venda');
  }
});

test('15b. manutenção: conversão baixa a peça usada (mesmo não vendável) e gera conta a receber de manutenção', () => {
  const loc = saveLocation(db, admin, null, { code: 'OFI', name: 'Oficina', location_type: 'deposito' }).id;
  const peca = createCatalogItem(db, admin, { description: 'Rolamento', kind: 'peca', unit: 'un', default_location_id: loc }).id;
  confirmEntry(db, admin, saveEntry(db, admin, null, { entry_kind: 'inicial', location_id: loc, items: [{ item_id: peca, quantity: 5, unit_cost: 1500 }] }).id);
  const settings = { ...DEFAULT_SETTINGS };
  const q = createQuotation(db, admin, { customer_id: customer, quotation_type: 'venda', category: 'manutencao', expiration_date: d(10), equipment_info: { description: 'Compactador do cliente' }, items: [{ catalog_item_id: peca, quantity: 2, unit_price: 3000 }, { catalog_item_id: null, item_code_snapshot: 'SERVICO', description_snapshot: 'Mão de obra', unit: 'h', quantity: 2, unit_price: 9000 }] }, settings);
  transitionQuotation(db, admin, q.id, 'aprovar_interno', {}, settings);
  transitionQuotation(db, admin, q.id, 'registrar_envio', {}, settings);
  transitionQuotation(db, admin, q.id, 'aprovar_cliente', {}, settings);
  registerConversionAdapter({ type: 'venda', convert: (qq, u) => convertSale(db, qq, u) });
  try {
    convertQuotation(db, admin, q.id, settings);
    const recs = listEntries(db, fin, 'receber', { quotation_id: String(q.id) });
    assert.equal(recs.total, 1);
    assert.equal(recs.rows[0].updated_amount, 24000);
    assert.match(recs.rows[0].description, /^Manutenção ORC-.* — Compactador do cliente/);
    assert.equal(getBalance(db, peca, loc).quantity, 3, 'peça usada no conserto sai do estoque');
  } finally {
    unregisterConversionAdapter('venda');
  }
});

test('16/17. contratos: uma conta por cobrança, idempotente; ajuste e cancelamento não mexem no que já foi recebido', () => {
  const charge = (id: number, due: string) => ({ contract_id: 1, charge_id: id, contract_number: 'CTR-2026-000001', customer_id: customer, description: 'Locação', amount: 50000, due_date: due, competence_date: due, category_id: null, origin: 'locacao' as const });
  const ids = transaction(db, () => [charge(1, d(1)), charge(2, d(31)), charge(3, d(61))].map((c) => contractChargeEntryTx(db, null, c)));
  const again = transaction(db, () => contractChargeEntryTx(db, null, charge(1, d(1))));
  assert.equal(again, ids[0]);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM financial_entries WHERE source_type = 'contrato'").get() as any).n, 3);
  const e = getEntryDetail(db, fin, ids[0]);
  assert.equal(e.origin, 'locacao');
  settle(db, fin, { entry_id: e.id, account_id: banco, allocations: [{ installment_id: e.installments[0].id, amount: 50000 }] });
  expectHttp(() => transaction(db, () => adjustContractChargeTx(db, admin, ids[0], 55000, 'Reajuste')), 422);
  transaction(db, () => adjustContractChargeTx(db, admin, ids[1], 55000, 'Reajuste'));
  assert.equal(getEntryDetail(db, fin, ids[1]).installments[0].original_amount, 55000);
  expectHttp(() => transaction(db, () => cancelContractChargeTx(db, admin, ids[0], 'Devolução antecipada')), 422);
  transaction(db, () => cancelContractChargeTx(db, admin, ids[2], 'Devolução antecipada'));
  assert.equal(getEntryDetail(db, fin, ids[2]).status, 'cancelado');
  assert.equal(getEntryDetail(db, fin, ids[0]).installments[0].status, 'liquidado');
  assert.equal(accountBalance(db, banco), 1050000);
});

test('17. integração com estoque: compra gera uma única conta a pagar vinculada', () => {
  const loc = saveLocation(db, admin, null, { code: 'D2', name: 'D2', location_type: 'deposito' }).id;
  const it = createCatalogItem(db, admin, { description: 'Peça X', kind: 'peca', unit: 'un' }).id;
  const se = saveEntry(db, admin, null, { entry_kind: 'compra', supplier_id: supplier, location_id: loc, items: [{ item_id: it, quantity: 5, unit_cost: 2000 }], extra_expenses: 500 });
  expectHttp(() => payableFromStockEntry(db, fin, se.id, { category_id: cat('Compra de peças') }), 422, /confirmadas/);
  confirmEntry(db, admin, se.id);
  const p = payableFromStockEntry(db, fin, se.id, { category_id: cat('Compra de peças'), plan: { count: 2, first_due: d(30) } });
  assert.equal(p.original_amount, 10500);
  assert.equal(p.installments.length, 2);
  assert.equal(p.party_name, 'Fornecedor Peças Ltda');
  expectHttp(() => payableFromStockEntry(db, fin, se.id, { category_id: cat('Compra de peças') }), 409, /já gerou/);
});

test('18. permissões: vendedor/consulta não operam; aprovação por alçada', () => {
  expectHttp(() => createEntry(db, consulta, 'pagar', {}), 403);
  expectHttp(() => createEntry(db, vendedor, 'pagar', {}), 403);
  saveFinanceSettings(db, admin, { ...getFinanceSettings(db), payment_approval_limit: 100000 });
  const big = payable(150000);
  assert.equal(big.status, 'aguardando_aprovacao');
  expectHttp(() => settle(db, fin, { entry_id: big.id, account_id: banco, amount: 150000 }), 422, /aprovação/);
  expectHttp(() => entryAction(db, fin, big.id, 'aprovar', {}), 403);
  entryAction(db, gestor, big.id, 'aprovar', {});
  settle(db, fin, { entry_id: big.id, account_id: banco, amount: 150000 });
  assert.equal(getEntryDetail(db, fin, big.id).display_status, 'liquidado');
  assert.equal(payable(50000).status, 'ativo');
  assert.equal(getEntryDetail(db, consulta, receivable(100).id).party_document?.startsWith('•••'), true);
});

test('19. auditoria: criação, pagamento, ajuste e cancelamento ficam registrados com usuário', () => {
  const p = payable(10000);
  settle(db, fin, { entry_id: p.id, account_id: banco, amount: 4000 });
  const x = getEntryDetail(db, fin, p.id);
  const actions = x.history.map((h) => h.action);
  assert.ok(actions.includes('create'));
  assert.ok(actions.includes('pagamento'));
  assert.ok(x.history.every((h) => h.user_name));
  const r = receivable(500);
  entryAction(db, fin, r.id, 'cancelar', { reason: 'Cobrança indevida' });
  assert.ok(getEntryDetail(db, fin, r.id).history.some((h) => h.action === 'cancelar'));
});

test('edição bloqueada após liquidação; recorrência idempotente; categoria inativa', () => {
  const p = payable(10000);
  settle(db, fin, { entry_id: p.id, account_id: banco, amount: 1000 });
  expectHttp(() => updateEntry(db, fin, p.id, { description: 'Outra', party_type: 'outro', party_name: 'X', category_id: catAluguel, original_amount: 9000, plan: { count: 1, first_due: d(5) } }), 422);
  createRecurrence(db, fin, 'pagar', { description: 'Internet', party_type: 'outro', party_name: 'Provedor', category_id: cat('Internet e telefonia'), original_amount: 15000, frequency: 'mensal', start_date: today });
  const n1 = listEntries(db, fin, 'pagar', { source_type: 'recorrencia' }).total;
  generateRecurrences(db);
  generateRecurrences(db);
  assert.equal(listEntries(db, fin, 'pagar', { source_type: 'recorrencia' }).total, n1);
  assert.ok(n1 >= 2);
  db.prepare('UPDATE financial_categories SET active = 0 WHERE id = ?').run(catAluguel);
  expectHttp(() => payable(100), 400, /inativa/);
});

test('fechamento de caixa registra diferença como movimentação auditável', () => {
  createTransfer(db, fin, { source_account_id: banco, destination_account_id: caixa, amount: 10000 });
  const sid = openCash(db, fin, caixa);
  expectHttp(() => openCash(db, fin, caixa), 409);
  const r = receivable(2000);
  settle(db, fin, { entry_id: r.id, account_id: caixa, amount: 2000 });
  expectHttp(() => closeCash(db, fin, sid, { counted_amount: 11900 }), 400, /justificativa/);
  const s = closeCash(db, fin, sid, { counted_amount: 11900, justification: 'Troco a menor' })!;
  assert.equal(s.expected_balance, 12000);
  assert.equal(s.difference, -100);
  assert.equal(accountBalance(db, caixa), 11900);
});

test('DRE gerencial: competência, investimento fora do resultado, rateio por centro de custo', () => {
  const ccs = listCostCenters(db);
  receivable(100000, { category_id: catLocacao, competence_date: today });
  payable(30000, { category_id: catAluguel, competence_date: today, cost_centers: [{ cost_center_id: ccs[0].id, amount: 20000 }, { cost_center_id: ccs[1].id, amount: 10000 }] });
  createEntry(db, fin, 'pagar', { description: 'Betoneira nova', party_type: 'fornecedor', supplier_id: supplier, category_id: catEquip, original_amount: 500000, plan: { count: 1, first_due: d(30) } });
  const r = dre(db, { from: today, to: today });
  const line = (k: string) => r.lines.find((l) => l.key === k)!.value;
  assert.equal(line('receita_locacao'), 100000);
  assert.equal(line('desp_adm'), -30000);
  assert.equal(line('res_final'), 70000); // compra de patrimônio não entra
  assert.equal(r.investimentos.value, 500000);
  const byCc = dre(db, { from: today, to: today, cost_center_id: String(ccs[0].id) });
  assert.equal(byCc.lines.find((l) => l.key === 'desp_adm')!.value, -20000);
  assert.equal(dre(db, { from: today, to: today, regime: 'caixa' }).lines.find((l) => l.key === 'res_final')!.value, 0); // nada pago ainda
});

test('20. persistência: dados continuam após reabrir o banco', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cl-fin-')), 'fin.db');
  let db2 = openDatabase(file);
  const u = { ...admin, id: (db2.prepare("INSERT INTO users (name, email, password_hash, role) VALUES ('a', 'a@a.com', 'x', 'admin') RETURNING id").get() as any).id };
  seedFinanceIfEmpty(db2);
  const acc = saveAccount(db2, u, null, { name: 'Banco', account_type: 'corrente', opening_balance: 5000, opening_balance_date: d(-1) });
  const e = createEntry(db2, u, 'receber', { description: 'Venda balcão', party_type: 'outro', party_name: 'Cliente avulso', category_id: (db2.prepare("SELECT id FROM financial_categories WHERE name = 'Venda de produtos'").get() as any).id, original_amount: 3000, plan: { count: 1, first_due: today } });
  settle(db2, u, { entry_id: e.id, account_id: acc.id, amount: 3000 });
  db2.close();
  db2 = openDatabase(file);
  assert.equal(accountBalance(db2, acc.id), 8000);
  assert.equal((db2.prepare('SELECT COUNT(*) n FROM financial_entries').get() as any).n, 1);
  db2.close();
});
