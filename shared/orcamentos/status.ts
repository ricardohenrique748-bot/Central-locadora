/**
 * Ciclo de vida do orçamento: transições permitidas por ação.
 *
 * Fluxo típico: rascunho → (em revisão) → aprovado internamente [ou aguardando aprovação
 * quando o desconto passa da alçada] → enviado → (em negociação) → aprovado pelo cliente → convertido.
 * Alterar um orçamento já aprovado/enviado exige "nova versão" (volta a rascunho e precisa ser reenviado).
 * Validade vencida em aprovado/enviado/negociação vira "expirado" automaticamente; só volta via renovação.
 */

import { QuotationAction, QuotationStatus } from './types';

export const STATUS_LABELS: Record<QuotationStatus, string> = {
  rascunho: 'Rascunho',
  em_revisao: 'Em revisão',
  aguardando_aprovacao: 'Aguardando aprovação interna',
  aprovado_interno: 'Aprovado internamente',
  enviado: 'Enviado ao cliente',
  em_negociacao: 'Em negociação',
  aprovado_cliente: 'Aprovado pelo cliente',
  recusado: 'Recusado',
  expirado: 'Expirado',
  cancelado: 'Cancelado',
  convertido: 'Convertido',
};

export const ALL_STATUSES = Object.keys(STATUS_LABELS) as QuotationStatus[];

export const EDITABLE_STATUSES: QuotationStatus[] = ['rascunho', 'em_revisao'];
export const EXPIRABLE_STATUSES: QuotationStatus[] = ['aprovado_interno', 'enviado', 'em_negociacao'];
export const TERMINAL_STATUSES: QuotationStatus[] = ['recusado', 'cancelado', 'convertido'];
/** Propostas que contam como fechadas (venda/locação aceita pelo cliente). */
export const WON_STATUSES: QuotationStatus[] = ['aprovado_cliente', 'convertido'];
/** Aguardando resposta do cliente. */
export const AWAITING_CLIENT_STATUSES: QuotationStatus[] = ['enviado', 'em_negociacao'];

interface Transition {
  from: QuotationStatus[];
  to: QuotationStatus | null; // null = não muda o status (ex.: duplicar)
  requiresReason?: boolean;
}

export const TRANSITIONS: Record<QuotationAction, Transition> = {
  editar: { from: EDITABLE_STATUSES, to: null },
  enviar_revisao: { from: ['rascunho'], to: 'em_revisao' },
  solicitar_aprovacao: { from: ['rascunho', 'em_revisao'], to: 'aguardando_aprovacao' },
  aprovar_interno: { from: ['rascunho', 'em_revisao', 'aguardando_aprovacao'], to: 'aprovado_interno' },
  rejeitar_aprovacao: { from: ['aguardando_aprovacao'], to: 'rascunho', requiresReason: true },
  registrar_envio: { from: ['aprovado_interno'], to: 'enviado' },
  registrar_negociacao: { from: ['enviado'], to: 'em_negociacao' },
  aprovar_cliente: { from: ['enviado', 'em_negociacao'], to: 'aprovado_cliente' },
  recusar: { from: ['enviado', 'em_negociacao'], to: 'recusado', requiresReason: true },
  renovar: { from: ['expirado'], to: 'em_revisao' },
  nova_versao: { from: ['aguardando_aprovacao', 'aprovado_interno', 'enviado', 'em_negociacao'], to: 'rascunho', requiresReason: true },
  cancelar: {
    from: ['rascunho', 'em_revisao', 'aguardando_aprovacao', 'aprovado_interno', 'enviado', 'em_negociacao', 'aprovado_cliente', 'expirado'],
    to: 'cancelado',
    requiresReason: true,
  },
  converter: { from: ['aprovado_interno', 'enviado', 'em_negociacao', 'aprovado_cliente'], to: 'convertido' },
  duplicar: { from: [...Object.keys(STATUS_LABELS)] as QuotationStatus[], to: null },
};

export function canTransition(action: QuotationAction, status: QuotationStatus): boolean {
  return TRANSITIONS[action].from.includes(status);
}

export function isExpired(status: QuotationStatus, expirationDate: string, today: string): boolean {
  return EXPIRABLE_STATUSES.includes(status) && expirationDate < today;
}

export const ACTION_LABELS: Record<QuotationAction, string> = {
  editar: 'Editar',
  enviar_revisao: 'Enviar para revisão',
  solicitar_aprovacao: 'Solicitar aprovação',
  aprovar_interno: 'Aprovar internamente',
  rejeitar_aprovacao: 'Rejeitar aprovação',
  registrar_envio: 'Registrar envio',
  registrar_negociacao: 'Em negociação',
  aprovar_cliente: 'Cliente aprovou',
  recusar: 'Cliente recusou',
  renovar: 'Renovar validade',
  nova_versao: 'Criar nova versão',
  cancelar: 'Cancelar',
  converter: 'Converter',
  duplicar: 'Duplicar',
};

export const REFUSAL_REASONS = [
  'Preço acima do esperado',
  'Prazo de entrega',
  'Optou por concorrente',
  'Indisponibilidade de equipamento',
  'Projeto/obra adiado ou cancelado',
  'Sem retorno do cliente',
  'Outro',
];
