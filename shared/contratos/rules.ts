/**
 * Regras puras dos contratos: totais, cronograma de cobranças e permissões.
 *
 * Período de locação: o término é o dia da devolução e não é cobrado (mesma regra "exclusiva" dos orçamentos:
 * retira 01, devolve 02 = 1 diária). Cada período vai de period_start a period_end (inclusivo).
 */

import { AuthUser } from '../orcamentos/types';
import { addDaysISO, daysBetween } from '../orcamentos/dates';
import { addMonthsISO } from '../financeiro/rules';
import { BillingFrequency, BillingTiming, ContractTotals, ContractType, ItemModality, ScheduleLine } from './types';

// ------------------------------------------------ totais

export interface TotalsItem {
  quantity: number;
  unit_price: number;
  discount_amount: number;
  modality: ItemModality;
}

export const lineTotal = (i: Pick<TotalsItem, 'quantity' | 'unit_price' | 'discount_amount'>) => Math.round(i.quantity * i.unit_price) - (i.discount_amount || 0);

export interface TermsForTotals {
  contract_type: ContractType;
  start_date: string;
  end_date: string | null;
  billing_frequency: BillingFrequency;
  custom_period_days: number | null;
  billing_timing: BillingTiming;
  due_day: number | null;
  due_days_after: number;
  proportional_last: boolean;
  /** locação com término: soma dos períodos cobrada de uma vez, no início */
  single_charge?: boolean;
  general_discount: number;
  freight_delivery: number;
  freight_pickup: number;
  other_fees: number;
  other_fees_description?: string | null;
  installments_count: number;
  first_due_date: string | null;
}

/** Período seguinte (sem acumular erro de fim de mês: sempre calculado a partir do início). */
export function periodStart(start: string, freq: BillingFrequency, index: number, customDays: number | null): string {
  switch (freq) {
    case 'diaria':
      return addDaysISO(start, index);
    case 'semanal':
      return addDaysISO(start, index * 7);
    case 'quinzenal':
      return addDaysISO(start, index * 15);
    case 'mensal':
      return addMonthsISO(start, index);
    case 'personalizado':
      return addDaysISO(start, index * Math.max(1, customDays || 1));
    default:
      return start;
  }
}

/** Receita mensal equivalente de um valor por período (para indicadores de carteira). */
export function monthlyEquivalent(amount: number, freq: BillingFrequency, customDays: number | null): number {
  const factor: Record<BillingFrequency, number> = { diaria: 30, semanal: 30 / 7, quinzenal: 2, mensal: 1, personalizado: 30 / Math.max(1, customDays || 30), unico: 0 };
  return Math.round(amount * factor[freq]);
}

export function computeTotals(items: TotalsItem[], t: TermsForTotals): ContractTotals {
  const rental = items.filter((i) => i.modality === 'locacao');
  const sale = items.filter((i) => i.modality === 'venda');
  const rental_subtotal = rental.reduce((a, i) => a + lineTotal(i), 0);
  const sale_subtotal = sale.reduce((a, i) => a + lineTotal(i), 0);
  const isRental = t.contract_type === 'locacao';
  const period_amount = isRental ? Math.max(0, rental_subtotal - t.general_discount) : 0;
  const sale_total = isRental ? sale_subtotal : Math.max(0, sale_subtotal - t.general_discount);
  const one_time_total = t.freight_delivery + t.freight_pickup + t.other_fees;
  let estimated_total: number | null = null;
  if (!isRental || t.billing_frequency === 'unico') estimated_total = (isRental ? period_amount : 0) + sale_total + one_time_total;
  else if (t.end_date) {
    estimated_total = buildSchedule({ ...t, period_amount, sale_total }).reduce((a, l) => a + l.amount, 0);
  }
  return {
    rental_subtotal,
    period_amount,
    sale_subtotal,
    sale_total,
    one_time_total,
    estimated_total,
    monthly_equivalent: isRental ? monthlyEquivalent(period_amount, t.billing_frequency, t.custom_period_days) : 0,
  };
}

// ------------------------------------------------ cronograma

export interface ScheduleInput extends TermsForTotals {
  period_amount: number;
  sale_total: number;
  /** Prazo indeterminado: gera períodos que começam até esta data. */
  horizon_end?: string;
}

function dueFrom(base: string, dueDay: number | null, daysAfter: number): string {
  if (dueDay) {
    const [y, m] = base.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let d = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(dueDay, last)).padStart(2, '0')}`;
    if (d < base) {
      const n = addMonthsISO(`${y}-${String(m).padStart(2, '0')}-01`, 1);
      const [ny, nm] = n.split('-').map(Number);
      const nlast = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
      d = `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(dueDay, nlast)).padStart(2, '0')}`;
    }
    return d;
  }
  return addDaysISO(base, daysAfter);
}

/**
 * Cronograma previsto de cobranças (não grava nada). Locação: um lançamento por período, último proporcional
 * se configurado; fretes/taxas e itens vendidos junto com a primeira cobrança. Venda: parcelas.
 */
export function buildSchedule(s: ScheduleInput): ScheduleLine[] {
  const out: ScheduleLine[] = [];
  const firstDue = s.contract_type === 'venda' ? s.first_due_date || addDaysISO(s.start_date, s.due_days_after) : dueFrom(s.start_date, s.due_day, s.due_days_after);

  if (s.contract_type === 'venda') {
    const n = Math.max(1, Math.min(60, Math.round(s.installments_count || 1)));
    const base = Math.floor(s.sale_total / n);
    for (let i = 0; i < n; i++) {
      const amount = i === n - 1 ? s.sale_total - base * (n - 1) : base;
      if (amount <= 0) continue;
      const due = addMonthsISO(firstDue, i);
      out.push({ kind: n === 1 ? 'unico' : 'parcela', description: n === 1 ? 'Venda — pagamento único' : `Venda — parcela ${i + 1}/${n}`, period_start: s.start_date, period_end: s.start_date, due_date: due, amount });
    }
  } else if (s.billing_frequency === 'unico') {
    const last = s.end_date ? addDaysISO(s.end_date, -1) : s.start_date;
    if (s.period_amount > 0) out.push({ kind: 'unico', description: 'Locação — valor único', period_start: s.start_date, period_end: last < s.start_date ? s.start_date : last, due_date: firstDue, amount: s.period_amount });
  } else if (s.period_amount > 0) {
    const limit = s.end_date || s.horizon_end;
    if (limit) {
      for (let i = 0; i < 1000; i++) {
        const ps = periodStart(s.start_date, s.billing_frequency, i, s.custom_period_days);
        if (s.end_date ? ps >= s.end_date : ps > limit) break;
        const fullEnd = periodStart(s.start_date, s.billing_frequency, i + 1, s.custom_period_days); // exclusivo
        const pe = s.end_date && s.end_date < fullEnd ? s.end_date : fullEnd;
        const partial = pe < fullEnd;
        const amount = partial && s.proportional_last ? Math.round((s.period_amount * daysBetween(ps, pe)) / daysBetween(ps, fullEnd)) : s.period_amount;
        const base = s.billing_timing === 'antecipado' ? ps : pe;
        out.push({
          kind: 'periodo',
          description: `Locação ${ps.split('-').reverse().join('/')} a ${addDaysISO(pe, -1).split('-').reverse().join('/')}${partial && s.proportional_last ? ' (proporcional)' : ''}`,
          period_start: ps,
          period_end: addDaysISO(pe, -1),
          due_date: dueFrom(base, s.due_day, s.due_days_after),
          amount,
          proportional: partial && s.proportional_last,
        });
      }
    }
  }
  if (s.contract_type === 'locacao' && s.single_charge && s.end_date && out.length > 1) {
    const total = out.reduce((a, l) => a + l.amount, 0);
    const [first, last] = [out[0], out[out.length - 1]];
    out.splice(0, out.length, {
      kind: 'unico',
      description: `Locação ${first.period_start.split('-').reverse().join('/')} a ${last.period_end.split('-').reverse().join('/')} — valor total`,
      period_start: first.period_start,
      period_end: last.period_end,
      due_date: dueFrom(first.period_start, s.due_day, s.due_days_after),
      amount: total,
    });
  }
  const firstDueAll = out[0]?.due_date || firstDue;
  if (s.contract_type === 'locacao' && s.sale_total > 0) out.push({ kind: 'venda_item', description: 'Itens vendidos no contrato', period_start: s.start_date, period_end: s.start_date, due_date: firstDueAll, amount: s.sale_total });
  if (s.freight_delivery > 0) out.push({ kind: 'frete', description: 'Frete de entrega', period_start: s.start_date, period_end: s.start_date, due_date: firstDueAll, amount: s.freight_delivery });
  if (s.freight_pickup > 0) out.push({ kind: 'frete', description: 'Frete de retirada', period_start: s.end_date || s.start_date, period_end: s.end_date || s.start_date, due_date: firstDueAll, amount: s.freight_pickup });
  if (s.other_fees > 0) out.push({ kind: 'taxa', description: s.other_fees_description || 'Taxas adicionais', period_start: s.start_date, period_end: s.start_date, due_date: firstDueAll, amount: s.other_fees });
  return out;
}

export interface MeasureMove {
  date: string; // AAAA-MM-DD
  qty: number; // positivo = entrega, negativo = devolução
}

/**
 * Medição de um item num período (início e fim inclusivos): soma, dia a dia, a quantidade em poder do cliente.
 * O dia da entrega conta; o dia da devolução não (mesma regra do término do contrato).
 */
export function measurePeriod(periodStart: string, periodEnd: string, moves: MeasureMove[]) {
  const sorted = [...moves].sort((a, b) => a.date.localeCompare(b.date));
  let onSite = sorted.filter((m) => m.date < periodStart).reduce((a, m) => a + m.qty, 0);
  let i = sorted.findIndex((m) => m.date >= periodStart);
  if (i < 0) i = sorted.length;
  let unitDays = 0;
  let days = 0;
  let maxQty = 0;
  for (let d = periodStart; d <= periodEnd; d = addDaysISO(d, 1)) {
    while (i < sorted.length && sorted[i].date === d) onSite += sorted[i++].qty;
    const q = Math.max(0, onSite);
    if (q > 0) days++;
    unitDays += q;
    maxQty = Math.max(maxQty, q);
  }
  const inPeriod = sorted.filter((m) => m.date >= periodStart && m.date <= periodEnd);
  return {
    period_days: daysBetween(periodStart, addDaysISO(periodEnd, 1)),
    days_in_use: days,
    unit_days: Math.round(unitDays * 1000) / 1000,
    max_qty: maxQty,
    delivered: inPeriod.filter((m) => m.qty > 0).reduce((a, m) => a + m.qty, 0),
    returned: -inPeriod.filter((m) => m.qty < 0).reduce((a, m) => a + m.qty, 0),
  };
}

/** Chave de idempotência de uma linha do cronograma: o mesmo período nunca é cobrado duas vezes. */
export const scheduleKey = (l: Pick<ScheduleLine, 'kind' | 'period_start' | 'description'>) => (l.kind === 'periodo' ? `periodo:${l.period_start}` : `${l.kind}:${l.description}`);

/** Data de reserva do equipamento: prazo indeterminado bloqueia até a devolução. */
export const OPEN_END = '2099-12-31';
export const reservationEnd = (endDate: string | null) => endDate || OPEN_END;

// ------------------------------------------------ permissões (aplicadas no servidor)

const is = (u: AuthUser, ...roles: AuthUser['role'][]) => roles.includes(u.role);

export const contractCan = {
  view: (u: AuthUser) => is(u, 'admin', 'gestor', 'vendedor', 'estoquista', 'financeiro', 'consulta'),
  create: (u: AuthUser) => is(u, 'admin', 'gestor', 'vendedor'),
  /** Vendedor edita apenas contratos sob sua responsabilidade. */
  edit: (u: AuthUser, c?: { responsible_user_id: number }) => is(u, 'admin', 'gestor') || (u.role === 'vendedor' && (!c || c.responsible_user_id === u.id)),
  approve: (u: AuthUser) => is(u, 'admin', 'gestor'),
  sign: (u: AuthUser) => is(u, 'admin', 'gestor'),
  activate: (u: AuthUser) => is(u, 'admin', 'gestor'),
  renew: (u: AuthUser) => is(u, 'admin', 'gestor'),
  operate: (u: AuthUser) => is(u, 'admin', 'gestor', 'estoquista'), // reserva, entrega, devolução
  close: (u: AuthUser) => is(u, 'admin', 'gestor'),
  cancel: (u: AuthUser) => is(u, 'admin', 'gestor'),
  viewValues: (u: AuthUser) => !is(u, 'estoquista'),
  viewFinance: (u: AuthUser) => is(u, 'admin', 'gestor', 'financeiro', 'vendedor', 'consulta'),
  charges: (u: AuthUser) => is(u, 'admin', 'gestor', 'financeiro'),
  documents: (u: AuthUser) => is(u, 'admin', 'gestor', 'vendedor'),
  export: (u: AuthUser) => is(u, 'admin', 'gestor', 'financeiro', 'consulta'),
  configure: (u: AuthUser) => is(u, 'admin'),
};
