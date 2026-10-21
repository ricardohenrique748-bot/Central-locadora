/**
 * Regras financeiras — usadas pelo servidor (autoridade) e pela interface.
 *
 * Convenções:
 * - Valor atualizado da parcela = original − desconto + juros + multa + acréscimos.
 * - Pendente = atualizado − liquidado. Nunca se paga/recebe acima do pendente.
 * - Parcelamento: divide em centavos; a diferença de arredondamento vai para a ÚLTIMA parcela,
 *   garantindo soma exata.
 * - Saldo oficial da conta = saldo inicial + movimentações efetivadas (um único cálculo).
 * - Projeção: saldo atual + a receber − a pagar com vencimento entre hoje e a data-limite;
 *   valores já vencidos não entram (risco) e são mostrados à parte.
 */

import { AuthUser } from '../orcamentos/types';
import { addDaysISO, daysBetween, isISODate } from '../orcamentos/dates';
import { DisplayStatus, EntryStatus, InstallmentStatus, RecurrenceFrequency } from './types';

export function updatedAmount(i: { original_amount: number; discount: number; interest: number; penalty: number; additional: number }) {
  return i.original_amount - i.discount + i.interest + i.penalty + i.additional;
}

export function installmentStatus(updated: number, settled: number, cancelled = false): InstallmentStatus {
  if (cancelled) return 'cancelado';
  if (settled <= 0) return 'aberto';
  if (settled >= updated) return 'liquidado';
  return 'parcial';
}

export function displayStatus(entryStatus: EntryStatus, inst: InstallmentStatus, dueDate: string, today: string): DisplayStatus {
  if (entryStatus === 'rascunho' || entryStatus === 'aguardando_aprovacao' || entryStatus === 'cancelado') return entryStatus;
  if (inst === 'cancelado' || inst === 'liquidado') return inst;
  if (dueDate < today) return 'vencido';
  return inst;
}

/** Situação do título a partir das parcelas não canceladas. */
export function entryDisplayStatus(entryStatus: EntryStatus, parts: { status: InstallmentStatus; due_date: string }[], today: string): DisplayStatus {
  if (entryStatus !== 'ativo') return entryStatus;
  const live = parts.filter((p) => p.status !== 'cancelado');
  if (!live.length) return 'cancelado';
  if (live.every((p) => p.status === 'liquidado')) return 'liquidado';
  if (live.some((p) => p.status !== 'liquidado' && p.due_date < today)) return 'vencido';
  if (live.some((p) => p.status === 'parcial' || p.status === 'liquidado')) return 'parcial';
  return 'aberto';
}

export function addMonthsISO(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay)); // 31/01 + 1 mês = 28/02 (ou 29)
  return target.toISOString().slice(0, 10);
}

export interface InstallmentPlan {
  total: number;
  count: number;
  first_due: string;
  interval: 'mensal' | 'quinzenal' | 'semanal' | 'dias';
  interval_days?: number;
  /** Vencimentos/valores personalizados (sobrepõem o cálculo). */
  custom?: { due_date: string; amount: number }[];
}

/** Gera parcelas cuja soma é exatamente o total. Lança Error com mensagem amigável. */
export function buildInstallments(p: InstallmentPlan): { number: number; due_date: string; amount: number }[] {
  if (!Number.isInteger(p.total) || p.total <= 0) throw new Error('Informe um valor total maior que zero.');
  if (p.custom?.length) {
    const sum = p.custom.reduce((a, c) => a + c.amount, 0);
    if (p.custom.some((c) => !isISODate(c.due_date))) throw new Error('Há parcela com vencimento inválido.');
    if (p.custom.some((c) => !Number.isInteger(c.amount) || c.amount <= 0)) throw new Error('Toda parcela deve ter valor maior que zero.');
    if (sum !== p.total) throw new Error(`A soma das parcelas (${(sum / 100).toFixed(2)}) difere do total (${(p.total / 100).toFixed(2)}).`);
    return p.custom.map((c, i) => ({ number: i + 1, due_date: c.due_date, amount: c.amount }));
  }
  const n = Math.round(p.count);
  if (!(n >= 1 && n <= 360)) throw new Error('Quantidade de parcelas deve ser entre 1 e 360.');
  if (!isISODate(p.first_due)) throw new Error('Informe o vencimento da primeira parcela.');
  if (Math.floor(p.total / n) < 1) throw new Error('Valor insuficiente para essa quantidade de parcelas.');
  const base = Math.floor(p.total / n);
  return Array.from({ length: n }, (_, i) => {
    const due =
      p.interval === 'mensal' ? addMonthsISO(p.first_due, i) : addDaysISO(p.first_due, i * (p.interval === 'quinzenal' ? 15 : p.interval === 'semanal' ? 7 : Math.max(1, p.interval_days || 30)));
    return { number: i + 1, due_date: due, amount: i === n - 1 ? p.total - base * (n - 1) : base };
  });
}

/** Rateio por centro de custo: soma deve ser exatamente o valor distribuído. */
export function validateCostCenterSplit(total: number, split: { cost_center_id: number; amount: number }[]): string | null {
  if (!split.length) return null;
  const ids = split.map((s) => s.cost_center_id);
  if (new Set(ids).size !== ids.length) return 'Centro de custo repetido no rateio.';
  if (split.some((s) => !Number.isInteger(s.amount) || s.amount <= 0)) return 'Cada parte do rateio deve ter valor maior que zero.';
  const sum = split.reduce((a, s) => a + s.amount, 0);
  if (sum !== total) return `O rateio soma ${(sum / 100).toFixed(2)}, mas o valor do lançamento é ${(total / 100).toFixed(2)}.`;
  return null;
}

/** Datas de ocorrência de uma recorrência a partir de `from` até `until` (inclusive). */
export function recurrenceDates(start: string, freq: RecurrenceFrequency, from: string, until: string, end: string | null): string[] {
  const out: string[] = [];
  for (let i = 0; i < 1000; i++) {
    const d = freq === 'mensal' ? addMonthsISO(start, i) : freq === 'anual' ? addMonthsISO(start, i * 12) : addDaysISO(start, i * 7);
    if (d > until || (end && d > end)) break;
    if (d >= from) out.push(d);
  }
  return out;
}

export const daysOverdue = (due: string, today: string) => Math.max(0, daysBetween(due, today));

// ------------------------------------------------ extratos

export interface ParsedStatementLine {
  transaction_date: string;
  description: string;
  amount: number;
  external_reference: string | null;
}

function parseMoney(raw: string): number | null {
  let s = raw.trim().replace(/[R$\s]/g, '');
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || s.endsWith('-');
  s = s.replace(/[()]/g, '').replace(/-$/, '');
  if (s.includes(',') && s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const v = Math.round(parseFloat(s) * 100);
  return neg ? -Math.abs(v) : v;
}

function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (m) return isISODate(`${m[3]}-${m[2]}-${m[1]}`) ? `${m[3]}-${m[2]}-${m[1]}` : null;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return isISODate(`${m[1]}-${m[2]}-${m[3]}`) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  m = /^(\d{4})(\d{2})(\d{2})/.exec(s); // OFX
  if (m) return isISODate(`${m[1]}-${m[2]}-${m[3]}`) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  return null;
}

/**
 * CSV: colunas data; descrição; valor [; referência] (separador ; ou , ou tab; cabeçalho opcional).
 * Aceita "crédito/débito" em colunas separadas quando houver 4+ colunas com cabeçalho reconhecido.
 */
export function parseStatementCSV(text: string): { lines: ParsedStatementLine[]; errors: string[] } {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/).filter((r) => r.trim());
  if (!rows.length) return { lines: [], errors: ['Arquivo vazio.'] };
  const sep = [';', '\t', ','].find((s) => rows[0].includes(s)) || ';';
  const split = (r: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (const ch of r) {
      if (ch === '"') q = !q;
      else if (ch === sep && !q) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };
  let header = split(rows[0]).map((h) => h.toLowerCase());
  const hasHeader = !parseDate(header[0] || '');
  let idx = { date: 0, desc: 1, amount: 2, ref: 3, credit: -1, debit: -1 };
  if (hasHeader) {
    const find = (...names: string[]) => header.findIndex((h) => names.some((n) => h.includes(n)));
    const d = find('data', 'date');
    const ds = find('hist', 'desc', 'lanç', 'lanc', 'memo');
    const v = find('valor', 'amount', 'value');
    const c = find('crédito', 'credito', 'credit');
    const db = find('débito', 'debito', 'debit');
    const rf = find('doc', 'ref', 'id');
    idx = { date: d >= 0 ? d : 0, desc: ds >= 0 ? ds : 1, amount: v, ref: rf, credit: c, debit: db };
  } else header = [];
  const lines: ParsedStatementLine[] = [];
  const errors: string[] = [];
  rows.slice(hasHeader ? 1 : 0).forEach((r, i) => {
    const cols = split(r);
    const date = parseDate(cols[idx.date] || '');
    let amount: number | null = null;
    if (idx.amount >= 0) amount = parseMoney(cols[idx.amount] || '');
    else if (idx.credit >= 0 || idx.debit >= 0) {
      const c = idx.credit >= 0 ? parseMoney(cols[idx.credit] || '') : null;
      const d = idx.debit >= 0 ? parseMoney(cols[idx.debit] || '') : null;
      amount = c ? Math.abs(c) : d ? -Math.abs(d) : null;
    }
    if (!date || amount === null || amount === 0) {
      errors.push(`Linha ${i + (hasHeader ? 2 : 1)}: data ou valor inválido — ignorada.`);
      return;
    }
    lines.push({ transaction_date: date, description: (cols[idx.desc] || '').slice(0, 200) || 'Sem descrição', amount, external_reference: idx.ref >= 0 ? cols[idx.ref] || null : null });
  });
  return { lines, errors };
}

/** OFX (SGML ou XML): lê blocos STMTTRN com DTPOSTED, TRNAMT, MEMO/NAME e FITID. */
export function parseStatementOFX(text: string): { lines: ParsedStatementLine[]; errors: string[] } {
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const tag = (b: string, t: string) => {
    const m = new RegExp(`<${t}>([^<\\r\\n]*)`, 'i').exec(b);
    return m ? m[1].trim() : '';
  };
  const lines: ParsedStatementLine[] = [];
  const errors: string[] = [];
  blocks.forEach((b, i) => {
    const date = parseDate(tag(b, 'DTPOSTED'));
    const amount = parseMoney(tag(b, 'TRNAMT').replace(',', '.'));
    if (!date || amount === null || amount === 0) {
      errors.push(`Transação ${i + 1}: data ou valor inválido — ignorada.`);
      return;
    }
    lines.push({ transaction_date: date, description: (tag(b, 'MEMO') || tag(b, 'NAME') || 'Sem descrição').slice(0, 200), amount, external_reference: tag(b, 'FITID') || null });
  });
  if (!blocks.length) errors.push('Nenhuma transação OFX encontrada.');
  return { lines, errors };
}

const tokens = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2)
  );

/**
 * Pontua a correspondência extrato × movimentação. Só considera candidatos com MESMO valor e sinal,
 * na mesma conta, até 5 dias de diferença. Valor igual sozinho NÃO basta para conciliar automaticamente.
 */
export function matchScore(st: { transaction_date: string; amount: number; description: string; external_reference: string | null }, tx: { transaction_date: string; amount: number; description: string; transaction_number: string }): number {
  if (st.amount !== tx.amount) return 0;
  const dd = Math.abs(daysBetween(st.transaction_date, tx.transaction_date));
  if (dd > 5) return 0;
  let score = 40 + (5 - dd) * 8; // 40..80 pela data
  const a = tokens(st.description);
  const b = tokens(tx.description);
  const common = [...a].filter((t) => b.has(t)).length;
  if (a.size && b.size) score += Math.round((common / Math.min(a.size, b.size)) * 15);
  if (st.external_reference && (st.external_reference === tx.transaction_number || st.description.includes(tx.transaction_number))) score += 20;
  return Math.min(100, score);
}

// ------------------------------------------------ permissões

/**
 * - Administrador (administrador financeiro): tudo, inclusive contas, categorias, centros de custo, configurações e estornos.
 * - Financeiro: cria contas a pagar/receber, registra pagamentos/recebimentos, transferências, conciliação, caixa.
 * - Gestor: consulta indicadores e relatórios; aprova pagamentos acima da alçada.
 * - Consulta: somente leitura (documentos de terceiros mascarados).
 * - Vendedor e Estoquista: sem acesso ao Financeiro.
 */
export const financeCan = {
  view: (u: AuthUser) => ['admin', 'financeiro', 'gestor', 'consulta'].includes(u.role),
  operate: (u: AuthUser) => ['admin', 'financeiro'].includes(u.role),
  approve: (u: AuthUser) => ['admin', 'gestor'].includes(u.role),
  reverse: (u: AuthUser) => u.role === 'admin',
  configure: (u: AuthUser) => u.role === 'admin',
  seeDocuments: (u: AuthUser) => u.role !== 'consulta',
};
