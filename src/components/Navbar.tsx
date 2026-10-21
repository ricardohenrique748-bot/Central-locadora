/**
 * Central Locação - Barra de Navegação e Cabeçalho do Sistema
 * Cores da Marca: Azul (#2AA3D8), Vermelho (#D9332B), Grafite (#4A4A4A), Laranja (#E07A2E)
 */

import React from 'react';
import logo from '../assets/logo-central-locadora.png';
import {
  LayoutDashboard,
  FileSpreadsheet,
  RotateCcw,
  Boxes,
  Users,
  Truck,
  Settings,
  Search,
  LogOut,
  FileText,
  FilePlus2,
  FileStack,
  BarChart3,
  Package,
  Warehouse,
  PackagePlus,
  Tag,
  CalendarCheck,
  ArrowLeftRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  ClipboardList,
  Factory,
  Landmark,
  Wallet,
  HandCoins,
  TrendingUp,
  Banknote,
  ListOrdered,
  FolderTree,
  Target,
  FileCheck2,
  AlertOctagon,
  FileSignature,
  PackageCheck,
  ShieldAlert,
  IdCard,
  Bell,
  UserPlus,
  Wrench,
  Cog,
  Ruler,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Route } from '../modules/orcamentos/context';
import { StockRoute } from '../modules/estoque/context';
import { FinRoute } from '../modules/financeiro/context';
import { CtrRoute } from '../modules/contratos/context';
import { OsRoute } from '../modules/os/context';
import { LogRoute } from '../modules/logistica/context';
import { NotificationBell } from './NotificationBell';
import { NotificationLink } from '../../shared/notificacoes/types';
import { ModuleKey } from '../../shared/acesso';

/** Páginas internas do estoque destacam o item de menu correspondente. */
/** Páginas internas do financeiro destacam o item de menu correspondente. */
const FIN_MENU_PAGE: Partial<Record<FinRoute['page'], string>> = { titulo: 'pagar', editar: 'pagar', novo: 'pagar' };
/** Páginas internas dos contratos destacam o item de menu correspondente. */
const CTR_MENU_PAGE: Partial<Record<CtrRoute['page'], string>> = { detalhe: 'painel', editar: 'painel' };
/** Páginas internas das OS destacam o item de menu correspondente. */
const OS_MENU_PAGE: Partial<Record<OsRoute['page'], string>> = { detalhe: 'painel' };
const STOCK_MENU_PAGE: Partial<Record<StockRoute['page'], string>> = { item: 'itens', item_editar: 'itens', ativo: 'ativos', entrada: 'entradas', transferencia: 'transferencias', inventario_det: 'inventario' };
import { DropdownNavigation, DropdownNavItem } from './ui/dropdown-navigation';

export type ActiveTab =
  | 'dashboard'
  | 'orcamentos'
  | 'contratos'
  | 'contratos_mod'
  | 'os'
  | 'logistica_mod'
  | 'devolucoes'
  | 'estoque'
  | 'financeiro'
  | 'clientes'
  | 'manutencao'
  | 'logistica'
  | 'notificacoes'
  | 'configuracoes';

type OrcPage = Route['page'];

interface NavbarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  orcamentosPage: OrcPage;
  onOpenOrcamentos: (page: OrcPage) => void;
  /** página do estoque (ou "pecas" / "peca_nova" quando filtrado por peças) */
  estoquePage: string;
  onOpenEstoque: (page: string) => void;
  /** null = usuário sem acesso ao Financeiro (o grupo não aparece). */
  financeiroPage: FinRoute['page'] | null;
  onOpenFinanceiro: (page: FinRoute['page']) => void;
  /** null = usuário sem acesso aos Contratos. */
  contratosPage: CtrRoute['page'] | null;
  onOpenContratos: (page: CtrRoute['page']) => void;
  osPage: OsRoute['page'];
  onOpenOs: (page: OsRoute['page']) => void;
  logPage: string;
  onOpenLog: (page: string) => void;
  onOpenQuickSearch?: () => void;
  onOpenNotificationLink: (link: NotificationLink) => void;
  onOpenClientes: (novo: boolean) => void;
  canCreateCustomer: boolean;
  onOpenManutencao: (page: 'novo' | 'lista') => void;
  /** página de manutenção aberta (orçamentos filtrados por manutenção), para destacar o menu */
  manutencaoPage: 'novo' | 'lista' | null;
  canCreateQuotation: boolean;
  canAccess: (m: ModuleKey) => boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  orcamentosPage,
  onOpenOrcamentos,
  estoquePage,
  onOpenEstoque,
  financeiroPage,
  onOpenFinanceiro,
  contratosPage,
  onOpenContratos,
  osPage,
  onOpenOs,
  logPage,
  onOpenLog,
  onOpenQuickSearch,
  onOpenNotificationLink,
  onOpenClientes,
  canCreateCustomer,
  onOpenManutencao,
  manutencaoPage,
  canCreateQuotation,
  canAccess,
}) => {
  const { usuarioAtual, logout, contratos } = useApp();

  const contratosAtivos = contratos.filter((c) => c.status === 'ativo').length;

  const allItems: DropdownNavItem[] = [
    { id: 'dashboard', label: 'Painel Geral', icon: LayoutDashboard },
    {
      id: 'grupo-orcamentos',
      label: 'Orçamentos',
      icon: FileText,
      subMenus: [
        {
          title: 'Propostas',
          items: [
            { id: 'orc:painel', label: 'Painel de Orçamentos', description: 'Indicadores e propostas vencendo', icon: LayoutDashboard },
            { id: 'orc:novo', label: 'Novo Orçamento', description: 'Proposta de venda ou locação', icon: FilePlus2 },
            { id: 'orc:lista', label: 'Todos os Orçamentos', description: 'Pesquisa, filtros e exportação', icon: FileStack },
            { id: 'orc:relatorios', label: 'Relatórios', description: 'Conversão, recusas e vencimentos', icon: BarChart3 },
          ],
        },
        {
          title: 'Ajustes',
          items: [
            { id: 'orc:config', label: 'Configurações', description: 'Alçadas, modelos e usuários', icon: Settings },
          ],
        },
      ],
    },
    {
      id: 'grupo-clientes',
      label: 'Clientes',
      icon: Users,
      subMenus: [
        {
          title: 'Cadastro de clientes',
          items: [
            { id: 'cli:lista', label: 'Clientes cadastrados', description: 'Pesquisa, edição e inativação', icon: Users },
            ...(canCreateCustomer ? [{ id: 'cli:novo', label: 'Novo cliente', description: 'Pessoa física ou jurídica, com endereço e contato', icon: UserPlus }] : []),
          ],
        },
      ],
    },
    ...(contratosPage === null
      ? []
      : [
          {
            id: 'grupo-contratos',
            label: 'Contratos',
            icon: FileSignature,
            subMenus: [
              {
                title: 'Contratos',
                items: [
                  { id: 'ctr:painel', label: 'Painel de Contratos', description: 'Indicadores, pesquisa e lista', icon: LayoutDashboard },
                  { id: 'ctr:novo', label: 'Novo Contrato', description: 'Locação ou venda', icon: FilePlus2 },
                  { id: 'ctr:orcamento', label: 'Gerar de Orçamento', description: 'Orçamentos de locação aprovados', icon: FileStack },
                ],
              },
              {
                title: 'Acompanhamento',
                items: [
                  { id: 'ctr:alertas', label: 'Alertas', description: 'Vencimentos, devoluções e cobranças', icon: Bell },
                  { id: 'ctr:relatorios', label: 'Relatórios', description: 'Carteira, renovações e avarias', icon: BarChart3 },
                  { id: 'ctr:config', label: 'Configurações', description: 'Fluxo, alertas e modelo', icon: Settings },
                ],
              },
            ],
          } as DropdownNavItem,
        ]),
    {
      id: 'grupo-estoque',
      label: 'Estoque',
      icon: Warehouse,
      subMenus: [
        {
          title: 'Consulta',
          items: [
            { id: 'est:painel', label: 'Painel de Estoque', description: 'Indicadores, valores e alertas', icon: LayoutDashboard },
            { id: 'est:itens', label: 'Produtos e Equipamentos', description: 'Saldos por item e local', icon: Package },
            { id: 'est:item_novo', label: 'Cadastro de Item', description: 'Novo produto, peça ou equipamento', icon: PackagePlus },
            { id: 'est:pecas', label: 'Peças de Reposição', description: 'Saldos e cadastro das peças', icon: Cog },
            { id: 'est:peca_nova', label: 'Cadastro de Peça', description: 'Nova peça para conserto e manutenção', icon: PackagePlus },
            { id: 'est:ativos', label: 'Equipamentos Individuais', description: 'Patrimônio, série e histórico', icon: Tag },
            { id: 'est:disponibilidade', label: 'Disponibilidade para Locação', description: 'Agenda, reservas, entrega e retorno', icon: CalendarCheck },
          ],
        },
        {
          title: 'Movimentação',
          items: [
            { id: 'est:movimentacoes', label: 'Movimentações', description: 'Histórico auditável e estornos', icon: ArrowLeftRight },
            { id: 'est:entradas', label: 'Entradas de Estoque', description: 'Compras e implantação', icon: ArrowDownToLine },
            { id: 'est:saidas', label: 'Saídas de Estoque', description: 'Consumo, perda, avaria', icon: ArrowUpFromLine },
            { id: 'est:transferencias', label: 'Transferências', description: 'Entre depósitos e locais', icon: Truck },
            { id: 'est:inventario', label: 'Inventário', description: 'Contagem física e ajustes', icon: ClipboardList },
          ],
        },
        {
          title: 'Cadastros e análises',
          items: [
            { id: 'est:fornecedores', label: 'Fornecedores', description: 'Cadastro de fornecedores', icon: Factory },
            { id: 'est:relatorios', label: 'Relatórios', description: 'Posição, patrimônio, utilização', icon: BarChart3 },
            { id: 'est:config', label: 'Configurações', description: 'Locais, categorias, unidades', icon: Settings },
          ],
        },
      ],
    },
    {
      id: 'grupo-operacao',
      label: 'Operação',
      icon: Boxes,
      subMenus: [
        {
          title: 'Entregas e Devoluções',
          items: [
            { id: 'log:painel', label: 'Painel de Entregas', description: 'Programação, transporte e pendências', icon: Truck },
            { id: 'log:nova_entrega', label: 'Nova Entrega', description: 'A partir de contrato ativo', icon: PackageCheck },
            { id: 'log:nova_retirada', label: 'Retirada / Devolução', description: 'Recolhimento e recebimento', icon: RotateCcw },
            { id: 'log:ocorrencias', label: 'Avarias e Ocorrências', description: 'Análise e cobrança aprovada', icon: ShieldAlert },
            { id: 'log:cadastros', label: 'Motoristas e Veículos', description: 'Cadastros da logística', icon: IdCard },
            { id: 'log:relatorios', label: 'Relatórios de Entregas', description: 'Prazos, inspeções, custos', icon: BarChart3 },
          ],
        },
        {
          title: 'Movimentação',
          items: [
            { id: 'contratos', label: 'Contratos antigos', description: 'Registros anteriores salvos no navegador', icon: FileSpreadsheet, badge: contratosAtivos },
            { id: 'devolucoes', label: 'Devoluções antigas', description: 'Registros anteriores salvos no navegador', icon: RotateCcw },
            { id: 'logistica', label: 'Logística & Pátio antigos', description: 'Registros anteriores salvos no navegador', icon: Truck },
          ],
        },
      ],
    },
    {
      id: 'grupo-manutencao',
      label: 'Manutenção',
      icon: Wrench,
      subMenus: [
        {
          title: 'Manutenção de equipamentos',
          items: [
            ...(canCreateQuotation ? [{ id: 'man:novo', label: 'Novo orçamento de manutenção', description: 'Equipamento do cliente, peças e mão de obra', icon: FilePlus2 }] : []),
            { id: 'man:lista', label: 'Orçamentos de manutenção', description: 'Acompanhar, aprovar e converter', icon: FileStack },
          ],
        },
      ],
    },
    ...(financeiroPage === null
      ? []
      : [
          {
            id: 'grupo-financeiro',
            label: 'Financeiro',
            icon: Landmark,
            subMenus: [
              {
                title: 'Contas',
                items: [
                  { id: 'fin:dashboard', label: 'Dashboard Financeiro', description: 'Saldos, vencimentos e resultado', icon: LayoutDashboard },
                  { id: 'fin:pagar', label: 'Contas a Pagar', description: 'Despesas, parcelas e aprovações', icon: ArrowUpFromLine },
                  { id: 'fin:receber', label: 'Contas a Receber', description: 'Recebíveis de vendas e serviços', icon: ArrowDownToLine },
                  { id: 'fin:faturas', label: 'Faturas e Medições', description: 'Fatura de locação e boletim de medição', icon: Ruler },
                  { id: 'fin:inadimplencia', label: 'Inadimplência', description: 'Clientes em atraso por faixa', icon: AlertOctagon },
                ],
              },
              {
                title: 'Tesouraria',
                items: [
                  { id: 'fin:fluxo', label: 'Fluxo de Caixa', description: 'Realizado e projetado', icon: TrendingUp },
                  { id: 'fin:contas', label: 'Caixa e Bancos', description: 'Saldos e fechamento de caixa', icon: Wallet },
                  { id: 'fin:lancamentos', label: 'Lançamentos Financeiros', description: 'Movimentações, comprovantes e estornos', icon: ListOrdered },
                  { id: 'fin:transferencias', label: 'Transferências', description: 'Entre contas próprias', icon: ArrowLeftRight },
                  { id: 'fin:conciliacao', label: 'Conciliação Bancária', description: 'Importar extrato CSV/OFX', icon: FileCheck2 },
                ],
              },
              {
                title: 'Cadastros e análises',
                items: [
                  { id: 'fin:categorias', label: 'Categorias Financeiras', description: 'Plano de receitas e despesas', icon: FolderTree },
                  { id: 'fin:centros', label: 'Centros de Custo', description: 'Áreas e rateios', icon: Target },
                  { id: 'fin:relatorios', label: 'Relatórios', description: 'DRE gerencial e exportações', icon: BarChart3 },
                  { id: 'fin:config', label: 'Configurações', description: 'Alçadas e regras', icon: Settings },
                ],
              },
            ],
          } as DropdownNavItem,
        ]),
    { id: 'notificacoes', label: 'Notificações', icon: Bell },
    { id: 'configuracoes', label: 'Configurações', icon: Settings },
  ];
  // cada usuário só vê as abas que o administrador liberou
  const GROUP_MODULE: Record<string, ModuleKey> = {
    'grupo-orcamentos': 'orcamentos',
    'grupo-clientes': 'clientes',
    'grupo-contratos': 'contratos',
    'grupo-estoque': 'estoque',
    'grupo-operacao': 'operacao',
    'grupo-manutencao': 'manutencao',
    'grupo-financeiro': 'financeiro',
  };
  const navItems = allItems.filter((i) => !GROUP_MODULE[i.id] || canAccess(GROUP_MODULE[i.id]));

  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40 select-none print:hidden">
      {/* Faixa Superior com Logo e Ações Rápidas */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3 cursor-pointer shrink-0" onClick={() => setActiveTab('dashboard')} title="Painel geral">
            <img src={logo} alt="Central Locadora Rio Preto" className="h-11 w-auto" />
            <p className="hidden lg:block text-[10px] text-slate-400 font-medium leading-tight">
              Gestão de equipamentos
              <br />
              <span className="text-slate-300">Lynus Tecnologia</span>
            </p>
          </div>

          {/* Busca Rápida Balcão */}
          <div className="flex-1 max-w-md hidden md:block">
            <button
              onClick={onOpenQuickSearch}
              className="w-full flex items-center justify-between px-3.5 py-2 text-xs text-slate-400 bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 rounded-lg transition-all focus:outline-hidden focus:ring-2 focus:ring-[#2AA3D8]"
            >
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4 text-slate-400" />
                <span>Buscar cliente, contrato, equipamento ou patrimônio...</span>
              </div>
              <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono text-slate-400 bg-slate-900 border border-slate-700 rounded">
                Ctrl + K
              </kbd>
            </button>
          </div>

          {/* Operador Logado */}
          <div className="flex items-center gap-2">
            <NotificationBell onOpenLink={onOpenNotificationLink} onOpenCenter={() => setActiveTab('notificacoes')} />
            <div className="hidden sm:flex items-center gap-2 bg-slate-800 border border-slate-700 px-2.5 py-1.5 rounded-lg text-xs">
              <span className="text-slate-400 text-[11px] hidden sm:inline">Operador:</span>
              <span className="text-white font-semibold">
                {usuarioAtual?.nome} ({usuarioAtual?.perfil.toUpperCase()})
              </span>
            </div>
            <button
              onClick={logout}
              title="Sair"
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-[#D9332B] border border-slate-700 hover:border-[#D9332B] px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
      </div>

      {/* Barra de Menus com submenus */}
      <div className="bg-slate-950/70 border-t border-slate-800/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-1">
          <DropdownNavigation
            navItems={navItems}
            activeId={activeTab === 'orcamentos' && manutencaoPage ? `man:${manutencaoPage}` : activeTab === 'orcamentos' && orcamentosPage === 'clientes' ? 'cli:lista' : activeTab === 'orcamentos' ? `orc:${orcamentosPage === 'detalhe' || orcamentosPage === 'editar' ? 'lista' : orcamentosPage}` : activeTab === 'estoque' ? `est:${STOCK_MENU_PAGE[estoquePage as StockRoute['page']] || estoquePage}` : activeTab === 'financeiro' && financeiroPage ? `fin:${FIN_MENU_PAGE[financeiroPage] || financeiroPage}` : activeTab === 'contratos_mod' && contratosPage ? `ctr:${CTR_MENU_PAGE[contratosPage] || contratosPage}` : activeTab === 'os' ? `os:${OS_MENU_PAGE[osPage] || osPage}` : activeTab === 'logistica_mod' ? `log:${logPage}` : activeTab}
            onSelect={(id) => (id.startsWith('man:') ? onOpenManutencao(id.slice(4) as 'novo' | 'lista') : id.startsWith('cli:') ? onOpenClientes(id === 'cli:novo') : id.startsWith('orc:') ? onOpenOrcamentos(id.slice(4) as OrcPage) : id.startsWith('est:') ? onOpenEstoque(id.slice(4)) : id.startsWith('fin:') ? onOpenFinanceiro(id.slice(4) as FinRoute['page']) : id.startsWith('ctr:') ? onOpenContratos(id.slice(4) as CtrRoute['page']) : id.startsWith('os:') ? onOpenOs(id.slice(3) as OsRoute['page']) : id.startsWith('log:') ? onOpenLog(id.slice(4)) : setActiveTab(id as ActiveTab))}
          />
        </div>
      </div>
    </header>
  );
};
