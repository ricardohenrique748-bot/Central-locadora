import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, isExpired } from './status';
import { allowedActions, canApproveInternally, canPerform, canViewQuotation } from './permissions';
import { isValidCNPJ, isValidCPF, validateCustomer } from './validators';
import { AuthUser, ModuleSettings } from './types';

const settings: ModuleSettings = {
  company: { name: 'X', legal_name: '', document: '', phone: '', email: '', address: '', logo_data: null },
  default_validity_days: 15,
  discount_limits: { admin: 100, gestor: 20, vendedor: 5, estoquista: 0, financeiro: 0, tecnico: 0, consulta: 0 },
  seller_can_change_price: true,
  require_internal_approval: false,
  rental_policy: { day_count_mode: 'exclusive', days_per_month: 30, proportional: false },
  expiring_soon_days: 3,
};

const u = (id: number, role: AuthUser['role']): AuthUser => ({ id, name: role, email: `${role}@x.com`, role, active: true });
const admin = u(1, 'admin');
const gestor = u(2, 'gestor');
const vendedor = u(3, 'vendedor');
const outroVendedor = u(4, 'vendedor');
const consulta = u(5, 'consulta');

const q = (over: Partial<{ responsible_user_id: number; status: any; effective_discount_percent: number }> = {}) => ({
  responsible_user_id: 3,
  status: 'rascunho' as const,
  effective_discount_percent: 0,
  ...over,
});

test('transições: recusado/cancelado/convertido não podem ser convertidos nem editados', () => {
  for (const s of ['recusado', 'cancelado', 'convertido', 'expirado'] as const) {
    assert.equal(canTransition('converter', s), false, s);
    assert.equal(canTransition('editar', s), false, s);
  }
  assert.equal(canTransition('converter', 'aprovado_cliente'), true);
});

test('transições: enviar exige aprovação interna; aprovado não é editável sem nova versão', () => {
  assert.equal(canTransition('registrar_envio', 'rascunho'), false);
  assert.equal(canTransition('registrar_envio', 'aprovado_interno'), true);
  assert.equal(canTransition('editar', 'aprovado_interno'), false);
  assert.equal(canTransition('editar', 'enviado'), false);
  assert.equal(canTransition('nova_versao', 'enviado'), true);
  assert.equal(canTransition('renovar', 'expirado'), true);
  assert.equal(canTransition('aprovar_cliente', 'expirado'), false);
});

test('expiração automática só para propostas aprovadas/enviadas/em negociação', () => {
  assert.equal(isExpired('enviado', '2026-10-01', '2026-10-02'), true);
  assert.equal(isExpired('enviado', '2026-10-02', '2026-10-02'), false);
  assert.equal(isExpired('rascunho', '2026-10-01', '2026-10-02'), false);
  assert.equal(isExpired('aprovado_cliente', '2026-10-01', '2026-10-02'), false);
});

test('vendedor só vê e altera os próprios orçamentos', () => {
  assert.equal(canViewQuotation(vendedor, q()), true);
  assert.equal(canViewQuotation(outroVendedor, q()), false);
  assert.equal(canViewQuotation(consulta, q()), true);
  assert.equal(canPerform(vendedor, 'editar', q(), settings), true);
  assert.equal(canPerform(outroVendedor, 'editar', q(), settings), false);
  assert.equal(canPerform(gestor, 'editar', q(), settings), true);
});

test('consulta não executa nenhuma ação', () => {
  assert.deepEqual(allowedActions(consulta, q(), settings), []);
});

test('alçada de desconto: vendedor até 5%, gestor até 20%, acima exige admin', () => {
  assert.equal(canApproveInternally(vendedor, q({ effective_discount_percent: 5 }), settings), true);
  assert.equal(canApproveInternally(vendedor, q({ effective_discount_percent: 5.01 }), settings), false);
  assert.equal(canPerform(vendedor, 'solicitar_aprovacao', q({ effective_discount_percent: 8 }), settings), true);
  assert.equal(canApproveInternally(gestor, q({ effective_discount_percent: 20, status: 'aguardando_aprovacao' }), settings), true);
  assert.equal(canApproveInternally(gestor, q({ effective_discount_percent: 25, status: 'aguardando_aprovacao' }), settings), false);
  assert.equal(canApproveInternally(admin, q({ effective_discount_percent: 60, status: 'aguardando_aprovacao' }), settings), true);
});

test('vendedor não aprova o que ele mesmo escalou nem quando aprovação interna é obrigatória', () => {
  assert.equal(canApproveInternally(vendedor, q({ status: 'aguardando_aprovacao' }), settings), false);
  assert.equal(canApproveInternally(vendedor, q(), { ...settings, require_internal_approval: true }), false);
  assert.equal(canPerform(vendedor, 'rejeitar_aprovacao', q({ status: 'aguardando_aprovacao' }), settings), false);
});

test('validação de CPF e CNPJ', () => {
  assert.equal(isValidCPF('529.982.247-25'), true);
  assert.equal(isValidCPF('529.982.247-24'), false);
  assert.equal(isValidCPF('111.111.111-11'), false);
  assert.equal(isValidCNPJ('11.222.333/0001-81'), true);
  assert.equal(isValidCNPJ('11.222.333/0001-80'), false);
  assert.equal(isValidCNPJ('00.000.000/0000-00'), false);
});

test('cliente: exige nome e um contato; documento validado conforme o tipo', () => {
  assert.ok(validateCustomer({ person_type: 'PF', name: 'Jo' }).name);
  assert.ok(validateCustomer({ person_type: 'PF', name: 'João Silva' }).phone);
  assert.deepEqual(validateCustomer({ person_type: 'PF', name: 'João Silva', phone: '17991234567' }), {});
  assert.ok(validateCustomer({ person_type: 'PJ', name: 'Empresa X', phone: '1732345678', document: '52998224725' }).document);
  assert.ok(validateCustomer({ person_type: 'PF', name: 'João Silva', email: 'joao@' }).email);
});
