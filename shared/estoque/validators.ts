/**
 * Validações do cadastro de itens e fornecedores (interface e servidor).
 */

import { ItemKind, StockItemInput, Supplier } from './types';
import { FieldErrors, isValidCNPJ, isValidCPF, isValidEmail, onlyDigits } from '../orcamentos/validators';

/** Modalidades comerciais padrão de cada tipo (o usuário pode ajustar acessórios e peças). */
export const KIND_DEFAULTS: Record<ItemKind, { sale: boolean; rental: boolean; item_type: 'equipamento' | 'produto' | 'peca' | 'acessorio' }> = {
  produto_venda: { sale: true, rental: false, item_type: 'produto' },
  equipamento_locacao: { sale: false, rental: true, item_type: 'equipamento' },
  venda_locacao: { sale: true, rental: true, item_type: 'equipamento' },
  peca: { sale: false, rental: false, item_type: 'peca' },
  acessorio: { sale: true, rental: false, item_type: 'acessorio' },
  consumo: { sale: false, rental: false, item_type: 'produto' },
};

export function validateStockItem(i: Partial<StockItemInput>, opts: { codeRequired?: boolean } = {}): FieldErrors {
  const e: FieldErrors = {};
  if (opts.codeRequired && !i.internal_code?.trim()) e.internal_code = 'Informe o código interno.';
  if (i.internal_code && !/^[A-Za-z0-9._\-/]{1,30}$/.test(i.internal_code.trim())) e.internal_code = 'Use até 30 letras, números, ponto, hífen ou barra.';
  if (!i.description || i.description.trim().length < 3) e.description = 'Informe o nome do item.';
  if (!i.kind || !(i.kind in KIND_DEFAULTS)) e.kind = 'Selecione o tipo de item.';
  if (i.tracking !== 'quantidade' && i.tracking !== 'individual') e.tracking = 'Selecione o tipo de controle.';
  if (i.tracking === 'individual' && !['equipamento_locacao', 'venda_locacao', 'acessorio'].includes(i.kind as string)) {
    e.tracking = 'Controle individual é para equipamentos e acessórios patrimoniais.';
  }
  if (!i.unit?.trim()) e.unit = 'Informe a unidade de medida.';
  const money = ['acquisition_cost', 'sale_price', 'daily_rental_price', 'weekly_rental_price', 'monthly_rental_price', 'custom_rental_price'] as const;
  for (const f of money) {
    const v = i[f];
    if (v !== null && v !== undefined && (!Number.isInteger(v) || v < 0)) e[f] = 'Valor inválido.';
  }
  if (i.sale_enabled && (i.sale_price === null || i.sale_price === undefined)) e.sale_price = 'Informe o preço de venda.';
  if (i.rental_enabled && ![i.daily_rental_price, i.weekly_rental_price, i.monthly_rental_price, i.custom_rental_price].some((v) => v !== null && v !== undefined)) {
    e.daily_rental_price = 'Informe ao menos um preço de locação.';
  }
  for (const f of ['min_qty', 'max_qty'] as const) {
    const v = i[f];
    if (v !== null && v !== undefined && (!Number.isFinite(v) || v < 0)) e[f] = 'Quantidade inválida.';
  }
  if (i.min_qty != null && i.max_qty != null && i.max_qty < i.min_qty) e.max_qty = 'Máximo deve ser maior ou igual ao mínimo.';
  if (i.barcode && !/^[0-9A-Za-z\-]{4,40}$/.test(i.barcode)) e.barcode = 'Código de barras inválido.';
  return e;
}

export function validateSupplier(s: Partial<Supplier>): FieldErrors {
  const e: FieldErrors = {};
  if (!s.name || s.name.trim().length < 3) e.name = 'Informe o nome ou razão social.';
  const doc = onlyDigits(s.document);
  if (doc) {
    if (s.person_type === 'PF' && !isValidCPF(doc)) e.document = 'CPF inválido.';
    if (s.person_type !== 'PF' && !isValidCNPJ(doc)) e.document = 'CNPJ inválido.';
  }
  if (s.email && !isValidEmail(s.email)) e.email = 'E-mail inválido.';
  const ph = onlyDigits(s.phone);
  if (ph && (ph.length < 10 || ph.length > 11)) e.phone = 'Telefone deve ter DDD + número.';
  return e;
}

/** Margem estimada sobre o preço de venda (null quando falta custo ou preço). */
export function estimatedMargin(cost: number | null, price: number | null): number | null {
  if (!cost || !price) return null;
  return Math.round(((price - cost) / price) * 1000) / 10;
}
