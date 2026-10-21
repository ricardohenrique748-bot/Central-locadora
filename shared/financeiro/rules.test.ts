import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonthsISO, buildInstallments, entryDisplayStatus, financeCan, installmentStatus, matchScore, parseStatementCSV, parseStatementOFX,
  recurrenceDates, updatedAmount, validateCostCenterSplit,
} from './rules';

test('parcelamento: soma exata, diferença de arredondamento na última parcela', () => {
  const p = buildInstallments({ total: 100000, count: 3, first_due: '2026-01-31', interval: 'mensal' });
  assert.deepEqual(p.map((x) => x.amount), [33333, 33333, 33334]);
  assert.equal(p.reduce((a, x) => a + x.amount, 0), 100000);
  assert.deepEqual(p.map((x) => x.due_date), ['2026-01-31', '2026-02-28', '2026-03-31']);
  const w = buildInstallments({ total: 1000, count: 2, first_due: '2026-10-01', interval: 'semanal' });
  assert.equal(w[1].due_date, '2026-10-08');
});

test('parcelas personalizadas precisam fechar o total', () => {
  assert.throws(() => buildInstallments({ total: 1000, count: 2, first_due: '2026-10-01', interval: 'mensal', custom: [{ due_date: '2026-10-01', amount: 400 }, { due_date: '2026-11-01', amount: 500 }] }), /difere do total/);
  const ok = buildInstallments({ total: 1000, count: 2, first_due: '2026-10-01', interval: 'mensal', custom: [{ due_date: '2026-10-05', amount: 700 }, { due_date: '2026-12-01', amount: 300 }] });
  assert.deepEqual(ok.map((x) => x.amount), [700, 300]);
  assert.throws(() => buildInstallments({ total: 2, count: 3, first_due: '2026-10-01', interval: 'mensal' }), /insuficiente/);
});

test('valor atualizado e situação da parcela', () => {
  const i = { original_amount: 10000, discount: 500, interest: 120, penalty: 200, additional: 0 };
  assert.equal(updatedAmount(i), 9820);
  assert.equal(installmentStatus(9820, 0), 'aberto');
  assert.equal(installmentStatus(9820, 5000), 'parcial');
  assert.equal(installmentStatus(9820, 9820), 'liquidado');
});

test('título só é "pago" quando todas as parcelas foram liquidadas', () => {
  const today = '2026-10-18';
  assert.equal(entryDisplayStatus('ativo', [{ status: 'liquidado', due_date: '2026-10-01' }, { status: 'aberto', due_date: '2026-11-01' }], today), 'parcial');
  assert.equal(entryDisplayStatus('ativo', [{ status: 'liquidado', due_date: '2026-10-01' }, { status: 'aberto', due_date: '2026-10-10' }], today), 'vencido');
  assert.equal(entryDisplayStatus('ativo', [{ status: 'liquidado', due_date: '2026-10-01' }, { status: 'liquidado', due_date: '2026-11-01' }], today), 'liquidado');
  assert.equal(entryDisplayStatus('ativo', [{ status: 'aberto', due_date: '2026-11-01' }], today), 'aberto');
});

test('rateio por centro de custo deve fechar o valor', () => {
  assert.equal(validateCostCenterSplit(1000, [{ cost_center_id: 1, amount: 600 }, { cost_center_id: 2, amount: 400 }]), null);
  assert.match(validateCostCenterSplit(1000, [{ cost_center_id: 1, amount: 600 }, { cost_center_id: 2, amount: 300 }])!, /rateio soma/);
  assert.match(validateCostCenterSplit(1000, [{ cost_center_id: 1, amount: 500 }, { cost_center_id: 1, amount: 500 }])!, /repetido/);
});

test('recorrência mensal respeita fim de mês e data final', () => {
  assert.deepEqual(recurrenceDates('2026-01-31', 'mensal', '2026-01-01', '2026-04-30', null), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(recurrenceDates('2026-01-10', 'mensal', '2026-02-01', '2026-12-31', '2026-03-15'), ['2026-02-10', '2026-03-10']);
  assert.equal(addMonthsISO('2024-01-31', 1), '2024-02-29');
});

test('extrato CSV brasileiro e OFX', () => {
  const csv = 'Data;Histórico;Valor;Documento\n05/10/2026;TARIFA PACOTE;-29,90;123\n06/10/2026;PIX RECEBIDO CONSTRUTORA;1.500,00;456\nlixo;;;';
  const r = parseStatementCSV(csv);
  assert.equal(r.lines.length, 2);
  assert.deepEqual(r.lines[0], { transaction_date: '2026-10-05', description: 'TARIFA PACOTE', amount: -2990, external_reference: '123' });
  assert.equal(r.lines[1].amount, 150000);
  assert.equal(r.errors.length, 1);
  const ofx = '<OFX><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261007120000<TRNAMT>-50.00<FITID>abc<MEMO>Energia</STMTTRN></OFX>';
  const o = parseStatementOFX(ofx);
  assert.deepEqual(o.lines[0], { transaction_date: '2026-10-07', description: 'Energia', amount: -5000, external_reference: 'abc' });
});

test('conciliação: valor igual sozinho não basta; data e descrição pesam', () => {
  const st = { transaction_date: '2026-10-06', amount: 150000, description: 'PIX RECEBIDO CONSTRUTORA RIO PRETO', external_reference: null };
  const same = matchScore(st, { transaction_date: '2026-10-06', amount: 150000, description: 'Recebimento REC-1 — Construtora Rio Preto', transaction_number: 'FIN-1' });
  const far = matchScore(st, { transaction_date: '2026-10-10', amount: 150000, description: 'Recebimento outro cliente', transaction_number: 'FIN-2' });
  assert.ok(same > far);
  assert.equal(matchScore(st, { transaction_date: '2026-10-06', amount: 149999, description: 'x', transaction_number: 'FIN-3' }), 0);
  assert.equal(matchScore(st, { transaction_date: '2026-10-20', amount: 150000, description: 'x', transaction_number: 'FIN-4' }), 0);
});

test('permissões financeiras por perfil', () => {
  const u = (role: any) => ({ id: 1, name: 'x', email: 'x@x.com', role, active: true });
  assert.equal(financeCan.view(u('vendedor')), false);
  assert.equal(financeCan.view(u('estoquista')), false);
  assert.equal(financeCan.operate(u('financeiro')), true);
  assert.equal(financeCan.operate(u('gestor')), false);
  assert.equal(financeCan.approve(u('gestor')), true);
  assert.equal(financeCan.reverse(u('financeiro')), false);
  assert.equal(financeCan.reverse(u('admin')), true);
  assert.equal(financeCan.seeDocuments(u('consulta')), false);
});
