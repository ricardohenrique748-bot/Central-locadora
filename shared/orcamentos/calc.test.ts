import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateQuotation, applyDiscount } from './calc';
import { computePeriods, computeRentalDays } from './rental';
import { parseBRL } from './money';
import { QuotationInput, QuotationItemInput, RentalPolicy } from './types';

const policy: RentalPolicy = { day_count_mode: 'exclusive', days_per_month: 30, proportional: false };

const item = (over: Partial<QuotationItemInput> = {}): QuotationItemInput => ({
  catalog_item_id: 1,
  item_code_snapshot: 'X-1',
  description_snapshot: 'Item',
  item_type_snapshot: 'produto',
  unit: 'un',
  quantity: 1,
  unit_price: 10000,
  reference_price: 10000,
  billing_period: null,
  discount_type: 'percent',
  discount_value: 0,
  notes: null,
  ...over,
});

const base = (over: Partial<QuotationInput> = {}): QuotationInput => ({
  customer_id: 1,
  quotation_type: 'venda',
  category: 'comercial',
  equipment_info: null,
  expiration_date: '2099-01-01',
  client_reference: null,
  start_date: null,
  end_date: null,
  rental_billing_period: null,
  custom_periods: null,
  custom_period_label: null,
  availability_status: 'nao_verificada',
  general_discount_type: 'percent',
  general_discount_value: 0,
  additional_charges: 0,
  freight_amount: 0,
  pickup_freight_amount: 0,
  installation_amount: 0,
  other_services_amount: 0,
  deposit_amount: 0,
  payment_terms: null,
  delivery_terms: null,
  warranty_terms: null,
  pickup_delivery_terms: null,
  customer_responsibilities: null,
  return_conditions: null,
  included_accessories: null,
  complementary_description: null,
  specific_conditions: null,
  commercial_notes: null,
  internal_notes: null,
  items: [item()],
  ...over,
});

test('venda: total soma itens, frete e serviços', () => {
  const r = calculateQuotation(
    base({
      items: [item({ quantity: 3, unit_price: 2550 }), item({ quantity: 2, unit_price: 10000 })],
      freight_amount: 5000,
      other_services_amount: 1500,
      additional_charges: 300,
    }),
    policy
  );
  assert.deepEqual(r.issues, []);
  assert.equal(r.items[0].line_total, 7650);
  assert.equal(r.totals.subtotal, 27650);
  assert.equal(r.totals.total_amount, 27650 + 5000 + 1500 + 300);
});

test('desconto do item e desconto geral não descontam o mesmo valor duas vezes', () => {
  // Item 1000,00 com 10% = 900,00; desconto geral de 10% incide sobre 900,00 (=90,00), não sobre 1000,00
  const r = calculateQuotation(
    base({ items: [item({ unit_price: 100000, discount_value: 10 })], general_discount_type: 'percent', general_discount_value: 10 }),
    policy
  );
  assert.equal(r.totals.item_discount_total, 10000);
  assert.equal(r.totals.subtotal, 90000);
  assert.equal(r.totals.general_discount, 9000);
  assert.equal(r.totals.total_amount, 81000);
  assert.equal(r.totals.effective_discount_percent, 19);
});

test('desconto fixo maior que o item é rejeitado', () => {
  const r = calculateQuotation(base({ items: [item({ unit_price: 1000, discount_type: 'fixed', discount_value: 1500 })] }), policy);
  assert.ok(r.issues.some((i) => i.field === 'items.0.discount_value'));
  assert.equal(r.items[0].line_total, 0);
});

test('percentual acima de 100% e valores negativos são rejeitados', () => {
  const r = calculateQuotation(base({ items: [item({ discount_value: 120 })], general_discount_value: -1, freight_amount: -10 }), policy);
  const fields = r.issues.map((i) => i.field);
  assert.ok(fields.includes('items.0.discount_value'));
  assert.ok(fields.includes('general_discount_value'));
  assert.ok(fields.includes('freight_amount'));
});

test('quantidade zero, negativa ou com mais de 3 casas é rejeitada', () => {
  for (const quantity of [0, -2, 1.2345]) {
    const r = calculateQuotation(base({ items: [item({ quantity })] }), policy);
    assert.ok(r.issues.some((i) => i.field === 'items.0.quantity'), `quantidade ${quantity}`);
  }
});

test('arredondamento em centavos é determinístico (sem erro de ponto flutuante)', () => {
  // 0,1 + 0,2 em float = 0,30000000000000004; aqui tudo é inteiro
  const r = calculateQuotation(base({ items: [item({ unit_price: 10, quantity: 1 }), item({ unit_price: 20, quantity: 1 })] }), policy);
  assert.equal(r.totals.total_amount, 30);
  // 33,33 × 1,5 = 49,995 → 50,00 (meio centavo arredonda para cima)
  const r2 = calculateQuotation(base({ items: [item({ unit_price: 3333, quantity: 1.5 })] }), policy);
  assert.equal(r2.items[0].gross_total, 5000);
  // 5% de 10,05 = 0,5025 → 0,50
  assert.equal(applyDiscount(1005, 'percent', 5), 50);
});

test('redução de preço frente ao catálogo conta no desconto efetivo', () => {
  const r = calculateQuotation(base({ items: [item({ unit_price: 9000, reference_price: 10000 })] }), policy);
  assert.equal(r.totals.price_reduction_total, 1000);
  assert.equal(r.totals.effective_discount_percent, 10);
});

test('caução não entra no total da locação', () => {
  const r = calculateQuotation(
    base({
      quotation_type: 'locacao',
      start_date: '2026-10-01',
      end_date: '2026-10-11',
      rental_billing_period: 'diaria',
      items: [item({ unit_price: 1000, quantity: 2 })],
      freight_amount: 5000,
      pickup_freight_amount: 4000,
      deposit_amount: 50000,
    }),
    policy
  );
  assert.deepEqual(r.issues, []);
  assert.equal(r.rental_days, 10);
  assert.equal(r.items[0].periods, 10);
  assert.equal(r.items[0].line_total, 20000);
  assert.equal(r.totals.deposit_amount, 50000);
  assert.equal(r.totals.total_amount, 20000 + 5000 + 4000);
});

test('venda ignora caução e frete de retirada', () => {
  const r = calculateQuotation(base({ deposit_amount: 1000, pickup_freight_amount: 1000 }), policy);
  assert.equal(r.totals.deposit_amount, 0);
  assert.equal(r.totals.pickup_freight_amount, 0);
  assert.equal(r.totals.total_amount, 10000);
});

test('locação: preço e período diferentes por equipamento', () => {
  const r = calculateQuotation(
    base({
      quotation_type: 'locacao',
      start_date: '2026-10-01',
      end_date: '2026-10-15',
      rental_billing_period: 'diaria',
      items: [item({ unit_price: 1000 }), item({ unit_price: 5000, billing_period: 'semanal' })],
    }),
    policy
  );
  assert.equal(r.items[0].periods, 14);
  assert.equal(r.items[0].line_total, 14000);
  assert.equal(r.items[1].periods, 2);
  assert.equal(r.items[1].line_total, 10000);
});

test('duração: data final deve ser posterior à inicial', () => {
  assert.equal(computeRentalDays('2026-10-10', '2026-10-10', policy).days, null);
  assert.equal(computeRentalDays('2026-10-10', '2026-10-05', policy).days, null);
  assert.equal(computeRentalDays('2026-10-10', '2026-10-11', policy).days, 1);
  assert.equal(computeRentalDays('2026-10-10', '2026-10-10', { ...policy, day_count_mode: 'inclusive' }).days, 1);
  assert.equal(computeRentalDays('2026-10-10', '2026-10-11', { ...policy, day_count_mode: 'inclusive' }).days, 2);
  assert.equal(computeRentalDays('2026-02-30', '2026-03-05', policy).days, null);
});

test('duração atravessando horário de verão / virada de mês', () => {
  assert.equal(computeRentalDays('2026-10-25', '2026-11-05', policy).days, 11);
  assert.equal(computeRentalDays('2026-12-30', '2027-01-02', policy).days, 3);
});

test('semanal sem proporcional arredonda para cima e avisa na memória de cálculo', () => {
  const p = computePeriods(10, 'semanal', policy, null, null);
  assert.equal(p.periods, 2);
  assert.equal(p.rounded, true);
  assert.match(p.memo, /arredondado para cima/);
  const exact = computePeriods(14, 'semanal', policy, null, null);
  assert.equal(exact.periods, 2);
  assert.equal(exact.rounded, false);
});

test('cobrança proporcional fraciona sem arredondar para cima', () => {
  const p = computePeriods(10, 'semanal', { ...policy, proportional: true }, null, null);
  assert.equal(p.periods, 1.43);
  assert.equal(p.rounded, false);
  const m = computePeriods(45, 'mensal', { ...policy, proportional: true }, null, null);
  assert.equal(m.periods, 1.5);
});

test('mensal usa os dias do mês comercial configurado', () => {
  assert.equal(computePeriods(30, 'mensal', policy, null, null).periods, 1);
  assert.equal(computePeriods(31, 'mensal', policy, null, null).periods, 2);
  assert.equal(computePeriods(31, 'mensal', { ...policy, days_per_month: 31 }, null, null).periods, 1);
});

test('período personalizado exige quantidade informada', () => {
  const r = calculateQuotation(
    base({ quotation_type: 'locacao', start_date: '2026-10-01', end_date: '2026-10-31', rental_billing_period: 'personalizado', custom_periods: null }),
    policy
  );
  assert.ok(r.issues.some((i) => i.field === 'custom_periods'));
  const ok = calculateQuotation(
    base({ quotation_type: 'locacao', start_date: '2026-10-01', end_date: '2026-10-31', rental_billing_period: 'personalizado', custom_periods: 2, custom_period_label: 'Quinzena' }),
    policy
  );
  assert.equal(ok.items[0].periods, 2);
  assert.equal(ok.totals.total_amount, 20000);
});

test('parseBRL aceita formatos brasileiros e rejeita lixo', () => {
  assert.equal(parseBRL('1.234,56'), 123456);
  assert.equal(parseBRL('R$ 10,5'), 1050);
  assert.equal(parseBRL('99'), 9900);
  assert.equal(parseBRL('12.50'), 1250);
  assert.equal(parseBRL('abc'), null);
  assert.equal(parseBRL('1,234'), null);
});
