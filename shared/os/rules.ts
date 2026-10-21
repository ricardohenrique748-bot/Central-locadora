/**
 * Regras puras das Ordens de Serviço: transições, regras por tipo, permissões e preventivas.
 */

import { AuthUser } from '../orcamentos/types';
import { addDaysISO } from '../orcamentos/dates';
import { BASE_ORDER_TYPES, OrderStatus, OrderTypeRule } from './types';

const WAITING: OrderStatus[] = ['aguardando_avaliacao', 'aguardando_aprovacao', 'aguardando_pecas', 'aguardando_fornecedor'];

/** Transições permitidas (status → próximos). Conclusão só a partir de "em testes". */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  aberta: [...WAITING, 'programada', 'em_execucao', 'cancelada'],
  aguardando_avaliacao: ['aguardando_aprovacao', 'aguardando_pecas', 'aguardando_fornecedor', 'programada', 'em_execucao', 'cancelada'],
  aguardando_aprovacao: ['aguardando_avaliacao', 'aguardando_pecas', 'aguardando_fornecedor', 'programada', 'em_execucao', 'cancelada'],
  aguardando_pecas: ['aguardando_aprovacao', 'aguardando_fornecedor', 'programada', 'em_execucao', 'cancelada'],
  aguardando_fornecedor: ['aguardando_aprovacao', 'aguardando_pecas', 'programada', 'em_execucao', 'em_testes', 'cancelada'],
  programada: ['aguardando_aprovacao', 'aguardando_pecas', 'aguardando_fornecedor', 'em_execucao', 'cancelada'],
  em_execucao: ['aguardando_aprovacao', 'aguardando_pecas', 'aguardando_fornecedor', 'em_testes', 'cancelada'],
  em_testes: ['em_execucao', 'aguardando_pecas', 'aguardando_fornecedor', 'concluida', 'cancelada'],
  concluida: [],
  cancelada: [],
};

/** Em qual "balde" de tempo cada status conta (separa espera de execução). */
export const TIME_BUCKET: Record<OrderStatus, 'waiting_evaluation' | 'waiting_approval' | 'waiting_parts' | 'waiting_supplier' | 'execution' | 'testing' | null> = {
  aberta: 'waiting_evaluation',
  aguardando_avaliacao: 'waiting_evaluation',
  programada: 'waiting_evaluation',
  aguardando_aprovacao: 'waiting_approval',
  aguardando_pecas: 'waiting_parts',
  aguardando_fornecedor: 'waiting_supplier',
  em_execucao: 'execution',
  em_testes: 'testing',
  concluida: null,
  cancelada: null,
};

/** Regras de conclusão por tipo (os tipos extras vêm das configurações). */
export const BASE_TYPE_RULES: OrderTypeRule[] = Object.entries(BASE_ORDER_TYPES).map(([key, label]) => ({
  key,
  label,
  requires_diagnosis: ['corretiva', 'avaria', 'garantia', 'terceirizado', 'inspecao'].includes(key),
  requires_checklist: ['preventiva', 'inspecao', 'revisao'].includes(key),
}));

export function typeRules(custom: OrderTypeRule[] = []): OrderTypeRule[] {
  return [...BASE_TYPE_RULES, ...custom.filter((c) => !BASE_ORDER_TYPES[c.key])];
}

export const minutesBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000));

/** Custo de mão de obra: valor/hora × minutos, arredondado ao centavo. */
export const laborCost = (hourlyRate: number, minutes: number) => Math.round((hourlyRate * minutes) / 60);

/** Próxima preventiva após uma execução, por data e/ou por medidor (horímetro/ciclos). */
export function nextPreventive(plan: { interval_days: number | null; interval_hours: number | null; interval_cycles: number | null }, doneDate: string, meter: number | null) {
  return {
    next_due_date: plan.interval_days ? addDaysISO(doneDate, plan.interval_days) : null,
    next_due_meter: meter !== null && (plan.interval_hours || plan.interval_cycles) ? meter + (plan.interval_hours || plan.interval_cycles || 0) : null,
  };
}

/** A preventiva vence por data (com antecedência) ou por medidor, o que vier primeiro. */
export function preventiveDue(s: { next_due_date: string | null; next_due_meter: number | null }, today: string, leadDays: number, currentMeter: number | null) {
  const byDate = !!s.next_due_date && s.next_due_date <= addDaysISO(today, leadDays);
  const byMeter = s.next_due_meter !== null && currentMeter !== null && currentMeter >= s.next_due_meter;
  return { due: byDate || byMeter, key: byMeter && !byDate ? `m${s.next_due_meter}` : s.next_due_date || `m${s.next_due_meter}` };
}

// ------------------------------------------------ permissões (aplicadas no servidor)

const is = (u: AuthUser, ...r: AuthUser['role'][]) => r.includes(u.role);

export const osCan = {
  view: (_u: AuthUser) => true,
  open: (u: AuthUser) => is(u, 'admin', 'gestor', 'tecnico', 'estoquista', 'vendedor'),
  edit: (u: AuthUser) => is(u, 'admin', 'gestor', 'tecnico'),
  approve: (u: AuthUser) => is(u, 'admin', 'gestor'),
  schedule: (u: AuthUser) => is(u, 'admin', 'gestor', 'tecnico'),
  materials: (u: AuthUser) => is(u, 'admin', 'gestor', 'tecnico', 'estoquista'),
  labor: (u: AuthUser) => is(u, 'admin', 'gestor', 'tecnico'),
  forwardFinance: (u: AuthUser) => is(u, 'admin', 'gestor', 'financeiro'),
  conclude: (u: AuthUser) => is(u, 'admin', 'gestor', 'tecnico'),
  cancel: (u: AuthUser) => is(u, 'admin', 'gestor'),
  plans: (u: AuthUser) => is(u, 'admin', 'gestor'),
  viewCosts: (u: AuthUser) => !is(u, 'vendedor'),
  export: (u: AuthUser) => is(u, 'admin', 'gestor', 'financeiro', 'consulta'),
  configure: (u: AuthUser) => is(u, 'admin'),
};
