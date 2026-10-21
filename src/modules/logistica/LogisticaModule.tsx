/**
 * Central Locadora - Módulo de Entregas e Devoluções: trilha, alertas e roteamento.
 * A navegação fica no grupo "Operação" do menu principal.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Bell, ChevronRight } from 'lucide-react';
import { AuthUser } from '../../../shared/orcamentos/types';
import { api } from '../orcamentos/api';
import { ErrorState, Loading, ToastProvider, cx } from '../orcamentos/ui';
import { LogMeta, LogProvider, LogRoute } from './context';
import { LogPainel } from './views/Painel';
import { NovaOperacao } from './views/NovaOperacao';
import { OperacaoDetalhe } from './views/Detalhe';
import { OcorrenciasView } from './views/Ocorrencias';
import { CadastrosView } from './views/Cadastros';
import { LogReportsView } from './views/Relatorios';

const TITLES: Record<LogRoute['page'], string> = { painel: 'Painel', nova: 'Nova operação', detalhe: 'Operação', ocorrencias: 'Avarias e ocorrências', cadastros: 'Motoristas e veículos', relatorios: 'Relatórios' };

interface Alert {
  kind: string;
  label: string;
  priority: 'alta' | 'media' | 'baixa';
  order_id: number | null;
  occurrence_id: number | null;
  ref: string;
  text: string;
}

const Alertas: React.FC<{ onOpen: (a: Alert) => void }> = ({ onOpen }) => {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Alert[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const load = () => api.get<{ rows: Alert[] }>('/logistics/alerts').then((r) => setRows(r.rows)).catch(() => setRows([]));
  useEffect(() => {
    load();
    const t = setInterval(load, 120_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const relevant = rows?.filter((r) => r.priority !== 'baixa') || [];
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => (setOpen((o) => !o), load())} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50" aria-label={`Alertas de logística (${relevant.length})`}>
        <Bell className="w-4 h-4" />
        <span className="hidden sm:inline">Alertas</span>
        {relevant.length > 0 && <span className={cx('min-w-4 h-4 px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center', relevant.some((r) => r.priority === 'alta') ? 'bg-red-600' : 'bg-amber-500')}>{relevant.length}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-xl shadow-xl z-40 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 text-sm font-bold text-slate-800">Alertas de entregas e devoluções</div>
          <div className="max-h-96 overflow-y-auto">
            {rows?.length === 0 && <p className="px-4 py-6 text-sm text-slate-500 text-center">Nenhum alerta.</p>}
            {rows?.slice(0, 30).map((a, i) => (
              <button key={i} disabled={!a.order_id && !a.occurrence_id} onClick={() => (setOpen(false), onOpen(a))} className="w-full text-left px-4 py-2.5 border-b border-slate-50 hover:bg-slate-50 disabled:cursor-default">
                <p className="text-sm font-semibold text-slate-800">{a.ref}</p>
                <p className={cx('text-xs', a.priority === 'alta' ? 'text-red-700' : a.priority === 'media' ? 'text-amber-700' : 'text-slate-600')}>
                  {a.label}: {a.text}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const LogisticaModule: React.FC<{ user: AuthUser; route: LogRoute; onNavigate: (r: LogRoute) => void; openContract?: (n: string) => void; openOs?: (id: number) => void }> = ({ user, route, onNavigate, openContract, openOs }) => {
  const [meta, setMeta] = useState<LogMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => {
    setError(null);
    api.get<LogMeta>('/logistics/meta').then(setMeta).catch((e) => setError(e.message));
  };
  useEffect(reload, [user.id]);
  const navigate = (r: LogRoute) => {
    onNavigate(r);
    window.scrollTo({ top: 0 });
  };
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!meta) return <Loading />;
  return (
    <LogProvider value={{ ...meta, user, reload, navigate, openContract, openOs }}>
      <ToastProvider>
        <div className="flex items-center justify-between gap-3 mb-4">
          <nav aria-label="Trilha" className="flex items-center gap-1 text-xs text-slate-500">
            <button onClick={() => navigate({ page: 'painel' })} className="font-semibold hover:text-slate-800">
              Entregas e Devoluções
            </button>
            {route.page !== 'painel' && (
              <>
                <ChevronRight className="w-3.5 h-3.5" />
                <span className="text-slate-800 font-semibold">{TITLES[route.page]}</span>
              </>
            )}
          </nav>
          <Alertas onOpen={(a) => (a.order_id ? navigate({ page: 'detalhe', id: a.order_id }) : navigate({ page: 'ocorrencias' }))} />
        </div>
        {route.page === 'painel' && <LogPainel key={`${route.status || ''}-${route.type || ''}`} initialStatus={route.status} initialType={route.type} />}
        {route.page === 'nova' && <NovaOperacao key={`${route.type}-${route.contractId || ''}`} type={route.type} contractId={route.contractId} />}
        {route.page === 'detalhe' && <OperacaoDetalhe key={route.id} id={route.id} />}
        {route.page === 'ocorrencias' && <OcorrenciasView />}
        {route.page === 'cadastros' && <CadastrosView />}
        {route.page === 'relatorios' && <LogReportsView />}
      </ToastProvider>
    </LogProvider>
  );
};
