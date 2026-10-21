/**
 * Componentes visuais do módulo de Contratos.
 */

import React from 'react';
import { CHARGE_STATUS_LABELS, CONTRACT_STATUS_LABELS, ChargeDisplayStatus, ContractStatus, DOCUMENT_STATUS_LABELS, DocumentStatus } from '../../../shared/contratos/types';
import { formatBRL } from '../../../shared/orcamentos/money';
import { cx } from '../orcamentos/ui';

const pill = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap';

const STATUS_STYLE: Record<ContractStatus, string> = {
  rascunho: 'bg-slate-100 text-slate-600',
  aguardando_aprovacao: 'bg-amber-100 text-amber-800',
  aprovado: 'bg-sky-100 text-sky-800',
  aguardando_assinatura: 'bg-amber-100 text-amber-800',
  agendado: 'bg-indigo-100 text-indigo-800',
  ativo: 'bg-emerald-100 text-emerald-800',
  vencido: 'bg-red-100 text-red-700',
  pendente_devolucao: 'bg-orange-100 text-orange-800',
  encerrado: 'bg-slate-200 text-slate-700',
  cancelado: 'bg-slate-100 text-slate-400 line-through',
};
export const StatusPill: React.FC<{ s: ContractStatus }> = ({ s }) => <span className={cx(pill, STATUS_STYLE[s])}>{CONTRACT_STATUS_LABELS[s]}</span>;

const CHARGE_STYLE: Record<ChargeDisplayStatus, string> = {
  previsto: 'bg-slate-100 text-slate-500',
  em_aberto: 'bg-sky-100 text-sky-800',
  vencido: 'bg-red-100 text-red-700',
  parcial: 'bg-amber-100 text-amber-800',
  pago: 'bg-emerald-100 text-emerald-800',
  cancelado: 'bg-slate-100 text-slate-400 line-through',
};
export const ChargePill: React.FC<{ s: ChargeDisplayStatus }> = ({ s }) => <span className={cx(pill, CHARGE_STYLE[s])}>{CHARGE_STATUS_LABELS[s]}</span>;

const DOC_STYLE: Record<DocumentStatus, string> = {
  gerado: 'bg-slate-100 text-slate-600',
  enviado: 'bg-sky-100 text-sky-800',
  assinado: 'bg-emerald-100 text-emerald-800',
  substituido: 'bg-slate-100 text-slate-400',
};
export const DocPill: React.FC<{ s: DocumentStatus }> = ({ s }) => <span className={cx(pill, DOC_STYLE[s])}>{DOCUMENT_STATUS_LABELS[s]}</span>;

export const Money: React.FC<{ v: number | null | undefined; className?: string }> = ({ v, className }) => <span className={cx('tabular-nums', className)}>{v === null || v === undefined ? '—' : formatBRL(v)}</span>;

export const Th: React.FC<{ children?: React.ReactNode; right?: boolean; className?: string }> = ({ children, right, className }) => (
  <th className={cx('font-semibold px-4 py-2.5 text-xs uppercase tracking-wide text-slate-500', right ? 'text-right' : 'text-left', className)}>{children}</th>
);

export const KV: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="py-1.5 flex justify-between gap-4 border-b border-slate-50 last:border-0 text-sm">
    <span className="text-slate-500 shrink-0">{label}</span>
    <span className="text-right text-slate-800 font-medium min-w-0">{children}</span>
  </div>
);
