/**
 * Componentes compartilhados do módulo de Estoque.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import {
  INVENTORY_LABELS, InventoryStatus, OPERATIONAL_LABELS, OperationalStatus, RENTAL_LABELS, RentalStatus, RESERVATION_LABELS, ReservationStatus,
  StockItemRow, TRANSFER_LABELS, TransferStatus,
} from '../../../shared/estoque/types';
import { api, qs } from '../orcamentos/api';
import { Input, Select, cx, useDebounced } from '../orcamentos/ui';
import { useStock } from './context';

export const fmtQty = (n: number | null | undefined, unit?: string) =>
  n === null || n === undefined ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}`;

const pill = 'inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap';

const OP_STYLE: Record<OperationalStatus, string> = {
  novo: 'bg-sky-50 text-sky-800 border-sky-200',
  operacional: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  aguardando_inspecao: 'bg-amber-50 text-amber-800 border-amber-200',
  em_manutencao: 'bg-orange-50 text-orange-800 border-orange-200',
  danificado: 'bg-red-50 text-red-700 border-red-200',
  baixado: 'bg-slate-100 text-slate-500 border-slate-200 line-through',
};
const RENT_STYLE: Record<RentalStatus, string> = {
  disponivel: 'bg-emerald-600 text-white border-emerald-600',
  reservado: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  alugado: 'bg-blue-50 text-blue-800 border-blue-200',
  em_transito: 'bg-violet-50 text-violet-800 border-violet-200',
  indisponivel: 'bg-slate-100 text-slate-600 border-slate-200',
};
const RES_STYLE: Record<ReservationStatus, string> = {
  pendente: 'bg-amber-50 text-amber-800 border-amber-200',
  confirmada: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  em_uso: 'bg-blue-50 text-blue-800 border-blue-200',
  concluida: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  cancelada: 'bg-slate-100 text-slate-500 border-slate-200 line-through',
};
const TRF_STYLE: Record<TransferStatus, string> = {
  rascunho: 'bg-slate-100 text-slate-700 border-slate-200',
  aguardando_envio: 'bg-amber-50 text-amber-800 border-amber-200',
  em_transito: 'bg-violet-50 text-violet-800 border-violet-200',
  recebida: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  cancelada: 'bg-slate-100 text-slate-500 border-slate-200 line-through',
};
const INV_STYLE: Record<InventoryStatus, string> = {
  em_andamento: 'bg-sky-50 text-sky-800 border-sky-200',
  aguardando_conferencia: 'bg-amber-50 text-amber-800 border-amber-200',
  aguardando_aprovacao: 'bg-orange-50 text-orange-800 border-orange-200',
  finalizado: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  cancelado: 'bg-slate-100 text-slate-500 border-slate-200 line-through',
};

export const OpBadge: React.FC<{ s: OperationalStatus }> = ({ s }) => <span className={cx(pill, OP_STYLE[s])}>{OPERATIONAL_LABELS[s]}</span>;
export const RentBadge: React.FC<{ s: RentalStatus }> = ({ s }) => <span className={cx(pill, RENT_STYLE[s])}>{RENTAL_LABELS[s]}</span>;
export const ResBadge: React.FC<{ s: ReservationStatus }> = ({ s }) => <span className={cx(pill, RES_STYLE[s])}>{RESERVATION_LABELS[s]}</span>;
export const TrfBadge: React.FC<{ s: TransferStatus }> = ({ s }) => <span className={cx(pill, TRF_STYLE[s])}>{TRANSFER_LABELS[s]}</span>;
export const InvBadge: React.FC<{ s: InventoryStatus }> = ({ s }) => <span className={cx(pill, INV_STYLE[s])}>{INVENTORY_LABELS[s]}</span>;
export const DocBadge: React.FC<{ s: 'rascunho' | 'confirmada' | 'cancelada' | 'confirmado' | 'estornado' }> = ({ s }) => (
  <span
    className={cx(
      pill,
      s === 'rascunho' ? 'bg-slate-100 text-slate-700 border-slate-200' : s === 'cancelada' || s === 'estornado' ? 'bg-slate-100 text-slate-500 border-slate-200 line-through' : 'bg-emerald-50 text-emerald-800 border-emerald-200'
    )}
  >
    {s === 'rascunho' ? 'Rascunho' : s === 'cancelada' ? 'Cancelada' : s === 'estornado' ? 'Estornado' : s === 'confirmado' ? 'Confirmado' : 'Confirmada'}
  </span>
);

export const LocationSelect: React.FC<{ value: number | string | null; onChange: (id: number | null) => void; placeholder?: string; error?: string; includeInactive?: boolean; disabled?: boolean; 'aria-label'?: string }> = ({
  value,
  onChange,
  placeholder = 'Selecione o local',
  error,
  includeInactive,
  disabled,
  ...rest
}) => {
  const { locations } = useStock();
  return (
    <Select value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} error={error} aria-label={rest['aria-label']}>
      <option value="">{placeholder}</option>
      {locations
        .filter((l) => includeInactive || l.active)
        .map((l) => (
          <option key={l.id} value={l.id}>
            {l.code} — {l.name}
          </option>
        ))}
    </Select>
  );
};

/** Pesquisa de item do estoque com saldo. */
export const ItemSearch: React.FC<{ onPick: (i: StockItemRow) => void; filter?: Record<string, string>; placeholder?: string; autoFocus?: boolean }> = ({ onPick, filter, placeholder = 'Pesquisar item por código, nome ou código de barras', autoFocus }) => {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<StockItemRow[]>([]);
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q, 250);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    api
      .get<{ rows: StockItemRow[] }>(`/stock/items${qs({ q: dq, active: 'true', page_size: 10, ...filter })}`)
      .then((r) => setRows(r.rows))
      .catch(() => setRows([]));
  }, [dq, open, JSON.stringify(filter)]);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <Input autoFocus={autoFocus} value={q} onFocus={() => setOpen(true)} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="pl-9" aria-label="Pesquisar item" />
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl max-h-72 overflow-y-auto">
          {rows.length === 0 && <p className="px-3 py-3 text-sm text-slate-500">Nenhum item encontrado.</p>}
          {rows.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => {
                onPick(i);
                setOpen(false);
                setQ('');
              }}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 border-b border-slate-50 flex justify-between gap-3"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-800 truncate">
                  <span className="font-mono text-xs text-slate-500 mr-1.5">{i.internal_code}</span>
                  {i.description}
                </span>
                <span className="text-[11px] text-slate-500">{i.tracking === 'individual' ? 'Controle individual' : 'Por quantidade'}</span>
              </span>
              <span className="text-xs text-slate-600 tabular-nums shrink-0">
                {i.tracking === 'individual' ? `${i.assets_available}/${i.assets_total} disp.` : `${fmtQty(i.qty_available, i.unit)} disp.`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const Stat: React.FC<{ label: string; value: React.ReactNode; hint?: string; tone?: string; onClick?: () => void; icon?: React.ElementType; active?: boolean }> = ({ label, value, hint, tone = 'text-[#1e3a5f] bg-slate-100', onClick, icon: Icon, active }) => (
  <button
    onClick={onClick}
    disabled={!onClick}
    aria-pressed={onClick ? !!active : undefined}
    className={cx('bg-white rounded-xl border p-3.5 text-left shadow-xs', active ? 'border-[#1e3a5f] ring-2 ring-[#1e3a5f]/15' : 'border-slate-200', onClick && 'cursor-pointer hover:border-[#1e3a5f]/40 hover:shadow-sm transition')}
  >
    <div className="flex items-center gap-2">
      {Icon && (
        <span className={cx('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', tone)}>
          <Icon className="w-4 h-4" />
        </span>
      )}
      <span className="text-xs font-semibold text-slate-500">{label}</span>
    </div>
    <p className="text-xl font-extrabold text-slate-900 mt-2 tabular-nums">{value}</p>
    {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
  </button>
);

export const Th: React.FC<{ children?: React.ReactNode; right?: boolean; className?: string }> = ({ children, right, className }) => (
  <th className={cx('font-semibold px-4 py-2.5 text-xs uppercase tracking-wide text-slate-500', right ? 'text-right' : 'text-left', className)}>{children}</th>
);
