/**
 * Central Locadora - Módulo de Orçamentos: roteamento interno das páginas.
 * A navegação entre as páginas fica no menu principal (submenu "Orçamentos" da Navbar);
 * a rota é controlada pelo App e repassada aqui.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Bell, ChevronRight } from 'lucide-react';
import { AuthUser, ModuleSettings } from '../../../shared/orcamentos/types';
import { api } from './api';
import { ModuleProvider, Route, Integrations } from './context';
import { ErrorState, Loading, ToastProvider, cx } from './ui';
import { PainelView } from './views/PainelView';
import { ListaView } from './views/ListaView';
import { FormView } from './views/FormView';
import { DetalheView } from './views/DetalheView';
import { ClientesView } from './views/ClientesView';
import { RelatoriosView } from './views/RelatoriosView';
import { ConfigView } from './views/ConfigView';

export const ORC_PAGE_TITLES: Record<Route['page'], string> = {
  painel: 'Painel de Orçamentos',
  novo: 'Novo Orçamento',
  lista: 'Todos os Orçamentos',
  detalhe: 'Orçamento',
  editar: 'Editar Orçamento',
  clientes: 'Clientes',
  relatorios: 'Relatórios',
  config: 'Configurações',
};

const Notifications: React.FC<{ onOpen: (id: number) => void }> = ({ onOpen }) => {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ id: number; quotation_number: string; kind: string; text: string }[] | null>(null);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = () =>
    api
      .get<{ rows: typeof rows }>('/notifications')
      .then((r) => {
        setRows(r.rows);
        setError(false);
      })
      .catch(() => setError(true));

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const count = rows?.length || 0;
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => {
          setOpen((o) => !o);
          load();
        }}
        className="relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50"
        aria-label={`Notificações de orçamentos (${count})`}
      >
        <Bell className="w-4 h-4" />
        <span className="hidden sm:inline">Pendências</span>
        {count > 0 && <span className="min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center">{count}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-xl shadow-xl z-40 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 text-sm font-bold text-slate-800">Pendências de orçamentos</div>
          <div className="max-h-80 overflow-y-auto">
            {error && <p className="px-4 py-6 text-sm text-red-600 text-center">Não foi possível carregar.</p>}
            {!error && rows && rows.length === 0 && <p className="px-4 py-6 text-sm text-slate-500 text-center">Nenhuma pendência.</p>}
            {rows?.map((n) => (
              <button
                key={`${n.kind}-${n.id}`}
                onClick={() => {
                  setOpen(false);
                  onOpen(n.id);
                }}
                className="w-full text-left px-4 py-2.5 border-b border-slate-50 hover:bg-slate-50"
              >
                <p className="text-sm font-semibold text-slate-800">{n.quotation_number}</p>
                <p className={cx('text-xs', n.kind === 'aprovacao' ? 'text-amber-700' : 'text-orange-700')}>{n.text}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export const OrcamentosModule: React.FC<{ user: AuthUser; route: Route; onNavigate: (r: Route) => void; openFinance?: (entryId: number) => void; openContract?: (contractNumber: string) => void }> = ({ user, route, onNavigate, openFinance, openContract }) => {
  const [settings, setSettings] = useState<ModuleSettings | null>(null);
  const [integrations, setIntegrations] = useState<Integrations | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSettings = () => {
    setError(null);
    api
      .get<{ settings: ModuleSettings; integrations: Integrations }>('/settings')
      .then((r) => {
        setSettings(r.settings);
        setIntegrations(r.integrations);
      })
      .catch((e) => setError(e.message));
  };
  useEffect(loadSettings, []);

  const navigate = (r: Route) => {
    onNavigate(r);
    window.scrollTo({ top: 0 });
  };

  if (error) return <ErrorState message={error} onRetry={loadSettings} />;
  if (!settings || !integrations) return <Loading />;

  const inQuotation = route.page === 'detalhe' || route.page === 'editar';

  return (
    <ModuleProvider value={{ user, settings, integrations, reloadSettings: loadSettings, route, navigate, openFinance, openContract }}>
      <ToastProvider>
        {/* Trilha de navegação + pendências */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <nav aria-label="Trilha" className="flex items-center gap-1 text-xs text-slate-500 min-w-0">
            <button onClick={() => navigate({ page: 'painel' })} className="font-semibold hover:text-slate-800">
              Orçamentos
            </button>
            {route.page !== 'painel' && (
              <>
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                {inQuotation && (
                  <>
                    <button onClick={() => navigate({ page: 'lista' })} className="hover:text-slate-800 whitespace-nowrap">
                      Todos os Orçamentos
                    </button>
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  </>
                )}
                <span className="text-slate-800 font-semibold truncate">{ORC_PAGE_TITLES[route.page]}</span>
              </>
            )}
          </nav>
          <Notifications onOpen={(id) => navigate({ page: 'detalhe', id })} />
        </div>

        {route.page === 'painel' && <PainelView />}
        {route.page === 'novo' && <FormView key={`novo-${route.modo || ''}`} initialMode={route.modo} />}
        {route.page === 'editar' && <FormView key={`edit-${route.id}`} id={route.id} />}
        {route.page === 'lista' && <ListaView key={`lista-${route.status || ''}-${JSON.stringify(route.filters || {})}`} initialStatus={route.status} initialFilters={route.filters} statusLabel={route.label} />}
        {route.page === 'detalhe' && <DetalheView key={route.id} id={route.id} />}
        {route.page === 'clientes' && <ClientesView startNew={route.novo} />}
        {route.page === 'relatorios' && <RelatoriosView />}
        {route.page === 'config' && <ConfigView />}
      </ToastProvider>
    </ModuleProvider>
  );
};
