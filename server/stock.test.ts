import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DB, openDatabase } from './db';
import { hashPassword } from './auth';
import { HttpError } from './http';
import { AuthUser } from '../shared/orcamentos/types';
import { addDaysISO, todayISO } from '../shared/orcamentos/dates';
import { createCatalogItem } from './services/catalog';
import { getBalance, reverseMovement } from './services/stock/core';
import { createSupplier, saveLocation } from './services/stock/registry';
import { confirmDraftMovement, confirmEntry, createExit, saveEntry, saveTransfer, transferAction, changeQuantityStatus } from './services/stock/documents';
import { assetAction, availability, createReservation, getAssetDetail, inspectAsset, listAssets, reservationAction } from './services/stock/rental';
import { inventoryAction, openInventory, saveCounts } from './services/stock/inventory';
import { stockDashboard } from './services/stock/reports';
import { createCustomer } from './services/customers';
import { seedIfEmpty, seedStockIfEmpty } from './seed';

let db: DB;
let admin: AuthUser, gestor: AuthUser, estoquista: AuthUser, vendedor: AuthUser, consulta: AuthUser;
let dep: number, pat: number, supplier: number;
let disco: number, betoneira: number, andaime: number;

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

const today = todayISO();
const d = (n: number) => addDaysISO(today, n);

/** Invariante: saldo de cada item/local = soma dos deltas das movimentações confirmadas/estornadas. */
function assertLedgerConsistent() {
  const bad = db
    .prepare(
      `SELECT b.item_id, b.location_id, b.quantity, b.unavailable,
         COALESCE((SELECT SUM(qty_delta) FROM stock_movements m WHERE m.item_id = b.item_id AND m.balance_location_id = b.location_id AND m.status != 'rascunho'),0) q,
         COALESCE((SELECT SUM(unavailable_delta) FROM stock_movements m WHERE m.item_id = b.item_id AND m.balance_location_id = b.location_id AND m.status != 'rascunho'),0) u
       FROM stock_balances b`
    )
    .all() as any[];
  for (const r of bad) {
    assert.ok(Math.abs(r.quantity - r.q) < 1e-9 && Math.abs(r.unavailable - r.u) < 1e-9, `saldo inconsistente item ${r.item_id} local ${r.location_id}: ${r.quantity} vs ${r.q}`);
  }
}

function entry(lines: any[], extra: any = {}) {
  const e = saveEntry(db, estoquista, null, { entry_kind: 'compra', supplier_id: supplier, location_id: dep, items: lines, ...extra });
  return confirmEntry(db, estoquista, e.id);
}

beforeEach(() => {
  db = openDatabase(':memory:');
  admin = mkUser('admin', 'admin');
  gestor = mkUser('gestor', 'gestor');
  estoquista = mkUser('estoquista', 'estoquista');
  vendedor = mkUser('vendedor', 'vendedor');
  consulta = mkUser('consulta', 'consulta');
  dep = saveLocation(db, admin, null, { code: 'DEP-01', name: 'Depósito', location_type: 'deposito' }).id;
  pat = saveLocation(db, admin, null, { code: 'PAT-01', name: 'Pátio', location_type: 'patio' }).id;
  supplier = createSupplier(db, estoquista, { name: 'Fornecedor Teste Ltda', document: '11222333000181' }).id;
  disco = createCatalogItem(db, estoquista, { description: 'Disco de corte 7"', kind: 'produto_venda', unit: 'un', sale_price: 2500, min_qty: 20 }).id;
  betoneira = createCatalogItem(db, estoquista, { description: 'Betoneira 400L', kind: 'equipamento_locacao', tracking: 'individual', unit: 'un', daily_rental_price: 5000 }).id;
  andaime = createCatalogItem(db, estoquista, { description: 'Painel de andaime', kind: 'equipamento_locacao', unit: 'pç', daily_rental_price: 200 }).id;
});

test('código interno gerado automaticamente e único por tipo', () => {
  const a = createCatalogItem(db, estoquista, { description: 'Luva de raspa', kind: 'consumo', unit: 'par' });
  const b = createCatalogItem(db, estoquista, { description: 'Óculos de proteção', kind: 'consumo', unit: 'un' });
  assert.match(a.internal_code, /^CON-\d{5}$/);
  assert.notEqual(a.internal_code, b.internal_code);
  expectHttp(() => createCatalogItem(db, vendedor, { description: 'X item', kind: 'consumo', unit: 'un' }), 403);
});

test('entrada confirmada atualiza saldo, custo médio e não confirma duas vezes', () => {
  const e = entry([{ item_id: disco, quantity: 10, unit_cost: 1000 }]);
  assert.equal(getBalance(db, disco, dep).quantity, 10);
  entry([{ item_id: disco, quantity: 10, unit_cost: 2000 }]);
  const item = db.prepare('SELECT average_cost, acquisition_cost, last_purchase_date FROM catalog_items WHERE id = ?').get(disco) as any;
  assert.equal(item.average_cost, 1500);
  assert.equal(item.acquisition_cost, 2000);
  assert.equal(item.last_purchase_date, today);
  expectHttp(() => confirmEntry(db, estoquista, e.id), 422, /já foi confirmada/);
  assert.equal(getBalance(db, disco, dep).quantity, 20);
  assertLedgerConsistent();
});

test('entrada com desconto e despesas rateados no custo', () => {
  entry([{ item_id: disco, quantity: 10, unit_cost: 1000 }], { discount: 1000, extra_expenses: 500 });
  const item = db.prepare('SELECT average_cost FROM catalog_items WHERE id = ?').get(disco) as any;
  assert.equal(item.average_cost, 950); // (10.000 − 1.000 + 500) / 10
});

test('entrada de equipamentos individuais cria patrimônios com histórico; patrimônio repetido é recusado', () => {
  entry([{ item_id: betoneira, quantity: 2, unit_cost: 350000, units: [{ asset_tag: 'BET-001', serial_number: 'SN1' }, { asset_tag: null, serial_number: 'SN2' }] }]);
  const assets = listAssets(db, { item_id: String(betoneira) }).rows;
  assert.equal(assets.length, 2);
  assert.ok(assets.some((a) => a.asset_tag === 'BET-001'));
  assert.ok(assets.every((a) => a.acquisition_cost === 350000 && a.rental_status === 'disponivel'));
  assert.equal(getBalance(db, betoneira, dep).quantity, 2);
  const detail = getAssetDetail(db, assets[0].id);
  assert.ok(detail.events.some((e) => e.event_type === 'cadastro'));
  expectHttp(() => saveEntry(db, estoquista, null, { entry_kind: 'compra', supplier_id: supplier, location_id: dep, items: [{ item_id: betoneira, quantity: 1, unit_cost: 1, units: [{ asset_tag: 'BET-001' }] }] }), 400, /já cadastrado/);
  expectHttp(() => saveEntry(db, estoquista, null, { entry_kind: 'compra', supplier_id: supplier, location_id: dep, items: [{ item_id: betoneira, quantity: 1.5, unit_cost: 1 }] }), 400, /inteira/);
});

test('saída manual: valida saldo; rascunho não mexe no saldo até confirmar', () => {
  entry([{ item_id: disco, quantity: 10, unit_cost: 1000 }]);
  expectHttp(() => createExit(db, estoquista, { movement_type: 'saida_consumo', item_id: disco, quantity: 11, location_id: dep, reason: 'Consumo interno', confirm: true }), 422, /insuficiente/);
  const draft = createExit(db, estoquista, { movement_type: 'saida_consumo', item_id: disco, quantity: 4, location_id: dep, reason: 'Consumo interno' });
  assert.equal(getBalance(db, disco, dep).quantity, 10);
  confirmDraftMovement(db, estoquista, draft.id);
  assert.equal(getBalance(db, disco, dep).quantity, 6);
  expectHttp(() => confirmDraftMovement(db, estoquista, draft.id), 422);
  expectHttp(() => createExit(db, estoquista, { movement_type: 'saida_consumo', item_id: disco, quantity: 1, location_id: dep, reason: 'Motivo inventado', confirm: true }), 400);
  expectHttp(() => createExit(db, estoquista, { movement_type: 'saida_consumo', item_id: betoneira, quantity: 1, location_id: dep, reason: 'Perda', confirm: true }), 400, /baixa patrimonial/);
  expectHttp(() => createExit(db, vendedor, { movement_type: 'saida_consumo', item_id: disco, quantity: 1, location_id: dep, reason: 'Perda', confirm: true }), 403);
  assertLedgerConsistent();
});

test('estorno compensa a movimentação, exige gestor e não estorna duas vezes', () => {
  entry([{ item_id: disco, quantity: 10, unit_cost: 1000 }]);
  const m = createExit(db, estoquista, { movement_type: 'saida_consumo', item_id: disco, quantity: 3, location_id: dep, reason: 'Consumo interno', confirm: true });
  expectHttp(() => reverseMovement(db, estoquista, m.id, 'erro'), 403);
  const rev = reverseMovement(db, gestor, m.id, 'Lançado em duplicidade');
  assert.equal(rev.movement_type, 'estorno');
  assert.equal(getBalance(db, disco, dep).quantity, 10);
  expectHttp(() => reverseMovement(db, gestor, m.id, 'de novo'), 422);
  assertLedgerConsistent();
});

test('transferência não duplica saldo: origem sai no envio, destino entra no recebimento', () => {
  entry([{ item_id: disco, quantity: 10, unit_cost: 1000 }]);
  const t = saveTransfer(db, estoquista, null, { origin_location_id: dep, dest_location_id: pat, items: [{ item_id: disco, quantity: 6 }] });
  expectHttp(() => saveTransfer(db, estoquista, null, { origin_location_id: dep, dest_location_id: dep, items: [{ item_id: disco, quantity: 1 }] }), 400);
  transferAction(db, estoquista, t.id, 'liberar', {});
  transferAction(db, estoquista, t.id, 'enviar', {});
  assert.equal(getBalance(db, disco, dep).quantity, 4);
  assert.equal(getBalance(db, disco, pat).quantity, 0);
  expectHttp(() => transferAction(db, estoquista, t.id, 'receber', { received: { [t.items[0].id]: 5 } }), 400, /divergência/);
  transferAction(db, estoquista, t.id, 'receber', { received: { [t.items[0].id]: 5 }, divergence_notes: '1 peça avariada no transporte' });
  assert.equal(getBalance(db, disco, pat).quantity, 5);
  const big = saveTransfer(db, estoquista, null, { origin_location_id: dep, dest_location_id: pat, items: [{ item_id: disco, quantity: 50 }] });
  expectHttp(() => transferAction(db, estoquista, big.id, 'liberar', {}), 422, /saldo disponível/);
  assertLedgerConsistent();
});

test('equipamento em trânsito não é entregue; ao receber fica no destino', () => {
  entry([{ item_id: betoneira, quantity: 1, unit_cost: 1000, units: [{ asset_tag: 'BET-9' }] }]);
  const asset = listAssets(db, {}).rows[0];
  const t = saveTransfer(db, estoquista, null, { origin_location_id: dep, dest_location_id: pat, items: [{ item_id: betoneira, asset_id: asset.id }] });
  transferAction(db, estoquista, t.id, 'liberar', {});
  transferAction(db, estoquista, t.id, 'enviar', {});
  assert.equal(getAssetDetail(db, asset.id).rental_status, 'em_transito');
  const r = createReservation(db, estoquista, { item_id: betoneira, asset_id: asset.id, start_date: today, end_date: d(3), customer_name: 'Cliente X', confirm: true });
  expectHttp(() => reservationAction(db, estoquista, r.id, 'entregar', {}), 422, /trânsito/);
  transferAction(db, estoquista, t.id, 'receber', {});
  const after = getAssetDetail(db, asset.id);
  assert.equal(after.location_id, pat);
  assert.notEqual(after.rental_status, 'em_transito');
});

test('reservas: conflito de datas bloqueado; cancelada não bloqueia; manutenção não reserva', () => {
  entry([{ item_id: betoneira, quantity: 1, unit_cost: 1000, units: [{ asset_tag: 'BET-1' }] }]);
  const a = listAssets(db, {}).rows[0];
  const r1 = createReservation(db, estoquista, { item_id: betoneira, asset_id: a.id, start_date: d(5), end_date: d(10), customer_name: 'Cliente A', confirm: true });
  assert.equal(r1.status, 'confirmada');
  expectHttp(() => createReservation(db, estoquista, { item_id: betoneira, asset_id: a.id, start_date: d(10), end_date: d(12), customer_name: 'Cliente B', confirm: true }), 409, /já está reservado/);
  const ok = createReservation(db, estoquista, { item_id: betoneira, asset_id: a.id, start_date: d(11), end_date: d(12), customer_name: 'Cliente B', confirm: true });
  assert.equal(ok.status, 'confirmada');
  reservationAction(db, estoquista, r1.id, 'cancelar', { reason: 'Cliente desistiu' });
  createReservation(db, estoquista, { item_id: betoneira, asset_id: a.id, start_date: d(5), end_date: d(9), customer_name: 'Cliente C', confirm: true });
  // vendedor só solicita (pendente); confirmação é do estoque
  const p = createReservation(db, vendedor, { item_id: betoneira, asset_id: a.id, start_date: d(20), end_date: d(22), customer_name: 'Cliente D', confirm: true });
  assert.equal(p.status, 'pendente');
  expectHttp(() => reservationAction(db, vendedor, p.id, 'confirmar', {}), 403);
  assetAction(db, estoquista, a.id, 'enviar_manutencao', { reason: 'Troca de correia' });
  expectHttp(() => reservationAction(db, estoquista, p.id, 'confirmar', {}), 409, /manuten/);
});

test('reserva por quantidade respeita a capacidade no período', () => {
  entry([{ item_id: andaime, quantity: 100, unit_cost: 9500 }]);
  createReservation(db, estoquista, { item_id: andaime, quantity: 70, start_date: d(1), end_date: d(10), customer_name: 'Obra 1', confirm: true });
  expectHttp(() => createReservation(db, estoquista, { item_id: andaime, quantity: 40, start_date: d(5), end_date: d(6), customer_name: 'Obra 2', confirm: true }), 409, /insuficiente/);
  createReservation(db, estoquista, { item_id: andaime, quantity: 40, start_date: d(11), end_date: d(15), customer_name: 'Obra 2', confirm: true });
  const av = availability(db, { from: d(5), to: d(6), item_id: String(andaime) })[0];
  assert.equal(av.free_qty, 30);
});

test('ciclo de locação: entrega → alugado; retorno → aguardando inspeção; inspeção libera', () => {
  entry([{ item_id: betoneira, quantity: 1, unit_cost: 1000, units: [{ asset_tag: 'BET-2' }] }]);
  const a = listAssets(db, {}).rows[0];
  const r = createReservation(db, estoquista, { item_id: betoneira, asset_id: a.id, start_date: today, end_date: d(5), customer_name: 'Construtora Y', confirm: true });
  reservationAction(db, estoquista, r.id, 'entregar', {});
  let st = getAssetDetail(db, a.id);
  assert.equal(st.rental_status, 'alugado');
  assert.equal(st.operational_status, 'operacional');
  assert.equal(getBalance(db, betoneira, dep).quantity, 0); // saiu fisicamente, mas continua no patrimônio
  expectHttp(() => assetAction(db, gestor, a.id, 'baixar', { reason: 'x' }), 422, /alugado/);
  reservationAction(db, estoquista, r.id, 'retornar', { location_id: dep });
  st = getAssetDetail(db, a.id);
  assert.equal(st.operational_status, 'aguardando_inspecao');
  assert.equal(st.rental_status, 'indisponivel');
  expectHttp(() => createReservation(db, estoquista, { item_id: betoneira, asset_id: a.id, start_date: d(7), end_date: d(8), customer_name: 'Z', confirm: true }), 409);
  expectHttp(() => inspectAsset(db, estoquista, a.id, { result: 'aprovado', checklist: { limpo: true } }), 400, /checklist/);
  inspectAsset(db, estoquista, a.id, { result: 'aprovado', checklist: { limpo: true, funcionando: true, acessorios: true, sem_danos: true, seguranca: true } });
  st = getAssetDetail(db, a.id);
  assert.equal(st.rental_status, 'disponivel');
  assert.deepEqual(['cadastro', 'entrada', 'reserva', 'entrega', 'retorno', 'liberacao'].every((t) => st.events.some((e) => e.event_type === t)), true);
  assertLedgerConsistent();
});

test('retorno danificado mantém indisponível até avaliação autorizada', () => {
  entry([{ item_id: betoneira, quantity: 1, unit_cost: 1000, units: [{ asset_tag: 'BET-3' }] }]);
  const a = listAssets(db, {}).rows[0];
  const r = createReservation(db, estoquista, { item_id: betoneira, asset_id: a.id, start_date: today, end_date: d(2), customer_name: 'Cli', confirm: true });
  reservationAction(db, estoquista, r.id, 'entregar', {});
  reservationAction(db, estoquista, r.id, 'retornar', { location_id: dep });
  expectHttp(() => inspectAsset(db, estoquista, a.id, { result: 'danificado' }), 400, /Descreva/);
  inspectAsset(db, estoquista, a.id, { result: 'danificado', notes: 'Tambor amassado' });
  assert.equal(getAssetDetail(db, a.id).rental_status, 'indisponivel');
  expectHttp(() => assetAction(db, estoquista, a.id, 'aprovar_inspecao', {}), 422); // danificado não libera direto
  assetAction(db, estoquista, a.id, 'enviar_manutencao', { reason: 'Reparo do tambor' });
  assetAction(db, estoquista, a.id, 'retornar_manutencao', {});
  assert.equal(getAssetDetail(db, a.id).operational_status, 'aguardando_inspecao');
});

test('locação por quantidade: avariadas voltam indisponíveis, faltantes ficam documentadas', () => {
  entry([{ item_id: andaime, quantity: 100, unit_cost: 9500 }]);
  const r = createReservation(db, estoquista, { item_id: andaime, quantity: 50, start_date: today, end_date: d(10), customer_name: 'Obra', confirm: true, location_id: dep });
  reservationAction(db, estoquista, r.id, 'entregar', { location_id: dep });
  assert.equal(getBalance(db, andaime, dep).quantity, 50);
  expectHttp(() => reservationAction(db, estoquista, r.id, 'retornar', { location_id: dep, returned_qty: 40, damaged_qty: 5, missing_qty: 0 }), 400, /somar/);
  reservationAction(db, estoquista, r.id, 'retornar', { location_id: dep, returned_qty: 43, damaged_qty: 5, missing_qty: 2 });
  const b = getBalance(db, andaime, dep);
  assert.equal(b.quantity, 98);
  assert.equal(b.unavailable, 5);
  changeQuantityStatus(db, estoquista, { item_id: andaime, quantity: 5, location_id: dep, action: 'liberar', reason: 'Avaliadas e aprovadas' });
  assert.equal(getBalance(db, andaime, dep).unavailable, 0);
  assertLedgerConsistent();
});

test('baixa patrimonial exige gestor e justificativa, preserva o histórico', () => {
  entry([{ item_id: betoneira, quantity: 1, unit_cost: 1000, units: [{ asset_tag: 'BET-4' }] }]);
  const a = listAssets(db, {}).rows[0];
  expectHttp(() => assetAction(db, estoquista, a.id, 'baixar', { reason: 'Sucata' }), 403);
  expectHttp(() => assetAction(db, gestor, a.id, 'baixar', {}), 400, /justificativa/);
  assetAction(db, gestor, a.id, 'baixar', { reason: 'Sucata — sem conserto' });
  const st = getAssetDetail(db, a.id);
  assert.equal(st.operational_status, 'baixado');
  assert.ok(st.events.length >= 3);
  assert.equal(getBalance(db, betoneira, dep).quantity, 0);
  expectHttp(() => createReservation(db, estoquista, { item_id: betoneira, asset_id: a.id, start_date: d(1), end_date: d(2), customer_name: 'X', confirm: true }), 409, /baixado/);
  assert.equal(listAssets(db, {}).rows.length, 0);
  assert.equal(listAssets(db, { include_written_off: '1' }).rows.length, 1);
});

test('inventário: ajuste = contado − saldo na abertura, mesmo com movimentação durante a contagem', () => {
  entry([{ item_id: disco, quantity: 100, unit_cost: 1000 }]);
  const inv = openInventory(db, estoquista, { scope: 'local', location_id: dep });
  expectHttp(() => openInventory(db, estoquista, { scope: 'local', location_id: dep }), 409, /aberto/);
  const line = inv.lines.find((l) => l.item_id === disco)!;
  assert.equal(line.system_qty, 100);
  // durante a contagem sai 10
  createExit(db, estoquista, { movement_type: 'saida_consumo', item_id: disco, quantity: 10, location_id: dep, reason: 'Consumo interno', confirm: true });
  // contagem feita na abertura encontrou 97 (3 a menos)
  saveCounts(db, estoquista, inv.id, { lines: [{ id: line.id, counted_qty: 97 }] });
  inventoryAction(db, estoquista, inv.id, 'enviar_conferencia', {});
  expectHttp(() => inventoryAction(db, estoquista, inv.id, 'conferir', {}), 400, /Justifique/);
  saveCounts(db, estoquista, inv.id, { lines: [{ id: line.id, counted_qty: 97, justification: 'Quebra no manuseio' }] });
  inventoryAction(db, estoquista, inv.id, 'conferir', {});
  expectHttp(() => inventoryAction(db, estoquista, inv.id, 'aprovar', {}), 403);
  const done = inventoryAction(db, gestor, inv.id, 'aprovar', {});
  assert.equal(done.status, 'finalizado');
  assert.equal(getBalance(db, disco, dep).quantity, 87); // 100 − 10 − 3
  assertLedgerConsistent();
});

test('painel separa custo de estoque, patrimônio e valor comercial', () => {
  entry([{ item_id: disco, quantity: 10, unit_cost: 1000 }, { item_id: andaime, quantity: 100, unit_cost: 9500 }, { item_id: betoneira, quantity: 1, unit_cost: 350000, units: [{ asset_tag: 'B1' }] }]);
  const k = stockDashboard(db, {}).kpis;
  assert.equal(k.valor_estoque_custo, 10 * 1000);
  assert.equal(k.valor_comercial_estimado, 10 * 2500);
  assert.equal(k.valor_patrimonio_locacao, 100 * 9500 + 350000);
  assert.equal(k.abaixo_minimo, 1);
  assert.equal(k.equipamentos_patrimoniais, 1);
  assert.equal(k.eq_disponiveis, 1);
});

test('consulta não opera estoque', () => {
  expectHttp(() => saveEntry(db, consulta, null, { location_id: dep, items: [] }), 403);
  expectHttp(() => createReservation(db, consulta, { item_id: andaime, quantity: 1, start_date: d(1), end_date: d(2), customer_name: 'X' }), 403);
});

test('carga inicial migra o estoque antigo com patrimônios, locados e indisponíveis', () => {
  const fresh = openDatabase(':memory:');
  seedIfEmpty(fresh);
  seedStockIfEmpty(fresh);
  seedStockIfEmpty(fresh); // idempotente
  const assets = fresh.prepare('SELECT COUNT(*) n, SUM(rental_status = \'alugado\') alugados, SUM(operational_status = \'em_manutencao\') manut FROM stock_assets').get() as any;
  assert.equal(assets.n, 11);
  assert.equal(assets.alugados, 3);
  assert.equal(assets.manut, 2);
  const andaimeRow = fresh.prepare("SELECT b.quantity, b.unavailable FROM stock_balances b JOIN catalog_items i ON i.id = b.item_id WHERE i.internal_code = 'AND-150'").get() as any;
  assert.equal(andaimeRow.quantity, 340 + 25); // disponível + manutenção/teste (230 locados estão com clientes)
  assert.equal(andaimeRow.unavailable, 25);
  const moves = fresh.prepare('SELECT COUNT(*) n FROM stock_movements').get() as any;
  assert.ok(moves.n > 11);
  void createCustomer;
});
