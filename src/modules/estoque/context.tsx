/**
 * Contexto do módulo de Estoque: usuário, configurações, locais e navegação interna.
 */

import { createContext, useContext } from 'react';
import { AuthUser } from '../../../shared/orcamentos/types';
import type { ItemKind } from '../../../shared/estoque/types';
import { StockLocation, StockSettings } from '../../../shared/estoque/types';

export type StockRoute =
  | { page: 'painel' }
  | { page: 'itens'; situation?: string; kind?: ItemKind }
  | { page: 'item_novo'; kind?: ItemKind }
  | { page: 'item_editar'; id: number }
  | { page: 'item'; id: number }
  | { page: 'ativos'; status?: string }
  | { page: 'ativo'; id: number }
  | { page: 'movimentacoes' }
  | { page: 'entradas' }
  | { page: 'entrada'; id?: number }
  | { page: 'saidas' }
  | { page: 'transferencias' }
  | { page: 'transferencia'; id?: number }
  | { page: 'inventario' }
  | { page: 'inventario_det'; id: number }
  | { page: 'disponibilidade' }
  | { page: 'fornecedores' }
  | { page: 'relatorios' }
  | { page: 'config' };

export interface StockCtx {
  user: AuthUser;
  settings: StockSettings;
  locations: StockLocation[];
  reload: () => void;
  route: StockRoute;
  navigate: (r: StockRoute) => void;
  /** Abre o Financeiro: título existente ou nova conta a pagar da entrada (ausente sem acesso). */
  openFinance?: (r: { entryId: number } | { stockEntryId: number }) => void;
  /** Abre uma OS existente ou a abertura de OS para o equipamento. */
  openOs?: (r: { orderId?: number; assetId?: number }) => void;
}

const Ctx = createContext<StockCtx | null>(null);
export const StockProvider = Ctx.Provider;

export function useStock() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useStock fora do módulo de estoque');
  return c;
}
