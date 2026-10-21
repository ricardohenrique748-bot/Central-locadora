/**
 * Núcleo do módulo de Contratos: configurações, validação, gravação do rascunho, listagem e leitura.
 *
 * - Cliente e itens vêm dos cadastros existentes (customers, catalog_items, stock_assets): o contrato guarda
 *   uma fotografia (snapshot) dos dados no momento da emissão.
 * - Disponibilidade física é SEMPRE das reservas do Estoque (stock_reservations.contract_id).
 * - Pagamentos são SEMPRE do Financeiro (contract_charges só aponta para o título).
 */

import { DB, audit, transaction } from '../../db';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../http';
import { AuthUser } from '../../../shared/orcamentos/types';
import { isISODate, todayISO } from '../../../shared/orcamentos/dates';
import {
  BillingFrequency,
  Contract,
  ContractInput,
  ContractItem,
  ContractItemInput,
  ContractListRow,
  ContractSettings,
  ContractStatus,
  RESPONSIBILITY_TOPICS,
  Responsibility,
  ResponsibilityKey,
} from '../../../shared/contratos/types';
import { computeTotals, contractCan, lineTotal } from '../../../shared/contratos/rules';
import { buildCustomerSnapshot } from '../quotations';
import { getCustomer } from '../customers';
import { nextNumber } from '../stock/core';

export const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

export const text = (v: unknown, max = 500) => {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t === '' ? null : t;
};
export const cents = (v: unknown, label: string) => {
  const n = Number(v ?? 0);
  if (!Number.isInteger(n) || n < 0 || n > 100_000_000_00) throw badRequest(`${label}: valor inválido.`);
  return n;
};

// ------------------------------------------------ configurações

/**
 * Modelo do contrato de locação de bens móveis (texto da empresa). Marcação: parágrafos separados por linha em
 * branco; **texto** sai em negrito; sozinhos num parágrafo, {{tabela_itens}}, {{tabela_prazo}} e {{tabela_reposicao}}
 * viram as tabelas dos equipamentos, {{assinatura|linha 1|linha 2}} uma linha de assinatura e {{testemunhas}} as duas
 * assinaturas de testemunha.
 */
export const DEFAULT_TEMPLATE = `**Pelo presente instrumento de Contrato de Locação de Bens Móveis, de um lado denominado LOCADORA, a empresa:**

**Central Br Comercio e Locação Equipamentos Construção Civil Ltda, estabelecida em São José do Rio Preto, SP, na Av. Feliciano Sales Cunha, 2920, Jardim Novo Aeroporto, com inscrição no CNPJ 31.292.742/0001-61, e Inscrição Estadual 647.971.276.118, por seu representante Legal infra-assinado, e doravante denominado como LOCADORA:**

**{{cliente}}, estabelecida em {{endereco_cliente}}, com inscrição no {{documento_cliente}}{{ie_cliente}}, por seu representante Legal infra-assinado, e doravante denominado como LOCATÁRIA:**

**As partes acima identificadas têm, entre si, justo e acertado o presente Contrato de Locação de Bens Móveis, que se regerá pelas cláusulas seguintes e pelas condições de preço, forma e termo de pagamento descritas no presente:**

**Cláusula 1ª: DO OBJETO DA LOCAÇÃO:** A Locadora e o Locatário acima qualificados, firmam entre si, o presente contrato de locação do bem móvel de propriedade da Locadora com as seguintes características:

{{tabela_itens}}

§1º. O bem móvel ora locado deverá ser utilizado exclusivamente de acordo com a sua natureza e respeitando as especificações do seu fabricante.

§2º. A utilização do bem de forma adversa da acima descrita estará sujeita à aplicações de multa, rescisão do contrato e eventuais perdas e danos.

§3º. O(s) bem(ns) móvel(is) deverá(ão) ser utilizado(s) para uso exclusivo na obra: {{local_obra}} e que acima são discriminados.

**Cláusula 2ª: DO VALOR DO ALUGUEL:**

O valor do aluguel, livremente ajustado pelas partes, é de {{valor_periodo}} por {{periodo}}, e estará sujeito a reajuste após o término do prazo mínimo estipulado na cláusula 3ª deste contrato, tornando-se para o cálculo deste reajuste o índice IGP-M ou na sua falta, outro fixado pelo Governo Federal.

Parágrafo único. O pagamento do referido aluguel iniciará no dia {{primeiro_vencimento}} e terá seus vencimentos conforme a periodicidade contratada ({{periodicidade}}), nos períodos subsequentes. Condições de pagamento: {{condicoes_pagamento}}. O pagamento da locação contratada será feito de forma antecipada, podendo, à critério da Locadora, ser faturado mensalmente contra a apresentação das faturas emitidas por ela, com um prazo máximo de trinta dias para pagamento.

**Cláusula 3ª: DO PRAZO DO ALUGUEL:**

O prazo da presente locação transcorre, CONFORME TABELA ABAIXO:

{{tabela_prazo}}

A partir da data inicial de {{inicio}}, com término previsto em {{termino}}, seguindo os períodos acima, de cada Objeto.

§1º. Ao final do prazo estipulado, caso as partes permaneçam inertes, a locação prorrogar-se-á automaticamente por tempo indeterminado.

§2º. Caso a Locadora não queira prorrogar a locação ao término do prazo estipulado neste contrato, e o referido bem não for devolvido, será cobrado o valor do aluguel proporcional aos dias de atraso acumulado de multa diária no valor da locação, conforme Caput da Cláusula 2ª.

**Cláusula 4ª: DO ESTADO DE CONSERVAÇÃO DOS EQUIPAMENTOS:** Os equipamentos objeto da presente locação encontram-se em perfeito estado de conservação e funcionamento, fato que a Locatária expressamente reconhece;

**Cláusula 5ª: DA RESPONSABILIDADE DOS ACIDENTES CAUSADOS COM A UTILIZAÇÃO DOS EQUIPAMENTOS LOCADOS:** Quaisquer acidentes ocorridos com o equipamento locado ou por ele causados a terceiros, desde sua retirada, até sua efetiva devolução e recebimento, serão de exclusiva responsabilidade da locatária, ficando a locadora excluída de quaisquer responsabilidades civis, criminais, trabalhistas ou outras;

**Cláusula 6ª: DA MANUTENÇÃO E SUBSTITUIÇÃO DE PEÇAS DOS EQUIPAMENTOS LOCADOS:** A manutenção e a substituição de peças nos equipamentos locados, serão de inteira responsabilidade da Locatária:

§1º. A Locatária não poderá, em hipótese alguma, substituir as peças que compõem os equipamentos ora locados por outras de qualidade inferior.

§2º. A manutenção e substituição de peças referidas neste artigo, poderão ser executadas pela Locadora, ficando a Locatária, neste caso, responsável pelo pagamento dos serviços prestados e das peças que forem substituídas;

**§3º.** O preço dos serviços prestados e das peças substituídas pela locadora, conforme consta do parágrafo anterior, será o constante da tabela Central Br Comercio Locação Equipamentos Construção Civil Ltda., em vigor na data da realização destes serviços ou da substituição de peças;

**Cláusula 7ª: DO EXTRAVIO OU DANIFICAÇÃO TOTAL DOS EQUIPAMENTOS:** Havendo extravio ou danificação total dos equipamentos locados, a Locatária se responsabilizará pelo seu pagamento, cujo preço será o constante da tabela de preço Central Br Comercio Locação Equipamentos Construção Civil Ltda., em vigor na data deste pagamento;

**Parágrafo único:** A LOCATÁRIA se responsabilizará expressamente pelos equipamentos para o caso de roubo ou furto, devendo zelar pelos equipamentos como se seu fosse não podendo arguir qualquer das hipóteses de caso fortuito ou força maior com o propósito de justificar a não restituição dos equipamentos locados.

**Cláusula 8ª: DA MONTAGEM E DESMONTAGEM DOS EQUIPAMENTOS LOCADOS:** A montagem e desmontagem dos equipamentos locados, serão de responsabilidade da Locatária;

**Parágrafo único:** A montagem e desmontagem referidas neste artigo, poderão ser executados pela locadora, ficando a locatária, neste caso, responsável pelo pagamento dos serviços prestados, cujos preços serão os constantes na tabela da Central Br Comercio Locação Equipamentos Construção Civil Ltda.;

**Cláusula 9ª: DO TRANSPORTE DOS EQUIPAMENTOS:** A Locatária se incumbirá, por sua conta e risco, do transporte dos equipamentos, responsabilizando-se pelos mesmos desde a sua retirada até sua efetiva devolução na empresa locadora.

**Cláusula 10ª: DA DEVOLUÇÃO DOS EQUIPAMENTOS LOCADOS:** Findo o prazo da locação, a locatária deverá devolver o equipamento locado e descrito na cláusula primeira supra, no depósito da Locadora.

§1º. Caso o equipamento seja retirado pela Locadora esta poderá cobrar da Locatária o valor do frete, cujo "quantum" será fixado de acordo com os valores praticados na região;

§2º. Na ocasião da devolução, os equipamentos serão vistoriados pela Locadora e esta, no ato da devolução, fará o respectivo relatório da quantidade e condições dos equipamentos;

**§3º.** Qualquer irregularidade, peça faltante, quebra ou desgaste que não de uso normal do equipamento, será apontada no relatório referido no parágrafo anterior, que deverá ser assinado pela pessoa que fez acompanhar a devolução dos equipamentos, que desde já a LOCATÁRIA expressa seu total aceite.

§4º. As avarias constatadas de acordo com o parágrafo anterior, serão reparadas pela Locadora e debitadas a Locatária com prazo de 30 dias para pagamento;

**Cláusula 11ª: DA PRORROGAÇÃO DO CONTRATO DE LOCAÇÃO:** Findo o prazo de locação, estabelecido na cláusula terceira desse contrato, e continuando a Locatária na posse da coisa alugada, sem oposição da Locadora, presumir-se-á prorrogada a locação pelo mesmo aluguel, com prazo indeterminado;

**Parágrafo único:** Qualquer que seja o motivo da não restituição dos equipamentos, como por exemplo, furto, roubo ou extravio, será considerado prorrogado o contrato por prazo indeterminado até que ocorra a indenização a LOCADORA pelo valor dos equipamentos, ou a restituição dos mesmos.

**Cláusula 12ª: DA TRIBUTAÇÃO:** Por se tratar o presente contrato de "Locação de Bens Moveis", a Locatária desde já reconhece que os impostos sobre serviços, é devido pela Locadora apenas ao Município de sua sede, qualquer que seja a localidade e a finalidade em que venham os equipamentos a serem destinados. Desta forma, os aluguéis decorrentes do presente contrato, não estarão sujeitos a retenção do imposto por parte da Locatária.

**Cláusula 13ª: DA RESCISÃO DO CONTRATO:** O presente contrato poderá ser rescindido nos seguintes casos:
a) Pela falta de pagamento dos aluguéis contratados;
b) Havendo ajuizamento de pedido de falência contra a Locatária, ou de concordata preventiva, ou ainda decretação de quebra da mesma;
c) Se houver descumprimento de quaisquer das cláusulas constantes deste contrato;

Parágrafo único: Ocorrendo quaisquer das hipóteses referidas nas alíneas "a", "b" e "c" deste artigo, poderá a Locadora valer-se do disposto no art. 502 do Código civil, retirando por seus próprios meios e condições os equipamentos locados, onde quer que estejam, independentemente de quaisquer avisos, notificação ou interpelação judicial, e ainda, sem nenhuma formalidade.

§2º. Toda despesa desembolsada pela Locadora para o transporte dos equipamentos, no caso do parágrafo anterior, será de responsabilidade da Locatária.

**Cláusula 14ª: DA PROIBIÇÃO DE SUBLOCAÇÃO, EMPRÉSTIMO OU ARRENDAMENTO DOS EQUIPAMENTOS LOCADOS:** A Locatária não poderá, em hipótese alguma, sublocar, emprestar ou arrendar os equipamentos constantes do presente contrato, ou por qualquer forma, ceder seu uso a terceiro, ainda que a título gratuito;

**Cláusula 15ª: DA INDENIZAÇÃO:** Na hipótese de não devolução, perda, roubo, extravio ou destruição total do bem ora locado, fica estipulada indenização devida pela Locatária que deverá, para efeito de indenização, pagar a Locadora o valor do objeto, avaliado em:

{{tabela_reposicao}}

**Cláusula 16ª:** Fica estabelecida uma multa contratual no valor de 20% (vinte por cento) do valor total dos equipamentos locados pelo presente contrato, para qualquer parte que descumprir as cláusulas acima pactuadas.

**Cláusula 17ª: DA ELEIÇÃO DO FORO:** Fica eleito o Foro da cidade de SÃO JOSÉ DO RIO PRETO - SP para dirimir quaisquer divergências provenientes do presente contrato, com renúncia a quaisquer outros por mais privilegiados que sejam;

E por estarem assim justos e contratados, assinam o presente contrato em 02 vias de igual teor e forma na presença de duas testemunhas.

**São José do Rio Preto, {{data_extenso}}**

{{assinatura|Locadora: Central Br Comercio e Locação Equipamentos Construção Civil Ltda.|CNPJ nº 31.292.742/0001-61}}

{{assinatura|Locatária: {{cliente}}|CNPJ/CPF: {{numero_documento_cliente}}}}

{{testemunhas}}`;

/** Início do modelo genérico antigo: configurações que ainda o guardam passam a usar o modelo acima. */
const LEGACY_TEMPLATE_PREFIX = 'MODELO EDITÁVEL — este texto é apenas um ponto de partida';

/** Modelo usado nos contratos de venda (o modelo configurável é o de locação). */
export const SALE_TEMPLATE = `MODELO EDITÁVEL — este texto é apenas um ponto de partida e NÃO foi validado juridicamente. Revise as cláusulas com a assessoria jurídica da empresa antes de usar.

## Objeto
{{empresa}} ("LOCADORA") cede a {{cliente}} ("LOCATÁRIA"), {{documento_cliente}}, os equipamentos relacionados neste contrato, nas condições abaixo.

## Vigência
Início em {{inicio}} e término previsto em {{termino}}. Prorrogações e renovações são formalizadas por aditivo.

## Valores e pagamento
Valor de {{valor_periodo}} por {{periodo}}, cobrado conforme o cronograma anexo. Condições: {{condicoes_pagamento}}. Em caso de atraso: multa de {{multa}}% e juros de {{juros}}% ao mês. Caução: {{caucao}}.

## Reajuste
{{reajuste}}

## Entrega, uso e devolução
Os equipamentos são entregues mediante comprovante assinado e devem ser devolvidos nas mesmas condições, ressalvado o desgaste natural de uso. Responsabilidades: transporte — {{resp_transporte}}; combustível — {{resp_combustivel}}; manutenção — {{resp_manutencao}}; avarias — {{resp_avarias}}.

## Avarias e extravios
Avarias e itens não devolvidos são apurados na conferência da devolução e cobrados conforme as condições negociadas.

## Encerramento e renovação
O contrato se encerra com a devolução e a conferência de todos os equipamentos e a quitação das obrigações. Condições especiais: {{condicoes_especiais}}`;

export const DEFAULT_CONTRACT_SETTINGS: ContractSettings = {
  require_approval: true,
  approval_limit: 0,
  require_signature_to_activate: true,
  alert_days: [30, 15, 7],
  charge_horizon_months: 3,
  default_due_days_after: 0,
  block_close_with_open_charges: false,
  require_inspection_before_close: true,
  contract_template: DEFAULT_TEMPLATE,
  lessor_signature: null,
  lessor_signatory: '',
};

export function getContractSettings(db: DB): ContractSettings {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'contracts'").get() as { value: string } | undefined;
  if (!row) return DEFAULT_CONTRACT_SETTINGS;
  const s = { ...DEFAULT_CONTRACT_SETTINGS, ...JSON.parse(row.value) };
  // modelo genérico antigo (nunca personalizado) passa a ser o modelo de locação da empresa
  if (s.contract_template.startsWith(LEGACY_TEMPLATE_PREFIX)) s.contract_template = DEFAULT_TEMPLATE;
  return s;
}

export function saveContractSettings(db: DB, user: AuthUser, raw: any): ContractSettings {
  if (!contractCan.configure(user)) throw forbidden('Somente o administrador altera as configurações de contratos.');
  const int = (v: unknown, min: number, max: number, label: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`${label}: informe um número entre ${min} e ${max}.`);
    return n;
  };
  const days = (Array.isArray(raw?.alert_days) ? raw.alert_days : String(raw?.alert_days || '').split(/[,; ]+/))
    .map(Number)
    .filter((n: number) => Number.isInteger(n) && n > 0 && n <= 365);
  const tpl = text(raw?.contract_template, 30_000);
  const sig = typeof raw?.lessor_signature === 'string' && raw.lessor_signature ? raw.lessor_signature : null;
  if (sig && !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(sig)) throw badRequest('A assinatura deve ser uma imagem PNG ou JPG.');
  if (sig && sig.length > 550_000) throw badRequest('Imagem da assinatura muito grande (máx. ~400 KB). Recorte só a assinatura.');
  const s: ContractSettings = {
    require_approval: !!raw?.require_approval,
    approval_limit: cents(raw?.approval_limit, 'Alçada de aprovação'),
    require_signature_to_activate: !!raw?.require_signature_to_activate,
    alert_days: [...new Set<number>(days)].sort((a, b) => b - a).slice(0, 6),
    charge_horizon_months: int(raw?.charge_horizon_months, 1, 24, 'Horizonte de cobranças'),
    default_due_days_after: int(raw?.default_due_days_after ?? 0, 0, 120, 'Prazo de vencimento'),
    block_close_with_open_charges: !!raw?.block_close_with_open_charges,
    require_inspection_before_close: !!raw?.require_inspection_before_close,
    contract_template: tpl || DEFAULT_TEMPLATE,
    lessor_signature: sig,
    lessor_signatory: text(raw?.lessor_signatory, 120) || '',
  };
  if (!s.alert_days.length) throw badRequest('Informe ao menos um prazo de alerta (ex.: 30, 15, 7).');
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('contracts', ?, ${NOW_SQL}) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(JSON.stringify(s));
  audit(db, 'settings', 'contracts', 'update', user.id, { ...s, contract_template: '(texto)', lessor_signature: s.lessor_signature ? '(imagem)' : null });
  return s;
}

// ------------------------------------------------ eventos (histórico imutável)

export function contractEvent(db: DB, contractId: number, type: string, description: string, user: AuthUser | null, prev: ContractStatus | null = null, next: ContractStatus | null = null, metadata?: unknown) {
  db.prepare('INSERT INTO contract_events (contract_id, event_type, previous_status, new_status, description, metadata, performed_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    contractId,
    type,
    prev,
    next,
    description,
    metadata === undefined ? null : JSON.stringify(metadata),
    user?.id ?? null
  );
}

/** Troca de status com trava otimista: se outro usuário mudou o contrato antes, falha. */
export function setStatus(db: DB, c: { id: number; status: ContractStatus }, to: ContractStatus, user: AuthUser | null, description: string, extraSql = '', extraParams: (string | number | null)[] = []) {
  const res = db
    .prepare(`UPDATE contracts SET status = ?, ${extraSql ? `${extraSql}, ` : ''}updated_by = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ? AND status = ?`)
    .run(to, ...extraParams, user?.id ?? null, c.id, c.status);
  if (!res.changes) throw conflict('O contrato foi alterado por outra pessoa. Atualize a tela e tente novamente.');
  contractEvent(db, c.id, 'status', description, user, c.status, to);
}

// ------------------------------------------------ validação

const FREQS: BillingFrequency[] = ['diaria', 'semanal', 'quinzenal', 'mensal', 'personalizado', 'unico'];
const RESP: Responsibility[] = ['locadora', 'cliente', 'a_combinar', 'nao_se_aplica'];

/**
 * Valida e normaliza as linhas de itens (cadastro, patrimônio, quantidade, valores). Erros vão para `errors`
 * em items.<índice>. `seenAssets` traz patrimônios que já estão no contrato (inclusão por aditivo).
 */
export function normalizeItems(db: DB, contract_type: 'locacao' | 'venda' | null, rawItems: any[], errors: Record<string, string>, seenAssets = new Set<number>()): ContractItemInput[] {
  const items: ContractItemInput[] = [];
  rawItems.forEach((ri, idx) => {
    const k = `items.${idx}`;
    const it = db.prepare('SELECT id, internal_code, tracking, rental_enabled, sale_enabled, active FROM catalog_items WHERE id = ?').get(Number(ri?.item_id)) as any;
    if (!it) return void (errors[k] = 'Item não encontrado.');
    if (!it.active) return void (errors[k] = `${it.internal_code} está inativo.`);
    const modality = contract_type === 'venda' ? 'venda' : ri?.modality === 'venda' ? 'venda' : 'locacao';
    if (modality === 'locacao' && !it.rental_enabled) return void (errors[k] = `${it.internal_code} não está habilitado para locação.`);
    if (modality === 'venda' && !it.sale_enabled) return void (errors[k] = `${it.internal_code} não está habilitado para venda.`);
    let asset_id: number | null = ri?.asset_id ? Number(ri.asset_id) : null;
    let quantity = Number(ri?.quantity);
    if (it.tracking === 'individual') {
      if (modality === 'venda') return void (errors[k] = `${it.internal_code} é controlado por patrimônio: a venda exige baixa patrimonial no Estoque.`);
      quantity = 1;
      if (asset_id) {
        const a = db.prepare('SELECT asset_tag, item_id, operational_status FROM stock_assets WHERE id = ?').get(asset_id) as any;
        if (!a || a.item_id !== it.id) return void (errors[k] = 'Patrimônio não pertence ao item.');
        if (a.operational_status === 'baixado') return void (errors[k] = `${a.asset_tag} está baixado.`);
        if (seenAssets.has(asset_id)) return void (errors[k] = `${a.asset_tag} aparece mais de uma vez.`);
        seenAssets.add(asset_id);
      }
    } else {
      asset_id = null;
      if (!(Number.isFinite(quantity) && quantity > 0 && quantity <= 1_000_000)) return void (errors[k] = 'Quantidade inválida.');
      quantity = Math.round(quantity * 1000) / 1000;
    }
    const unit_price = Number(ri?.unit_price);
    const discount_amount = Number(ri?.discount_amount || 0);
    if (!Number.isInteger(unit_price) || unit_price < 0) return void (errors[k] = 'Valor unitário inválido.');
    if (!Number.isInteger(discount_amount) || discount_amount < 0 || discount_amount > Math.round(quantity * unit_price)) return void (errors[k] = 'Desconto maior que o valor do item.');
    items.push({ id: ri?.id ? Number(ri.id) : undefined, item_id: it.id, asset_id, quantity, modality, unit_price, discount_amount, notes: text(ri?.notes, 1000), conditions: text(ri?.conditions, 1000) });
  });
  return items;
}

export function normalizeContract(db: DB, raw: any): ContractInput {
  const errors: Record<string, string> = {};
  const contract_type = raw?.contract_type === 'venda' ? 'venda' : raw?.contract_type === 'locacao' ? 'locacao' : null;
  if (!contract_type) errors.contract_type = 'Selecione o tipo de contrato.';
  const customer_id = Number(raw?.customer_id);
  const cust = db.prepare('SELECT active FROM customers WHERE id = ?').get(customer_id) as { active: number } | undefined;
  if (!cust) errors.customer_id = 'Selecione o cliente.';
  else if (!cust.active) errors.customer_id = 'Cliente inativo não pode receber novos contratos.';

  const start_date = raw?.start_date;
  if (!isISODate(start_date)) errors.start_date = 'Informe a data de início.';
  let end_date: string | null = raw?.end_date || null;
  if (end_date && !isISODate(end_date)) errors.end_date = 'Data inválida.';
  else if (end_date && isISODate(start_date) && end_date <= start_date) errors.end_date = 'O término deve ser posterior ao início (o dia do término é o da devolução).';
  if (contract_type === 'venda') end_date = null;

  const responsible_user_id = Number(raw?.responsible_user_id);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(responsible_user_id)) errors.responsible_user_id = 'Selecione o responsável comercial.';
  const approver_user_id = raw?.approver_user_id ? Number(raw.approver_user_id) : null;
  if (approver_user_id && !db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1 AND role IN ('admin','gestor')").get(approver_user_id)) errors.approver_user_id = 'O aprovador precisa ser gestor ou administrador.';

  let billing_frequency: BillingFrequency = FREQS.includes(raw?.billing_frequency) ? raw.billing_frequency : 'mensal';
  if (contract_type === 'venda') billing_frequency = 'unico';
  const custom_period_days = billing_frequency === 'personalizado' ? Number(raw?.custom_period_days) : null;
  if (billing_frequency === 'personalizado' && !(Number.isInteger(custom_period_days) && custom_period_days! >= 1 && custom_period_days! <= 365)) errors.custom_period_days = 'Informe a duração do período (1 a 365 dias).';
  if (contract_type === 'locacao' && !end_date && billing_frequency === 'unico') errors.end_date = 'Valor único exige data de término.';
  const due_day = raw?.due_day ? Number(raw.due_day) : null;
  if (due_day !== null && !(Number.isInteger(due_day) && due_day >= 1 && due_day <= 31)) errors.due_day = 'Dia entre 1 e 31.';
  const due_days_after = Number(raw?.due_days_after ?? 0);
  if (!(Number.isInteger(due_days_after) && due_days_after >= 0 && due_days_after <= 120)) errors.due_days_after = 'Entre 0 e 120 dias.';
  const pct = (v: unknown, k: string) => {
    const n = Number(v ?? 0);
    if (!Number.isFinite(n) || n < 0 || n > 100) errors[k] = 'Percentual entre 0 e 100.';
    return Math.round(n * 100) / 100;
  };
  const installments_count = contract_type === 'venda' ? Number(raw?.installments_count || 1) : 1;
  if (!(Number.isInteger(installments_count) && installments_count >= 1 && installments_count <= 60)) errors.installments_count = 'Entre 1 e 60 parcelas.';
  const first_due_date = contract_type === 'venda' && raw?.first_due_date ? raw.first_due_date : null;
  if (first_due_date && !isISODate(first_due_date)) errors.first_due_date = 'Data inválida.';
  const adjustment_period_months = raw?.adjustment_period_months ? Number(raw.adjustment_period_months) : null;
  if (adjustment_period_months !== null && !(Number.isInteger(adjustment_period_months) && adjustment_period_months >= 1 && adjustment_period_months <= 120)) errors.adjustment_period_months = 'Entre 1 e 120 meses.';
  const responsibilities = {} as Record<ResponsibilityKey, Responsibility>;
  for (const t of RESPONSIBILITY_TOPICS) responsibilities[t.key] = RESP.includes(raw?.responsibilities?.[t.key]) ? raw.responsibilities[t.key] : 'a_combinar';

  // itens
  const rawItems: any[] = Array.isArray(raw?.items) ? raw.items : [];
  if (!rawItems.length) errors.items = 'Inclua ao menos um item.';
  if (rawItems.length > 200) errors.items = 'Máximo de 200 itens.';
  const items = normalizeItems(db, contract_type, rawItems, errors);
  if (Object.keys(errors).length) throw badRequest('Revise os campos destacados.', errors);
  const input: ContractInput = {
    contract_type: contract_type!,
    customer_id,
    customer_contact: text(raw?.customer_contact, 120),
    start_date,
    end_date,
    responsible_user_id,
    approver_user_id,
    delivery_address: text(raw?.delivery_address, 500),
    internal_notes: text(raw?.internal_notes, 4000),
    billing_frequency,
    custom_period_days,
    billing_timing: raw?.billing_timing === 'postecipado' ? 'postecipado' : 'antecipado',
    due_day,
    due_days_after,
    proportional_last: raw?.proportional_last !== false,
    // locação com término: sempre uma única cobrança com o valor total da vigência
    single_charge: contract_type === 'locacao' && billing_frequency !== 'unico' && !!end_date,
    general_discount: cents(raw?.general_discount, 'Desconto geral'),
    freight_delivery: cents(raw?.freight_delivery, 'Frete de entrega'),
    freight_pickup: contract_type === 'venda' ? 0 : cents(raw?.freight_pickup, 'Frete de retirada'),
    other_fees: cents(raw?.other_fees, 'Taxas adicionais'),
    other_fees_description: text(raw?.other_fees_description, 120),
    deposit_amount: contract_type === 'venda' ? 0 : cents(raw?.deposit_amount, 'Caução'),
    late_fee_percent: pct(raw?.late_fee_percent, 'late_fee_percent'),
    interest_month_percent: pct(raw?.interest_month_percent, 'interest_month_percent'),
    adjustment_index: text(raw?.adjustment_index, 60),
    adjustment_period_months,
    responsibilities,
    payment_terms: text(raw?.payment_terms, 2000),
    special_conditions: text(raw?.special_conditions, 4000),
    installments_count,
    first_due_date,
    items,
  };
  const totals = computeTotals(items, input);
  if (contract_type === 'locacao' && items.some((i) => i.modality === 'locacao') && totals.period_amount <= 0) throw badRequest('O valor por período ficou zerado: confira os preços e o desconto geral.', { general_discount: 'Desconto maior que o valor por período.' });
  if (contract_type === 'venda' && totals.sale_total <= 0) throw badRequest('Venda sem valor.', { items: 'Informe os valores.' });
  return input;
}

// ------------------------------------------------ gravação (rascunho)

function writeItems(db: DB, contractId: number, items: ContractItemInput[]) {
  db.prepare('DELETE FROM contract_items WHERE contract_id = ?').run(contractId);
  appendItems(db, contractId, items);
}

/** Acrescenta itens ao fim da lista do contrato. Retorna os ids criados. */
export function appendItems(db: DB, contractId: number, items: ContractItemInput[]): number[] {
  const last = (db.prepare('SELECT COALESCE(MAX(position), 0) p FROM contract_items WHERE contract_id = ?').get(contractId) as { p: number }).p;
  const ins = db.prepare(
    `INSERT INTO contract_items (contract_id, position, item_id, asset_id, item_code_snapshot, description_snapshot, unit, quantity, modality, unit_price, discount_amount, line_total, notes, conditions)
     SELECT ?, ?, i.id, ?, i.internal_code, i.description, i.unit, ?, ?, ?, ?, ?, ?, ? FROM catalog_items i WHERE i.id = ? RETURNING id`
  );
  return items.map((it, idx) => (ins.get(contractId, last + idx + 1, it.asset_id, it.quantity, it.modality, it.unit_price, it.discount_amount, lineTotal(it), it.notes, it.conditions, it.item_id) as { id: number }).id);
}

const HEADER_COLS = [
  'customer_id', 'start_date', 'end_date', 'responsible_user_id', 'approver_user_id', 'delivery_address', 'internal_notes', 'billing_frequency', 'custom_period_days',
  'billing_timing', 'due_day', 'due_days_after', 'proportional_last', 'single_charge', 'general_discount', 'freight_delivery', 'freight_pickup', 'other_fees', 'other_fees_description',
  'deposit_amount', 'late_fee_percent', 'interest_month_percent', 'adjustment_index', 'adjustment_period_months', 'responsibilities', 'payment_terms', 'special_conditions',
  'installments_count', 'first_due_date', 'rental_subtotal', 'period_amount', 'sale_subtotal', 'sale_total', 'one_time_total', 'estimated_total', 'monthly_equivalent',
] as const;

function headerValues(db: DB, c: ContractInput) {
  const totals = computeTotals(c.items, c);
  const row: Record<string, unknown> = { ...c, ...totals, proportional_last: c.proportional_last ? 1 : 0, single_charge: c.single_charge ? 1 : 0, responsibilities: JSON.stringify(c.responsibilities) };
  return { values: HEADER_COLS.map((k) => (row[k] === undefined ? null : row[k])) as (string | number | null)[], snapshot: customerSnapshotFor(db, c.customer_id, c.customer_contact) };
}

export function customerSnapshotFor(db: DB, customerId: number, contact: string | null) {
  const cu = getCustomer(db, customerId);
  return JSON.stringify({ ...buildCustomerSnapshot(cu), city: cu.city, state: cu.state, contact_name: contact });
}

/** Insere contrato em rascunho (DENTRO de transação). */
export function insertContractTx(db: DB, user: AuthUser, c: ContractInput, origin: { source: 'manual' | 'orcamento'; quotation_id: number | null } = { source: 'manual', quotation_id: null }): number {
  const { values, snapshot } = headerValues(db, c);
  const row = db
    .prepare(
      `INSERT INTO contracts (contract_number, contract_type, status, source, quotation_id, customer_snapshot, created_by, updated_by, ${HEADER_COLS.join(', ')})
       VALUES (?, ?, 'rascunho', ?, ?, ?, ?, ?, ${HEADER_COLS.map(() => '?').join(', ')}) RETURNING id, contract_number`
    )
    .get(nextNumber(db, 'CTR'), c.contract_type, origin.source, origin.quotation_id, snapshot, user.id, user.id, ...values) as { id: number; contract_number: string };
  writeItems(db, row.id, c.items);
  contractEvent(db, row.id, 'criacao', origin.quotation_id ? `Contrato criado a partir do orçamento.` : 'Contrato criado (cadastro manual).', user, null, 'rascunho');
  audit(db, 'contract', row.id, 'create', user.id, { source: origin.source });
  return row.id;
}

export function createContract(db: DB, user: AuthUser, raw: any): Contract {
  if (!contractCan.create(user)) throw forbidden();
  const c = normalizeContract(db, raw);
  if (user.role === 'vendedor' && c.responsible_user_id !== user.id) c.responsible_user_id = user.id;
  const id = transaction(db, () => insertContractTx(db, user, c));
  return loadContract(db, user, id);
}

export function updateContract(db: DB, user: AuthUser, id: number, raw: any): Contract {
  transaction(db, () => {
    const cur = loadRaw(db, id);
    if (!contractCan.edit(user, cur)) throw forbidden();
    if (cur.status !== 'rascunho') throw new HttpError(422, 'Somente contratos em rascunho são editados. Alterações em contratos formalizados são feitas por aditivo (renovação/reajuste).');
    if (raw?.row_version !== undefined && Number(raw.row_version) !== cur.row_version) throw conflict('O contrato foi alterado por outra pessoa. Recarregue antes de salvar.');
    const c = normalizeContract(db, { ...raw, contract_type: cur.contract_type });
    if (user.role === 'vendedor') c.responsible_user_id = cur.responsible_user_id;
    const { values, snapshot } = headerValues(db, c);
    db.prepare(`UPDATE contracts SET ${HEADER_COLS.map((k) => `${k} = ?`).join(', ')}, customer_snapshot = ?, updated_by = ?, row_version = row_version + 1, updated_at = ${NOW_SQL} WHERE id = ?`).run(
      ...values,
      snapshot,
      user.id,
      id
    );
    writeItems(db, id, c.items);
    contractEvent(db, id, 'edicao', 'Rascunho alterado.', user);
  });
  return loadContract(db, user, id);
}

// ------------------------------------------------ leitura

export function loadRaw(db: DB, id: number) {
  const c = db.prepare('SELECT * FROM contracts WHERE id = ?').get(id) as any;
  if (!c) throw notFound('Contrato não encontrado.');
  return c;
}

const CONTRACT_SELECT = `
  SELECT c.*, q.quotation_number, ur.name AS responsible_name, ua.name AS approver_name, ub.name AS approved_by_name, uc.name AS created_by_name
  FROM contracts c
  LEFT JOIN quotations q ON q.id = c.quotation_id
  LEFT JOIN users ur ON ur.id = c.responsible_user_id
  LEFT JOIN users ua ON ua.id = c.approver_user_id
  LEFT JOIN users ub ON ub.id = c.approved_by
  LEFT JOIN users uc ON uc.id = c.created_by`;

/** Itens com a situação física derivada das reservas do Estoque. */
export function loadItems(db: DB, contractId: number): ContractItem[] {
  return (
    db
      .prepare(
        `SELECT ci.*, ci.item_code_snapshot AS item_code, ci.description_snapshot AS description, i.tracking, a.asset_tag, a.serial_number,
           COALESCE(a.acquisition_cost, i.acquisition_cost) AS replacement_value,
           COALESCE((SELECT SUM(quantity) FROM stock_reservations r WHERE r.contract_item_id = ci.id AND r.status = 'confirmada'), 0) AS reserved_qty,
           COALESCE((SELECT SUM(quantity) FROM stock_reservations r WHERE r.contract_item_id = ci.id AND r.status = 'em_uso'), 0) AS delivered_qty,
           COALESCE((SELECT SUM(quantity) FROM stock_reservations r WHERE r.contract_item_id = ci.id AND r.status = 'concluida'), 0) AS returned_qty,
           COALESCE((SELECT SUM(oi.quantity) FROM contract_operation_items oi JOIN contract_operations o ON o.id = oi.operation_id
                     WHERE oi.contract_item_id = ci.id AND o.operation_type = 'entrega' AND ci.modality = 'venda'), 0) AS sold_delivered_qty
         FROM contract_items ci JOIN catalog_items i ON i.id = ci.item_id LEFT JOIN stock_assets a ON a.id = ci.asset_id
         WHERE ci.contract_id = ? ORDER BY ci.position`
      )
      .all(contractId) as any[]
  ).map((r) => ({ ...r }));
}

export function rowToContract(r: any, items: ContractItem[]): Contract {
  return {
    ...r,
    proportional_last: !!r.proportional_last,
    single_charge: !!r.single_charge,
    responsibilities: JSON.parse(r.responsibilities || '{}'),
    customer_snapshot: JSON.parse(r.customer_snapshot),
    customer_contact: JSON.parse(r.customer_snapshot).contact_name ?? null,
    items,
  };
}

/** Oculta valores para perfis sem acesso (estoquista). */
export function maskValues<T extends Contract>(c: T, user: AuthUser): T {
  if (contractCan.viewValues(user)) return c;
  const zero = { unit_price: 0, discount_amount: 0, line_total: 0 };
  return {
    ...c,
    rental_subtotal: 0, period_amount: 0, sale_subtotal: 0, sale_total: 0, one_time_total: 0, estimated_total: null, monthly_equivalent: 0,
    general_discount: 0, freight_delivery: 0, freight_pickup: 0, other_fees: 0, deposit_amount: 0,
    items: c.items.map((i) => ({ ...i, ...zero })),
  };
}

export function loadContract(db: DB, user: AuthUser, id: number): Contract {
  if (!contractCan.view(user)) throw forbidden();
  const r = db.prepare(`${CONTRACT_SELECT} WHERE c.id = ?`).get(id) as any;
  if (!r) throw notFound('Contrato não encontrado.');
  return maskValues(rowToContract(r, loadItems(db, id)), user);
}

// ------------------------------------------------ listagem

export function listContracts(db: DB, user: AuthUser, f: Record<string, string | undefined>, all = false) {
  if (!contractCan.view(user)) throw forbidden();
  const where: string[] = [];
  const params: (string | number)[] = [];
  const today = todayISO();
  if (f.status === 'vencendo') {
    const s = getContractSettings(db);
    where.push("c.status IN ('ativo','agendado') AND c.end_date BETWEEN ? AND ?");
    params.push(today, addDays(today, Math.max(...s.alert_days)));
  } else if (f.status === 'atencao') {
    where.push("(c.status IN ('aguardando_aprovacao','aguardando_assinatura','vencido','pendente_devolucao'))");
  } else if (f.status === 'em_elaboracao') {
    where.push("c.status IN ('rascunho','aguardando_aprovacao')");
  } else if (f.status) {
    const st = f.status.split(',');
    where.push(`c.status IN (${st.map(() => '?').join(',')})`);
    params.push(...st);
  }
  if (f.type === 'locacao' || f.type === 'venda') {
    where.push('c.contract_type = ?');
    params.push(f.type);
  }
  if (f.customer_id) {
    where.push('c.customer_id = ?');
    params.push(Number(f.customer_id));
  }
  if (f.responsible_id) {
    where.push('c.responsible_user_id = ?');
    params.push(Number(f.responsible_id));
  }
  if (f.from) {
    where.push('COALESCE(c.end_date, ?) >= ?');
    params.push('9999-12-31', f.from);
  }
  if (f.to) {
    where.push('c.start_date <= ?');
    params.push(f.to);
  }
  if (f.q?.trim()) {
    const q = `%${f.q.trim()}%`;
    const digits = f.q.replace(/\D/g, '');
    where.push(`(c.contract_number LIKE ? OR json_extract(c.customer_snapshot, '$.name') LIKE ? OR json_extract(c.customer_snapshot, '$.trade_name') LIKE ?
      ${digits.length >= 3 ? "OR json_extract(c.customer_snapshot, '$.document') LIKE ?" : ''}
      OR EXISTS (SELECT 1 FROM contract_items ci LEFT JOIN stock_assets a ON a.id = ci.asset_id WHERE ci.contract_id = c.id AND (ci.item_code_snapshot LIKE ? OR ci.description_snapshot LIKE ? OR a.asset_tag LIKE ? OR a.serial_number LIKE ?)))`);
    params.push(q, q, q);
    if (digits.length >= 3) params.push(`%${digits}%`);
    params.push(q, q, q, q);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const SORTS: Record<string, string> = { numero: 'c.contract_number', cliente: "json_extract(c.customer_snapshot, '$.name')", inicio: 'c.start_date', termino: 'c.end_date', valor: 'c.period_amount', status: 'c.status' };
  const sort = SORTS[f.sort || ''] || 'c.id';
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  const total = (db.prepare(`SELECT COUNT(*) n FROM contracts c ${w}`).get(...params) as { n: number }).n;
  const pageSize = all ? 5000 : Math.min(Math.max(Number(f.page_size) || 20, 5), 100);
  const page = all ? 1 : Math.max(Number(f.page) || 1, 1);
  const rows = (
    db
      .prepare(
        `SELECT c.id, c.contract_number, c.contract_type, c.status, c.customer_id, json_extract(c.customer_snapshot, '$.name') AS customer_name,
           json_extract(c.customer_snapshot, '$.document') AS customer_document, c.start_date, c.end_date, c.billing_frequency, c.period_amount, c.sale_total, c.estimated_total,
           u.name AS responsible_name,
           EXISTS (SELECT 1 FROM stock_reservations r WHERE r.contract_id = c.id AND r.status = 'em_uso' AND r.end_date < ?) AS late_return
         FROM contracts c LEFT JOIN users u ON u.id = c.responsible_user_id ${w} ORDER BY ${sort} ${dir}, c.id DESC LIMIT ? OFFSET ?`
      )
      .all(today, ...params, pageSize, (page - 1) * pageSize) as any[]
  ).map((r): ContractListRow => {
    let attention: string | null = null;
    if (r.late_return) attention = 'Devolução atrasada';
    else if (r.status === 'vencido') attention = 'Prazo vencido';
    else if (r.status === 'aguardando_aprovacao') attention = 'Aguardando aprovação';
    else if (r.status === 'aguardando_assinatura') attention = 'Aguardando assinatura';
    else if (r.end_date && ['ativo', 'agendado'].includes(r.status)) {
      const days = Math.round((Date.parse(r.end_date) - Date.parse(today)) / 86_400_000);
      if (days <= 7) attention = days <= 0 ? 'Termina hoje' : `Termina em ${days} dia(s)`;
    }
    const values = contractCan.viewValues(user);
    return {
      id: r.id, contract_number: r.contract_number, contract_type: r.contract_type, status: r.status, customer_id: r.customer_id, customer_name: r.customer_name,
      customer_document: r.customer_document, start_date: r.start_date, end_date: r.end_date, billing_frequency: r.billing_frequency,
      period_amount: values ? (r.contract_type === 'venda' ? r.sale_total : r.period_amount) : 0, estimated_total: values ? r.estimated_total : null,
      responsible_name: r.responsible_name, attention,
    };
  });
  return { total, page, page_size: pageSize, rows };
}

export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

/** Usuários para os seletores de responsável/aprovador. */
export function contractUsers(db: DB) {
  return db.prepare("SELECT id, name, role FROM users WHERE active = 1 AND role IN ('admin','gestor','vendedor') ORDER BY name").all();
}
