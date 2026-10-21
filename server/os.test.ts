import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DB, openDatabase } from './db';
import { hashPassword } from './auth';
import { HttpError } from './http';
import { AuthUser } from '../shared/orcamentos/types';
import { addDaysISO, todayISO } from '../shared/orcamentos/dates';
import { INSPECTION_CHECKLIST } from '../shared/estoque/types';
import { createCatalogItem, updateCatalogItem } from './services/catalog';
import { getBalance } from './services/stock/core';
import { createSupplier, saveLocation } from './services/stock/registry';
import { confirmEntry, saveEntry } from './services/stock/documents';
import { createReservation, inspectAsset } from './services/stock/rental';
import { seedFinanceIfEmpty } from './services/finance/registry';
import { createOrder, seedOsIfEmpty, updateOrder } from './services/os/core';
import { addMaterial, materialAction } from './services/os/materials';
import { addActivity, addService, serviceAction } from './services/os/labor';
import { answerChecklist, changeStatus, getOrderDetail, releaseEquipment, setBlocking } from './services/os/lifecycle';
import { generatePreventives, listPlans, savePlan } from './services/os/preventive';
import { equipmentHistory, osDashboard } from './services/os/queries';

let db: DB;
let admin: AuthUser, gestor: AuthUser, tecnico: AuthUser, estoquista: AuthUser, vendedor: AuthUser, fin: AuthUser, consulta: AuthUser;
let dep: number, supplier: number, betoneira: number, vela: number, oleo: number, bet1: number, bet2: number;
const today = todayISO();
let k = 0;
const key = () => `os-${++k}`;

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
const open = (extra: any = {}) => createOrder(db, tecnico, { asset_id: bet1, order_type: 'corretiva', title: 'Motor falhando ao ligar', priority: 'alta', responsible_user_id: tecnico.id, ...extra });
const detail = (id: number, u: AuthUser = admin) => getOrderDetail(db, u, id);
const status = (id: number, to: string, extra: any = {}) => changeStatus(db, tecnico, id, { to, ...extra });
const assetStatus = (id: number) => (db.prepare('SELECT operational_status FROM stock_assets WHERE id = ?').get(id) as any).operational_status;
const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const fullInspection = Object.fromEntries(INSPECTION_CHECKLIST.map((c) => [c.key, true]));

/** Leva a OS até "em testes" com diagnóstico, atividade e resultado de teste. */
function toTesting(id: number) {
  status(id, 'em_execucao');
  const d = detail(id);
  updateOrder(db, tecnico, id, { ...d, diagnosis: 'Carburador entupido', test_result: 'Funcionou 30 min em carga' });
  addActivity(db, tecnico, id, { description: 'Limpeza do carburador', technician_user_id: tecnico.id, started_at: iso(120), ended_at: iso(30), hourly_rate: 6000 });
  status(id, 'em_testes');
}

beforeEach(() => {
  db = openDatabase(':memory:');
  admin = mkUser('admin', 'admin');
  gestor = mkUser('gestor', 'gestor');
  tecnico = mkUser('tecnico', 'tecnico');
  estoquista = mkUser('estoquista', 'estoquista');
  vendedor = mkUser('vendedor', 'vendedor');
  fin = mkUser('fin', 'financeiro');
  consulta = mkUser('consulta', 'consulta');
  seedFinanceIfEmpty(db);
  seedOsIfEmpty(db);
  dep = saveLocation(db, admin, null, { code: 'DEP-01', name: 'Depósito', location_type: 'deposito' }).id;
  supplier = createSupplier(db, estoquista, { name: 'Retífica Rio Preto Ltda' }).id;
  betoneira = createCatalogItem(db, estoquista, { description: 'Betoneira 400L', kind: 'equipamento_locacao', tracking: 'individual', unit: 'un', category: 'Betoneiras', monthly_rental_price: 100000, default_location_id: dep }).id;
  vela = createCatalogItem(db, estoquista, { description: 'Vela de ignição', kind: 'peca', unit: 'un', default_location_id: dep }).id;
  oleo = createCatalogItem(db, estoquista, { description: 'Óleo 2T', kind: 'consumo', unit: 'L', default_location_id: dep }).id;
  const e = saveEntry(db, estoquista, null, {
    entry_kind: 'compra', supplier_id: supplier, location_id: dep,
    items: [
      { item_id: betoneira, quantity: 2, unit_cost: 350000, units: [{ asset_tag: 'BET-1', serial_number: 'SN-1' }, { asset_tag: 'BET-2' }] },
      { item_id: vela, quantity: 10, unit_cost: 2500 },
      { item_id: oleo, quantity: 20, unit_cost: 1500 },
    ],
  });
  confirmEntry(db, estoquista, e.id);
  bet1 = (db.prepare("SELECT id FROM stock_assets WHERE asset_tag = 'BET-1'").get() as any).id;
  bet2 = (db.prepare("SELECT id FROM stock_assets WHERE asset_tag = 'BET-2'").get() as any).id;
});

test('1. abre OS corretiva com fotografia do equipamento, prazo pela prioridade e sem bloquear por padrão', () => {
  const id = open();
  const o = detail(id);
  assert.match(o.order_number, /^OS-\d{4}-\d{6}$/);
  assert.equal(o.status, 'aberta');
  assert.equal(o.asset.asset_tag, 'BET-1');
  assert.equal(o.asset.serial_number, 'SN-1');
  assert.equal(o.due_date, addDaysISO(today, 3)); // prioridade alta
  assert.equal(o.blocks_equipment, false);
  assert.equal(assetStatus(bet1), 'novo'); // abrir OS não bloqueia sem necessidade
  assert.ok(o.events.some((e) => e.event_type === 'abertura'));
});

test('2/13. preventiva por plano: gerada uma vez, com checklist; concluir agenda a próxima sem duplicar', () => {
  savePlan(db, gestor, null, { name: 'Revisão mensal', asset_id: bet1, interval_days: 30, first_due_date: today, responsible_user_id: tecnico.id });
  assert.equal(generatePreventives(db, null).created, 1);
  assert.equal(generatePreventives(db, null).created, 0);
  const id = (db.prepare("SELECT id FROM work_orders WHERE order_type = 'preventiva'").get() as any).id;
  const o = detail(id);
  assert.equal(o.origin, 'preventiva');
  assert.ok(o.checklist.length >= 5);
  toTesting(id);
  answerChecklist(db, tecnico, id, { answers: detail(id).checklist.map((c) => ({ id: c.id, result: 'aprovado' })) });
  status(id, 'concluida');
  const s = listPlans(db)[0].schedules[0];
  assert.equal(s.last_done_at, today);
  assert.equal(s.next_due_date, addDaysISO(today, 30));
  assert.equal(generatePreventives(db, null).created, 0);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM work_orders WHERE order_type = 'preventiva'").get() as any).n, 1);
  // plano por horas de uso só vale para equipamento com medidor
  savePlan(db, gestor, null, { name: 'Troca de óleo', asset_id: bet2, interval_hours: 100 });
  assert.equal(generatePreventives(db, null).created, 0);
});

test('3. transições controladas: pausa exige motivo, conclusão só a partir de testes, vendedor não altera status', () => {
  const id = open();
  expectHttp(() => status(id, 'concluida'), 422, /Não é possível passar/);
  expectHttp(() => status(id, 'aguardando_pecas'), 400, /motivo/);
  expectHttp(() => changeStatus(db, vendedor, id, { to: 'em_execucao' }), 403);
  status(id, 'em_execucao');
  addActivity(db, tecnico, id, { description: 'Desmontagem', technician_user_id: tecnico.id, started_at: iso(60), ended_at: iso(10), hourly_rate: 0 });
  status(id, 'aguardando_pecas', { reason: 'Falta carburador' });
  assert.equal(detail(id).times.worked_min, 50); // tempo trabalhado preservado na pausa
  status(id, 'em_execucao');
  expectHttp(() => status(id, 'programada'), 422);
  assert.ok(detail(id).events.filter((e) => e.event_type === 'status').length >= 3);
});

test('4. não conclui sem o checklist obrigatório aprovado', () => {
  const id = open({ order_type: 'inspecao' });
  assert.equal(detail(id).requires_checklist, true);
  toTesting(id);
  expectHttp(() => status(id, 'concluida'), 422, /Checklist obrigatório/);
  const items = detail(id).checklist;
  expectHttp(() => answerChecklist(db, tecnico, id, { answers: [{ id: items[0].id, result: 'nao_aplicavel' }] }), 400);
  expectHttp(() => answerChecklist(db, tecnico, id, { answers: [{ id: items[0].id, result: 'reprovado' }] }), 400, /Descreva/);
  answerChecklist(db, tecnico, id, { answers: items.map((c) => ({ id: c.id, result: c.required ? 'aprovado' : 'nao_aplicavel' })) });
  status(id, 'concluida');
  assert.equal(detail(id).status, 'concluida');
});

test('5/6/7. materiais: solicitar não movimenta; reserva, retirada real sem duplicidade, utilização e devolução', () => {
  const id = open();
  const mid = addMaterial(db, tecnico, id, { item_id: vela, quantity: 3 }).id;
  assert.equal(getBalance(db, vela, dep).quantity, 10); // lista de necessidade não consome
  materialAction(db, estoquista, id, mid, 'reservar', { quantity: 3 });
  assert.equal(getBalance(db, vela, dep).reserved, 3);
  const kw = key();
  materialAction(db, tecnico, id, mid, 'retirar', { quantity: 2, idempotency_key: kw });
  assert.equal(materialAction(db, tecnico, id, mid, 'retirar', { quantity: 2, idempotency_key: kw }).already, true);
  let b = getBalance(db, vela, dep);
  assert.equal(b.quantity, 8);
  assert.equal(b.reserved, 1);
  expectHttp(() => materialAction(db, tecnico, id, mid, 'utilizar', { quantity: 3 }), 422, /retirado/);
  materialAction(db, tecnico, id, mid, 'utilizar', { quantity: 1 });
  materialAction(db, tecnico, id, mid, 'devolver', { quantity: 1, idempotency_key: key() });
  b = getBalance(db, vela, dep);
  assert.equal(b.quantity, 9);
  const m = detail(id).materials[0];
  assert.deepEqual([m.quantity_requested, m.quantity_reserved, m.quantity_withdrawn, m.quantity_used, m.quantity_returned], [3, 1, 2, 1, 1]);
  assert.equal(detail(id).costs!.actual.parts, 2500); // só o utilizado vira custo
  // saldo não fica negativo
  const m2 = addMaterial(db, tecnico, id, { item_id: oleo, quantity: 50 }).id;
  expectHttp(() => materialAction(db, tecnico, id, m2, 'retirar', { quantity: 50, idempotency_key: key() }), 422, /insuficiente/);
  // histórico de movimentos preservado
  assert.throws(() => db.prepare('DELETE FROM work_order_material_moves').run(), /não são excluídas/);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM stock_movements WHERE movement_type IN ('consumo_os','devolucao_os')").get() as any).n, 2);
});

test('8/9/10. mão de obra e terceiros: previsto ≠ realizado; despesa vai ao Financeiro uma única vez', () => {
  const id = open({ estimated_labor: 20000 });
  addActivity(db, tecnico, id, { description: 'Diagnóstico', technician_user_id: tecnico.id, started_at: iso(100), ended_at: iso(10), hourly_rate: 6000 });
  const sid = addService(db, tecnico, id, { supplier_id: supplier, description: 'Retífica do motor', estimated_cost: 50000, supplier_document: 'ORC-77' }).id;
  let c = detail(id).costs!;
  assert.equal(c.actual.labor, 9000);
  assert.equal(c.estimated.services, 50000);
  assert.equal(c.actual.services, 0); // previsto não é realizado
  expectHttp(() => serviceAction(db, tecnico, id, sid, 'aprovar', { approved_cost: 45000 }), 403);
  serviceAction(db, gestor, id, sid, 'aprovar', { approved_cost: 45000 });
  expectHttp(() => serviceAction(db, fin, id, sid, 'financeiro', {}), 422); // ainda não realizado
  serviceAction(db, tecnico, id, sid, 'concluir', { actual_cost: 48000 });
  c = detail(id).costs!;
  assert.equal(c.estimated.services, 45000);
  assert.equal(c.actual.services, 48000);
  assert.equal(c.estimated.labor, 20000);
  assert.equal(c.difference, c.actual.total - c.estimated.total);
  assert.equal(c.payable, 0); // custo técnico ≠ obrigação financeira
  expectHttp(() => serviceAction(db, tecnico, id, sid, 'financeiro', {}), 403);
  const a = serviceAction(db, fin, id, sid, 'financeiro', {}) as any;
  const b = serviceAction(db, fin, id, sid, 'financeiro', {}) as any;
  assert.equal(b.already, true);
  assert.equal(a.entry_id, b.entry_id);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM financial_entries WHERE source_type = 'os_servico'").get() as any).n, 1);
  assert.equal(detail(id).costs!.payable, 48000);
});

test('11/12. OS impeditiva bloqueia o equipamento; liberação só após conclusão e inspeção', () => {
  const id = open({ operational_risk: 'alto' });
  assert.equal(detail(id).blocks_equipment, true);
  assert.equal(assetStatus(bet1), 'em_manutencao');
  const res = () => createReservation(db, estoquista, { item_id: betoneira, asset_id: bet1, start_date: addDaysISO(today, 2), end_date: addDaysISO(today, 5), customer_name: 'Cliente X', confirm: true });
  expectHttp(res, 409);
  toTesting(id);
  status(id, 'concluida');
  assert.equal(assetStatus(bet1), 'aguardando_inspecao'); // concluir não libera sozinho
  expectHttp(res, 409, /Aguardando inspeção/);
  expectHttp(() => releaseEquipment(db, tecnico, id, { checklist: {} }), 400, /checklist/);
  releaseEquipment(db, tecnico, id, { checklist: fullInspection });
  assert.equal(assetStatus(bet1), 'operacional');
  assert.ok(detail(id).downtime_end);
  assert.ok(res().id);
  // OS aberta impeditiva também impede a inspeção de liberar pelo Estoque
  const id2 = open({ asset_id: bet2 });
  db.prepare("UPDATE stock_assets SET operational_status = 'aguardando_inspecao' WHERE id = ?").run(bet2);
  setBlocking(db, tecnico, id2, { block: true, reason: 'Risco elétrico' });
  db.prepare("UPDATE stock_assets SET operational_status = 'aguardando_inspecao' WHERE id = ?").run(bet2);
  expectHttp(() => inspectAsset(db, estoquista, bet2, { result: 'aprovado', checklist: fullInspection }), 422, /ordem de serviço/);
});

test('14. histórico do equipamento preservado mesmo após mudar o cadastro; OS encerrada não é alterada nem excluída', () => {
  const id = open();
  toTesting(id);
  status(id, 'concluida');
  updateCatalogItem(db, estoquista, betoneira, { description: 'Betoneira 400 litros (novo nome)' });
  const h = equipmentHistory(db, admin, bet1);
  assert.equal(h.length, 1);
  assert.equal(h[0].asset_snapshot.description, 'Betoneira 400L');
  assert.equal(h[0].diagnosis, 'Carburador entupido');
  assert.throws(() => db.prepare("UPDATE work_orders SET diagnosis = 'outro' WHERE id = ?").run(id), /não é alterada/);
  assert.throws(() => db.prepare('DELETE FROM work_orders WHERE id = ?').run(id), /não são excluídas/);
  expectHttp(() => updateOrder(db, tecnico, id, { ...detail(id), title: 'mudar' }), 422, /encerrada/);
  expectHttp(() => status(id, 'cancelada', { reason: 'x' }), 422);
});

test('15. permissões aplicadas no servidor', () => {
  expectHttp(() => createOrder(db, consulta, { asset_id: bet1, order_type: 'corretiva', title: 'Barulho estranho' }), 403);
  const id = createOrder(db, vendedor, { asset_id: bet1, order_type: 'corretiva', title: 'Cliente relatou barulho', origin: 'cliente' });
  expectHttp(() => updateOrder(db, vendedor, id, detail(id)), 403);
  expectHttp(() => addActivity(db, estoquista, id, { description: 'x', technician_name: 'y', started_at: iso(30), ended_at: iso(10) }), 403);
  const mid = addMaterial(db, estoquista, id, { item_id: vela, quantity: 1 }).id; // estoquista opera materiais
  assert.ok(mid);
  expectHttp(() => changeStatus(db, tecnico, id, { to: 'cancelada', reason: 'duplicada' }), 403);
  expectHttp(() => savePlan(db, tecnico, null, { name: 'x', asset_id: bet1, interval_days: 10 }), 403);
  assert.equal(detail(id, vendedor).costs, null);
  assert.equal(osDashboard(db, vendedor, {}).custo_mes, null);
  changeStatus(db, gestor, id, { to: 'cancelada', reason: 'Aberta em duplicidade' });
  assert.equal(getBalance(db, vela, dep).reserved, 0);
});

test('16. multiempresa: não se aplica (empresa única, sem coluna de empresa)', () => {
  const cols = (db.prepare("SELECT name FROM pragma_table_info('work_orders')").all() as { name: string }[]).map((c) => c.name);
  assert.ok(!cols.some((c) => /company|empresa|tenant/.test(c)));
});

test('17. sem regressão no Estoque: saldo continua igual à soma das movimentações após operações da OS', () => {
  const id = open();
  const mid = addMaterial(db, tecnico, id, { item_id: oleo, quantity: 5 }).id;
  materialAction(db, tecnico, id, mid, 'reservar', { quantity: 5 });
  materialAction(db, tecnico, id, mid, 'retirar', { quantity: 4, idempotency_key: key() });
  materialAction(db, tecnico, id, mid, 'devolver', { quantity: 1, idempotency_key: key() });
  const bad = db
    .prepare(
      `SELECT b.item_id, b.quantity, COALESCE((SELECT SUM(qty_delta) FROM stock_movements m WHERE m.item_id = b.item_id AND m.balance_location_id = b.location_id AND m.status != 'rascunho'),0) q FROM stock_balances b`
    )
    .all() as any[];
  for (const r of bad) assert.ok(Math.abs(r.quantity - r.q) < 1e-9, `item ${r.item_id}`);
  assert.equal(getBalance(db, oleo, dep).quantity, 17);
  assert.equal(getBalance(db, oleo, dep).reserved, 1);
});
