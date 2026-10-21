/**
 * Componentes de interface do módulo de orçamentos (padrão visual único).
 * Paleta: azul-escuro corporativo (#1e3a5f), branco, cinzas; cores apenas para status.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Inbox, Loader2, X, XCircle, Info } from 'lucide-react';
import { QuotationStatus } from '../../../shared/orcamentos/types';
import { STATUS_LABELS } from '../../../shared/orcamentos/status';
import { centsToInput, parseBRL } from '../../../shared/orcamentos/money';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ------------------------------------------------ toasts

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}
const ToastCtx = createContext<(kind: ToastKind, text: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? XCircle : Info;
          return (
            <div
              key={t.id}
              className={cx(
                'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-lg bg-white',
                t.kind === 'success' && 'border-emerald-200',
                t.kind === 'error' && 'border-red-200',
                t.kind === 'info' && 'border-slate-200'
              )}
            >
              <Icon className={cx('w-4 h-4 mt-0.5 shrink-0', t.kind === 'success' ? 'text-emerald-600' : t.kind === 'error' ? 'text-red-600' : 'text-slate-500')} />
              <span className="text-slate-800 flex-1">{t.text}</span>
              <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="text-slate-400 hover:text-slate-600" aria-label="Fechar">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
};

// ------------------------------------------------ botões e campos

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; loading?: boolean; icon?: React.ElementType; size?: 'sm' | 'md' }> = ({
  variant = 'secondary',
  loading,
  icon: Icon,
  size = 'md',
  className,
  children,
  disabled,
  ...rest
}) => (
  <button
    {...rest}
    disabled={disabled || loading}
    className={cx(
      'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap',
      size === 'sm' ? 'text-xs px-2.5 py-1.5' : 'text-sm px-3.5 py-2',
      variant === 'primary' && 'bg-[#1e3a5f] text-white hover:bg-[#16304f]',
      variant === 'secondary' && 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
      variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
      variant === 'success' && 'bg-emerald-600 text-white hover:bg-emerald-700',
      variant === 'ghost' && 'text-slate-600 hover:bg-slate-100',
      className
    )}
  >
    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : Icon ? <Icon className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} /> : null}
    {children}
  </button>
);

export const Field: React.FC<{ label: string; error?: string; hint?: string; required?: boolean; className?: string; children: React.ReactNode; htmlFor?: string }> = ({
  label,
  error,
  hint,
  required,
  className,
  children,
  htmlFor,
}) => (
  <div className={cx('space-y-1', className)}>
    <label htmlFor={htmlFor} className="block text-xs font-semibold text-slate-700">
      {label}
      {required && <span className="text-red-600"> *</span>}
    </label>
    {children}
    {error ? <p className="text-xs text-red-600">{error}</p> : hint ? <p className="text-[11px] text-slate-500">{hint}</p> : null}
  </div>
);

export const inputCls = (error?: string) =>
  cx(
    'w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:ring-2 disabled:bg-slate-100 disabled:text-slate-500',
    error ? 'border-red-400 focus:ring-red-200' : 'border-slate-300 focus:ring-[#1e3a5f]/25 focus:border-[#1e3a5f]'
  );

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { error?: string }>(({ error, className, ...rest }, ref) => (
  <input ref={ref} {...rest} className={cx(inputCls(error), className)} />
));

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement> & { error?: string }> = ({ error, className, children, ...rest }) => (
  <select {...rest} className={cx(inputCls(error), 'pr-8', className)}>
    {children}
  </select>
);

export const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string }> = ({ error, className, ...rest }) => (
  <textarea {...rest} className={cx(inputCls(error), 'min-h-[70px]', className)} />
);

/** Campo monetário: digita "1.234,56", entrega centavos (ou null). */
export const MoneyInput: React.FC<{ value: number | null; onChange: (cents: number | null) => void; error?: string; disabled?: boolean; id?: string; placeholder?: string; allowEmpty?: boolean }> = ({
  value,
  onChange,
  error,
  disabled,
  id,
  placeholder = '0,00',
  allowEmpty,
}) => {
  const [text, setText] = useState(centsToInput(value));
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(centsToInput(value));
  }, [value]);
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>
      <input
        id={id}
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        value={text}
        onFocus={() => (focused.current = true)}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim() === '') {
            setInvalid(false);
            onChange(allowEmpty ? null : 0);
            return;
          }
          const c = parseBRL(e.target.value);
          setInvalid(c === null || c < 0);
          if (c !== null && c >= 0) onChange(c);
        }}
        onBlur={() => {
          focused.current = false;
          if (!invalid) setText(centsToInput(value));
        }}
        className={cx(inputCls(error || (invalid ? 'x' : undefined)), 'pl-9 text-right tabular-nums')}
      />
      {invalid && !error && <p className="text-xs text-red-600 mt-1">Valor inválido</p>}
    </div>
  );
};

export const Checkbox: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode; disabled?: boolean }> = ({ checked, onChange, label, disabled }) => (
  <label className={cx('inline-flex items-center gap-2 text-sm text-slate-700 select-none', disabled ? 'opacity-60' : 'cursor-pointer')}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 rounded accent-[#1e3a5f]" />
    {label}
  </label>
);

// ------------------------------------------------ layout

export const Card: React.FC<{ title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }> = ({
  title,
  actions,
  children,
  className,
  bodyClassName,
}) => (
  <section className={cx('bg-white rounded-xl border border-slate-200 shadow-xs', className)}>
    {(title || actions) && (
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </header>
    )}
    <div className={cx('p-4', bodyClassName)}>{children}</div>
  </section>
);

export const PageHeader: React.FC<{ title: string; subtitle?: string; actions?: React.ReactNode; onBack?: () => void }> = ({ title, subtitle, actions, onBack }) => (
  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5">
    <div className="flex items-start gap-2">
      {onBack && (
        <button onClick={onBack} className="mt-0.5 p-1 rounded-md text-slate-500 hover:bg-slate-200" aria-label="Voltar">
          <ChevronLeft className="w-5 h-5" />
        </button>
      )}
      <div>
        <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

// ------------------------------------------------ estados

export const Loading: React.FC<{ text?: string }> = ({ text = 'Carregando...' }) => (
  <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
    <Loader2 className="w-5 h-5 animate-spin" /> {text}
  </div>
);

export const EmptyState: React.FC<{ title: string; text?: string; action?: React.ReactNode }> = ({ title, text, action }) => (
  <div className="flex flex-col items-center justify-center text-center py-12 px-4">
    <Inbox className="w-10 h-10 text-slate-300 mb-3" />
    <p className="font-semibold text-slate-700">{title}</p>
    {text && <p className="text-sm text-slate-500 mt-1 max-w-md">{text}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const ErrorState: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="flex flex-col items-center justify-center text-center py-12 px-4">
    <AlertTriangle className="w-10 h-10 text-red-400 mb-3" />
    <p className="font-semibold text-slate-800">Não foi possível carregar</p>
    <p className="text-sm text-slate-500 mt-1 max-w-md">{message}</p>
    {onRetry && (
      <Button className="mt-4" onClick={onRetry}>
        Tentar novamente
      </Button>
    )}
  </div>
);

export const Notice: React.FC<{ kind?: 'info' | 'warning' | 'danger'; children: React.ReactNode; className?: string }> = ({ kind = 'info', children, className }) => (
  <div
    className={cx(
      'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
      kind === 'info' && 'bg-sky-50 border-sky-200 text-sky-900',
      kind === 'warning' && 'bg-amber-50 border-amber-200 text-amber-900',
      kind === 'danger' && 'bg-red-50 border-red-200 text-red-900',
      className
    )}
  >
    {kind === 'info' ? <Info className="w-4 h-4 shrink-0 mt-px" /> : <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />}
    <div className="flex-1">{children}</div>
  </div>
);

// ------------------------------------------------ status

const STATUS_STYLE: Record<QuotationStatus, string> = {
  rascunho: 'bg-slate-100 text-slate-700 border-slate-200',
  em_revisao: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  aguardando_aprovacao: 'bg-amber-50 text-amber-800 border-amber-200',
  aprovado_interno: 'bg-sky-50 text-sky-800 border-sky-200',
  enviado: 'bg-blue-50 text-blue-800 border-blue-200',
  em_negociacao: 'bg-violet-50 text-violet-800 border-violet-200',
  aprovado_cliente: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  recusado: 'bg-red-50 text-red-700 border-red-200',
  expirado: 'bg-orange-50 text-orange-800 border-orange-200',
  cancelado: 'bg-slate-100 text-slate-500 border-slate-200 line-through',
  convertido: 'bg-emerald-600 text-white border-emerald-600',
};

export const StatusBadge: React.FC<{ status: QuotationStatus }> = ({ status }) => (
  <span className={cx('inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap', STATUS_STYLE[status])}>{STATUS_LABELS[status]}</span>
);

// ------------------------------------------------ modal

export const Modal: React.FC<{ open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }> = ({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 p-0 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          'bg-white w-full rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]',
          size === 'sm' && 'sm:max-w-md',
          size === 'md' && 'sm:max-w-xl',
          size === 'lg' && 'sm:max-w-3xl',
          size === 'xl' && 'sm:max-w-5xl'
        )}
      >
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-md text-slate-400 hover:bg-slate-100" aria-label="Fechar">
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && <footer className="px-5 py-3 border-t border-slate-100 flex flex-wrap justify-end gap-2">{footer}</footer>}
      </div>
    </div>
  );
};

// ------------------------------------------------ paginação

export const Pagination: React.FC<{ page: number; pageSize: number; total: number; onPage: (p: number) => void }> = ({ page, pageSize, total, onPage }) => {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-100 text-xs text-slate-600">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} de {total}
      </span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" icon={ChevronLeft} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior" />
        <span className="px-2">
          Página {page} de {pages}
        </span>
        <Button size="sm" variant="ghost" icon={ChevronRight} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Próxima página" />
      </div>
    </div>
  );
};

// ------------------------------------------------ hook de carregamento

export function useAsync<T>(fn: () => Promise<T>, deps: React.DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e?.message || 'Erro desconhecido'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
