import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DB, openDatabase } from './db';
import { hashPassword } from './auth';
import { HttpError } from './http';
import { AuthUser } from '../shared/orcamentos/types';
import { addDaysISO, todayISO } from '../shared/orcamentos/dates';
import { INSPECTION_CHECKLIST } from '../shared/estoque/types';
import { createCatalogItem } from './services/catalog';
import { getBalance } from './services/stock/core';
import { createSupplier, saveLocation } from './services/stock/registry';
import { confirmEntry, saveEntry } from './services/stock/documents';
import { createReservation } from './services/stock/rental';
import { createCustomer } from './services/customers';
import { seedFinanceIfEmpty } from './services/finance/registry';
import { seedOsIfEmpty } from './services/os/core';
import { createContract } from './services/contracts/core';
import { contractAction, getContractDetail } from './services/contracts/lifecycle';
import { generateContractDocument } from './services/contracts/documents';
import { addAttachment, createOperation, getOperation } from './services/logistics/core';
import { availableActions, opAction } from './services/logistics/flow';
import { inspectItem, occurrenceAction } from './services/logistics/inspection';
import { logisticsAlerts, logisticsDashboard } from './services/logistics/reports';

let db: DB;
let admin: AuthUser, gestor: AuthUser, vendedor: AuthUser, estoquista: AuthUser, tecnico: AuthUser, fin: AuthUser, consulta: AuthUser;
let dep: number, customer: number, betoneira: number, andaime: number, bet1: number, bet2: number;
const today = todayISO();
const d = (n: number) => addDaysISO(today, n);
const at = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
const full = Object.fromEntries(INSPECTION_CHECKLIST.map((c) => [c.key, true]));
const exitChecklist = { conferido: true, funcionando: true, acessorios: true };

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
function activeContract(items: any[]) {
  const c = createContract(db, vendedor, { contract_type: 'locacao', customer_id: customer, start_date: today, end_date: d(60), responsible_user_id: vendedor.id, billing_frequency: 'mensal', delivery_address: 'Obra Rua B, 100', items });
  contractAction(db, vendedor, c.id, 'enviar_aprovacao', {});
  contractAction(db, gestor, c.id, 'aprovar', {});
  generateContractDocument(db, vendedor, c.id);
  contractAction(db, gestor, c.id, 'registrar_assinatura', { signature_method: 'presencial', signed_at: today, signed_by_names: 'Cliente', signature_evidence: 'Via física arquivada' });
  contractAction(db, gestor, c.id, 'ativar', {});
  return getContractDetail(db, admin, c.id);
}
const op = (id: number, u: AuthUser = admin) => getOperation(db, u, id, (o) => availableActions(db, o, u));
const act = (id: number, action: string, raw: any = {}, u: AuthUser = estoquista) => opAction(db, u, id, action, raw);
const ci = (c: any, itemId: number, assetId?: number) => c.items.find((i: any) => i.item_id === itemId && (!assetId || i.asset_id === assetId));
const movements = () => (db.prepare('SELECT COUNT(*) n FROM stock_movements').get() as any).n;
const assetStatus = (id: number) => (db.prepare('SELECT operational_status FROM stock_assets WHERE id = ?').get(id) as any).operational_status;

/** Entrega completa: programa, separa, sai e confirma. */
function deliverAll(c: any, items: { contract_item_id: number; quantity: number }[]) {
  const { id } = createOperation(db, estoquista, 'entrega', { contract_id: c.id, scheduled_at: at(2), address: 'Obra Rua B, 100', items });
  act(id, 'iniciar_separacao');
  const o = op(id);
  act(id, 'concluir_separacao', { checklist: exitChecklist, items: o.items.map((i) => ({ id: i.id, quantity: i.quantity_planned, condition: 'bom' })) });
  act(id, 'sair');
  act(id, 'confirmar_entrega', { receiver_name: 'Mestre de obras' });
  return id;
}

beforeEach(() => {
  db = openDatabase(':memory:');
  admin = mkUser('admin', 'admin');
  gestor = mkUser('gestor', 'gestor');
  vendedor = mkUser('vendedor', 'vendedor');
  estoquista = mkUser('estoquista', 'estoquista');
  tecnico = mkUser('tecnico', 'tecnico');
  fin = mkUser('fin', 'financeiro');
  consulta = mkUser('consulta', 'consulta');
  seedFinanceIfEmpty(db);
  seedOsIfEmpty(db);
  dep = saveLocation(db, admin, null, { code: 'DEP-01', name: 'Depósito', location_type: 'deposito' }).id;
  const supplier = createSupplier(db, estoquista, { name: 'Fornecedor Ltda' }).id;
  customer = createCustomer(db, admin, { person_type: 'PJ', name: 'Construtora Teste', document: '11222333000181', phone: '17991234567', street: 'Rua A', street_number: '1', city: 'SJRP', state: 'SP' }).id;
  betoneira = createCatalogItem(db, estoquista, { description: 'Betoneira 400L', kind: 'equipamento_locacao', tracking: 'individual', unit: 'un', monthly_rental_price: 100000, default_location_id: dep }).id;
  andaime = createCatalogItem(db, estoquista, { description: 'Painel de andaime', kind: 'equipamento_locacao', unit: 'pç', monthly_rental_price: 500, default_location_id: dep }).id;
  const e = saveEntry(db, estoquista, null, { entry_kind: 'compra', supplier_id: supplier, location_id: dep, items: [{ item_id: betoneira, quantity: 2, unit_cost: 350000, units: [{ asset_tag: 'BET-1' }, { asset_tag: 'BET-2' }] }, { item_id: andaime, quantity: 100, unit_cost: 5000 }] });
  confirmEntry(db, estoquista, e.id);
  bet1 = (db.prepare("SELECT id FROM stock_assets WHERE asset_tag = 'BET-1'").get() as any).id;
  bet2 = (db.prepare("SELECT id FROM stock_assets WHERE asset_tag = 'BET-2'").get() as any).id;
});

test('1. entrega vinculada ao contrato é programada sem movimentar o estoque', () => {
  const c = activeContract([{ item_id: betoneira, asset_id: bet1, unit_price: 100000 }, { item_id: andaime, quantity: 40, unit_price: 500 }]);
  const m0 = movements();
  const { id, number } = createOperation(db, estoquista, 'entrega', { contract_id: c.id, scheduled_at: at(3), items: [{ contract_item_id: ci(c, betoneira).id, quantity: 1 }, { contract_item_id: ci(c, andaime).id, quantity: 40 }] });
  assert.match(number, /^ENTG-\d{4}-\d{6}$/);
  const o = op(id);
  assert.equal(o.status, 'programada');
  assert.equal(o.address, 'Obra Rua B, 100'); // endereço da obra do contrato, sem alterar o cadastro do cliente
  assert.equal(movements(), m0);
  assert.equal(getBalance(db, andaime, dep).quantity, 100);
  expectHttp(() => createOperation(db, estoquista, 'entrega', { contract_id: c.id, scheduled_at: at(3), items: [{ contract_item_id: ci(c, andaime).id, quantity: 1 }] }), 422, /outra operação aberta/);
});

test('2. impede programar entrega de equipamento indisponível ou acima do saldo contratado', () => {
  const c = activeContract([{ item_id: betoneira, asset_id: bet2, unit_price: 100000 }, { item_id: andaime, quantity: 10, unit_price: 500 }]);
  db.prepare("UPDATE stock_assets SET operational_status = 'em_manutencao' WHERE id = ?").run(bet2);
  expectHttp(() => createOperation(db, estoquista, 'entrega', { contract_id: c.id, scheduled_at: at(3), items: [{ contract_item_id: ci(c, betoneira).id, quantity: 1 }] }), 422, /indisponível.*Em manutenção/);
  expectHttp(() => createOperation(db, estoquista, 'entrega', { contract_id: c.id, scheduled_at: at(3), items: [{ contract_item_id: ci(c, andaime).id, quantity: 11 }] }), 422, /saldo pendente/);
  expectHttp(() => createOperation(db, estoquista, 'entrega', { contract_id: c.id, scheduled_at: at(3), items: [{ contract_item_id: ci(c, andaime).id, quantity: 2 }, { contract_item_id: ci(c, andaime).id, quantity: 2 }] }), 400, /duas vezes/);
});

test('3/4. entrega parcial com ajuste autorizado; confirmação não duplica a saída', () => {
  const c = activeContract([{ item_id: betoneira, asset_id: bet1, unit_price: 100000 }, { item_id: andaime, quantity: 40, unit_price: 500 }]);
  const { id } = createOperation(db, estoquista, 'entrega', { contract_id: c.id, scheduled_at: at(2), items: [{ contract_item_id: ci(c, betoneira).id, quantity: 1 }, { contract_item_id: ci(c, andaime).id, quantity: 40 }] });
  act(id, 'iniciar_separacao');
  let o = op(id);
  const sep = (q: number) => o.items.map((i) => ({ id: i.id, quantity: i.tracking === 'individual' ? 1 : q }));
  expectHttp(() => act(id, 'concluir_separacao', { checklist: {}, items: sep(40) }), 400, /Checklist de saída/);
  expectHttp(() => act(id, 'concluir_separacao', { checklist: exitChecklist, items: sep(30) }), 400, /ajuste autorizado/);
  const andItem = o.items.find((i) => i.tracking === 'quantidade')!;
  expectHttp(() => act(id, 'ajustar', { reason: '10 peças amassadas', items: [{ id: andItem.id, quantity_planned: 30 }] }), 403);
  act(id, 'ajustar', { reason: '10 peças amassadas na separação', items: [{ id: andItem.id, quantity_planned: 30 }] }, gestor);
  o = op(id);
  act(id, 'concluir_separacao', { checklist: exitChecklist, items: sep(30) });
  assert.equal(getBalance(db, andaime, dep).quantity, 100); // separação não é saída
  act(id, 'sair', { departed_at: at(-1) });
  const m0 = movements();
  act(id, 'confirmar_entrega', { receiver_name: 'João (encarregado)' });
  const m1 = movements();
  assert.equal(m1 - m0, 2);
  assert.equal(act(id, 'confirmar_entrega', { receiver_name: 'João' }).already, true);
  assert.equal(movements(), m1);
  o = op(id);
  assert.equal(o.status, 'entregue_parcialmente');
  assert.ok(o.contract_operation_number);
  assert.equal(getBalance(db, andaime, dep).quantity, 70);
  const cd = getContractDetail(db, admin, c.id);
  assert.equal(ci(cd, andaime).delivered_qty, 30);
  // o restante (10) segue pendente e pode ser programado
  assert.ok(createOperation(db, estoquista, 'entrega', { contract_id: c.id, scheduled_at: at(30), items: [{ contract_item_id: ci(cd, andaime).id, quantity: 10 }] }).id);
});

test('5/6/7. retirada programada, recebimento parcial retido para inspeção e sem duplicidade', () => {
  const c = activeContract([{ item_id: andaime, quantity: 30, unit_price: 500 }]);
  deliverAll(c, [{ contract_item_id: ci(c, andaime).id, quantity: 30 }]);
  expectHttp(() => createOperation(db, estoquista, 'retirada', { contract_id: c.id, scheduled_at: at(5), address: 'Obra', items: [{ contract_item_id: ci(c, andaime).id, quantity: 20 }] }), 400, /motivo/);
  const { id } = createOperation(db, estoquista, 'retirada', { contract_id: c.id, reason: 'antecipada', scheduled_at: at(5), address: 'Obra', return_location_id: dep, items: [{ contract_item_id: ci(c, andaime).id, quantity: 20 }] });
  expectHttp(() => createOperation(db, estoquista, 'retirada', { contract_id: c.id, reason: 'antecipada', scheduled_at: at(5), address: 'Obra', items: [{ contract_item_id: ci(c, andaime).id, quantity: 11 }] }), 422, /com o cliente 10/);
  assert.equal(op(id).status, 'programada'); // agendar não é retirar
  act(id, 'iniciar');
  const item = op(id).items[0];
  act(id, 'receber', { items: [{ id: item.id, quantity: 15 }], counterpart_name: 'Motorista do cliente' });
  let o = op(id);
  assert.equal(o.status, 'recebida_parcialmente');
  const b = getBalance(db, andaime, dep);
  assert.equal(b.quantity, 85);
  assert.equal(b.unavailable, 15); // entrada física ≠ liberação
  assert.equal(ci(getContractDetail(db, admin, c.id), andaime).delivered_qty, 15); // saldo que ainda está com o cliente
  const m0 = movements();
  assert.equal(act(id, 'receber', { items: [{ id: item.id, quantity: 15 }] }).already, true);
  assert.equal(movements(), m0);
  assert.equal(getContractDetail(db, admin, c.id).status, 'ativo'); // devolução parcial não encerra o contrato
  // libera 12 na inspeção; 3 com avaria seguem indisponíveis e viram ocorrência
  inspectItem(db, estoquista, id, { order_item_id: item.id, quantity: 12, result: 'aprovado', checklist: full });
  inspectItem(db, estoquista, id, { order_item_id: item.id, quantity: 3, result: 'avaria', notes: 'Painéis amassados' });
  o = op(id);
  assert.equal(o.status, 'concluida');
  assert.equal(getBalance(db, andaime, dep).unavailable, 3);
  assert.equal(o.occurrences.length, 1);
});

test('8/9/10/11. inspeção: equipamento retido fica indisponível; avaria com evidência; manutenção abre OS; liberação só com checklist', () => {
  const c = activeContract([{ item_id: betoneira, asset_id: bet1, unit_price: 100000 }, { item_id: betoneira, asset_id: bet2, unit_price: 100000 }]);
  deliverAll(c, c.items.map((i: any) => ({ contract_item_id: i.id, quantity: 1 })));
  const { id } = createOperation(db, estoquista, 'devolucao', { contract_id: c.id, reason: 'fim_contrato', scheduled_at: at(1), items: c.items.map((i: any) => ({ contract_item_id: i.id, quantity: 1 })) });
  const items = op(id).items;
  act(id, 'receber', { items: items.map((i) => ({ id: i.id, quantity: 1, condition: 'regular' })) });
  assert.equal(assetStatus(bet1), 'aguardando_inspecao');
  const other = activeContract([{ item_id: andaime, quantity: 1, unit_price: 500 }]);
  expectHttp(() => createReservation(db, estoquista, { item_id: betoneira, asset_id: bet1, start_date: d(5), end_date: d(9), customer_name: 'X', confirm: true }), 409, /Aguardando inspeção/);
  assert.ok(other);
  const i1 = items.find((i) => i.asset_id === bet1)!;
  const i2 = items.find((i) => i.asset_id === bet2)!;
  expectHttp(() => inspectItem(db, estoquista, id, { order_item_id: i1.id, result: 'aprovado', checklist: {} }), 400, /checklist/);
  expectHttp(() => inspectItem(db, estoquista, id, { order_item_id: i1.id, result: 'avaria' }), 400, /Descreva/);
  inspectItem(db, tecnico, id, { order_item_id: i1.id, result: 'avaria', notes: 'Tambor amassado', estimated_cost: 35000 });
  assert.equal(assetStatus(bet1), 'danificado');
  const occ = op(id).occurrences[0];
  addAttachment(db, estoquista, { occurrence_id: occ.id }, { file_name: 'foto.png', content: 'data:image/png;base64,iVBORw0KGgo=', phase: 'inspecao' });
  assert.equal((db.prepare('SELECT COUNT(*) n FROM logistics_attachments WHERE occurrence_id = ?').get(occ.id) as any).n, 1);
  const r = inspectItem(db, tecnico, id, { order_item_id: i2.id, result: 'manutencao', notes: 'Motor falhando' });
  assert.equal(r.work_order_id, null, 'manutenção fica no Estoque, sem abrir OS');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM work_orders').get() as any).n, 0);
  assert.equal(assetStatus(bet2), 'em_manutencao');
  assert.equal(op(id).occurrences.find((o) => o.asset_tag === 'BET-2')!.status, 'encaminhada_manutencao');
  assert.equal(op(id).status, 'concluida');
});

test('12. ocorrência não gera cobrança sozinha: análise, aprovação e envio explícito, uma única vez', () => {
  const c = activeContract([{ item_id: betoneira, asset_id: bet1, unit_price: 100000 }]);
  deliverAll(c, [{ contract_item_id: c.items[0].id, quantity: 1 }]);
  const { id } = createOperation(db, estoquista, 'devolucao', { contract_id: c.id, reason: 'fim_contrato', scheduled_at: at(1), items: [{ contract_item_id: c.items[0].id, quantity: 1 }] });
  act(id, 'receber', { items: [{ id: op(id).items[0].id, quantity: 1 }] });
  const charges0 = (db.prepare('SELECT COUNT(*) n FROM contract_charges').get() as any).n;
  inspectItem(db, estoquista, id, { order_item_id: op(id).items[0].id, result: 'avaria', notes: 'Quebra na alavanca', estimated_cost: 20000 });
  const occ = op(id).occurrences[0];
  assert.equal(occ.responsibility, 'indefinida');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM contract_charges').get() as any).n, charges0); // nada cobrado
  expectHttp(() => occurrenceAction(db, gestor, occ.id, 'aprovar_cobranca', { approved_cost: 20000 }), 422, /responsabilidade/);
  expectHttp(() => occurrenceAction(db, estoquista, occ.id, 'analisar', { status: 'aguardando_aprovacao' }), 400, /responsabilidade do cliente/);
  occurrenceAction(db, estoquista, occ.id, 'analisar', { status: 'aguardando_aprovacao', responsibility: 'cliente', notes: 'Mau uso comprovado por foto' });
  expectHttp(() => occurrenceAction(db, estoquista, occ.id, 'aprovar_cobranca', { approved_cost: 18000 }), 403);
  expectHttp(() => occurrenceAction(db, estoquista, occ.id, 'enviar_financeiro', {}), 403);
  occurrenceAction(db, gestor, occ.id, 'aprovar_cobranca', { approved_cost: 18000 });
  const a = occurrenceAction(db, fin, occ.id, 'enviar_financeiro', {}) as any;
  const b = occurrenceAction(db, fin, occ.id, 'enviar_financeiro', {}) as any;
  assert.equal(b.already, true);
  assert.equal(a.charge_id, b.charge_id);
  const ch = db.prepare("SELECT ch.amount, e.entry_type FROM contract_charges ch JOIN financial_entries e ON e.id = ch.financial_entry_id WHERE ch.kind = 'extra'").all() as any[];
  assert.equal(ch.length, 1);
  assert.equal(ch[0].amount, 18000);
  assert.equal(ch[0].entry_type, 'receber');
});

test('13. cancelamento preserva movimentações: entregue não cancela; programada cancela com justificativa', () => {
  const c = activeContract([{ item_id: andaime, quantity: 20, unit_price: 500 }]);
  const done = deliverAll(c, [{ contract_item_id: c.items[0].id, quantity: 10 }]);
  const m0 = movements();
  expectHttp(() => act(done, 'cancelar', { reason: 'erro' }, gestor), 422);
  const { id } = createOperation(db, estoquista, 'entrega', { contract_id: c.id, scheduled_at: at(4), items: [{ contract_item_id: c.items[0].id, quantity: 10 }] });
  expectHttp(() => act(id, 'cancelar', {}, gestor), 400);
  act(id, 'cancelar', { reason: 'Cliente adiou' }, gestor);
  assert.equal(op(id).status, 'cancelada');
  assert.equal(movements(), m0);
  assert.throws(() => db.prepare('DELETE FROM logistics_orders WHERE id = ?').run(done), /não são excluídas/);
  assert.throws(() => db.prepare("UPDATE logistics_orders SET status = 'programada' WHERE id = ?").run(done), /encerrada/);
});

test('14. permissões aplicadas no servidor', () => {
  const c = activeContract([{ item_id: andaime, quantity: 20, unit_price: 500 }]);
  expectHttp(() => createOperation(db, consulta, 'entrega', { contract_id: c.id, scheduled_at: at(4), items: [{ contract_item_id: c.items[0].id, quantity: 5 }] }), 403);
  const { id } = createOperation(db, vendedor, 'entrega', { contract_id: c.id, scheduled_at: at(4), items: [{ contract_item_id: c.items[0].id, quantity: 5 }] });
  expectHttp(() => act(id, 'iniciar_separacao', {}, vendedor), 403);
  expectHttp(() => act(id, 'cancelar', { reason: 'x' }, estoquista), 403);
  expectHttp(() => opAction(db, tecnico, id, 'confirmar_entrega', { receiver_name: 'x' }), 403);
  assert.equal(op(id, vendedor).transport_cost_estimated, null);
});

test('15. multiempresa: não se aplica (empresa única, sem coluna de empresa)', () => {
  const cols = (db.prepare("SELECT name FROM pragma_table_info('logistics_orders')").all() as { name: string }[]).map((c) => c.name);
  assert.ok(!cols.some((c) => /company|empresa|tenant/.test(c)));
});

test('16. falha no Estoque na confirmação não deixa a operação inconsistente; corrigido, confirma uma vez', () => {
  const c = activeContract([{ item_id: betoneira, asset_id: bet1, unit_price: 100000 }]);
  const { id } = createOperation(db, estoquista, 'entrega', { contract_id: c.id, scheduled_at: at(2), items: [{ contract_item_id: c.items[0].id, quantity: 1 }] });
  act(id, 'iniciar_separacao');
  act(id, 'concluir_separacao', { checklist: exitChecklist, items: [{ id: op(id).items[0].id, quantity: 1 }] });
  act(id, 'sair');
  const m0 = movements();
  db.prepare("UPDATE stock_assets SET operational_status = 'em_manutencao' WHERE id = ?").run(bet1); // equipamento deixou de estar apto
  expectHttp(() => act(id, 'confirmar_entrega', { receiver_name: 'João' }), 422, /não pode ser entregue/);
  assert.equal(op(id).status, 'em_transporte');
  assert.equal(movements(), m0);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM contract_operations').get() as any).n, 0);
  db.prepare("UPDATE stock_assets SET operational_status = 'operacional' WHERE id = ?").run(bet1);
  act(id, 'confirmar_entrega', { receiver_name: 'João' });
  assert.equal(op(id).status, 'entregue');
  assert.equal((db.prepare('SELECT COUNT(*) n FROM contract_operations').get() as any).n, 1);
});

test('17. integração com Contratos/Estoque: painel e alertas refletem a operação; contrato encerra após devolução e inspeção', () => {
  const c = activeContract([{ item_id: betoneira, asset_id: bet1, unit_price: 100000 }]);
  deliverAll(c, [{ contract_item_id: c.items[0].id, quantity: 1 }]);
  const { id } = createOperation(db, estoquista, 'retirada', { contract_id: c.id, reason: 'fim_contrato', scheduled_at: at(-2), address: 'Obra', items: [{ contract_item_id: c.items[0].id, quantity: 1 }] });
  assert.ok(logisticsAlerts(db).some((a) => a.kind === 'retirada_atrasada' && a.order_id === id));
  assert.equal(logisticsDashboard(db).retiradas_programadas, 1);
  act(id, 'receber', { items: [{ id: op(id).items[0].id, quantity: 1 }] });
  expectHttp(() => contractAction(db, gestor, c.id, 'encerrar', {}), 422, /conferência/);
  assert.notEqual(getContractDetail(db, admin, c.id).status, 'encerrado', 'patrimônio aguardando conferência segura o encerramento');
  inspectItem(db, estoquista, id, { order_item_id: op(id).items[0].id, result: 'aprovado', checklist: full });
  assert.equal(assetStatus(bet1), 'operacional');
  assert.equal(getContractDetail(db, admin, c.id).status, 'encerrado', 'conferência do último patrimônio encerra sozinha');
});
