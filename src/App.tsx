/**
 * Central Locação - Sistema ERP de Locação de Equipamentos para Construção Civil
 * Central BR Comércio e Locação de Equipamentos para Construção Civil Ltda
 * Nome Comercial: Central Locadora Rio Preto (São José do Rio Preto - SP)
 * Desenvolvido por: Lynus Tecnologia
 */

import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Navbar, ActiveTab } from './components/Navbar';
import { QuickSearchModal } from './components/QuickSearchModal';
import { PainelGeral, PainelAction } from './modules/painel/PainelGeral';
import { ContratosView } from './views/ContratosView';
import { DevolucoesView } from './views/DevolucoesView';
import { ClientesView } from './views/ClientesView';
import { ManutencaoView } from './views/ManutencaoView';
import { LogisticaView } from './views/LogisticaView';
import { ConfiguracoesView } from './views/ConfiguracoesView';
import { LoginView } from './views/LoginView';
import { OrcamentosModule } from './modules/orcamentos/OrcamentosModule';
import { Route as OrcRoute } from './modules/orcamentos/context';
import { EstoqueModule } from './modules/estoque/EstoqueModule';
import { StockRoute } from './modules/estoque/context';
import { FinanceiroModule } from './modules/financeiro/FinanceiroModule';
import { FinRoute } from './modules/financeiro/context';
import { financeCan } from '../shared/financeiro/rules';
import { ContratosModule } from './modules/contratos/ContratosModule';
import { CtrRoute } from './modules/contratos/context';
import { contractCan } from '../shared/contratos/rules';
import { canCreateQuotation, canManageCustomers } from '../shared/orcamentos/permissions';
import { ModuleKey, hasModule } from '../shared/acesso';
import { OsModule } from './modules/os/OsModule';
import { OsRoute } from './modules/os/context';
import { LogisticaModule } from './modules/logistica/LogisticaModule';
import { LogRoute } from './modules/logistica/context';
import { NotificacoesModule } from './modules/notificacoes/NotificacoesModule';
import { NotificationLink } from '../shared/notificacoes/types';

// Documentos Oficiais (Item 3 do Prompt Mestre)
import { ContratoDocument } from './components/documents/ContratoDocument';
import { ComprovanteDevolucaoDocument } from './components/documents/ComprovanteDevolucaoDocument';
import { FaturaDocument } from './components/documents/FaturaDocument';

import { Contrato, ComprovanteDevolucao, Fatura } from './types';

const MainAppContent: React.FC = () => {
  const { clientes, equipamentos, configEmpresa, pagarFatura, authUser } = useApp();

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [orcRoute, setOrcRoute] = useState<OrcRoute>({ page: 'painel' });

  const [stockRoute, setStockRoute] = useState<StockRoute>({ page: 'painel' });
  const openEstoque = (page: string) => {
    setActiveTab('estoque');
    setStockRoute(page === 'pecas' ? { page: 'itens', kind: 'peca' } : page === 'peca_nova' ? { page: 'item_novo', kind: 'peca' } : ({ page } as StockRoute));
    window.scrollTo({ top: 0 });
  };

  const [finRoute, setFinRoute] = useState<FinRoute>({ page: 'dashboard' });
  const openFinanceiro = (page: FinRoute['page']) => {
    setActiveTab('financeiro');
    setFinRoute({ page } as FinRoute);
    window.scrollTo({ top: 0 });
  };

  const canFinance = !!authUser && financeCan.view(authUser);
  const openFinanceEntry = (r: { entryId: number } | { stockEntryId: number }) => {
    setActiveTab('financeiro');
    setFinRoute('entryId' in r ? { page: 'titulo', id: r.entryId } : { page: 'novo', type: 'pagar', stockEntryId: r.stockEntryId });
    window.scrollTo({ top: 0 });
  };

  const canContracts = !!authUser && contractCan.view(authUser);
  const [ctrRoute, setCtrRoute] = useState<CtrRoute>({ page: 'painel' });
  const openContratos = (page: CtrRoute['page']) => {
    setActiveTab('contratos_mod');
    setCtrRoute({ page } as CtrRoute);
    window.scrollTo({ top: 0 });
  };
  const openContract = (contractNumber: string) => {
    fetch(`/api/contracts?q=${encodeURIComponent(contractNumber)}`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((r) => {
        const c = r.rows?.find((x: { contract_number: string }) => x.contract_number === contractNumber);
        setActiveTab('contratos_mod');
        setCtrRoute(c ? { page: 'detalhe', id: c.id } : { page: 'painel' });
        window.scrollTo({ top: 0 });
      })
      .catch(() => openContratos('painel'));
  };

  const [osRoute, setOsRoute] = useState<OsRoute>({ page: 'painel' });
  const openOs = (page: OsRoute['page'] | OsRoute) => {
    setActiveTab('os');
    setOsRoute(typeof page === 'string' ? ({ page } as OsRoute) : page);
    window.scrollTo({ top: 0 });
  };

  const [logRoute, setLogRoute] = useState<LogRoute>({ page: 'painel' });
  const openLog = (key: string) => {
    setActiveTab('logistica_mod');
    setLogRoute(key === 'nova_entrega' ? { page: 'nova', type: 'entrega' } : key === 'nova_retirada' ? { page: 'nova', type: 'retirada' } : ({ page: key } as LogRoute));
    window.scrollTo({ top: 0 });
  };
  const logMenuKey = logRoute.page === 'nova' ? (logRoute.type === 'entrega' ? 'nova_entrega' : 'nova_retirada') : logRoute.page === 'detalhe' ? 'painel' : logRoute.page;

  const openOrcamentos = (page: OrcRoute['page']) => {
    setActiveTab('orcamentos');
    setOrcRoute({ page } as OrcRoute);
    window.scrollTo({ top: 0 });
  };
  const [notifTab, setNotifTab] = useState<'lista' | 'config' | 'processamento'>('lista');
  /** Abre o registro de origem de uma notificação no módulo correspondente. */
  const openNotificationLink = (l: { module: string; page: string; id?: number }) => {
    const go = (tab: ActiveTab) => (setActiveTab(tab), window.scrollTo({ top: 0 }));
    if (l.module === 'contratos') l.id ? (setCtrRoute({ page: 'detalhe', id: l.id }), go('contratos_mod')) : openContratos(l.page as CtrRoute['page']);
    else if (l.module === 'financeiro') l.id ? openFinanceEntry({ entryId: l.id }) : openFinanceiro(l.page as FinRoute['page']);
    else if (l.module === 'estoque') (setStockRoute(l.id ? ({ page: l.page, id: l.id } as StockRoute) : ({ page: l.page } as StockRoute)), go('estoque'));
    else if (l.module === 'os') openOs(l.id ? { page: 'detalhe', id: l.id } : (l.page as OsRoute['page']));
    else if (l.module === 'logistica') (setLogRoute(l.id ? { page: 'detalhe', id: l.id } : ({ page: l.page } as LogRoute)), go('logistica_mod'));
    else if (l.module === 'orcamentos') l.id ? (setOrcRoute({ page: 'detalhe', id: l.id }), go('orcamentos')) : openOrcamentos(l.page as OrcRoute['page']);
    else (setNotifTab(l.page === 'processamento' ? 'processamento' : l.page === 'config' ? 'config' : 'lista'), go('notificacoes'));
  };
  const painelAction = (a: PainelAction) => {
    if (a === 'novo_orcamento') openOrcamentos('novo');
    else if (a === 'novo_contrato') openContratos('novo');
    else if (a === 'nova_entrega') openLog('nova_entrega');
    else if (a === 'nova_retirada') openLog('nova_retirada');
    else if (a === 'disponibilidade') openEstoque('disponibilidade');
    else (setNotifTab('lista'), setActiveTab('notificacoes'), window.scrollTo({ top: 0 }));
  };
  const canAccess = (m: ModuleKey) => !!authUser && hasModule(authUser, m);
  // aba aberta que o usuário não pode usar (ex.: acesso retirado pelo administrador) volta para o painel
  const TAB_MODULES: Partial<Record<ActiveTab, ModuleKey[]>> = {
    orcamentos: ['orcamentos', 'manutencao', 'clientes'],
    contratos_mod: ['contratos'],
    estoque: ['estoque'],
    logistica_mod: ['operacao'],
    os: ['manutencao'],
    financeiro: ['financeiro'],
  };
  const tabAllowed = !TAB_MODULES[activeTab] || TAB_MODULES[activeTab]!.some(canAccess);
  useEffect(() => {
    if (authUser && !tabAllowed) setActiveTab('dashboard');
  }, [authUser, tabAllowed]);
  const openManutencao = (page: 'novo' | 'lista') => {
    setActiveTab('orcamentos');
    setOrcRoute(page === 'novo' ? { page: 'novo', modo: 'manutencao' } : { page: 'lista', filters: { type: 'manutencao' }, label: 'Manutenção' });
    window.scrollTo({ top: 0 });
  };
  const manutencaoPage: 'novo' | 'lista' | null =
    orcRoute.page === 'novo' && orcRoute.modo === 'manutencao' ? 'novo' : orcRoute.page === 'lista' && orcRoute.filters?.type === 'manutencao' ? 'lista' : null;
  const openClientes = (novo: boolean) => {
    setActiveTab('orcamentos');
    setOrcRoute(novo ? { page: 'clientes', novo: Date.now() } : { page: 'clientes' });
    window.scrollTo({ top: 0 });
  };
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);

  // Controle de Visualização/Impressão de Documentos Oficiais
  const [documentoContrato, setDocumentoContrato] = useState<Contrato | null>(null);
  const [documentoDevolucao, setDocumentoDevolucao] = useState<ComprovanteDevolucao | null>(null);
  const [documentoFatura, setDocumentoFatura] = useState<Fatura | null>(null);

  // Modais de Ação Rápida
  const [novoContratoModalOpen, setNovoContratoModalOpen] = useState(false);
  const [novaDevolucaoModalOpen, setNovaDevolucaoModalOpen] = useState(false);

  // Se estiver visualizando o Contrato Oficial (Item 3.1)
  if (documentoContrato) {
    const cli = clientes.find((c) => c.id === documentoContrato.clienteId) || clientes[0];
    const obr = cli?.obras.find((o) => o.id === documentoContrato.obraId);
    return (
      <ContratoDocument
        contrato={documentoContrato}
        cliente={cli}
        obra={obr}
        equipamentos={equipamentos}
        empresa={configEmpresa}
        onBack={() => setDocumentoContrato(null)}
      />
    );
  }

  // Se estiver visualizando o Comprovante de Devolução (Item 3.2)
  if (documentoDevolucao) {
    const cli = clientes.find((c) => c.id === documentoDevolucao.clienteId) || clientes[0];
    const obr = cli?.obras.find((o) => o.id === documentoDevolucao.obraId);
    // Find contrato reference
    const cnt = {
      id: documentoDevolucao.contratoId,
      numeroContrato: '009537',
      dataEmissao: '2026-08-04',
      clienteId: cli.id,
      obraId: obr?.id || '',
      status: 'ativo' as const,
      itens: [],
      freteEntrega: 0,
      freteRecolhimento: 0,
      modalidadeTransporte: 'entrega_locadora' as const,
      totalMensalEstimado: 0,
      aditivos: [],
      responsavelLocadora: 'Balcão',
    };

    return (
      <ComprovanteDevolucaoDocument
        devolucao={documentoDevolucao}
        cliente={cli}
        obra={obr}
        contrato={cnt}
        empresa={configEmpresa}
        onBack={() => setDocumentoDevolucao(null)}
      />
    );
  }

  // Se estiver visualizando a Fatura com Canhoto e PIX (Item 3.3)
  if (documentoFatura) {
    const cli = clientes.find((c) => c.id === documentoFatura.clienteId) || clientes[0];
    return (
      <FaturaDocument
        fatura={documentoFatura}
        cliente={cli}
        empresa={configEmpresa}
        onBack={() => setDocumentoFatura(null)}
        onMarcarPaga={() => {
          pagarFatura(documentoFatura.id);
          setDocumentoFatura({ ...documentoFatura, status: 'paga' });
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-900 flex flex-col font-sans">
      {/* Barra de Navegação */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        orcamentosPage={orcRoute.page}
        onOpenOrcamentos={openOrcamentos}
        estoquePage={(stockRoute.page === 'itens' || stockRoute.page === 'item_novo') && stockRoute.kind === 'peca' ? (stockRoute.page === 'itens' ? 'pecas' : 'peca_nova') : stockRoute.page}
        onOpenEstoque={openEstoque}
        financeiroPage={canFinance ? finRoute.page : null}
        onOpenFinanceiro={openFinanceiro}
        contratosPage={canContracts ? ctrRoute.page : null}
        onOpenContratos={openContratos}
        osPage={osRoute.page}
        onOpenOs={openOs}
        logPage={logMenuKey}
        onOpenLog={openLog}
        onOpenQuickSearch={() => setQuickSearchOpen(true)}
        onOpenNotificationLink={openNotificationLink}
        onOpenClientes={openClientes}
        onOpenManutencao={openManutencao}
        manutencaoPage={manutencaoPage}
        canCreateQuotation={!!authUser && canCreateQuotation(authUser) && hasModule(authUser, 'orcamentos')}
        canAccess={canAccess}
        canCreateCustomer={!!authUser && canManageCustomers(authUser)}
      />

      {/* Conteúdo Principal */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Módulo de Orçamentos (páginas escolhidas no submenu "Orçamentos" do menu principal) */}
        {activeTab === 'orcamentos' && authUser && <OrcamentosModule user={authUser} route={orcRoute} onNavigate={setOrcRoute} openFinance={canFinance ? (entryId) => openFinanceEntry({ entryId }) : undefined} openContract={canContracts ? openContract : undefined} />}

        {activeTab === 'dashboard' && authUser && <PainelGeral user={authUser} onOpenLink={openNotificationLink} onAction={painelAction} />}

        {activeTab === 'contratos' && (
          <ContratosView
            onSelectContratoPrint={(cnt) => setDocumentoContrato(cnt)}
            isCreateModalOpen={novoContratoModalOpen}
            setIsCreateModalOpen={setNovoContratoModalOpen}
          />
        )}

        {activeTab === 'devolucoes' && (
          <DevolucoesView
            onSelectDevolucaoPrint={(dev) => setDocumentoDevolucao(dev)}
            isCreateModalOpen={novaDevolucaoModalOpen}
            setIsCreateModalOpen={setNovaDevolucaoModalOpen}
          />
        )}

        {activeTab === 'estoque' && authUser && <EstoqueModule user={authUser} route={stockRoute} onNavigate={setStockRoute} openFinance={canFinance ? openFinanceEntry : undefined} />}

        {activeTab === 'contratos_mod' && authUser && (
          <ContratosModule user={authUser} route={ctrRoute} onNavigate={setCtrRoute} openFinance={canFinance ? (entryId) => openFinanceEntry({ entryId }) : undefined} openCustomers={() => openOrcamentos('clientes')} />
        )}

        {activeTab === 'logistica_mod' && authUser && (
          <LogisticaModule user={authUser} route={logRoute} onNavigate={setLogRoute} openContract={canContracts ? openContract : undefined} />
        )}

        {activeTab === 'os' && authUser && (
          <OsModule user={authUser} route={osRoute} onNavigate={setOsRoute} openFinance={canFinance ? (entryId) => openFinanceEntry({ entryId }) : undefined} openContract={canContracts ? openContract : undefined} />
        )}

        {activeTab === 'financeiro' && authUser && <FinanceiroModule user={authUser} route={finRoute} onNavigate={setFinRoute} />}

        {activeTab === 'clientes' && <ClientesView />}

        {activeTab === 'manutencao' && <ManutencaoView />}

        {activeTab === 'logistica' && <LogisticaView />}

        {activeTab === 'notificacoes' && authUser && <NotificacoesModule user={authUser} onOpenLink={openNotificationLink} initialTab={notifTab} />}

        {activeTab === 'configuracoes' && <ConfiguracoesView />}
      </main>

      {/* Rodapé Corporativo com Lynus Tecnologia */}
      <footer className="bg-slate-900 text-slate-400 border-t border-slate-800 py-4 px-4 text-xs select-none print:hidden">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-2">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-white">Central Locadora Rio Preto</span>
            <span>•</span>
            <span>São José do Rio Preto – SP</span>
            <span>•</span>
            <span>CNPJ: {configEmpresa.cnpj}</span>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-slate-300">
            <span>Desenvolvido por</span>
            <span className="font-black text-white bg-slate-800 px-2 py-0.5 rounded border border-slate-700 tracking-wider">
              LYNUS TECNOLOGIA
            </span>
            <span>v2.4.0 (Substituição i3tech)</span>
          </div>
        </div>
      </footer>

      {/* Modal de Busca Rápida (Ctrl + K) */}
      <QuickSearchModal
        isOpen={quickSearchOpen}
        onClose={() => setQuickSearchOpen(false)}
        onNavigate={(tab) => {
          setActiveTab(tab);
        }}
      />
    </div>
  );
};

const AuthGate: React.FC = () => {
  const { usuarioAtual, authLoading } = useApp();
  if (authLoading) {
    return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400 text-sm">Carregando...</div>;
  }
  return usuarioAtual ? <MainAppContent /> : <LoginView />;
};

export default function App() {
  return (
    <AppProvider>
      <AuthGate />
    </AppProvider>
  );
}
