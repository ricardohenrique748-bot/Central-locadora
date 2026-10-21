/**
 * Cálculo do período de locação.
 *
 * Regra:
 * - Dias: modo "exclusive" (padrão) conta fim − início (retira 01, devolve 02 = 1 diária);
 *   modo "inclusive" conta também o dia final (01 → 02 = 2 diárias).
 * - Diária: períodos = dias.
 * - Semanal: dias ÷ 7. Mensal: dias ÷ dias do mês comercial (padrão 30).
 *   Com cobrança proporcional, fraciona com 2 casas (10 dias = 1,43 semana).
 *   Sem proporcional, arredonda PARA CIMA e sinaliza o arredondamento na memória de cálculo.
 * - Personalizado: o usuário informa o nº de períodos (ex.: 2 quinzenas).
 */

import { BillingPeriod, RentalPolicy, BILLING_PERIOD_LABELS } from './types';
import { daysBetween, isISODate } from './dates';
import { round2 } from './money';

export interface RentalDaysResult {
  days: number | null;
  error: string | null;
}

export function computeRentalDays(start: string | null, end: string | null, policy: RentalPolicy): RentalDaysResult {
  if (!start || !end) return { days: null, error: 'Informe as datas previstas de início e término.' };
  if (!isISODate(start) || !isISODate(end)) return { days: null, error: 'Datas de locação inválidas.' };
  const diff = daysBetween(start, end);
  if (policy.day_count_mode === 'exclusive') {
    if (diff <= 0) return { days: null, error: 'A data de término deve ser posterior à data de início.' };
    return { days: diff, error: null };
  }
  if (diff < 0) return { days: null, error: 'A data de término não pode ser anterior à data de início.' };
  return { days: diff + 1, error: null };
}

export interface PeriodResult {
  periods: number;
  rounded: boolean;
  memo: string;
}

const UNIT_NAMES: Record<Exclude<BillingPeriod, 'personalizado'>, [string, string]> = {
  diaria: ['diária', 'diárias'],
  semanal: ['semana', 'semanas'],
  mensal: ['mês', 'meses'],
};

function plural(n: number, [one, many]: [string, string]) {
  return `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${n === 1 ? one : many}`;
}

export function computePeriods(
  days: number,
  billing: BillingPeriod,
  policy: RentalPolicy,
  customPeriods: number | null,
  customLabel: string | null
): PeriodResult {
  if (billing === 'personalizado') {
    const n = customPeriods && customPeriods > 0 ? round2(customPeriods) : 0;
    const label = customLabel?.trim() || 'período(s)';
    return { periods: n, rounded: false, memo: `${n.toLocaleString('pt-BR')} × ${label} (informado manualmente)` };
  }
  if (billing === 'diaria') {
    return { periods: days, rounded: false, memo: `${days} dia(s) = ${plural(days, UNIT_NAMES.diaria)}` };
  }
  const divisor = billing === 'semanal' ? 7 : policy.days_per_month;
  const raw = days / divisor;
  const names = UNIT_NAMES[billing];
  if (policy.proportional) {
    const periods = round2(raw);
    return {
      periods,
      rounded: false,
      memo: `${days} dia(s) ÷ ${divisor} = ${plural(periods, names)} (proporcional)`,
    };
  }
  const periods = Math.ceil(raw - 1e-9);
  const rounded = Math.abs(periods - raw) > 1e-9;
  return {
    periods,
    rounded,
    memo: rounded
      ? `${days} dia(s) ÷ ${divisor} = ${round2(raw).toLocaleString('pt-BR')} → cobrado ${plural(periods, names)} (período fechado, arredondado para cima)`
      : `${days} dia(s) ÷ ${divisor} = ${plural(periods, names)}`,
  };
}

export function billingPeriodLabel(billing: BillingPeriod | null, customLabel?: string | null): string {
  if (!billing) return '—';
  if (billing === 'personalizado' && customLabel) return customLabel;
  return BILLING_PERIOD_LABELS[billing];
}
