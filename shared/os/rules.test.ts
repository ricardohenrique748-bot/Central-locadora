import test from 'node:test';
import assert from 'node:assert/strict';
import { ORDER_TRANSITIONS, laborCost, minutesBetween, nextPreventive, preventiveDue, typeRules } from './rules';

test('conclusão só a partir de "em testes"; encerradas não mudam', () => {
  const into = Object.entries(ORDER_TRANSITIONS).filter(([, to]) => to.includes('concluida')).map(([from]) => from);
  assert.deepEqual(into, ['em_testes']);
  assert.deepEqual(ORDER_TRANSITIONS.concluida, []);
  assert.deepEqual(ORDER_TRANSITIONS.cancelada, []);
});

test('mão de obra e tempo', () => {
  assert.equal(laborCost(6000, 90), 9000);
  assert.equal(laborCost(5000, 25), 2083);
  assert.equal(minutesBetween('2026-10-18T10:00:00Z', '2026-10-18T11:30:00Z'), 90);
});

test('próxima preventiva por data e por medidor; sem medidor não presume horímetro', () => {
  assert.deepEqual(nextPreventive({ interval_days: 30, interval_hours: null, interval_cycles: null }, '2026-10-18', null), { next_due_date: '2026-11-17', next_due_meter: null });
  assert.deepEqual(nextPreventive({ interval_days: null, interval_hours: 250, interval_cycles: null }, '2026-10-18', 1000), { next_due_date: null, next_due_meter: 1250 });
  assert.equal(nextPreventive({ interval_days: null, interval_hours: 250, interval_cycles: null }, '2026-10-18', null).next_due_meter, null);
});

test('vencimento da preventiva: antecedência por data ou leitura do medidor', () => {
  assert.equal(preventiveDue({ next_due_date: '2026-10-25', next_due_meter: null }, '2026-10-18', 7, null).due, true);
  assert.equal(preventiveDue({ next_due_date: '2026-10-26', next_due_meter: null }, '2026-10-18', 7, null).due, false);
  const m = preventiveDue({ next_due_date: null, next_due_meter: 500 }, '2026-10-18', 7, 510);
  assert.deepEqual(m, { due: true, key: 'm500' });
  assert.equal(preventiveDue({ next_due_date: null, next_due_meter: 500 }, '2026-10-18', 7, null).due, false);
});

test('tipos configuráveis entram sem sobrescrever os padrões', () => {
  const r = typeRules([{ key: 'x_lavagem', label: 'Lavagem', requires_diagnosis: false, requires_checklist: true }, { key: 'corretiva', label: 'X', requires_diagnosis: false, requires_checklist: false }]);
  assert.equal(r.find((t) => t.key === 'corretiva')!.requires_diagnosis, true);
  assert.ok(r.some((t) => t.key === 'x_lavagem'));
});
