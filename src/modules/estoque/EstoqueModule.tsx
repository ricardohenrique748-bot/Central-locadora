/**
 * Central Locadora - Módulo de Estoque: carrega configurações e locais, trilha, pesquisa rápida e roteamento.
 * A navegação entre páginas fica no submenu "Estoque" do menu principal.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { AuthUser } from '../../../shared/orcamentos/types';
import { StockLocation, StockSettings } from '../../../shared/estoque/types';
import { api, qs } from '../orcamentos/api';
import { ErrorState, Input, Loading, ToastProvider, useDebounced } from '../orcamentos/ui';
import { StockCtx, StockProvider, StockRoute } from './context';
import { PainelEstoque } from './views/PainelEstoque';
import { ItensView, ItemDetalhe, ItemForm } from './views/Itens';
import { AtivosView, AtivoFicha } from './views/Ativos';
import { MovimentacoesView, SaidasView } from './views/Movimentacoes';
import { EntradasView, EntradaForm } from './views/Entradas';
import { TransferenciasView, TransferenciaForm } from './views/Transferencias';
import { InventarioView, InventarioDetalhe } from './views/Inventario';
import { DisponibilidadeView } from './views/Disponibilidade';
import { FornecedoresView } from './views/Fornecedores';
import { RelatoriosEstoque } from './views/RelatoriosEstoque';
import { ConfigEstoque } from './views/ConfigEstoque';

export const STOCK_TITLES: Record<StockRoute['page'], string> = {
  painel: 'Painel de Estoque',
  itens: 'Produtos e Equipamentos',
  item_novo: 'Cadastro de Item',
  item_editar: 'Editar Item',
  item: 'Item',
  ativos: 'Equipamentos Individuais',
  ativo: 'Ficha do Equipamento',
  movimentacoes: 'Movimentações',
  entradas: 'Entradas de Estoque',
  entrada: 'Entrada',
  saidas: 'Saídas de Estoque',
  transferencias: 'Transferências',
  transferencia: 'Transferência',
  inventario: 'Inventário',
  inventario_det: 'Inventário',
  disponibilidade: 'Disponibilidade para Locação',
  fornecedores: 'Fornecedores',
  relatorios: 'Relatórios',
  config: 'Configurações',
};

const PARENT: Partial<Record<StockRoute['page'], StockRoute>> = {
  item_editar: { page: 'itens' },
  item: { page: 'itens' },
  ativo: { page: 'ativos' },
  entrada: { page: 'entradas' },
  transferencia: { page: 'transferencias' },
  inventario_det: { page: 'inventario' },
};

const QuickSearch: React.FC<{ navigate: (r: StockRoute) => void }> = ({ navigate }) => {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ items: any[]; assets: any[]; documents: any[] } | null>(null);
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q, 250);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (dq.trim().length < 2) return setRes(null);
    api.get<typeof res>(`/stock/search${qs({ q: dq })}`).then(setRes).catch(() => setRes(null));
  }, [dq]);
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const go = (r: StockRoute) => {
    navigate(r);
    setOpen(false);
    setQ('');
  };
  const docRoute = (d: any): StockRoute =>
    d.type === 'entrada' ? { page: 'entrada', id: d.id } : d.type === 'transferencia' ? { page: 'transferencia', id: d.id } : d.type === 'inventario' ? { page: 'inventario_det', id: d.id } : d.type === 'reserva' ? { page: 'disponibilidade' } : { page: 'movimentacoes' };
  const empty = res && !res.items.length && !res.assets.length && !res.documents.length;
  return (
    <div className="relative w-full sm:w-80" ref={ref}>
      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <Input value={q} onFocus={() => setOpen(true)} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisa rápida: item, patrimônio, documento" className="pl-9 py-1.5 text-xs" aria-label="Pesquisa rápida no estoque" />
      {open && res && (
        <div className="absolute right-0 z-40 mt-1 w-full sm:w-96 bg-white border border-slate-200 rounded-lg shadow-xl max-h-96 overflow-y-auto text-sm">
          {empty && <p className="px-3 py-3 text-slate-500">Nada encontrado.</p>}
          {res.items.length > 0 && <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-slate-400">Itens</p>}
          {res.items.map((i) => (
            <button key={`i${i.id}`} onClick={() => go({ page: 'item', id: i.id })} className="w-full text-left px-3 py-1.5 hover:bg-slate-50">
              <span className="font-mono text-xs text-slate-500 mr-1.5">{i.internal_code}</span>
              {i.description}
            </button>
          ))}
          {res.assets.length > 0 && <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-slate-400">Patrimônios</p>}
          {res.assets.map((a) => (
            <button key={`a${a.id}`} onClick={() => go({ page: 'ativo', id: a.id })} className="w-full text-left px-3 py-1.5 hover:bg-slate-50">
              <b>{a.asset_tag}</b> <span className="text-slate-500">• {a.description}</span>
            </button>
          ))}
          {res.documents.length > 0 && <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase text-slate-400">Documentos</p>}
          {res.documents.map((d) => (
            <button key={`d${d.type}${d.id}`} onClick={() => go(docRoute(d))} className="w-full text-left px-3 py-1.5 hover:bg-slate-50">
              <b>{d.number}</b> <span className="text-slate-500">• {d.type}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const EstoqueModule: React.FC<{ user: AuthUser; route: StockRoute; onNavigate: (r: StockRoute) => void; openFinance?: StockCtx['openFinance']; openOs?: StockCtx['openOs'] }> = ({ user, route, onNavigate, openFinance, openOs }) => {
  const [settings, setSettings] = useState<StockSettings | null>(null);
  const [locations, setLocations] = useState<StockLocation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    setError(null);
    Promise.all([api.get<StockSettings>('/stock/settings'), api.get<{ rows: StockLocation[] }>('/stock/locations')])
      .then(([s, l]) => {
        setSettings(s);
        setLocations(l.rows);
      })
      .catch((e) => setError(e.message));
  };
  useEffect(reload, []);

  const navigate = (r: StockRoute) => {
    onNavigate(r);
    window.scrollTo({ top: 0 });
  };

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!settings || !locations) return <Loading />;
  const parent = PARENT[route.page];

  return (
    <StockProvider value={{ user, settings, locations, reload, route, navigate, openFinance, openOs }}>
      <ToastProvider>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <nav aria-label="Trilha" className="flex items-center gap-1 text-xs text-slate-500 min-w-0">
            <button onClick={() => navigate({ page: 'painel' })} className="font-semibold hover:text-slate-800">
              Estoque
            </button>
            {route.page !== 'painel' && (
              <>
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                {parent && (
                  <>
                    <button onClick={() => navigate(parent)} className="hover:text-slate-800 whitespace-nowrap">
                      {STOCK_TITLES[parent.page]}
                    </button>
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  </>
                )}
                <span className="text-slate-800 font-semibold truncate">{STOCK_TITLES[route.page]}</span>
              </>
            )}
          </nav>
          <QuickSearch navigate={navigate} />
        </div>

        {route.page === 'painel' && <PainelEstoque />}
        {route.page === 'itens' && <ItensView key={`itens-${route.situation || ''}-${route.kind || ''}`} initialSituation={route.situation} initialKind={route.kind} />}
        {route.page === 'item_novo' && <ItemForm key={`novo-${route.kind || ''}`} initialKind={route.kind} />}
        {route.page === 'item_editar' && <ItemForm key={`e${route.id}`} id={route.id} />}
        {route.page === 'item' && <ItemDetalhe key={route.id} id={route.id} />}
        {route.page === 'ativos' && <AtivosView key={`ativos-${route.status || ''}`} initialStatus={route.status} />}
        {route.page === 'ativo' && <AtivoFicha key={route.id} id={route.id} />}
        {route.page === 'movimentacoes' && <MovimentacoesView />}
        {route.page === 'entradas' && <EntradasView />}
        {route.page === 'entrada' && <EntradaForm key={route.id || 'nova'} id={route.id} />}
        {route.page === 'saidas' && <SaidasView />}
        {route.page === 'transferencias' && <TransferenciasView />}
        {route.page === 'transferencia' && <TransferenciaForm key={route.id || 'nova'} id={route.id} />}
        {route.page === 'inventario' && <InventarioView />}
        {route.page === 'inventario_det' && <InventarioDetalhe key={route.id} id={route.id} />}
        {route.page === 'disponibilidade' && <DisponibilidadeView />}
        {route.page === 'fornecedores' && <FornecedoresView />}
        {route.page === 'relatorios' && <RelatoriosEstoque />}
        {route.page === 'config' && <ConfigEstoque />}
      </ToastProvider>
    </StockProvider>
  );
};
