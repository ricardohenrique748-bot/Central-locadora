import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSchedule, computeTotals, measurePeriod, monthlyEquivalent, ScheduleInput } from './rules';

const base: ScheduleInput = {
  contract_type: 'locacao',
  start_date: '2026-01-10',
  end_date: '2026-04-10',
  billing_frequency: 'mensal',
  custom_period_days: null,
  billing_timing: 'antecipado',
  due_day: null,
  due_days_after: 0,
  proportional_last: true,
  general_discount: 0,
  freight_delivery: 0,
  freight_pickup: 0,
  other_fees: 0,
  installments_count: 1,
  first_due_date: null,
  period_amount: 100000,
  sale_total: 0,
};

test('mensal: o término é o dia da devolução (não cobrado); 3 meses exatos = 3 cobranças', () => {
  const s = buildSchedule(base);
  assert.equal(s.length, 3);
  assert.deepEqual(s.map((l) => [l.period_start, l.period_end, l.amount]), [
    ['2026-01-10', '2026-02-09', 100000],
    ['2026-02-10', '2026-03-09', 100000],
    ['2026-03-10', '2026-04-09', 100000],
  ]);
});

test('último período proporcional (ou cheio, se desligado)', () => {
  const s = buildSchedule({ ...base, end_date: '2026-03-25' }); // 15 dos 31 dias de 10/03 a 10/04
  assert.equal(s.length, 3);
  assert.equal(s[2].amount, Math.round((100000 * 15) / 31));
  assert.equal(s[2].proportional, true);
  assert.equal(buildSchedule({ ...base, end_date: '2026-03-25', proportional_last: false })[2].amount, 100000);
});

test('cobrança única: soma da vigência (com o proporcional) numa só cobrança no início', () => {
  const s = buildSchedule({ ...base, end_date: '2026-03-25', single_charge: true, freight_delivery: 5000 });
  assert.equal(s.length, 2); // locação + frete
  assert.equal(s[0].kind, 'unico');
  assert.equal(s[0].amount, 200000 + Math.round((100000 * 15) / 31));
  assert.deepEqual([s[0].period_start, s[0].period_end, s[0].due_date], ['2026-01-10', '2026-03-24', '2026-01-10']);
  assert.equal(computeTotals([{ modality: 'locacao', quantity: 1, unit_price: 100000, discount_amount: 0 }] as any, { ...base, end_date: '2026-03-25', single_charge: true } as any).estimated_total, s[0].amount);
});

test('não acumula erro de fim de mês: 31/01 → 28/02 → 31/03', () => {
  const s = buildSchedule({ ...base, start_date: '2026-01-31', end_date: '2026-04-30' });
  assert.deepEqual(s.map((l) => l.period_start), ['2026-01-31', '2026-02-28', '2026-03-31']);
});

test('vencimento: dias após, dia fixo do mês e cobrança ao final do período', () => {
  assert.equal(buildSchedule({ ...base, due_days_after: 5 })[0].due_date, '2026-01-15');
  assert.deepEqual(buildSchedule({ ...base, due_day: 5 }).map((l) => l.due_date), ['2026-02-05', '2026-03-05', '2026-04-05']);
  assert.equal(buildSchedule({ ...base, billing_timing: 'postecipado' })[0].due_date, '2026-02-10');
});

test('semanal, quinzenal, diária e personalizado não são tratados como mensal', () => {
  assert.equal(buildSchedule({ ...base, billing_frequency: 'semanal', end_date: '2026-01-31' }).length, 3); // 21 dias
  assert.equal(buildSchedule({ ...base, billing_frequency: 'quinzenal', end_date: '2026-02-09' }).length, 2);
  assert.equal(buildSchedule({ ...base, billing_frequency: 'diaria', end_date: '2026-01-13' }).length, 3);
  assert.equal(buildSchedule({ ...base, billing_frequency: 'personalizado', custom_period_days: 10, end_date: '2026-02-09' }).length, 3);
  assert.equal(buildSchedule({ ...base, billing_frequency: 'unico' }).length, 1);
});

test('prazo indeterminado gera até o horizonte; venda gera parcelas com resto na última', () => {
  assert.equal(buildSchedule({ ...base, end_date: null, horizon_end: '2026-03-15' }).length, 3);
  const v = buildSchedule({ ...base, contract_type: 'venda', end_date: null, billing_frequency: 'unico', period_amount: 0, sale_total: 10000, installments_count: 3, first_due_date: '2026-02-01' });
  assert.deepEqual(v.map((l) => [l.due_date, l.amount]), [
    ['2026-02-01', 3333],
    ['2026-03-01', 3333],
    ['2026-04-01', 3334],
  ]);
});

test('fretes, taxas e itens vendidos entram uma vez junto com a primeira cobrança', () => {
  const s = buildSchedule({ ...base, freight_delivery: 5000, freight_pickup: 6000, other_fees: 1000, sale_total: 2000 });
  assert.equal(s.filter((l) => l.kind !== 'periodo').length, 4);
  assert.ok(s.filter((l) => l.kind !== 'periodo').every((l) => l.due_date === s[0].due_date));
});

test('totais e receita mensal equivalente', () => {
  const t = computeTotals(
    [
      { quantity: 2, unit_price: 50000, discount_amount: 1000, modality: 'locacao' },
      { quantity: 3, unit_price: 1000, discount_amount: 0, modality: 'venda' },
    ],
    { ...base, general_discount: 500 }
  );
  assert.equal(t.rental_subtotal, 99000);
  assert.equal(t.period_amount, 98500);
  assert.equal(t.sale_total, 3000);
  assert.equal(t.estimated_total, 98500 * 3 + 3000);
  assert.equal(monthlyEquivalent(1000, 'diaria', null), 30000);
  assert.equal(monthlyEquivalent(1000, 'quinzenal', null), 2000);
  assert.equal(monthlyEquivalent(1000, 'unico', null), 0);
});

test('medição: conta o dia da entrega, não o da devolução; considera o saldo anterior ao período', () => {
  // 2 unidades desde antes do período; 1 devolvida no dia 11; mais 3 entregues no dia 21
  const m = measurePeriod('2026-03-01', '2026-03-31', [
    { date: '2026-02-20', qty: 2 },
    { date: '2026-03-11', qty: -1 },
    { date: '2026-03-21', qty: 3 },
  ]);
  assert.equal(m.period_days, 31);
  assert.equal(m.days_in_use, 31);
  assert.equal(m.unit_days, 2 * 10 + 1 * 10 + 4 * 11);
  assert.equal(m.max_qty, 4);
  assert.equal(m.delivered, 3);
  assert.equal(m.returned, 1);
});

test('medição: item entregue no meio e devolvido antes do fim do período', () => {
  const m = measurePeriod('2026-03-01', '2026-03-31', [
    { date: '2026-03-05', qty: 1 },
    { date: '2026-03-15', qty: -1 },
    { date: '2026-04-02', qty: 1 },
  ]);
  assert.equal(m.days_in_use, 10);
  assert.equal(m.unit_days, 10);
});
