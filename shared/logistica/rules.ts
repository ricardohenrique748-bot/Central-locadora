/**
 * Regras puras da Logística: transições e permissões.
 */

import { AuthUser } from '../orcamentos/types';
import { OpStatus, OpType, OccurrenceStatus } from './types';

export const DELIVERY_TRANSITIONS: Record<string, OpStatus[]> = {
  rascunho: ['programada', 'cancelada'],
  programada: ['em_separacao', 'cancelada'],
  em_separacao: ['pronta', 'programada', 'cancelada'],
  pronta: ['em_transporte', 'em_separacao', 'cancelada'],
  em_transporte: ['entregue', 'entregue_parcialmente', 'pronta'],
  entregue_parcialmente: [],
  entregue: [],
  cancelada: [],
};

export const RETURN_TRANSITIONS: Record<string, OpStatus[]> = {
  rascunho: ['programada', 'cancelada'],
  programada: ['em_andamento', 'recebida', 'recebida_parcialmente', 'cancelada'],
  em_andamento: ['recebida', 'recebida_parcialmente', 'programada', 'cancelada'],
  recebida_parcialmente: ['em_conferencia', 'aguardando_inspecao', 'concluida'],
  recebida: ['em_conferencia', 'aguardando_inspecao', 'concluida'],
  aguardando_inspecao: ['em_conferencia', 'concluida'],
  em_conferencia: ['aguardando_inspecao', 'concluida'],
  concluida: [],
  cancelada: [],
};

export const transitionsFor = (type: OpType) => (type === 'entrega' ? DELIVERY_TRANSITIONS : RETURN_TRANSITIONS);

/** Status em que a movimentação física já aconteceu: a operação não pode mais ser cancelada. */
export const PHYSICALLY_DONE: OpStatus[] = ['entregue', 'entregue_parcialmente', 'recebida', 'recebida_parcialmente', 'aguardando_inspecao', 'em_conferencia', 'concluida'];

export const OCCURRENCE_TRANSITIONS: Record<OccurrenceStatus, OccurrenceStatus[]> = {
  registrada: ['em_analise', 'aguardando_orcamento', 'aguardando_aprovacao', 'nao_cobravel', 'encaminhada_manutencao', 'resolvida'],
  em_analise: ['aguardando_orcamento', 'aguardando_aprovacao', 'nao_cobravel', 'encaminhada_manutencao', 'resolvida'],
  aguardando_orcamento: ['em_analise', 'aguardando_aprovacao', 'nao_cobravel', 'encaminhada_manutencao'],
  aguardando_aprovacao: ['aprovada_cobranca', 'nao_cobravel', 'em_analise'],
  aprovada_cobranca: ['resolvida'],
  nao_cobravel: ['resolvida', 'em_analise'],
  encaminhada_manutencao: ['em_analise', 'aguardando_aprovacao', 'nao_cobravel', 'resolvida'],
  resolvida: [],
};

const is = (u: AuthUser, ...r: AuthUser['role'][]) => r.includes(u.role);

export const logCan = {
  view: (_u: AuthUser) => true,
  create: (u: AuthUser) => is(u, 'admin', 'gestor', 'estoquista', 'vendedor'),
  separate: (u: AuthUser) => is(u, 'admin', 'gestor', 'estoquista'),
  confirm: (u: AuthUser) => is(u, 'admin', 'gestor', 'estoquista'),
  inspect: (u: AuthUser) => is(u, 'admin', 'gestor', 'estoquista', 'tecnico'),
  occurrence: (u: AuthUser) => is(u, 'admin', 'gestor', 'estoquista', 'tecnico'),
  approve: (u: AuthUser) => is(u, 'admin', 'gestor'), // ajustar operação, aprovar cobrança
  cancel: (u: AuthUser) => is(u, 'admin', 'gestor'),
  viewCosts: (u: AuthUser) => is(u, 'admin', 'gestor', 'financeiro', 'estoquista'),
  forwardFinance: (u: AuthUser) => is(u, 'admin', 'gestor', 'financeiro'),
  registry: (u: AuthUser) => is(u, 'admin', 'gestor'),
  export: (u: AuthUser) => is(u, 'admin', 'gestor', 'financeiro', 'consulta'),
};
