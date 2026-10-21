import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DB, openDatabase } from './db';
import { hashPassword } from './auth';
import { HttpError } from './http';
import { AuthUser } from '../shared/orcamentos/types';
import { addDaysISO, todayISO } from '../shared/orcamentos/dates';
import { addMonthsISO } from '../shared/financeiro/rules';
import { INSPECTION_CHECKLIST } from '../shared/estoque/types';
import { createCatalogItem } from './services/catalog';
import { getBalance } from './services/stock/core';
import { createSupplier, saveLocation } from './services/stock/registry';
import { confirmEntry, saveEntry } from './services/stock/documents';
import { availability } from './services/stock/rental';
import { createCustomer } from './services/customers';
import { convertQuotation, createQuotation, transitionQuotation } from './services/quotations';
import { DEFAULT_SETTINGS } from './settings';
import { registerConversionAdapter, unregisterConversionAdapter } from './integrations';
import { seedFinanceIfEmpty } from './services/finance/registry';
import { settle } from './services/finance/settlement';
import { createContract, getContractSettings, saveContractSettings, updateContract } from './services/contracts/core';
import { contractAction, deleteContract, getContractDetail, refreshContractStatuses } from './services/contracts/lifecycle';
import { deliver, reserveContract, returnItems } from './services/contracts/operations';
import { addAttachment, deleteDocument, documentFile, generateContractDocument } from './services/contracts/documents';
import { contractFromQuotation } from './services/contracts/fromQuotation';
import { consolidateChargesTx } from './services/contracts/billing';
import { loadRaw } from './services/contracts/core';
import { contractAlerts, contractDashboard } from './services/contracts/reports';

let db: DB;
let admin: AuthUser, gestor: AuthUser, vendedor: AuthUser, vendedor2: AuthUser, estoquista: AuthUser, fin: AuthUser, consulta: AuthUser;
let dep: number, customer: number, betoneira: number, andaime: number, disco: number, bet1: number, bet2: number, caixa: number;
const today = todayISO();
const d = (n: number) => addDaysISO(today, n);
let keySeq = 0;
const key = () => `k-${++keySeq}`;

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

function rental(extra: any = {}, items?: any[]) {
  return createContract(db, vendedor, {
    contract_type: 'locacao',
    customer_id: customer,
    start_date: today,
    end_date: d(60),
    responsible_user_id: vendedor.id,
    billing_frequency: 'mensal',
    items: items || [{ item_id: betoneira, asset_id: bet1, unit_price: 100000 }, { item_id: andaime, quantity: 40, unit_price: 500 }],
    ...extra,
  });
}

/** Aprovação → documento → assinatura com evidência → ativação. */
function formalize(id: number, activate = true) {
  contractAction(db, vendedor, id, 'enviar_aprovacao', {});
  contractAction(db, gestor, id, 'aprovar', {});
  generateContractDocument(db, vendedor, id);
  contractAction(db, gestor, id, 'registrar_assinatura', { signature_method: 'presencial', signed_at: today, signed_by_names: 'João (cliente)', signature_evidence: 'Via física arquivada na pasta 12' });
  if (activate) return contractAction(db, gestor, id, 'ativar', {});
}
const detail = (id: number, u: AuthUser = admin) => getContractDetail(db, u, id);
/** Contrato antigo, de antes da cobrança única obrigatória: locação com término cobrada por período. */
const legacyPeriods = (id: number) => db.prepare('UPDATE contracts SET single_charge = 0 WHERE id = ?').run(id);
const item = (id: number, code: number) => detail(id).items.find((i) => i.item_id === code)!;
const fullChecklist = Object.fromEntries(INSPECTION_CHECKLIST.map((c) => [c.key, true]));

beforeEach(() => {
  db = openDatabase(':memory:');
  admin = mkUser('admin', 'admin');
  gestor = mkUser('gestor', 'gestor');
  vendedor = mkUser('vendedor', 'vendedor');
  vendedor2 = mkUser('vendedor2', 'vendedor');
  estoquista = mkUser('estoquista', 'estoquista');
  fin = mkUser('fin', 'financeiro');
  consulta = mkUser('consulta', 'consulta');
  seedFinanceIfEmpty(db);
  caixa = (db.prepare("SELECT id FROM financial_accounts WHERE account_type = 'caixa'").get() as any).id;
  dep = saveLocation(db, admin, null, { code: 'DEP-01', name: 'Depósito', location_type: 'deposito' }).id;
  const supplier = createSupplier(db, estoquista, { name: 'Fornecedor Teste Ltda' }).id;
  customer = createCustomer(db, admin, { person_type: 'PJ', name: 'Construtora Teste', document: '11222333000181', phone: '17991234567', street: 'Rua A', street_number: '1', city: 'SJRP', state: 'SP' }).id;
  betoneira = createCatalogItem(db, estoquista, { description: 'Betoneira 400L', kind: 'equipamento_locacao', tracking: 'individual', unit: 'un', monthly_rental_price: 100000, default_location_id: dep }).id;
  andaime = createCatalogItem(db, estoquista, { description: 'Painel de andaime', kind: 'equipamento_locacao', unit: 'pç', monthly_rental_price: 500, default_location_id: dep }).id;
  disco = createCatalogItem(db, estoquista, { description: 'Disco de corte 7"', kind: 'produto_venda', unit: 'un', sale_price: 2500, default_location_id: dep }).id;
  const e = saveEntry(db, estoquista, null, {
    entry_kind: 'compra', supplier_id: supplier, location_id: dep,
    items: [
      { item_id: betoneira, quantity: 2, unit_cost: 350000, units: [{ asset_tag: 'BET-1' }, { asset_tag: 'BET-2' }] },
      { item_id: andaime, quantity: 100, unit_cost: 5000 },
      { item_id: disco, quantity: 50, unit_cost: 1000 },
    ],
  });
  confirmEntry(db, estoquista, e.id);
  bet1 = (db.prepare("SELECT id FROM stock_assets WHERE asset_tag = 'BET-1'").get() as any).id;
  bet2 = (db.prepare("SELECT id FROM stock_assets WHERE asset_tag = 'BET-2'").get() as any).id;
});

test('1. gera contrato (rascunho) a partir de orçamento de locação aprovado, sem reservar nem cobrar', () => {
  const settings = { ...DEFAULT_SETTINGS };
  const q = createQuotation(db, vendedor, { customer_id: customer, quotation_type: 'locacao', expiration_date: d(10), start_date: d(1), end_date: d(31), rental_billing_period: 'mensal', items: [{ catalog_item_id: betoneira, quantity: 2, unit_price: 100000 }, { catalog_item_id: andaime, quantity: 30, unit_price: 500 }], freight_amount: 15000 }, settings);
  transitionQuotation(db, admin, q.id, 'aprovar_interno', {}, settings);
  transitionQuotation(db, admin, q.id, 'registrar_envio', {}, settings);
  transitionQuotation(db, admin, q.id, 'aprovar_cliente', {}, settings);
  registerConversionAdapter({ type: 'contrato_locacao', convert: (qq, u) => contractFromQuotation(db, qq, u) });
  try {
    const out = convertQuotation(db, vendedor, q.id, settings);
    const c = db.prepare('SELECT * FROM contracts WHERE contract_number = ?').get(out.record_id) as any;
    assert.equal(c.status, 'rascunho');
    assert.equal(c.quotation_id, q.id);
    assert.equal(c.freight_delivery, 15000);
    const dt = detail(c.id);
    assert.equal(dt.items.length, 3); // betoneira individual vira 2 linhas (patrimônio escolhido depois)
    assert.equal(dt.period_amount, 2 * 100000 + 30 * 500);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM stock_reservations').get() as any).n, 0);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM financial_entries').get() as any).n, 0);
    assert.equal((db.prepare('SELECT status FROM quotations WHERE id = ?').get(q.id) as any).status, 'convertido');

    // 2. a mesma operação não gera outro contrato
    const again = convertQuotation(db, vendedor, q.id, settings);
    assert.equal(again.already, true);
    assert.equal(again.record_id, out.record_id);
    assert.equal(contractFromQuotation(db, { ...(q as any), id: q.id, quotation_type: 'locacao' }, vendedor).record_id, out.record_id);
    assert.equal((db.prepare('SELECT COUNT(*) n FROM contracts').get() as any).n, 1);
  } finally {
    unregisterConversionAdapter('contrato_locacao');
  }
});

test('3. impede locar equipamento indisponível (manutenção) ou quantidade acima do estoque', () => {
  db.prepare("UPDATE stock_assets SET operational_status = 'em_manutencao' WHERE id = ?").run(bet1);
  const a = rental();
  formalize(a.id, false);
  expectHttp(() => reserveContract(db, estoquista, a.id), 409, /Em manutenção/);
  const b = rental({}, [{ item_id: andaime, quantity: 150, unit_price: 500 }]);
  formalize(b.id, false);
  expectHttp(() => contractAction(db, gestor, b.id, 'ativar', {}), 409, /insuficiente/);
  assert.equal(detail(b.id).status, 'aprovado'); // nada mudou: a transação foi desfeita
});

test('4. dois contratos não reservam a mesma unidade física no mesmo período', () => {
  const a = rental();
  const b = rental({ start_date: d(30), end_date: d(90) }, [{ item_id: betoneira, asset_id: bet1, unit_price: 100000 }]);
  formalize(a.id);
  formalize(b.id, false);
  expectHttp(() => reserveContract(db, estoquista, b.id), 409, /BET-1 já está reservado/);
  const c = rental({ start_date: d(61), end_date: d(90) }, [{ item_id: betoneira, asset_id: bet1, unit_price: 100000 }]);
  formalize(c.id, false);
  assert.equal(reserveContract(db, estoquista, c.id).created, 1); // período seguinte: livre
});

test('5. contrato com vários itens: totais transparentes (período, venda, fretes, estimado)', () => {
  const c = rental({ general_discount: 1000, freight_delivery: 20000, freight_pickup: 20000, deposit_amount: 50000 }, [
    { item_id: betoneira, asset_id: bet1, unit_price: 100000 },
    { item_id: andaime, quantity: 40, unit_price: 500, discount_amount: 2000 },
    { item_id: disco, quantity: 5, unit_price: 2500, modality: 'venda' },
  ]);
  assert.equal(c.rental_subtotal, 100000 + 40 * 500 - 2000);
  assert.equal(c.period_amount, c.rental_subtotal - 1000);
  assert.equal(c.sale_total, 12500);
  assert.equal(c.one_time_total, 40000);
  const d60 = detail(c.id).schedule_preview;
  assert.equal(c.estimated_total, d60.reduce((a, l) => a + l.amount, 0));
  assert.ok(d60.some((l) => l.kind === 'venda_item') && d60.filter((l) => l.kind === 'frete').length === 2);
  assert.equal(c.deposit_amount, 50000); // caução registrada, fora do total
});

test('6. entrega parcial baixa só o entregue; reenvio não processa duas vezes; reserva ≠ entrega', () => {
  const c = rental({}, [{ item_id: andaime, quantity: 40, unit_price: 500 }]);
  formalize(c.id);
  assert.equal(item(c.id, andaime).reserved_qty, 40);
  assert.equal(getBalance(db, andaime, dep).quantity, 100); // reserva não é saída física
  const k = key();
  deliver(db, estoquista, c.id, { idempotency_key: k, counterpart_name: 'Mestre de obras', lines: [{ contract_item_id: item(c.id, andaime).id, quantity: 15 }] });
  const again = deliver(db, estoquista, c.id, { idempotency_key: k, lines: [{ contract_item_id: item(c.id, andaime).id, quantity: 15 }] });
  assert.equal(again.already, true);
  assert.equal(getBalance(db, andaime, dep).quantity, 85);
  const it = item(c.id, andaime);
  assert.equal(it.delivered_qty, 15);
  assert.equal(it.reserved_qty, 25);
  expectHttp(() => deliver(db, estoquista, c.id, { idempotency_key: key(), lines: [{ contract_item_id: it.id, quantity: 30 }] }), 422, /restam 25/);
  assert.equal(detail(c.id).documents.filter((x) => x.document_type === 'comprovante_entrega').length, 1);
});

test('7. devolução parcial com avaria: volta ao local como indisponível, restante segue com o cliente', () => {
  const c = rental({}, [{ item_id: andaime, quantity: 40, unit_price: 500 }]);
  formalize(c.id);
  const ci = item(c.id, andaime).id;
  deliver(db, estoquista, c.id, { idempotency_key: key(), lines: [{ contract_item_id: ci, quantity: 40 }] });
  expectHttp(() => returnItems(db, estoquista, c.id, { idempotency_key: key(), lines: [{ contract_item_id: ci, returned_qty: 10, damaged_qty: 2 }] }), 400, /descreva/);
  returnItems(db, estoquista, c.id, { idempotency_key: key(), lines: [{ contract_item_id: ci, returned_qty: 10, damaged_qty: 2, notes: 'Painéis amassados' }] });
  const it = item(c.id, andaime);
  assert.equal(it.delivered_qty, 28);
  assert.equal(it.returned_qty, 12);
  const bal = getBalance(db, andaime, dep);
  assert.equal(bal.quantity, 72);
  assert.equal(bal.unavailable, 2);
  expectHttp(() => returnItems(db, estoquista, c.id, { idempotency_key: key(), lines: [{ contract_item_id: ci, returned_qty: 30 }] }), 422, /está com 28/);
});

test('8. equipamento devolvido não fica disponível antes da inspeção/manutenção', () => {
  const c = rental({ end_date: d(10) }, [{ item_id: betoneira, asset_id: bet1, unit_price: 100000 }, { item_id: betoneira, asset_id: bet2, unit_price: 100000 }]);
  formalize(c.id);
  const [l1, l2] = detail(c.id).items;
  deliver(db, estoquista, c.id, { idempotency_key: key(), lines: [{ contract_item_id: l1.id, quantity: 1 }, { contract_item_id: l2.id, quantity: 1 }] });
  expectHttp(() => returnItems(db, estoquista, c.id, { idempotency_key: key(), lines: [{ contract_item_id: l1.id, returned: true, classification: 'disponivel', inspection: {} }] }), 400, /checklist/);
  returnItems(db, estoquista, c.id, { idempotency_key: key(), lines: [{ contract_item_id: l1.id, returned: true }, { contract_item_id: l2.id, returned: true, classification: 'manutencao', notes: 'Motor falhando' }] });
  const st = (id: number) => (db.prepare('SELECT operational_status FROM stock_assets WHERE id = ?').get(id) as any).operational_status;
  assert.equal(st(bet1), 'aguardando_inspecao');
  assert.equal(st(bet2), 'em_manutencao');
  const av = availability(db, { from: d(20), to: d(30), item_id: String(betoneira) });
  assert.ok(av.every((r) => !r.available_in_period));
  const other = rental({ start_date: d(20), end_date: d(30) }, [{ item_id: betoneira, asset_id: bet1, unit_price: 100000 }]);
  formalize(other.id, false);
  expectHttp(() => reserveContract(db, estoquista, other.id), 409, /Aguardando inspeção/);
  // encerramento exige a conferência (configuração padrão)
  expectHttp(() => contractAction(db, gestor, c.id, 'encerrar', {}), 422, /aguardando conferência: BET-1/);
});

test('9/10. cobranças geradas uma vez; recebimento só pelo Financeiro', () => {
  const draft = rental();
  expectHttp(() => contractAction(db, admin, draft.id, 'gerar_cobrancas', {}), 422);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM financial_entries').get() as any).n, 0); // rascunho não cobra
  const out = formalize(draft.id) as any;
  const n = detail(draft.id).charges.length;
  assert.equal(out.generated, n);
  assert.equal(n, detail(draft.id).schedule_preview.length);
  assert.equal((contractAction(db, fin, draft.id, 'gerar_cobrancas', {}) as any).generated, 0);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM financial_entries WHERE source_type = 'contrato'").get() as any).n, n);
  const first = detail(draft.id).charges[0];
  assert.equal(first.display_status, 'em_aberto');
  const entry = db.prepare('SELECT i.id FROM financial_installments i WHERE i.entry_id = ?').get(first.financial_entry_id) as any;
  settle(db, fin, { entry_id: first.financial_entry_id!, account_id: caixa, allocations: [{ installment_id: entry.id, amount: first.amount }] });
  const dt = detail(draft.id);
  assert.equal(dt.charges[0].display_status, 'pago');
  assert.equal(dt.financial!.received, first.amount);
  assert.equal(dt.financial!.open, dt.financial!.scheduled - first.amount);
});

test('locação com término sempre gera uma única cobrança com o valor total, mesmo se o envio pedir por período', () => {
  const c = rental({ billing_frequency: 'diaria', end_date: d(5), single_charge: false }, [{ item_id: andaime, quantity: 50, unit_price: 180 }]);
  formalize(c.id);
  const dt = detail(c.id);
  assert.equal(dt.single_charge, true);
  const rentalCharges = dt.charges.filter((ch) => ch.kind === 'periodo' || ch.kind === 'unico');
  assert.equal(rentalCharges.length, 1);
  assert.equal(rentalCharges[0].kind, 'unico');
  assert.equal(rentalCharges[0].amount, 5 * 50 * 180);
});

test('cobranças por período já lançadas são unificadas numa cobrança com o valor total', () => {
  const c = rental({ billing_frequency: 'diaria', end_date: d(5) }, [{ item_id: andaime, quantity: 50, unit_price: 180 }]);
  legacyPeriods(c.id);
  formalize(c.id);
  const before = detail(c.id).charges.filter((ch) => ch.kind === 'periodo');
  assert.equal(before.length, 5);
  const total = before.reduce((a, ch) => a + ch.amount, 0);
  expectHttp(() => consolidateChargesTx(db, consulta, loadRaw(db, c.id)), 403);
  assert.equal(consolidateChargesTx(db, fin, loadRaw(db, c.id)), 1);
  const live = detail(c.id).charges.filter((ch) => ch.status !== 'cancelado' && ch.kind !== 'frete');
  assert.equal(live.length, 1);
  assert.equal(live[0].kind, 'unico');
  assert.equal(live[0].amount, total);
  assert.equal(detail(c.id).single_charge, true);
  assert.equal(consolidateChargesTx(db, fin, loadRaw(db, c.id)), 0); // repetir não duplica
});

test('11. renovação valida a agenda e estende o cronograma; reajuste muda só cobranças futuras não pagas', () => {
  const c = rental({ end_date: addMonthsISO(today, 2) }, [{ item_id: betoneira, asset_id: bet1, unit_price: 100000 }]);
  legacyPeriods(c.id);
  formalize(c.id);
  assert.equal(detail(c.id).charges.length, 2);
  const blocker = rental({ start_date: addDaysISO(addMonthsISO(today, 3), 1), end_date: addMonthsISO(today, 4) }, [{ item_id: betoneira, asset_id: bet1, unit_price: 100000 }]);
  formalize(blocker.id);
  expectHttp(() => contractAction(db, gestor, c.id, 'prorrogar', { new_end: addMonthsISO(today, 5), reason: 'Obra atrasou' }), 409, /BET-1/);
  contractAction(db, gestor, c.id, 'prorrogar', { new_end: addMonthsISO(today, 3), reason: 'Obra atrasou' });
  const dt = detail(c.id);
  assert.equal(dt.end_date, addMonthsISO(today, 3));
  assert.equal(dt.charges.length, 3);
  assert.equal(dt.reservations[0].end_date, addMonthsISO(today, 3));
  assert.equal(dt.amendments.length, 1);
  assert.ok(dt.documents.some((x) => x.document_type === 'aditivo'));
  // pagar a primeira e reajustar a partir do 2º período
  const first = dt.charges[0];
  const inst = db.prepare('SELECT id FROM financial_installments WHERE entry_id = ?').get(first.financial_entry_id) as any;
  settle(db, fin, { entry_id: first.financial_entry_id!, account_id: caixa, allocations: [{ installment_id: inst.id, amount: first.amount }] });
  expectHttp(() => contractAction(db, gestor, c.id, 'reajustar', { percent: 10, effective_date: d(-1), reason: 'IGP-M' }), 400, /hoje ou futura/);
  contractAction(db, gestor, c.id, 'reajustar', { percent: 10, effective_date: addMonthsISO(today, 1), reason: 'IGP-M' });
  const after = detail(c.id).charges;
  assert.equal(after[0].amount, 100000);
  assert.equal(after[1].amount, 110000);
  assert.equal(after[2].amount, 110000);
  assert.equal(detail(c.id).period_amount, 110000);
});

test('12. encerramento bloqueado com devolução pendente; a devolução encerra sozinha e cancela só cobranças futuras não pagas', () => {
  const c = rental({ start_date: today, end_date: addMonthsISO(today, 3) }, [{ item_id: betoneira, asset_id: bet1, unit_price: 100000 }]);
  legacyPeriods(c.id);
  formalize(c.id);
  const line = detail(c.id).items[0];
  deliver(db, estoquista, c.id, { idempotency_key: key(), lines: [{ contract_item_id: line.id, quantity: 1 }] });
  contractAction(db, gestor, c.id, 'iniciar_encerramento', { reason: 'Obra concluída' });
  assert.equal(detail(c.id).status, 'pendente_devolucao');
  expectHttp(() => contractAction(db, gestor, c.id, 'encerrar', {}), 422, /com o cliente/);
  returnItems(db, estoquista, c.id, { idempotency_key: key(), lines: [{ contract_item_id: line.id, returned: true, classification: 'disponivel', inspection: fullChecklist, condition: 'bom' }] });
  assert.equal((db.prepare('SELECT operational_status FROM stock_assets WHERE id = ?').get(bet1) as any).operational_status, 'operacional');
  const dt = detail(c.id);
  assert.equal(dt.status, 'encerrado', 'tudo devolvido: encerra sem clicar em Encerrar');
  // 2º e 3º meses ainda não começaram e não foram pagos; o 1º (em aberto) continua no Financeiro
  assert.equal(dt.charges.filter((x) => x.display_status === 'cancelado').length, 2);
  assert.equal(dt.charges.filter((x) => x.display_status !== 'cancelado').length, 1);
  assert.ok(dt.events.some((e) => /encerrado automaticamente/.test(e.description)));
});

test('13. cancelamento exige justificativa, libera reservas e preserva o histórico', () => {
  const c = rental();
  formalize(c.id);
  expectHttp(() => contractAction(db, gestor, c.id, 'cancelar', {}), 400);
  const line = item(c.id, andaime);
  deliver(db, estoquista, c.id, { idempotency_key: key(), lines: [{ contract_item_id: line.id, quantity: 5 }] });
  expectHttp(() => contractAction(db, gestor, c.id, 'cancelar', { reason: 'Cliente desistiu' }), 422, /devolução/);
  returnItems(db, estoquista, c.id, { idempotency_key: key(), lines: [{ contract_item_id: line.id, returned_qty: 5 }] });
  contractAction(db, gestor, c.id, 'cancelar', { reason: 'Cliente desistiu' });
  const dt = detail(c.id);
  assert.equal(dt.status, 'cancelado');
  assert.equal(dt.cancellation_reason, 'Cliente desistiu');
  assert.equal(dt.reservations.filter((r) => r.status === 'confirmada').length, 0);
  assert.ok(dt.events.length >= 6);
  assert.throws(() => db.prepare('DELETE FROM contracts WHERE id = ?').run(c.id), /não são excluídos/);
  assert.throws(() => db.prepare('DELETE FROM contract_events WHERE contract_id = ?').run(c.id), /não pode ser apagado/);
});

test('14. permissões aplicadas no servidor', () => {
  expectHttp(() => createContract(db, estoquista, { contract_type: 'locacao' }), 403);
  const c = rental();
  expectHttp(() => updateContract(db, vendedor2, c.id, { ...c, items: c.items }), 403); // contrato de outro vendedor
  contractAction(db, vendedor, c.id, 'enviar_aprovacao', {});
  expectHttp(() => contractAction(db, vendedor, c.id, 'aprovar', {}), 403);
  contractAction(db, gestor, c.id, 'aprovar', {});
  expectHttp(() => reserveContract(db, consulta, c.id), 403);
  expectHttp(() => contractAction(db, fin, c.id, 'cancelar', { reason: 'x' }), 403);
  expectHttp(() => saveContractSettings(db, gestor, getContractSettings(db)), 403);
  const masked = detail(c.id, estoquista);
  assert.equal(masked.period_amount, 0);
  assert.equal(masked.financial, null);
  assert.ok(masked.items.every((i) => i.unit_price === 0));
  assert.ok(!detail(c.id, consulta).actions.includes('cancelar'));
});

test('15. multiempresa: não se aplica (o sistema atende uma única empresa, sem coluna de empresa nas tabelas)', () => {
  const cols = (db.prepare("SELECT name FROM pragma_table_info('contracts')").all() as { name: string }[]).map((c) => c.name);
  assert.ok(!cols.some((c) => /company|empresa|tenant/.test(c)));
});

test('16. documentos com versões; assinatura só com evidência; PDF gerado da fotografia', async () => {
  const c = rental();
  contractAction(db, vendedor, c.id, 'enviar_aprovacao', {});
  expectHttp(() => generateContractDocument(db, vendedor, c.id), 422);
  contractAction(db, gestor, c.id, 'aprovar', {});
  generateContractDocument(db, vendedor, c.id);
  assert.equal(detail(c.id).status, 'aguardando_assinatura');
  generateContractDocument(db, vendedor, c.id);
  const docs = detail(c.id).documents.filter((x) => x.document_type === 'contrato');
  assert.deepEqual(docs.map((x) => [x.version, x.status]), [[2, 'gerado'], [1, 'substituido']]);
  expectHttp(() => contractAction(db, gestor, c.id, 'registrar_assinatura', { signature_method: 'presencial', signed_at: today, signed_by_names: 'João' }), 400, /evidência/);
  expectHttp(() => contractAction(db, gestor, c.id, 'registrar_assinatura', { signature_method: 'digitalizado', signed_at: today, signed_by_names: 'João', signature_evidence: 'scan' }), 400, /Anexe/);
  expectHttp(() => contractAction(db, gestor, c.id, 'ativar', {}), 422);
  contractAction(db, gestor, c.id, 'registrar_assinatura', { signature_method: 'presencial', signed_at: today, signed_by_names: 'João', signature_evidence: 'Via física na pasta 3' });
  const signed = detail(c.id).documents.find((x) => x.version === 2)!;
  assert.equal(signed.status, 'assinado');
  assert.equal(detail(c.id).signed_at, today);
  const pdf = await documentFile(db, admin, c.id, signed.id);
  assert.equal(pdf.buffer.subarray(0, 4).toString(), '%PDF');
});

test('17. contrato de venda: sem reserva, renovação ou devolução; entrega baixa o estoque e encerra', () => {
  const c = createContract(db, vendedor, { contract_type: 'venda', customer_id: customer, start_date: today, responsible_user_id: vendedor.id, installments_count: 2, first_due_date: d(30), items: [{ item_id: disco, quantity: 5, unit_price: 2500 }] });
  assert.equal(c.end_date, null);
  assert.equal(c.sale_total, 12500);
  expectHttp(() => createContract(db, vendedor, { contract_type: 'venda', customer_id: customer, start_date: today, responsible_user_id: vendedor.id, items: [{ item_id: betoneira, asset_id: bet1, unit_price: 1 }] }), 400);
  formalize(c.id);
  const dt = detail(c.id);
  assert.equal(dt.status, 'ativo');
  assert.equal(dt.reservations.length, 0);
  assert.deepEqual(dt.charges.map((x) => x.amount), [6250, 6250]);
  for (const a of ['prorrogar', 'devolver', 'reservar', 'reajustar', 'iniciar_encerramento'] as const) assert.ok(!dt.actions.includes(a), a);
  expectHttp(() => contractAction(db, gestor, c.id, 'prorrogar', { new_end: d(90), reason: 'x' }), 422);
  expectHttp(() => contractAction(db, gestor, c.id, 'encerrar', {}), 422, /não entregues/);
  deliver(db, estoquista, c.id, { idempotency_key: key(), lines: [{ contract_item_id: dt.items[0].id, quantity: 5 }] });
  assert.equal(getBalance(db, disco, dep).quantity, 45);
  expectHttp(() => returnItems(db, estoquista, c.id, { idempotency_key: key(), lines: [] }), 422);
  contractAction(db, gestor, c.id, 'encerrar', {});
  assert.equal(detail(c.id).status, 'encerrado');
  assert.equal(detail(c.id).charges.filter((x) => x.display_status !== 'cancelado').length, 2); // parcelas da venda continuam devidas
});

test('rotina diária: agendado vira ativo no início e ativo vira vencido após o término; alertas e indicadores', () => {
  const c = rental({ start_date: d(2), end_date: d(40) });
  formalize(c.id);
  assert.equal(detail(c.id).status, 'agendado');
  refreshContractStatuses(db, d(2));
  assert.equal(detail(c.id).status, 'ativo');
  refreshContractStatuses(db, d(41));
  assert.equal(detail(c.id).status, 'vencido');
  const dash = contractDashboard(db, admin);
  assert.equal(dash.vencidos, 1);
  assert.ok(dash.valor_mensal_ativo! > 0);
  assert.ok(contractAlerts(db, admin).some((a) => a.kind === 'renovacao' && a.contract_id === c.id));
});

test('excluir contrato: rascunho pelo dono/gestor; formalizado só pelo admin e sem movimentação; o banco segue protegido', () => {
  const draft = rental();
  expectHttp(() => deleteContract(db, vendedor2, draft.id), 403);
  expectHttp(() => deleteContract(db, consulta, draft.id), 403);
  assert.equal(deleteContract(db, vendedor, draft.id).deleted, draft.contract_number);
  assert.equal(db.prepare('SELECT 1 FROM contracts WHERE id = ?').get(draft.id), undefined);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM contract_items WHERE contract_id = ?').get(draft.id) as any).n, 0);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE entity = 'contract' AND action = 'delete'").get());

  const waiting = rental();
  contractAction(db, vendedor, waiting.id, 'enviar_aprovacao', {});
  assert.ok(deleteContract(db, gestor, waiting.id).deleted, 'aguardando aprovação também sai');

  const active = rental();
  formalize(active.id);
  expectHttp(() => deleteContract(db, gestor, active.id), 403);
  assert.throws(() => db.prepare('DELETE FROM contracts WHERE id = ?').run(active.id), /não são excluídos/);
  assert.throws(() => db.prepare('DELETE FROM contract_events WHERE contract_id = ?').run(active.id), /histórico/);
  assert.throws(() => db.prepare('DELETE FROM contract_documents WHERE contract_id = ?').run(active.id), /Documentos/);

  // admin exclui formalizado sem movimentação: títulos cancelados no Financeiro, reservas liberadas
  const entries = db.prepare("SELECT id FROM financial_entries WHERE source_type = 'contrato' AND source_id LIKE ?").all(`${active.id}:%`) as { id: number }[];
  assert.equal(deleteContract(db, admin, active.id).deleted, active.contract_number);
  assert.equal(db.prepare('SELECT 1 FROM contracts WHERE id = ?').get(active.id), undefined);
  for (const e of entries) assert.equal((db.prepare('SELECT status FROM financial_entries WHERE id = ?').get(e.id) as any).status, 'cancelado');
  assert.equal(db.prepare("SELECT 1 FROM stock_reservations WHERE contract_ref = ? AND status IN ('pendente','confirmada')").get(active.contract_number), undefined);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM contract_purges').get() as any).n, 0);

  // com entrega registrada, nem o admin exclui
  const delivered = rental({}, [{ item_id: andaime, quantity: 2, unit_price: 500 }]);
  formalize(delivered.id);
  deliver(db, estoquista, delivered.id, { idempotency_key: key(), lines: [{ contract_item_id: item(delivered.id, andaime).id, quantity: 2 }] });
  expectHttp(() => deleteContract(db, admin, delivered.id), 422, /entrega/);
});

test('excluir documento: anexo e versão não assinada saem; comprovante só admin; assinado nunca', () => {
  const c = rental();
  contractAction(db, vendedor, c.id, 'enviar_aprovacao', {});
  contractAction(db, gestor, c.id, 'aprovar', {});
  generateContractDocument(db, vendedor, c.id);
  generateContractDocument(db, vendedor, c.id); // v1 fica substituída
  contractAction(db, gestor, c.id, 'registrar_assinatura', { signature_method: 'presencial', signed_at: today, signed_by_names: 'Cliente', signature_evidence: 'Via física' });
  contractAction(db, gestor, c.id, 'ativar', {});
  addAttachment(db, gestor, c.id, { content: 'data:application/pdf;base64,JVBERi0xLjQK', file_name: 'foto.pdf' });
  deliver(db, estoquista, c.id, { idempotency_key: key(), lines: [{ contract_item_id: item(c.id, andaime).id, quantity: 5 }] });
  const docs = () => db.prepare('SELECT id, document_type, status FROM contract_documents WHERE contract_id = ?').all(c.id) as any[];
  const find = (type: string, status?: string) => docs().find((d) => d.document_type === type && (!status || d.status === status));

  const old = find('contrato', 'substituido');
  expectHttp(() => deleteDocument(db, vendedor, c.id, old.id), 403);
  assert.ok(deleteDocument(db, gestor, c.id, old.id).deleted);
  assert.ok(deleteDocument(db, gestor, c.id, find('anexo').id).deleted);

  const signed = find('contrato', 'assinado');
  expectHttp(() => deleteDocument(db, admin, c.id, signed.id), 422, /assinad/);
  assert.throws(() => db.prepare('DELETE FROM contract_documents WHERE id = ?').run(signed.id), /não são excluídos/);

  const receipt = find('comprovante_entrega');
  expectHttp(() => deleteDocument(db, gestor, c.id, receipt.id), 403);
  assert.throws(() => db.prepare('DELETE FROM contract_documents WHERE id = ?').run(receipt.id), /não são excluídos/, 'sem a marca, o banco segue barrando');
  assert.ok(deleteDocument(db, admin, c.id, receipt.id).deleted);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM contract_operations WHERE contract_id = ?').get(c.id) as any).n, 1, 'a entrega continua registrada');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM contract_document_purges').get() as any).n, 0);
  assert.ok(detail(c.id).events.some((e: any) => /Documento excluído/.test(e.description)));
});

test('assinatura da locadora: só imagem válida; gravada no documento na emissão; trocar depois não muda o já emitido', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  expectHttp(() => saveContractSettings(db, gestor, { ...getContractSettings(db), lessor_signature: png }), 403);
  expectHttp(() => saveContractSettings(db, admin, { ...getContractSettings(db), lessor_signature: 'data:text/html;base64,PGI+' }), 400, /PNG ou JPG/);
  saveContractSettings(db, admin, { ...getContractSettings(db), lessor_signature: png, lessor_signatory: 'Sócio' });
  const c = rental();
  contractAction(db, vendedor, c.id, 'enviar_aprovacao', {});
  contractAction(db, gestor, c.id, 'aprovar', {});
  generateContractDocument(db, vendedor, c.id);
  const snap = () => JSON.parse((db.prepare("SELECT snapshot_data FROM contract_documents WHERE contract_id = ? AND document_type = 'contrato' ORDER BY version DESC").get(c.id) as any).snapshot_data);
  assert.deepEqual(snap().lessor_signature, { image: png, name: 'Sócio' });
  saveContractSettings(db, admin, { ...getContractSettings(db), lessor_signature: null });
  assert.equal(snap().lessor_signature.name, 'Sócio', 'documento emitido não muda');
  generateContractDocument(db, vendedor, c.id);
  assert.equal(snap().lessor_signature, undefined, 'nova emissão sem assinatura configurada');
});

test('pagar não encerra; só a devolução de tudo encerra, mesmo com cobrança em aberto', () => {
  const c = rental({ start_date: today, end_date: addMonthsISO(today, 1) }, [{ item_id: andaime, quantity: 10, unit_price: 500 }]);
  formalize(c.id);
  const line = detail(c.id).items[0];
  deliver(db, estoquista, c.id, { idempotency_key: key(), lines: [{ contract_item_id: line.id, quantity: 10 }] });
  const ch = detail(c.id).charges.find((x) => x.display_status !== 'cancelado')!;
  const inst = (db.prepare('SELECT id, original_amount FROM financial_installments WHERE entry_id = ?').get(ch.financial_entry_id) as any);
  settle(db, admin, { entry_id: ch.financial_entry_id!, account_id: caixa, allocations: [{ installment_id: inst.id, amount: inst.original_amount }] });
  assert.equal(detail(c.id).status, 'ativo', 'cobrança paga com material no cliente: continua ativo');
  returnItems(db, estoquista, c.id, { idempotency_key: key(), lines: [{ contract_item_id: line.id, returned_qty: 4 }] });
  assert.equal(detail(c.id).status, 'ativo', 'devolução parcial: continua ativo');
  const c2 = rental({ start_date: today, end_date: addMonthsISO(today, 1) }, [{ item_id: andaime, quantity: 5, unit_price: 500 }]);
  formalize(c2.id);
  const l2 = detail(c2.id).items[0];
  deliver(db, estoquista, c2.id, { idempotency_key: key(), lines: [{ contract_item_id: l2.id, quantity: 5 }] });
  returnItems(db, estoquista, c2.id, { idempotency_key: key(), lines: [{ contract_item_id: l2.id, returned_qty: 5 }] });
  const d2 = detail(c2.id);
  assert.equal(d2.status, 'encerrado', 'tudo devolvido sem pagamento: encerra');
  assert.ok(d2.charges.some((x) => x.display_status === 'em_aberto' || x.display_status === 'vencido'), 'a cobrança segue em aberto no Financeiro');
});

test('inclusão de itens por aditivo: reserva os novos, ajusta cobranças futuras e complementa as já pagas', async () => {
  const c = rental({ end_date: addMonthsISO(today, 2) }, [{ item_id: betoneira, asset_id: bet1, unit_price: 100000 }]);
  expectHttp(() => contractAction(db, gestor, c.id, 'incluir_itens', { items: [{ item_id: andaime, quantity: 1, unit_price: 500 }], effective_date: today, reason: 'x' }), 422); // rascunho: edita direto
  legacyPeriods(c.id);
  formalize(c.id);
  assert.ok(detail(c.id).actions.includes('incluir_itens'));
  const first = detail(c.id).charges[0];
  const inst = db.prepare('SELECT id FROM financial_installments WHERE entry_id = ?').get(first.financial_entry_id) as any;
  settle(db, fin, { entry_id: first.financial_entry_id!, account_id: caixa, allocations: [{ installment_id: inst.id, amount: first.amount }] });

  const body = (items: any[]) => ({ items, effective_date: today, reason: 'Cliente pediu mais equipamentos', row_version: detail(c.id).row_version });
  expectHttp(() => contractAction(db, vendedor, c.id, 'incluir_itens', body([{ item_id: andaime, quantity: 1, unit_price: 500 }])), 403);
  expectHttp(() => contractAction(db, gestor, c.id, 'incluir_itens', body([{ item_id: betoneira, asset_id: bet1, unit_price: 50000 }])), 400); // já está no contrato
  expectHttp(() => contractAction(db, gestor, c.id, 'incluir_itens', body([{ item_id: betoneira, unit_price: 50000 }])), 400); // patrimônio obrigatório
  expectHttp(() => contractAction(db, gestor, c.id, 'incluir_itens', body([{ item_id: andaime, quantity: 500, unit_price: 500 }])), 409); // acima do estoque

  contractAction(db, gestor, c.id, 'incluir_itens', body([
    { item_id: betoneira, asset_id: bet2, unit_price: 50000 },
    { item_id: andaime, quantity: 10, unit_price: 500 },
    { item_id: disco, quantity: 2, modality: 'venda', unit_price: 2500 },
  ]));
  const dt = detail(c.id);
  assert.equal(dt.items.length, 4);
  assert.equal(dt.period_amount, 155000);
  assert.equal(dt.sale_total, 5000);
  assert.ok(dt.reservations.some((r) => r.asset_tag === 'BET-2' && r.status === 'confirmada' && r.start_date === today));
  assert.ok(dt.reservations.some((r) => r.item_code === item(c.id, andaime).item_code && r.quantity === 10));
  const periods = dt.charges.filter((x) => x.kind === 'periodo');
  assert.equal(periods[0].amount, 100000); // paga: não muda
  assert.equal(periods[1].amount, 155000); // futura em aberto: ajustada
  const extra = dt.charges.find((x) => x.kind === 'extra')!;
  assert.equal(extra.amount, 55000); // complemento do período pago, inteiro (inclusão desde o 1º dia)
  assert.ok(dt.charges.some((x) => x.kind === 'venda_item' && x.amount === 5000));
  assert.equal(dt.amendments[0].amendment_type, 'alteracao');
  assert.equal(dt.amendments[0].new_amount, 155000);
  assert.ok(dt.actions.includes('entregar'));
  const doc = dt.documents.find((x) => x.document_type === 'aditivo')!;
  const pdf = await documentFile(db, admin, c.id, doc.id);
  assert.ok(pdf.buffer.length > 1000);
});
