/**
 * Central Locadora - Módulo Financeiro: carrega cadastros de apoio, trilha e roteamento.
 * A navegação fica no submenu "Financeiro" do menu principal.
 */

import React, { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { AuthUser } from '../../../shared/orcamentos/types';
import { CostCenter, FinanceSettings, FinancialAccount, FinancialCategory } from '../../../shared/financeiro/types';
import { financeCan } from '../../../shared/financeiro/rules';
import { api } from '../orcamentos/api';
import { ErrorState, Loading, Notice, ToastProvider } from '../orcamentos/ui';
import { FinProvider, FinRoute } from './context';
import { DashboardFin } from './views/DashboardFin';
import { EntriesList, EntryDetailView, EntryForm } from './views/Entries';
import { CashFlowView } from './views/CashFlow';
import { AccountsView, TransactionsView } from './views/Accounts';
import { TransfersView } from './views/Transfers';
import { CategoriesView, CostCentersView, FinConfigView } from './views/Registry';
import { ReconciliationView } from './views/Reconciliation';
import { DelinquencyView } from './views/Delinquency';
import { InvoicesView } from './views/Invoices';
import { FinReportsView } from './views/Reports';

export const FIN_TITLES: Record<FinRoute['page'], string> = {
  dashboard: 'Dashboard Financeiro',
  pagar: 'Contas a Pagar',
  receber: 'Contas a Receber',
  novo: 'Novo lançamento',
  editar: 'Editar lançamento',
  titulo: 'Lançamento',
  fluxo: 'Fluxo de Caixa',
  contas: 'Caixa e Bancos',
  lancamentos: 'Lançamentos Financeiros',
  transferencias: 'Transferências',
  categorias: 'Categorias Financeiras',
  centros: 'Centros de Custo',
  conciliacao: 'Conciliação Bancária',
  inadimplencia: 'Inadimplência',
  faturas: 'Faturas e Medições',
  relatorios: 'Relatórios',
  config: 'Configurações',
};

export const FinanceiroModule: React.FC<{ user: AuthUser; route: FinRoute; onNavigate: (r: FinRoute) => void }> = ({ user, route, onNavigate }) => {
  const [data, setData] = useState<{ accounts: FinancialAccount[]; categories: FinancialCategory[]; costCenters: CostCenter[]; settings: FinanceSettings } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    if (!financeCan.view(user)) return;
    setError(null);
    Promise.all([
      api.get<{ rows: FinancialAccount[] }>('/finance/accounts'),
      api.get<{ rows: FinancialCategory[] }>('/finance/categories'),
      api.get<{ rows: CostCenter[] }>('/finance/cost-centers'),
      api.get<FinanceSettings>('/finance/settings'),
    ])
      .then(([a, c, cc, s]) => setData({ accounts: a.rows, categories: c.rows, costCenters: cc.rows, settings: s }))
      .catch((e) => setError(e.message));
  };
  useEffect(reload, [user.id]);

  if (!financeCan.view(user)) return <Notice kind="warning">Seu perfil não tem acesso ao Financeiro.</Notice>;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Loading />;

  const navigate = (r: FinRoute) => {
    onNavigate(r);
    window.scrollTo({ top: 0 });
  };
  const parent: FinRoute | null =
    route.page === 'titulo' || route.page === 'editar' ? null : route.page === 'novo' ? { page: route.type } : null;

  return (
    <FinProvider value={{ user, ...data, reload, route, navigate }}>
      <ToastProvider>
        <nav aria-label="Trilha" className="flex items-center gap-1 text-xs text-slate-500 mb-4">
          <button onClick={() => navigate({ page: 'dashboard' })} className="font-semibold hover:text-slate-800">
            Financeiro
          </button>
          {route.page !== 'dashboard' && (
            <>
              <ChevronRight className="w-3.5 h-3.5" />
              {parent && (
                <>
                  <button onClick={() => navigate(parent)} className="hover:text-slate-800">
                    {FIN_TITLES[parent.page]}
                  </button>
                  <ChevronRight className="w-3.5 h-3.5" />
                </>
              )}
              <span className="text-slate-800 font-semibold">{FIN_TITLES[route.page]}</span>
            </>
          )}
        </nav>
        {route.page === 'dashboard' && <DashboardFin />}
        {route.page === 'pagar' && <EntriesList key={`p${route.status || ''}`} type="pagar" initialStatus={route.status} />}
        {route.page === 'receber' && <EntriesList key={`r${route.status || ''}`} type="receber" initialStatus={route.status} />}
        {route.page === 'novo' && <EntryForm key={`n${route.type}${route.stockEntryId || ''}`} type={route.type} stockEntryId={route.stockEntryId} />}
        {route.page === 'editar' && <EntryForm key={`e${route.id}`} id={route.id} />}
        {route.page === 'titulo' && <EntryDetailView key={route.id} id={route.id} />}
        {route.page === 'fluxo' && <CashFlowView />}
        {route.page === 'contas' && <AccountsView />}
        {route.page === 'lancamentos' && <TransactionsView key={route.accountId || 0} initialAccount={route.accountId} />}
        {route.page === 'transferencias' && <TransfersView />}
        {route.page === 'categorias' && <CategoriesView />}
        {route.page === 'centros' && <CostCentersView />}
        {route.page === 'conciliacao' && <ReconciliationView />}
        {route.page === 'inadimplencia' && <DelinquencyView />}
        {route.page === 'faturas' && <InvoicesView />}
        {route.page === 'relatorios' && <FinReportsView />}
        {route.page === 'config' && <FinConfigView />}
      </ToastProvider>
    </FinProvider>
  );
};
