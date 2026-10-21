/**
 * Cálculo do orçamento — mesma função na interface e no servidor (o servidor sempre recalcula).
 *
 * Regra de descontos (sem descontar o mesmo valor duas vezes):
 * 1. Bruto do item = valor unitário × quantidade × períodos (períodos = 1 na venda).
 * 2. Desconto do item (percentual ou fixo) incide sobre o bruto do item → total do item.
 * 3. Subtotal = soma dos totais dos itens (já com desconto individual).
 * 4. Desconto geral (percentual ou fixo) incide UMA vez sobre o subtotal.
 * 5. Total = subtotal − desconto geral + acréscimos + fretes + montagem + outros serviços.
 * 6. Caução é informada à parte e NUNCA entra no total.
 *
 * Desconto efetivo (para alçada de aprovação) = (redução de preço frente ao catálogo
 * + descontos dos itens + desconto geral) ÷ valor de referência (catálogo) dos itens.
 */

import { BillingPeriod, CatalogItem, QuotationInput, QuotationItemInput, QuotationTotals, RentalPolicy } from './types';

/** Preço de catálogo correspondente à modalidade/período (null = não cadastrado). */
export function catalogPrice(
  item: Pick<CatalogItem, 'sale_price' | 'daily_rental_price' | 'weekly_rental_price' | 'monthly_rental_price' | 'custom_rental_price'>,
  type: 'venda' | 'locacao',
  billing: BillingPeriod | null
): number | null {
  if (type === 'venda') return item.sale_price;
  switch (billing) {
    case 'diaria':
      return item.daily_rental_price;
    case 'semanal':
      return item.weekly_rental_price;
    case 'mensal':
      return item.monthly_rental_price;
    case 'personalizado':
      return item.custom_rental_price;
    default:
      return null;
  }
}
import { computePeriods, computeRentalDays, PeriodResult } from './rental';
import { round2, toHundredths, toMilli } from './money';

export interface ComputedItem extends QuotationItemInput {
  position: number;
  periods: number;
  period_memo: string | null;
  period_rounded: boolean;
  gross_total: number;
  discount_amount: number;
  line_total: number;
  reference_total: number;
}

export interface CalcIssue {
  field: string;
  message: string;
}

export interface CalcResult {
  items: ComputedItem[];
  totals: QuotationTotals;
  rental_days: number | null;
  issues: CalcIssue[];
}

/** valor (centavos) × quantidade × períodos, em aritmética inteira. */
function multiply(unitCents: number, quantity: number, periods: number): number {
  return Math.round((unitCents * toMilli(quantity) * toHundredths(periods)) / 100_000);
}

export function applyDiscount(base: number, type: 'percent' | 'fixed', value: number): number {
  if (!value || value <= 0 || base <= 0) return 0;
  if (type === 'percent') return Math.round((base * toHundredths(value)) / 10_000);
  return Math.round(value);
}

export function calculateQuotation(input: QuotationInput, policy: RentalPolicy): CalcResult {
  const issues: CalcIssue[] = [];
  const isRental = input.quotation_type === 'locacao';

  let rentalDays: number | null = null;
  if (isRental) {
    const r = computeRentalDays(input.start_date, input.end_date, policy);
    rentalDays = r.days;
    if (r.error) issues.push({ field: 'end_date', message: r.error });
  }

  const periodCache = new Map<BillingPeriod, PeriodResult>();
  const periodsFor = (billing: BillingPeriod): PeriodResult => {
    if (!periodCache.has(billing)) {
      periodCache.set(
        billing,
        rentalDays === null
          ? { periods: 0, rounded: false, memo: 'Período não definido' }
          : computePeriods(rentalDays, billing, policy, input.custom_periods, input.custom_period_label)
      );
    }
    return periodCache.get(billing)!;
  };

  if (isRental && !input.rental_billing_period) {
    issues.push({ field: 'rental_billing_period', message: 'Selecione a modalidade de cobrança.' });
  }

  const items: ComputedItem[] = input.items.map((item, index) => {
    const label = `Item ${index + 1}`;
    let periods = 1;
    let memo: string | null = null;
    let rounded = false;
    let billing: BillingPeriod | null = null;

    if (isRental) {
      billing = item.billing_period || input.rental_billing_period;
      if (billing) {
        const p = periodsFor(billing);
        periods = p.periods;
        memo = p.memo;
        rounded = p.rounded;
        if (billing === 'personalizado' && p.periods <= 0) {
          issues.push({ field: 'custom_periods', message: 'Informe a quantidade de períodos personalizados.' });
        }
      } else {
        periods = 0;
      }
    }

    if (!(item.quantity > 0)) issues.push({ field: `items.${index}.quantity`, message: `${label}: quantidade deve ser maior que zero.` });
    if (Math.abs(item.quantity * 1000 - toMilli(item.quantity)) > 1e-6) {
      issues.push({ field: `items.${index}.quantity`, message: `${label}: use no máximo 3 casas decimais na quantidade.` });
    }
    if (!Number.isInteger(item.unit_price) || item.unit_price < 0) {
      issues.push({ field: `items.${index}.unit_price`, message: `${label}: valor unitário inválido.` });
    }
    if (!item.description_snapshot?.trim()) {
      issues.push({ field: `items.${index}.description_snapshot`, message: `${label}: descrição obrigatória.` });
    }

    const qty = Math.max(0, item.quantity || 0);
    const unit = Math.max(0, item.unit_price || 0);
    const gross = multiply(unit, qty, periods);
    const refUnit = item.reference_price !== null && item.reference_price !== undefined ? item.reference_price : unit;
    const reference = multiply(Math.max(refUnit, unit), qty, periods);

    if (item.discount_value < 0) issues.push({ field: `items.${index}.discount_value`, message: `${label}: desconto não pode ser negativo.` });
    if (item.discount_type === 'percent' && item.discount_value > 100) {
      issues.push({ field: `items.${index}.discount_value`, message: `${label}: desconto acima de 100%.` });
    }
    let discount = applyDiscount(gross, item.discount_type, item.discount_value);
    if (discount > gross) {
      issues.push({ field: `items.${index}.discount_value`, message: `${label}: desconto maior que o valor do item.` });
      discount = gross;
    }

    return {
      ...item,
      billing_period: billing,
      position: index + 1,
      periods,
      period_memo: memo,
      period_rounded: rounded,
      gross_total: gross,
      discount_amount: discount,
      line_total: gross - discount,
      reference_total: reference,
    };
  });

  const sum = (fn: (i: ComputedItem) => number) => items.reduce((acc, i) => acc + fn(i), 0);
  const itemsGross = sum((i) => i.gross_total);
  const itemDiscountTotal = sum((i) => i.discount_amount);
  const referenceTotal = sum((i) => i.reference_total);
  const priceReduction = referenceTotal - itemsGross;
  const subtotal = itemsGross - itemDiscountTotal;

  for (const [field, label] of [
    ['additional_charges', 'Acréscimos'],
    ['freight_amount', 'Frete'],
    ['pickup_freight_amount', 'Frete de retirada'],
    ['installation_amount', 'Montagem/instalação'],
    ['other_services_amount', 'Outros serviços'],
    ['deposit_amount', 'Caução'],
  ] as const) {
    const v = input[field];
    if (!Number.isInteger(v) || v < 0) issues.push({ field, message: `${label}: valor inválido.` });
  }

  if (input.general_discount_value < 0) issues.push({ field: 'general_discount_value', message: 'Desconto geral não pode ser negativo.' });
  if (input.general_discount_type === 'percent' && input.general_discount_value > 100) {
    issues.push({ field: 'general_discount_value', message: 'Desconto geral acima de 100%.' });
  }
  let generalDiscount = applyDiscount(subtotal, input.general_discount_type, input.general_discount_value);
  if (generalDiscount > subtotal) {
    issues.push({ field: 'general_discount_value', message: 'Desconto geral maior que o subtotal.' });
    generalDiscount = subtotal;
  }

  const pos = (v: number) => (Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  const additional = pos(input.additional_charges);
  const freight = pos(input.freight_amount);
  const pickup = isRental ? pos(input.pickup_freight_amount) : 0;
  const installation = pos(input.installation_amount);
  const otherServices = pos(input.other_services_amount);
  const deposit = isRental ? pos(input.deposit_amount) : 0;

  const totalDiscount = priceReduction + itemDiscountTotal + generalDiscount;

  return {
    items,
    rental_days: rentalDays,
    issues,
    totals: {
      reference_total: referenceTotal,
      items_gross_total: itemsGross,
      item_discount_total: itemDiscountTotal,
      price_reduction_total: priceReduction,
      subtotal,
      general_discount: generalDiscount,
      additional_charges: additional,
      freight_amount: freight,
      pickup_freight_amount: pickup,
      installation_amount: installation,
      other_services_amount: otherServices,
      total_amount: subtotal - generalDiscount + additional + freight + pickup + installation + otherServices,
      deposit_amount: deposit,
      effective_discount_percent: referenceTotal > 0 ? round2((totalDiscount / referenceTotal) * 100) : 0,
    },
  };
}
