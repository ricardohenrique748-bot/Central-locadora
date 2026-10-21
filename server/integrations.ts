/**
 * Pontos de extensão entre módulos.
 *
 * Registrados hoje (server/api.ts): disponibilidade (Estoque), conversão em venda (Financeiro + Estoque)
 * e conversão em contrato de locação (módulo de Contratos: gera o contrato em rascunho).
 * O fluxo de conversão (idempotente, em transação) fica em services/quotations.ts.
 */

import { AuthUser, Quotation } from '../shared/orcamentos/types';

export type ConversionTargetType = 'venda' | 'contrato_locacao';

export interface ConversionAdapter {
  type: ConversionTargetType;
  /** Cria o registro de destino e devolve seu identificador. Deve validar disponibilidade. */
  convert(quotation: Quotation, user: AuthUser | null): { record_id: string };
}

/** Futuro módulo de estoque: consulta e reserva de disponibilidade. */
export interface AvailabilityAdapter {
  check(items: { catalog_item_id: number; quantity: number }[], start: string | null, end: string | null): {
    catalog_item_id: number;
    status: 'confirmada' | 'insuficiente' | 'indisponivel';
  }[];
}

/** Futuro módulo financeiro: contas a receber e caução após a operação efetivada. */
export interface FinanceAdapter {
  registerReceivable(sourceType: ConversionTargetType, recordId: string, amountCents: number): void;
  registerDeposit(recordId: string, amountCents: number): void;
}

const conversionAdapters = new Map<ConversionTargetType, ConversionAdapter>();
let availabilityAdapter: AvailabilityAdapter | null = null;

export function registerConversionAdapter(adapter: ConversionAdapter) {
  conversionAdapters.set(adapter.type, adapter);
}

export function unregisterConversionAdapter(type: ConversionTargetType) {
  conversionAdapters.delete(type);
}

export function conversionTargetFor(q: Pick<Quotation, 'quotation_type'>): ConversionTargetType {
  return q.quotation_type === 'venda' ? 'venda' : 'contrato_locacao';
}

export function getConversionAdapter(type: ConversionTargetType): ConversionAdapter | null {
  return conversionAdapters.get(type) || null;
}

export function getAvailabilityAdapter() {
  return availabilityAdapter;
}

export function setAvailabilityAdapter(adapter: AvailabilityAdapter | null) {
  availabilityAdapter = adapter;
}

export const INTEGRATION_STATUS = () => ({
  venda: !!conversionAdapters.get('venda'),
  contrato_locacao: !!conversionAdapters.get('contrato_locacao'),
  estoque: !!availabilityAdapter,
  // A venda convertida gera contas a receber no módulo Financeiro (ver services/finance/integrations.ts).
  financeiro: !!conversionAdapters.get('venda'),
});
