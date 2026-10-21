/**
 * Componentes compartilhados do Financeiro.
 */

import React from 'react';
import { DISPLAY_LABELS, DisplayStatus, EntryType, FinancialCategory, STATEMENT_LABELS, StatementStatus, TRANSFER_LABELS, TransferStatus } from '../../../shared/financeiro/types';
import { formatBRL } from '../../../shared/orcamentos/money';
import { Select, cx } from '../orcamentos/ui';
import { useFin } from './context';

const pill = 'inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap';
const ST: Record<DisplayStatus, string> = {
  rascunho: 'bg-slate-100 text-slate-700 border-slate-200',
  aguardando_aprovacao: 'bg-amber-50 text-amber-800 border-amber-200',
  aberto: 'bg-sky-50 text-sky-800 border-sky-200',
  parcial: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  liquidado: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  vencido: 'bg-red-50 text-red-700 border-red-200',
  cancelado: 'bg-slate-100 text-slate-500 border-slate-200 line-through',
};
export const StatusPill: React.FC<{ s: DisplayStatus; type: EntryType }> = ({ s, type }) => <span className={cx(pill, ST[s])}>{DISPLAY_LABELS[type][s]}</span>;

const TR: Record<TransferStatus, string> = {
  pendente: 'bg-amber-50 text-amber-800 border-amber-200',
  efetivada: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  estornada: 'bg-slate-100 text-slate-500 border-slate-200 line-through',
  cancelada: 'bg-slate-100 text-slate-500 border-slate-200 line-through',
};
export const TransferPill: React.FC<{ s: TransferStatus }> = ({ s }) => <span className={cx(pill, TR[s])}>{TRANSFER_LABELS[s]}</span>;

const SI: Record<StatementStatus, string> = {
  pendente: 'bg-amber-50 text-amber-800 border-amber-200',
  conciliado: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  divergente: 'bg-red-50 text-red-700 border-red-200',
  ignorado: 'bg-slate-100 text-slate-500 border-slate-200',
  duplicado: 'bg-violet-50 text-violet-800 border-violet-200',
};
export const StatementPill: React.FC<{ s: StatementStatus }> = ({ s }) => <span className={cx(pill, SI[s])}>{STATEMENT_LABELS[s]}</span>;

/** Valor com cor: positivo (verde) / negativo (vermelho). */
export const Amount: React.FC<{ v: number | null | undefined; sign?: boolean; className?: string }> = ({ v, sign, className }) => (
  <span className={cx('tabular-nums', v != null && v < 0 ? 'text-red-700' : v != null && v > 0 && sign ? 'text-emerald-700' : 'text-slate-900', className)}>
    {v == null ? '—' : `${sign && v > 0 ? '+' : ''}${v < 0 ? '−' : ''}${formatBRL(Math.abs(v))}`}
  </span>
);

/** Seleção de categoria com subcategorias agrupadas; só ativas para novos lançamentos. */
export const CategorySelect: React.FC<{ type: 'receita' | 'despesa'; value: number | string | null; onChange: (id: number | null) => void; error?: string; includeInactive?: boolean; placeholder?: string }> = ({
  type,
  value,
  onChange,
  error,
  includeInactive,
  placeholder = 'Selecione...',
}) => {
  const { categories } = useFin();
  const list = categories.filter((c) => c.category_type === type && (includeInactive || c.active || c.id === Number(value)));
  const roots = list.filter((c) => !c.parent_id);
  const children = (p: FinancialCategory) => list.filter((c) => c.parent_id === p.id);
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} error={error}>
      <option value="">{placeholder}</option>
      {roots.map((r) => (
        <React.Fragment key={r.id}>
          <option value={r.id}>
            {r.name}
            {!r.active ? ' (inativa)' : ''}
          </option>
          {children(r).map((c) => (
            <option key={c.id} value={c.id}>
              {'   › '}
              {c.name}
              {!c.active ? ' (inativa)' : ''}
            </option>
          ))}
        </React.Fragment>
      ))}
    </Select>
  );
};

export const AccountSelect: React.FC<{ value: number | string | null; onChange: (id: number | null) => void; placeholder?: string; error?: string; disabled?: boolean; includeInactive?: boolean }> = ({
  value,
  onChange,
  placeholder = 'Selecione a conta',
  error,
  disabled,
  includeInactive,
}) => {
  const { accounts } = useFin();
  return (
    <Select value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} error={error}>
      <option value="">{placeholder}</option>
      {accounts
        .filter((a) => includeInactive || a.active)
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} — saldo {formatBRL(a.balance)}
          </option>
        ))}
    </Select>
  );
};

export const Th: React.FC<{ children?: React.ReactNode; right?: boolean; className?: string }> = ({ children, right, className }) => (
  <th className={cx('font-semibold px-4 py-2.5 text-xs uppercase tracking-wide text-slate-500', right ? 'text-right' : 'text-left', className)}>{children}</th>
);

export const PAYMENT_METHODS = ['PIX', 'Boleto', 'Transferência', 'Dinheiro', 'Cartão de crédito', 'Cartão de débito', 'Cheque', 'Débito automático'];
