/**
 * Datas de negócio no formato YYYY-MM-DD, tratadas em UTC para não sofrer com fuso/horário de verão.
 */

const DAY_MS = 86_400_000;

export function isISODate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(start + 'T00:00:00Z')) / DAY_MS);
}

export function addDaysISO(date: string, days: number): string {
  return new Date(Date.parse(date + 'T00:00:00Z') + days * DAY_MS).toISOString().slice(0, 10);
}

/** Data de hoje no fuso de São Paulo (operação da locadora). */
export function todayISO(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
}

export function formatDateBR(value: string | null | undefined): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateTimeBR(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value.includes('T') || value.endsWith('Z') ? value : value.replace(' ', 'T') + 'Z');
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
}
