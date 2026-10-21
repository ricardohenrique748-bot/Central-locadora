/**
 * Componentes visuais do módulo de Entregas e Devoluções.
 */

import React from 'react';
import { OCCURRENCE_STATUS_LABELS, OP_STATUS_LABELS, OccurrenceStatus, OpStatus } from '../../../shared/logistica/types';
import { cx } from '../orcamentos/ui';

const pill = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap';
const OP_STYLE: Record<OpStatus, string> = {
  rascunho: 'bg-slate-100 text-slate-600',
  programada: 'bg-indigo-100 text-indigo-800',
  em_separacao: 'bg-amber-100 text-amber-800',
  pronta: 'bg-sky-100 text-sky-800',
  em_transporte: 'bg-violet-100 text-violet-800',
  entregue_parcialmente: 'bg-orange-100 text-orange-800',
  entregue: 'bg-emerald-100 text-emerald-800',
  em_andamento: 'bg-violet-100 text-violet-800',
  recebida_parcialmente: 'bg-orange-100 text-orange-800',
  recebida: 'bg-sky-100 text-sky-800',
  aguardando_inspecao: 'bg-amber-100 text-amber-800',
  em_conferencia: 'bg-amber-100 text-amber-800',
  concluida: 'bg-emerald-100 text-emerald-800',
  cancelada: 'bg-slate-100 text-slate-400 line-through',
};
export const OpPill: React.FC<{ s: OpStatus }> = ({ s }) => <span className={cx(pill, OP_STYLE[s])}>{OP_STATUS_LABELS[s]}</span>;

const OCC_STYLE: Record<OccurrenceStatus, string> = {
  registrada: 'bg-red-100 text-red-700',
  em_analise: 'bg-amber-100 text-amber-800',
  aguardando_orcamento: 'bg-amber-100 text-amber-800',
  aguardando_aprovacao: 'bg-amber-100 text-amber-800',
  aprovada_cobranca: 'bg-sky-100 text-sky-800',
  nao_cobravel: 'bg-slate-100 text-slate-600',
  encaminhada_manutencao: 'bg-violet-100 text-violet-800',
  resolvida: 'bg-emerald-100 text-emerald-800',
};
export const OccPill: React.FC<{ s: OccurrenceStatus }> = ({ s }) => <span className={cx(pill, OCC_STYLE[s])}>{OCCURRENCE_STATUS_LABELS[s]}</span>;

export const Th: React.FC<{ children?: React.ReactNode; right?: boolean; className?: string }> = ({ children, right, className }) => (
  <th className={cx('font-semibold px-4 py-2.5 text-xs uppercase tracking-wide text-slate-500', right ? 'text-right' : 'text-left', className)}>{children}</th>
);
export const KV: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="py-1.5 flex justify-between gap-4 border-b border-slate-50 last:border-0 text-sm">
    <span className="text-slate-500 shrink-0">{label}</span>
    <span className="text-right text-slate-800 font-medium min-w-0">{children}</span>
  </div>
);
