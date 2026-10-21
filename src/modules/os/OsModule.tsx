/**
 * Central Locadora - Módulo de Ordens de Serviço (manutenção): trilha e roteamento.
 * A navegação fica no grupo "Operação" do menu principal.
 */

import React, { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { AuthUser } from '../../../shared/orcamentos/types';
import { api } from '../orcamentos/api';
import { ErrorState, Loading, ToastProvider } from '../orcamentos/ui';
import { OsMeta, OsProvider, OsRoute } from './context';
import { OsPainel } from './views/Painel';
import { NovaOS } from './views/NovaOS';
import { OsDetalhe } from './views/Detalhe';
import { PreventivasView } from './views/Preventivas';
import { ChecklistsView } from './views/Checklists';
import { OsReportsView } from './views/Relatorios';
import { OsConfigView } from './views/Config';

export const OS_TITLES: Record<OsRoute['page'], string> = {
  painel: 'Painel de Manutenção',
  nova: 'Nova OS',
  detalhe: 'Ordem de Serviço',
  preventivas: 'Preventivas',
  checklists: 'Checklists',
  relatorios: 'Relatórios',
  config: 'Configurações',
};

export const OsModule: React.FC<{ user: AuthUser; route: OsRoute; onNavigate: (r: OsRoute) => void; openFinance?: (entryId: number) => void; openContract?: (n: string) => void }> = ({
  user, route, onNavigate, openFinance, openContract,
}) => {
  const [meta, setMeta] = useState<OsMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => {
    setError(null);
    api
      .get<OsMeta>('/os/meta')
      .then(setMeta)
      .catch((e) => setError(e.message));
  };
  useEffect(reload, [user.id]);
  const navigate = (r: OsRoute) => {
    onNavigate(r);
    window.scrollTo({ top: 0 });
  };
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!meta) return <Loading />;
  return (
    <OsProvider value={{ ...meta, user, reload, route, navigate, openFinance, openContract }}>
      <ToastProvider>
        <nav aria-label="Trilha" className="flex items-center gap-1 text-xs text-slate-500 mb-4">
          <button onClick={() => navigate({ page: 'painel' })} className="font-semibold hover:text-slate-800">
            Ordens de Serviço
          </button>
          {route.page !== 'painel' && (
            <>
              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              <span className="text-slate-800 font-semibold">{OS_TITLES[route.page]}</span>
            </>
          )}
        </nav>
        {route.page === 'painel' && <OsPainel key={`p-${route.status || ''}`} initialStatus={route.status} />}
        {route.page === 'nova' && <NovaOS assetId={route.assetId} />}
        {route.page === 'detalhe' && <OsDetalhe key={route.id} id={route.id} initialTab={route.tab} />}
        {route.page === 'preventivas' && <PreventivasView />}
        {route.page === 'checklists' && <ChecklistsView />}
        {route.page === 'relatorios' && <OsReportsView />}
        {route.page === 'config' && <OsConfigView />}
      </ToastProvider>
    </OsProvider>
  );
};
