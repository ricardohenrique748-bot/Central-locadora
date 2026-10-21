/**
 * Regras do módulo de Estoque — usadas pelo servidor (autoridade) e pela interface.
 *
 * Convenções documentadas:
 * - Períodos de reserva/locação usam datas INCLUSIVAS: [início, término]. Duas reservas
 *   conflitam se início_A <= término_B e início_B <= término_A. Quem devolve no dia X
 *   só pode ser reservado a partir de X+1 (e somente após inspeção).
 * - Custo médio ponderado: (saldo × custo médio + entrada × custo unitário) ÷ (saldo + entrada).
 *   Nunca recalcula movimentações antigas.
 * - Desconto e despesas da entrada são rateados proporcionalmente ao valor de cada linha.
 */

import { AuthUser } from '../orcamentos/types';
import { OperationalStatus, RentalStatus } from './types';

// ------------------------------------------------ estado operacional

export type AssetAction = 'enviar_manutencao' | 'retornar_manutencao' | 'marcar_danificado' | 'aprovar_inspecao' | 'enviar_inspecao' | 'baixar';

/** Transições operacionais permitidas (o retorno de locação leva a "aguardando inspeção" automaticamente). */
export const OPERATIONAL_TRANSITIONS: Record<AssetAction, { from: OperationalStatus[]; to: OperationalStatus; label: string; requiresReason: boolean }> = {
  enviar_manutencao: { from: ['novo', 'operacional', 'aguardando_inspecao', 'danificado'], to: 'em_manutencao', label: 'Enviar para manutenção', requiresReason: true },
  retornar_manutencao: { from: ['em_manutencao'], to: 'aguardando_inspecao', label: 'Retorno de manutenção (vai para inspeção)', requiresReason: false },
  marcar_danificado: { from: ['novo', 'operacional', 'aguardando_inspecao', 'em_manutencao'], to: 'danificado', label: 'Marcar como danificado', requiresReason: true },
  enviar_inspecao: { from: ['danificado'], to: 'aguardando_inspecao', label: 'Encaminhar para avaliação/inspeção', requiresReason: true },
  aprovar_inspecao: { from: ['aguardando_inspecao'], to: 'operacional', label: 'Inspeção aprovada — liberar', requiresReason: false },
  baixar: { from: ['novo', 'operacional', 'aguardando_inspecao', 'em_manutencao', 'danificado'], to: 'baixado', label: 'Baixa patrimonial', requiresReason: true },
};

export const RENTABLE_OPERATIONAL: OperationalStatus[] = ['novo', 'operacional'];

/**
 * Situação de locação DERIVADA (não é um campo manual):
 * baixado/indisponível operacional → indisponível; entregue → alugado; em transferência → em trânsito;
 * reserva confirmada cobrindo hoje → reservado; senão disponível.
 */
export function deriveRentalStatus(op: OperationalStatus, flags: { onRent: boolean; inTransit: boolean; reservedToday: boolean }): RentalStatus {
  if (op === 'baixado') return 'indisponivel';
  if (flags.onRent) return 'alugado';
  if (flags.inTransit) return 'em_transito';
  if (!RENTABLE_OPERATIONAL.includes(op)) return 'indisponivel';
  if (flags.reservedToday) return 'reservado';
  return 'disponivel';
}

// ------------------------------------------------ períodos

export function datesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Maior quantidade simultânea dentro de [start, end] considerando as reservas existentes + a nova.
 * Varre os dias em que o uso muda (datas inclusivas).
 */
export function peakUsage(existing: { start_date: string; end_date: string; quantity: number }[], start: string, end: string, extra = 0): number {
  const relevant = existing.filter((r) => datesOverlap(r.start_date, r.end_date, start, end));
  const points = new Set<string>([start]);
  for (const r of relevant) if (r.start_date >= start && r.start_date <= end) points.add(r.start_date);
  let peak = 0;
  for (const day of points) {
    const used = relevant.filter((r) => r.start_date <= day && day <= r.end_date).reduce((a, r) => a + r.quantity, 0);
    peak = Math.max(peak, used + extra);
  }
  return peak;
}

// ------------------------------------------------ custos

export function weightedAverageCost(prevQty: number, prevAvg: number | null, inQty: number, inUnitCost: number): number {
  const base = Math.max(prevQty, 0);
  if (base === 0 || prevAvg === null) return inUnitCost;
  return Math.round((base * prevAvg + inQty * inUnitCost) / (base + inQty));
}

/** Rateia desconto (−) e despesas (+) pelo valor das linhas. Retorna custo unitário alocado por linha (centavos). */
export function apportionEntry(lines: { quantity: number; unit_cost: number }[], discount: number, extra: number): { line_total: number; allocated_total: number; allocated_unit_cost: number }[] {
  const totals = lines.map((l) => Math.round(l.quantity * l.unit_cost));
  const sum = totals.reduce((a, b) => a + b, 0);
  const adj = extra - discount;
  let assigned = 0;
  return totals.map((t, i) => {
    const share = i === totals.length - 1 ? adj - assigned : sum > 0 ? Math.round((adj * t) / sum) : 0;
    assigned += share;
    const allocated = Math.max(0, t + share);
    return { line_total: t, allocated_total: allocated, allocated_unit_cost: lines[i].quantity > 0 ? Math.round(allocated / lines[i].quantity) : 0 };
  });
}

export const round3 = (v: number) => Math.round(v * 1000) / 1000;

// ------------------------------------------------ permissões

/**
 * - Administrador: tudo, inclusive configurações (categorias, unidades, locais).
 * - Gestor: tudo operacional + aprovar inventário, baixa patrimonial, estorno.
 * - Estoquista: cadastra itens, entradas, saídas, transferências, contagens, reservas, entregas, retornos e inspeções.
 * - Vendedor: consulta estoque e disponibilidade, solicita reserva (pendente).
 * - Consulta: somente leitura.
 */
export const stockCan = {
  view: (_u: AuthUser) => true,
  manageItems: (u: AuthUser) => ['admin', 'gestor', 'estoquista'].includes(u.role),
  operate: (u: AuthUser) => ['admin', 'gestor', 'estoquista'].includes(u.role),
  requestReservation: (u: AuthUser) => ['admin', 'gestor', 'estoquista', 'vendedor'].includes(u.role),
  confirmReservation: (u: AuthUser) => ['admin', 'gestor', 'estoquista'].includes(u.role),
  approve: (u: AuthUser) => ['admin', 'gestor'].includes(u.role), // inventário, baixa patrimonial, estorno
  configure: (u: AuthUser) => u.role === 'admin',
  manageSuppliers: (u: AuthUser) => ['admin', 'gestor', 'estoquista'].includes(u.role),
  viewCosts: (u: AuthUser) => u.role !== 'vendedor',
};
