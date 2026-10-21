/**
 * Valores monetários em centavos inteiros: evita erros de ponto flutuante
 * e garante o mesmo resultado na interface, no servidor e no banco.
 */

export function roundCents(value: number): number {
  return Math.round(value);
}

/** Quantidade com até 3 casas → inteiro em milésimos. */
export const toMilli = (value: number) => Math.round(value * 1000);
/** Percentual/períodos com até 2 casas → inteiro em centésimos (percentual vira pontos-base). */
export const toHundredths = (value: number) => Math.round(value * 100);

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatBRL(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Converte "1.234,56", "1234.56" ou "1234" em centavos. Retorna null se inválido. */
export function parseBRL(input: string): number | null {
  const text = input.replace(/[R$\s]/g, '').trim();
  if (text === '') return null;
  let normalized = text;
  if (text.includes(',')) {
    normalized = text.replace(/\./g, '').replace(',', '.');
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return roundCents(parseFloat(normalized) * 100);
}

/** Centavos → texto de input "1234,56". */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

export function formatNumber(value: number, maxDecimals = 3): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: maxDecimals });
}
