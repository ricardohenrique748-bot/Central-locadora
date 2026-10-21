import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diffDays,
  calculateItemRentalCost,
  calculateLateCharges,
  numberToExtensoBRL,
  isValidCPF,
  isValidCNPJ,
} from './billing.ts';

test('diffDays calculates exact calendar days between two dates', () => {
  assert.equal(diffDays('2026-08-04', '2026-09-04'), 31);
  assert.equal(diffDays('2026-10-01', '2026-10-15'), 14);
  assert.equal(diffDays('2026-10-01', '2026-10-01'), 0);
});

test('calculateItemRentalCost handles proportional rental for partial cycle', () => {
  const item = {
    valorPeriodo: 300, // R$ 300 / 30 dias = R$ 10 / dia
    periodoDias: 30,
    dataInicio: '2026-10-01',
    quantidade: 2,
  };

  // 15 dias de uso proporcional
  const res = calculateItemRentalCost(item, '2026-10-16', 'proporcional');
  assert.equal(res.diasUtilizados, 15);
  assert.equal(res.ciclosCompletos, 0);
  assert.equal(res.diasRestantes, 15);
  // 15 * 10 * 2 = 300
  assert.equal(res.valorTotal, 300);
});

test('calculateItemRentalCost handles ciclo_cheio policy with minimum cycle', () => {
  const item = {
    valorPeriodo: 300,
    periodoDias: 30,
    dataInicio: '2026-10-01',
    quantidade: 1,
  };

  // 10 dias com política de ciclo cheio inicial
  const res = calculateItemRentalCost(item, '2026-10-11', 'ciclo_cheio');
  assert.equal(res.valorTotal, 300);
});

test('calculateLateCharges calculates 2% fine plus daily interest', () => {
  const result = calculateLateCharges(1000, '2026-10-01', '2026-10-11', 2.0, 0.033);
  assert.equal(result.diasAtraso, 10);
  assert.equal(result.valorMulta, 20); // 2% de 1000 = 20
  // Juros: 1000 * (0.033% * 10) = 3.30
  assert.equal(result.valorJuros, 3.3);
  assert.equal(result.valorTotalDevido, 1023.3);
});

test('numberToExtensoBRL correctly converts amounts to Portuguese words', () => {
  assert.equal(numberToExtensoBRL(1), 'Um real');
  assert.equal(numberToExtensoBRL(100), 'Cem reais');
  assert.equal(numberToExtensoBRL(150), 'Cento e cinquenta reais');
  assert.equal(numberToExtensoBRL(2450.5), 'Dois mil e quatrocentos e cinquenta reais e cinquenta centavos');
});

test('isValidCPF identifies standard invalid and valid formats', () => {
  assert.equal(isValidCPF('00000000000'), false);
  assert.equal(isValidCPF('11111111111'), false);
  assert.equal(isValidCPF('12345678900'), false);
  // Valid CPF checksum check
  assert.equal(isValidCPF('52998224725'), true);
});

test('isValidCNPJ identifies invalid CNPJ', () => {
  assert.equal(isValidCNPJ('00000000000000'), false);
  assert.equal(isValidCNPJ('12345678000199'), false);
});
