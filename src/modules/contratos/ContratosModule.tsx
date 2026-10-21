/**
 * Central Locadora - Módulo de Contratos (locação e venda): trilha, pendências e roteamento.
 * A navegação fica no submenu "Contratos" do menu principal.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Bell, ChevronRight } from 'lucide-react';
import { AuthUser } from '../../../shared/orcamentos/types';
import { ContractAlert, ContractSettings } from '../../../shared/contratos/types';
import { contractCan } from '../../../shared/contratos/rules';
import { api } from '../orcamentos/api';
import { ErrorState, Loading, Notice, ToastProvider, cx } from '../orcamentos/ui';
import { CtrProvider, CtrRoute, CtrUser } from './context';
import { ContratosLista, FromQuotationView } from './views/Lista';
import { ContratoForm } from './views/Form';
import { ContratoDetalhe } from './views/Detalhe';
import { AlertasView } from './views/Alertas';
import { CtrReportsView } from './views/Relatorios';
import { CtrConfigView } from './views/Config';

export const CTR_TITLES: Record<CtrRoute['page'], string> = {
  painel: 'Contratos',
  novo: 'Novo contrato',
  orcamento: 'Gerar a partir de orçamento',
  editar: 'Editar contrato',
  detalhe: 'Contrato',
  alertas: 'Alertas',
  relatorios: 'Relatórios',
  config: 'Configurações',
};

const Pendencias: React.FC<{ onOpen: (id: number) => void; onAll: () => void }> = ({ onOpen, onAll }) => {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ContractAlert[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const load = () =>
    api
      .get<{ rows: ContractAlert[] }>('/contracts/alerts')
      .then((r) => setRows(r.rows))
      .catch(() => setRows([]));
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
  const high = rows?.filter((r) => r.priority === 'alta').length || 0;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => (setOpen((o) => !o), load())}
        className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50"
        aria-label={`Alertas de contratos (${rows?.length || 0})`}
      >
        <Bell className="w-4 h-4" />
        <span className="hidden sm:inline">Alertas</span>
        {!!rows?.length && <span className={cx('min-w-4 h-4 px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center', high ? 'bg-red-600' : 'bg-amber-500')}>{rows.length}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-xl shadow-xl z-40 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 text-sm font-bold text-slate-800 flex justify-between">
            Alertas de contratos
            <button onClick={() => (setOpen(false), onAll())} className="text-xs font-semibold text-[#1e3a5f] hover:underline">
              Ver todos
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {rows && rows.length === 0 && <p className="px-4 py-6 text-sm text-slate-500 text-center">Nenhum alerta.</p>}
            {rows?.slice(0, 15).map((n, i) => (
              <button key={`${n.kind}-${n.contract_id}-${i}`} onClick={() => (setOpen(false), onOpen(n.contract_id))} className="w-full text-left px-4 py-2.5 border-b border-slate-50 hover:bg-slate-50">
                <p className="text-sm font-semibold text-slate-800">
                  {n.contract_number} <span className="font-normal text-slate-500">• {n.customer_name}</span>
                </p>
                <p className={cx('text-xs', n.priority === 'alta' ? 'text-red-700' : n.priority === 'media' ? 'text-amber-700' : 'text-slate-600')}>
                  {n.label}: {n.text}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const ContratosModule: React.FC<{
  user: AuthUser;
  route: CtrRoute;
  onNavigate: (r: CtrRoute) => void;
  openFinance?: (entryId: number) => void;
  openCustomers?: () => void;
}> = ({ user, route, onNavigate, openFinance, openCustomers }) => {
  const [meta, setMeta] = useState<{ users: CtrUser[]; settings: ContractSettings; reports: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => {
    if (!contractCan.view(user)) return;
    setError(null);
    api
      .get<{ users: CtrUser[]; settings: ContractSettings; reports: Record<string, string> }>('/contracts/meta')
      .then(setMeta)
      .catch((e) => setError(e.message));
  };
  useEffect(reload, [user.id]);
  const navigate = (r: CtrRoute) => {
    onNavigate(r);
    window.scrollTo({ top: 0 });
  };

  if (!contractCan.view(user)) return <Notice kind="warning">Seu perfil não tem acesso aos contratos.</Notice>;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!meta) return <Loading />;

  return (
    <CtrProvider value={{ user, settings: meta.settings, users: meta.users, reports: meta.reports, reload, route, navigate, openFinance, openCustomers }}>
      <ToastProvider>
        <div className="flex items-center justify-between gap-3 mb-4">
          <nav aria-label="Trilha" className="flex items-center gap-1 text-xs text-slate-500 min-w-0">
            <button onClick={() => navigate({ page: 'painel' })} className="font-semibold hover:text-slate-800">
              Contratos
            </button>
            {route.page !== 'painel' && (
              <>
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                <span className="text-slate-800 font-semibold truncate">{CTR_TITLES[route.page]}</span>
              </>
            )}
          </nav>
          <Pendencias onOpen={(id) => navigate({ page: 'detalhe', id })} onAll={() => navigate({ page: 'alertas' })} />
        </div>
        {route.page === 'painel' && <ContratosLista key={`lista-${route.status || ''}`} initialStatus={route.status} />}
        {route.page === 'orcamento' && <FromQuotationView />}
        {route.page === 'novo' && <ContratoForm key="novo" />}
        {route.page === 'editar' && <ContratoForm key={`edit-${route.id}`} id={route.id} />}
        {route.page === 'detalhe' && <ContratoDetalhe key={route.id} id={route.id} initialTab={route.tab} />}
        {route.page === 'alertas' && <AlertasView />}
        {route.page === 'relatorios' && <CtrReportsView />}
        {route.page === 'config' && <CtrConfigView />}
      </ToastProvider>
    </CtrProvider>
  );
};
