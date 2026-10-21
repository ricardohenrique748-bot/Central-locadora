/**
 * Componentes visuais do módulo de Ordens de Serviço.
 */

import React from 'react';
import { ORDER_STATUS_LABELS, OrderStatus, PRIORITY_LABELS, Priority, SERVICE_STATUS_LABELS, ServiceStatus } from '../../../shared/os/types';
import { cx } from '../orcamentos/ui';

const pill = 'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap';

const STATUS_STYLE: Record<OrderStatus, string> = {
  aberta: 'bg-slate-100 text-slate-700',
  aguardando_avaliacao: 'bg-amber-100 text-amber-800',
  aguardando_aprovacao: 'bg-amber-100 text-amber-800',
  aguardando_pecas: 'bg-orange-100 text-orange-800',
  aguardando_fornecedor: 'bg-orange-100 text-orange-800',
  programada: 'bg-indigo-100 text-indigo-800',
  em_execucao: 'bg-sky-100 text-sky-800',
  em_testes: 'bg-violet-100 text-violet-800',
  concluida: 'bg-emerald-100 text-emerald-800',
  cancelada: 'bg-slate-100 text-slate-400 line-through',
};
export const OsStatusPill: React.FC<{ s: OrderStatus }> = ({ s }) => <span className={cx(pill, STATUS_STYLE[s])}>{ORDER_STATUS_LABELS[s]}</span>;

const PRIO_STYLE: Record<Priority, string> = { baixa: 'bg-slate-100 text-slate-600', media: 'bg-sky-50 text-sky-700', alta: 'bg-orange-100 text-orange-800', urgente: 'bg-red-100 text-red-700' };
export const PriorityPill: React.FC<{ p: Priority }> = ({ p }) => <span className={cx(pill, PRIO_STYLE[p])}>{PRIORITY_LABELS[p]}</span>;

const SRV_STYLE: Record<ServiceStatus, string> = {
  pendente_aprovacao: 'bg-amber-100 text-amber-800',
  aprovado: 'bg-sky-100 text-sky-800',
  reprovado: 'bg-red-100 text-red-700',
  concluido: 'bg-emerald-100 text-emerald-800',
  cancelado: 'bg-slate-100 text-slate-400',
};
export const ServicePill: React.FC<{ s: ServiceStatus }> = ({ s }) => <span className={cx(pill, SRV_STYLE[s])}>{SERVICE_STATUS_LABELS[s]}</span>;

export const Th: React.FC<{ children?: React.ReactNode; right?: boolean; className?: string }> = ({ children, right, className }) => (
  <th className={cx('font-semibold px-4 py-2.5 text-xs uppercase tracking-wide text-slate-500', right ? 'text-right' : 'text-left', className)}>{children}</th>
);

export const KV: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="py-1.5 flex justify-between gap-4 border-b border-slate-50 last:border-0 text-sm">
    <span className="text-slate-500 shrink-0">{label}</span>
    <span className="text-right text-slate-800 font-medium min-w-0">{children}</span>
  </div>
);
