import test from 'node:test';
import assert from 'node:assert/strict';
import { DELIVERY_TRANSITIONS, OCCURRENCE_TRANSITIONS, PHYSICALLY_DONE, RETURN_TRANSITIONS } from './rules';

test('entrega: só chega a "entregue" a partir de "em transporte"; entregue é final', () => {
  const into = Object.entries(DELIVERY_TRANSITIONS).filter(([, to]) => to.includes('entregue')).map(([from]) => from);
  assert.deepEqual(into, ['em_transporte']);
  assert.deepEqual(DELIVERY_TRANSITIONS.entregue, []);
});

test('operações com movimentação física não podem ser canceladas', () => {
  for (const st of PHYSICALLY_DONE) {
    const t = (DELIVERY_TRANSITIONS[st] || RETURN_TRANSITIONS[st] || []) as string[];
    assert.ok(!t.includes('cancelada'), st);
  }
});

test('cobrança só a partir de "aguardando aprovação"', () => {
  const into = Object.entries(OCCURRENCE_TRANSITIONS).filter(([, to]) => (to as string[]).includes('aprovada_cobranca')).map(([from]) => from);
  assert.deepEqual(into, ['aguardando_aprovacao']);
});
