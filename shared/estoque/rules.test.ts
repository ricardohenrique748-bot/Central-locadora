import test from 'node:test';
import assert from 'node:assert/strict';
import { apportionEntry, datesOverlap, deriveRentalStatus, peakUsage, stockCan, weightedAverageCost } from './rules';
import { validateStockItem, validateSupplier, estimatedMargin } from './validators';

test('datas inclusivas: devolução no dia X conflita com retirada no mesmo dia X', () => {
  assert.equal(datesOverlap('2026-11-01', '2026-11-10', '2026-11-10', '2026-11-15'), true);
  assert.equal(datesOverlap('2026-11-01', '2026-11-10', '2026-11-11', '2026-11-15'), false);
  assert.equal(datesOverlap('2026-11-05', '2026-11-06', '2026-11-01', '2026-11-30'), true);
});

test('pico de uso considera apenas reservas que se sobrepõem no mesmo dia', () => {
  const r = [
    { start_date: '2026-11-01', end_date: '2026-11-05', quantity: 10 },
    { start_date: '2026-11-06', end_date: '2026-11-10', quantity: 15 },
    { start_date: '2026-11-04', end_date: '2026-11-07', quantity: 5 },
  ];
  // dia 04-05: 10+5 = 15; dia 06-07: 15+5 = 20
  assert.equal(peakUsage(r, '2026-11-01', '2026-11-10'), 20);
  assert.equal(peakUsage(r, '2026-11-01', '2026-11-03'), 10);
  assert.equal(peakUsage(r, '2026-11-01', '2026-11-03', 7), 17);
  assert.equal(peakUsage([], '2026-11-01', '2026-11-03', 3), 3);
});

test('custo médio ponderado não depende de movimentações antigas', () => {
  assert.equal(weightedAverageCost(0, null, 10, 1000), 1000);
  assert.equal(weightedAverageCost(10, 1000, 10, 2000), 1500);
  assert.equal(weightedAverageCost(30, 1000, 10, 2000), 1250);
  assert.equal(weightedAverageCost(-5, 1000, 10, 2000), 2000); // saldo negativo não distorce
});

test('rateio de desconto e despesas proporcional e sem perder centavos', () => {
  const r = apportionEntry([{ quantity: 1, unit_cost: 10000 }, { quantity: 3, unit_cost: 10000 }], 4000, 1000);
  // total 40.000; ajuste -3.000 → 25% / 75%
  assert.deepEqual(r.map((x) => x.allocated_total), [9250, 27750]);
  assert.equal(r[1].allocated_unit_cost, 9250);
  const odd = apportionEntry([{ quantity: 1, unit_cost: 333 }, { quantity: 1, unit_cost: 333 }, { quantity: 1, unit_cost: 334 }], 0, 100);
  assert.equal(odd.reduce((a, x) => a + x.allocated_total, 0), 1100);
});

test('situação de locação é derivada, não manual', () => {
  assert.equal(deriveRentalStatus('em_manutencao', { onRent: false, inTransit: false, reservedToday: false }), 'indisponivel');
  assert.equal(deriveRentalStatus('aguardando_inspecao', { onRent: false, inTransit: false, reservedToday: false }), 'indisponivel');
  assert.equal(deriveRentalStatus('operacional', { onRent: true, inTransit: false, reservedToday: false }), 'alugado');
  assert.equal(deriveRentalStatus('operacional', { onRent: false, inTransit: true, reservedToday: true }), 'em_transito');
  assert.equal(deriveRentalStatus('novo', { onRent: false, inTransit: false, reservedToday: true }), 'reservado');
  assert.equal(deriveRentalStatus('baixado', { onRent: false, inTransit: false, reservedToday: false }), 'indisponivel');
  assert.equal(deriveRentalStatus('operacional', { onRent: false, inTransit: false, reservedToday: false }), 'disponivel');
});

test('permissões do estoque por perfil', () => {
  const u = (role: any) => ({ id: 1, name: 'x', email: 'x@x.com', role, active: true });
  assert.equal(stockCan.operate(u('estoquista')), true);
  assert.equal(stockCan.approve(u('estoquista')), false);
  assert.equal(stockCan.approve(u('gestor')), true);
  assert.equal(stockCan.requestReservation(u('vendedor')), true);
  assert.equal(stockCan.confirmReservation(u('vendedor')), false);
  assert.equal(stockCan.operate(u('consulta')), false);
  assert.equal(stockCan.configure(u('gestor')), false);
  assert.equal(stockCan.viewCosts(u('vendedor')), false);
});

test('cadastro de item: individual só para equipamentos; preço exigido pela modalidade', () => {
  const base = { description: 'Betoneira 400L', kind: 'equipamento_locacao' as const, tracking: 'individual' as const, unit: 'un', rental_enabled: true, sale_enabled: false, daily_rental_price: 5000 };
  assert.deepEqual(validateStockItem(base), {});
  assert.ok(validateStockItem({ ...base, kind: 'consumo' }).tracking);
  assert.ok(validateStockItem({ ...base, daily_rental_price: null }).daily_rental_price);
  assert.ok(validateStockItem({ ...base, min_qty: 10, max_qty: 5 }).max_qty);
  assert.deepEqual(validateStockItem({ description: 'Disco de corte', kind: 'consumo', tracking: 'quantidade', unit: 'un' }), {});
});

test('fornecedor e margem', () => {
  assert.ok(validateSupplier({ name: 'Fo', person_type: 'PJ' }).name);
  assert.ok(validateSupplier({ name: 'Fornecedor X', person_type: 'PJ', document: '11222333000180' }).document);
  assert.deepEqual(validateSupplier({ name: 'Fornecedor X', person_type: 'PJ', document: '11222333000181' }), {});
  assert.equal(estimatedMargin(6000, 10000), 40);
  assert.equal(estimatedMargin(null, 10000), null);
});
