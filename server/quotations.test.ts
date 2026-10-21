import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DB, openDatabase } from './db';
import { hashPassword, login, userFromToken } from './auth';
import { DEFAULT_SETTINGS } from './settings';
import { HttpError } from './http';
import { createCustomer, updateCustomer } from './services/customers';
import { createCatalogItem, updateCatalogItem } from './services/catalog';
import {
  convertQuotation,
  deleteQuotation,
  createQuotation,
  duplicateQuotation,
  getQuotationDetail,
  getVersionSnapshot,
  listQuotations,
  sweepExpired,
  transitionQuotation,
  updateQuotation,
} from './services/quotations';
import { dashboard } from './services/reports';
import { registerConversionAdapter, unregisterConversionAdapter } from './integrations';
import { renderQuotationPdf } from './pdf';
import { AuthUser, ModuleSettings } from '../shared/orcamentos/types';
import { addDaysISO, todayISO } from '../shared/orcamentos/dates';

let db: DB;
let admin: AuthUser, gestor: AuthUser, vendedor: AuthUser, vendedor2: AuthUser, consulta: AuthUser;
let customerId: number, betoneira: number, furadeira: number;
const settings: ModuleSettings = DEFAULT_SETTINGS;

function mkUser(name: string, role: AuthUser['role']): AuthUser {
  const row = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?) RETURNING id').get(name, `${name}@t.com`, hashPassword('senha-segura'), role) as {
    id: number;
  };
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

const venda = (over: any = {}) => ({
  customer_id: customerId,
  quotation_type: 'venda',
  expiration_date: addDaysISO(todayISO(), 10),
  items: [{ catalog_item_id: furadeira, quantity: 2, unit_price: 45000, discount_type: 'percent', discount_value: 0 }],
  freight_amount: 2000,
  ...over,
});

beforeEach(() => {
  db = openDatabase(':memory:');
  admin = mkUser('admin', 'admin');
  gestor = mkUser('gestor', 'gestor');
  vendedor = mkUser('vendedor', 'vendedor');
  vendedor2 = mkUser('vendedor2', 'vendedor');
  consulta = mkUser('consulta', 'consulta');
  customerId = createCustomer(db, admin, {
    person_type: 'PJ', name: 'Construtora Teste Ltda', document: '11.222.333/0001-81', phone: '17991234567',
    street: 'Rua A', street_number: '10', city: 'São José do Rio Preto', state: 'SP',
  }).id;
  betoneira = createCatalogItem(db, admin, {
    internal_code: 'BET-400', description: 'Betoneira 400L', item_type: 'equipamento', unit: 'un',
    rental_enabled: true, daily_rental_price: 5000, weekly_rental_price: 25000, monthly_rental_price: 80000,
  }).id;
  furadeira = createCatalogItem(db, admin, {
    internal_code: 'FUR-01', description: 'Furadeira de impacto', item_type: 'equipamento', unit: 'un',
    sale_enabled: true, sale_price: 45000, rental_enabled: true, daily_rental_price: 3000,
  }).id;
});

test('login com senha correta cria sessão; senha errada e usuário inativo são recusados', () => {
  assert.equal(login(db, 'vendedor@t.com', 'errada', false), null);
  const ok = login(db, 'VENDEDOR@t.com', 'senha-segura', true);
  assert.ok(ok);
  assert.equal(userFromToken(db, ok!.token)?.id, vendedor.id);
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(vendedor.id);
  assert.equal(userFromToken(db, ok!.token), null);
  assert.equal(login(db, 'vendedor@t.com', 'senha-segura', false), null);
});

test('cliente: documento duplicado é recusado; consulta não cadastra; vendedor não inativa', () => {
  expectHttp(() => createCustomer(db, vendedor, { person_type: 'PJ', name: 'Outra', document: '11222333000181', phone: '1732345678' }), 409);
  expectHttp(() => createCustomer(db, consulta, { person_type: 'PF', name: 'Fulano de Tal', phone: '1732345678' }), 403);
  expectHttp(() => updateCustomer(db, vendedor, customerId, { active: false }), 403);
  expectHttp(() => createCustomer(db, vendedor, { person_type: 'PF', name: 'Fulano', document: '123', phone: '1732345678' }), 400);
});

test('numeração única e sequencial', () => {
  const a = createQuotation(db, vendedor, venda(), settings);
  const b = createQuotation(db, vendedor, venda(), settings);
  const year = todayISO().slice(0, 4);
  assert.equal(a.quotation_number, `ORC-${year}-00001`);
  assert.equal(b.quotation_number, `ORC-${year}-00002`);
});

test('número duplicado é bloqueado pelo banco', () => {
  const a = createQuotation(db, vendedor, venda(), settings);
  const b = createQuotation(db, vendedor, venda(), settings);
  assert.throws(() => db.prepare('UPDATE quotations SET quotation_number = ? WHERE id = ?').run(a.quotation_number, b.id), /UNIQUE/);
});

test('servidor recalcula totais e ignora valores enviados pela interface', () => {
  const q = createQuotation(db, vendedor, venda({ total_amount: 1, subtotal: 1 }), settings);
  assert.equal(q.subtotal, 90000);
  assert.equal(q.total_amount, 92000);
  assert.equal(q.items[0].reference_price, 45000);
  assert.equal(q.customer_snapshot.name, 'Construtora Teste Ltda');
});

test('item inativo não entra em novo orçamento, mas permanece no orçamento existente', () => {
  const q = createQuotation(db, vendedor, venda(), settings);
  updateCatalogItem(db, admin, furadeira, { active: false });
  expectHttp(() => createQuotation(db, vendedor, venda(), settings), 400, /inativo/);
  const edited = updateQuotation(db, vendedor, q.id, { ...venda({ freight_amount: 0 }), row_version: q.row_version }, settings);
  assert.equal(edited.items.length, 1);
  assert.equal(edited.total_amount, 90000);
});

test('preço e descrição ficam congelados no orçamento após mudança no catálogo', () => {
  const q = createQuotation(db, vendedor, venda(), settings);
  updateCatalogItem(db, admin, furadeira, { sale_price: 60000, description: 'Furadeira NOVA' });
  const d = getQuotationDetail(db, vendedor, q.id, settings);
  assert.equal(d.items[0].unit_price, 45000);
  assert.equal(d.items[0].description_snapshot, 'FURADEIRA DE IMPACTO');
});

test('vendedor sem permissão não altera preço de tabela', () => {
  const s = { ...settings, seller_can_change_price: false };
  expectHttp(() => createQuotation(db, vendedor, venda({ items: [{ catalog_item_id: furadeira, quantity: 1, unit_price: 40000 }] }), s), 400, /preço/);
  assert.ok(createQuotation(db, gestor, venda({ items: [{ catalog_item_id: furadeira, quantity: 1, unit_price: 40000 }] }), s));
});

test('fluxo completo: rascunho → aprovado → enviado → negociação → aprovado pelo cliente, com histórico', () => {
  let q = createQuotation(db, vendedor, venda(), settings);
  q = transitionQuotation(db, vendedor, q.id, 'enviar_revisao', {}, settings);
  q = transitionQuotation(db, vendedor, q.id, 'aprovar_interno', {}, settings);
  q = transitionQuotation(db, vendedor, q.id, 'registrar_envio', { channel: 'whatsapp' }, settings);
  assert.ok(q.sent_at);
  q = transitionQuotation(db, vendedor, q.id, 'registrar_negociacao', { reason: 'Cliente pediu prazo' }, settings);
  q = transitionQuotation(db, vendedor, q.id, 'aprovar_cliente', {}, settings);
  assert.equal(q.status, 'aprovado_cliente');
  const d = getQuotationDetail(db, gestor, q.id, settings);
  assert.deepEqual(
    d.history.map((h) => h.new_status).reverse(),
    ['rascunho', 'em_revisao', 'aprovado_interno', 'enviado', 'em_negociacao', 'aprovado_cliente']
  );
  assert.equal(d.history[0].changed_by_name, 'vendedor');
  assert.equal(d.versions.length, 1);
  assert.equal(d.approvals[0].status, 'aprovado');
});

test('transição inválida é recusada (enviar sem aprovação, converter recusado)', () => {
  const q = createQuotation(db, vendedor, venda(), settings);
  expectHttp(() => transitionQuotation(db, vendedor, q.id, 'registrar_envio', {}, settings), 422);
  expectHttp(() => transitionQuotation(db, vendedor, q.id, 'cancelar', {}, settings), 400, /justificativa/);
  transitionQuotation(db, vendedor, q.id, 'cancelar', { reason: 'Cliente desistiu' }, settings);
  expectHttp(() => convertQuotation(db, vendedor, q.id, settings), 422);
});

test('desconto acima da alçada exige aprovação de gestor/admin', () => {
  const q = createQuotation(db, vendedor, venda({ general_discount_value: 15 }), settings);
  assert.equal(q.effective_discount_percent, 15);
  expectHttp(() => transitionQuotation(db, vendedor, q.id, 'aprovar_interno', {}, settings), 403, /alçada/);
  transitionQuotation(db, vendedor, q.id, 'solicitar_aprovacao', { reason: 'Cliente grande' }, settings);
  expectHttp(() => transitionQuotation(db, vendedor, q.id, 'aprovar_interno', {}, settings), 403);
  const ok = transitionQuotation(db, gestor, q.id, 'aprovar_interno', { reason: 'Liberado' }, settings);
  assert.equal(ok.status, 'aprovado_interno');
  const d = getQuotationDetail(db, admin, q.id, settings);
  assert.equal(d.approvals[0].approved_by_name, 'gestor');
});

test('desconto acima da alçada do gestor só o admin aprova', () => {
  const q = createQuotation(db, vendedor, venda({ general_discount_value: 30 }), settings);
  transitionQuotation(db, vendedor, q.id, 'solicitar_aprovacao', {}, settings);
  expectHttp(() => transitionQuotation(db, gestor, q.id, 'aprovar_interno', {}, settings), 403);
  assert.equal(transitionQuotation(db, admin, q.id, 'aprovar_interno', {}, settings).status, 'aprovado_interno');
});

test('permissões: vendedor não vê orçamento de outro; consulta não altera', () => {
  const q = createQuotation(db, vendedor, venda(), settings);
  expectHttp(() => getQuotationDetail(db, vendedor2, q.id, settings), 403);
  expectHttp(() => updateQuotation(db, vendedor2, q.id, venda(), settings), 403);
  expectHttp(() => transitionQuotation(db, consulta, q.id, 'enviar_revisao', {}, settings), 403);
  expectHttp(() => createQuotation(db, consulta, venda(), settings), 403);
  assert.equal(listQuotations(db, vendedor2, {}).total, 0);
  assert.equal(listQuotations(db, consulta, {}).total, 1);
});

test('orçamento enviado não é editado silenciosamente: nova versão preserva a anterior', () => {
  let q = createQuotation(db, vendedor, venda(), settings);
  transitionQuotation(db, vendedor, q.id, 'aprovar_interno', {}, settings);
  q = transitionQuotation(db, vendedor, q.id, 'registrar_envio', { channel: 'email' }, settings);
  expectHttp(() => updateQuotation(db, vendedor, q.id, venda(), settings), 403, /nova versão/);
  q = transitionQuotation(db, vendedor, q.id, 'nova_versao', { reason: 'Cliente pediu mais 1 unidade' }, settings);
  assert.equal(q.status, 'rascunho');
  assert.equal(q.version, 2);
  q = updateQuotation(db, vendedor, q.id, { ...venda({ items: [{ catalog_item_id: furadeira, quantity: 3, unit_price: 45000 }] }), row_version: q.row_version }, settings);
  assert.equal(q.total_amount, 137000);
  const v1 = getVersionSnapshot(db, vendedor, q.id, 1);
  assert.equal(v1.total_amount, 92000);
  assert.equal(v1.items[0].quantity, 2);
});

test('controle de concorrência: edição com versão desatualizada é recusada', () => {
  const q = createQuotation(db, vendedor, venda(), settings);
  updateQuotation(db, vendedor, q.id, { ...venda(), row_version: q.row_version }, settings);
  expectHttp(() => updateQuotation(db, gestor, q.id, { ...venda(), row_version: q.row_version }, settings), 409);
});

test('expiração automática e renovação com nova versão', () => {
  let q = createQuotation(db, vendedor, venda(), settings);
  transitionQuotation(db, vendedor, q.id, 'aprovar_interno', {}, settings);
  transitionQuotation(db, vendedor, q.id, 'registrar_envio', {}, settings);
  db.prepare('UPDATE quotations SET expiration_date = ? WHERE id = ?').run(addDaysISO(todayISO(), -1), q.id);
  assert.equal(sweepExpired(db), 1);
  q = getQuotationDetail(db, vendedor, q.id, settings);
  assert.equal(q.status, 'expirado');
  expectHttp(() => transitionQuotation(db, vendedor, q.id, 'aprovar_cliente', {}, settings), 422);
  expectHttp(() => convertQuotation(db, vendedor, q.id, settings), 422, /renove/);
  q = transitionQuotation(db, vendedor, q.id, 'renovar', { expiration_date: addDaysISO(todayISO(), 15) }, settings);
  assert.equal(q.status, 'em_revisao');
  assert.equal(q.version, 2);
});

test('recusa exige motivo e alimenta relatório', () => {
  const q = createQuotation(db, vendedor, venda(), settings);
  transitionQuotation(db, vendedor, q.id, 'aprovar_interno', {}, settings);
  transitionQuotation(db, vendedor, q.id, 'registrar_envio', {}, settings);
  expectHttp(() => transitionQuotation(db, vendedor, q.id, 'recusar', {}, settings), 400, /motivo/);
  const r = transitionQuotation(db, vendedor, q.id, 'recusar', { refusal_category: 'Optou por concorrente', reason: 'Preço 10% menor' }, settings);
  assert.equal(r.refusal_reason, 'Optou por concorrente: Preço 10% menor');
});

test('envio exige cadastro do cliente completo para documento definitivo', () => {
  const semDoc = createCustomer(db, admin, { person_type: 'PF', name: 'Cliente Preliminar', phone: '17991112222' }).id;
  const q = createQuotation(db, vendedor, venda({ customer_id: semDoc }), settings);
  transitionQuotation(db, vendedor, q.id, 'aprovar_interno', {}, settings);
  expectHttp(() => transitionQuotation(db, vendedor, q.id, 'registrar_envio', {}, settings), 400, /CPF/);
});

test('conversão indisponível sem integração; idempotente quando houver', () => {
  const q = createQuotation(db, vendedor, venda(), settings);
  transitionQuotation(db, vendedor, q.id, 'aprovar_interno', {}, settings);
  transitionQuotation(db, vendedor, q.id, 'registrar_envio', {}, settings);
  transitionQuotation(db, vendedor, q.id, 'aprovar_cliente', {}, settings);
  expectHttp(() => convertQuotation(db, vendedor, q.id, settings), 501);

  let calls = 0;
  registerConversionAdapter({ type: 'venda', convert: () => ({ record_id: `VND-${++calls}` }) });
  try {
    const first = convertQuotation(db, vendedor, q.id, settings);
    const second = convertQuotation(db, vendedor, q.id, settings);
    assert.equal(first.record_id, 'VND-1');
    assert.equal(second.record_id, 'VND-1');
    assert.equal(second.already, true);
    assert.equal(calls, 1);
    assert.equal(first.quotation.status, 'convertido');
  } finally {
    unregisterConversionAdapter('venda');
  }
});

test('locação: período, caução fora do total; duplicar gera novo número e remove itens inativos', () => {
  const q = createQuotation(
    db,
    vendedor,
    {
      customer_id: customerId,
      quotation_type: 'locacao',
      expiration_date: addDaysISO(todayISO(), 5),
      start_date: '2026-11-01',
      end_date: '2026-11-11',
      rental_billing_period: 'diaria',
      items: [
        { catalog_item_id: betoneira, quantity: 2, unit_price: 5000 },
        { catalog_item_id: furadeira, quantity: 1, unit_price: 3000 },
      ],
      deposit_amount: 100000,
    },
    settings
  );
  assert.equal(q.rental_days, 10);
  assert.equal(q.total_amount, 2 * 5000 * 10 + 3000 * 10);
  assert.equal(q.deposit_amount, 100000);
  updateCatalogItem(db, admin, furadeira, { active: false });
  const { quotation, removed } = duplicateQuotation(db, vendedor, q.id, settings);
  assert.notEqual(quotation.quotation_number, q.quotation_number);
  assert.equal(quotation.status, 'rascunho');
  assert.deepEqual(removed, ['FUR-01']);
  assert.equal(quotation.items.length, 1);
});

test('painel: recusados e cancelados não contam como aprovados; conversão sobre enviados', () => {
  const mk = () => {
    const q = createQuotation(db, vendedor, venda(), settings);
    transitionQuotation(db, vendedor, q.id, 'aprovar_interno', {}, settings);
    transitionQuotation(db, vendedor, q.id, 'registrar_envio', {}, settings);
    return q.id;
  };
  transitionQuotation(db, vendedor, mk(), 'aprovar_cliente', {}, settings);
  transitionQuotation(db, vendedor, mk(), 'recusar', { refusal_category: 'Outro' }, settings);
  transitionQuotation(db, vendedor, mk(), 'cancelar', { reason: 'x' }, settings);
  createQuotation(db, vendedor, venda(), settings); // rascunho, nunca enviado

  const d = dashboard(db, admin, {}, 3);
  assert.equal(d.kpis.total, 4);
  assert.equal(d.kpis.aprovados, 1);
  assert.equal(d.kpis.recusados, 1);
  assert.equal(d.kpis.cancelados, 1);
  assert.equal(d.kpis.enviados, 3);
  assert.equal(d.kpis.valor_aprovado, 92000);
  assert.equal(d.kpis.valor_total, 92000 * 3); // cancelado fora
  assert.ok(Math.abs((d.kpis.taxa_conversao ?? 0) - 1 / 3) < 1e-9);
  assert.equal(dashboard(db, vendedor2, {}, 3).kpis.total, 0);
});

test('PDF é gerado e não contém observações internas', async () => {
  const q = createQuotation(db, vendedor, venda({ internal_notes: 'MARGEM-SECRETA-123', commercial_notes: 'Entrega em 2 dias' }), settings);
  const pdf = await renderQuotationPdf(q, settings);
  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > 2000);
  assert.ok(!pdf.toString('latin1').includes('MARGEM-SECRETA-123'));
});

test('excluir: só rascunho nunca enviado, pelo dono ou gestor; o que já foi enviado é cancelado', () => {
  const q = createQuotation(db, vendedor, venda(), settings);
  expectHttp(() => deleteQuotation(db, vendedor2, q.id), 403);
  expectHttp(() => deleteQuotation(db, consulta, q.id), 403);
  const r = deleteQuotation(db, vendedor, q.id);
  assert.equal(r.deleted, q.quotation_number);
  assert.equal(db.prepare('SELECT 1 FROM quotations WHERE id = ?').get(q.id), undefined);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM quotation_items WHERE quotation_id = ?').get(q.id) as any).n, 0);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE entity = 'quotation' AND entity_id = ? AND action = 'delete'").get(String(q.id)) || db.prepare("SELECT 1 FROM audit_log WHERE entity = 'quotation' AND entity_id = ? AND action = 'delete'").get(q.id), 'exclusão fica na auditoria');
  expectHttp(() => deleteQuotation(db, gestor, q.id), 404);

  let sent = createQuotation(db, vendedor, venda(), settings);
  sent = transitionQuotation(db, vendedor, sent.id, 'enviar_revisao', {}, settings);
  sent = transitionQuotation(db, vendedor, sent.id, 'aprovar_interno', {}, settings);
  sent = transitionQuotation(db, vendedor, sent.id, 'registrar_envio', { channel: 'whatsapp' }, settings);
  expectHttp(() => deleteQuotation(db, gestor, sent.id), 422, /Cancelar/);

  const own = createQuotation(db, vendedor, venda(), settings);
  assert.ok(deleteQuotation(db, gestor, own.id).deleted, 'gestor exclui rascunho de outro vendedor');
});

test('manutenção: exige equipamento, aceita peça não vendável e mão de obra avulsa, filtra na lista e não troca de modalidade', () => {
  const peca = createCatalogItem(db, admin, { internal_code: 'ROL-01', description: 'Rolamento do tambor', kind: 'peca', item_type: 'peca', unit: 'un', sale_price: 3500 }).id;
  const base = (over: any = {}) => ({
    customer_id: customerId, quotation_type: 'venda', category: 'manutencao', expiration_date: addDaysISO(todayISO(), 10),
    equipment_info: { description: 'Betoneira 400 L do cliente', brand: 'Menegotti', model: 'MB400', serial_number: 'SN123', reported_defect: 'Tambor travando', diagnosis: 'Troca de rolamento' },
    items: [
      { catalog_item_id: peca, quantity: 2, unit_price: 3500 },
      { catalog_item_id: null, item_code_snapshot: 'SERVICO', description_snapshot: 'Mão de obra', unit: 'h', quantity: 3, unit_price: 8000 },
    ],
    ...over,
  });
  expectHttp(() => createQuotation(db, gestor, base({ equipment_info: { description: '' } }), settings), 400, /equipamento/);
  const q = createQuotation(db, gestor, base(), settings);
  assert.equal(q.category, 'manutencao');
  assert.equal(q.quotation_type, 'venda');
  assert.equal(q.total_amount, 2 * 3500 + 3 * 8000);
  const d = getQuotationDetail(db, gestor, q.id, settings);
  assert.equal(d.equipment_info?.serial_number, 'SN123');
  // peça sem "habilitado para venda" entra só na manutenção
  expectHttp(() => createQuotation(db, gestor, { ...base(), category: 'comercial', items: [{ catalog_item_id: peca, quantity: 1, unit_price: 3500 }] }, settings), 400, /venda/);
  createQuotation(db, gestor, venda(), settings);
  assert.deepEqual(listQuotations(db, gestor, { type: 'manutencao' } as any).rows.map((r) => r.id), [q.id]);
  assert.ok(listQuotations(db, gestor, { type: 'venda' } as any).rows.every((r) => r.category === 'comercial'));
  expectHttp(() => updateQuotation(db, gestor, q.id, { ...base(), category: 'comercial', row_version: d.row_version }, settings), 400, /modalidade/);
  assert.equal(duplicateQuotation(db, gestor, q.id, settings).quotation.category, 'manutencao');
});
